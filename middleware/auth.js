const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Seller = require('../models/Seller');

// Why an account may not use the app right now, or null if it may. Used on every request AND at login, so a
// suspension takes effect immediately, even for a token that was issued before the suspension.
// (Suspending a shop changes the SHOP's status; suspending a person changes the USER's flags. Both are checked.)
async function accessBlock(user) {
  if (!user) return { status: 401, code: 'NO_USER', message: 'Not authorized — user no longer exists.' };
  if (user.isDeleted) return { status: 403, code: 'ACCOUNT_DELETED', message: 'This account no longer exists.' };
  if (user.isSuspended) {
    return { status: 403, code: 'ACCOUNT_SUSPENDED',
      message: user.suspendedReason ? `Your account has been suspended: ${user.suspendedReason}` : 'Your account has been suspended. Contact support for help.' };
  }
  if (user.role === 'seller') {
    const shop = await Seller.findOne({ user: user._id }).select('status').lean();
    if (shop && shop.status === 'suspended') {
      return { status: 403, code: 'ACCOUNT_SUSPENDED', message: 'Your shop has been suspended. Contact support for help.' };
    }
  }
  return null;
}

// Verifies the Bearer token from api.js's _headers() and attaches the
// full user document (minus password) to req.user.
async function protect(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Not authorized — no token provided.' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id);
    const blocked = user && user.role === 'admin' ? null : await accessBlock(user);   // an admin can never be locked out of the admin tools by a flag
    if (blocked) return res.status(blocked.status).json({ message: blocked.message, code: blocked.code });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Not authorized — invalid or expired token.' });
  }
}

// Usage: router.get('/admin-only', protect, requireRole('admin'), handler)
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have permission to do that.' });
    }
    next();
  };
}

// For public endpoints that behave differently for a logged-in admin
// (e.g. GET /sellers returns every status to an admin, only 'approved'
// to everyone else). Never rejects — just attaches req.user if a valid
// token is present, otherwise leaves it undefined.
async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) return next();
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (user && (user.role === 'admin' || !(await accessBlock(user)))) req.user = user;   // a suspended account is treated as a stranger
    next();
  } catch (err) {
    next(); // invalid/expired token on a public route — just proceed as anonymous
  }
}

module.exports = { protect, requireRole, optionalAuth, accessBlock };
