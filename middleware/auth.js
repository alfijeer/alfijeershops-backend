const jwt = require('jsonwebtoken');
const User = require('../models/User');

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
    if (!user) {
      return res.status(401).json({ message: 'Not authorized — user no longer exists.' });
    }
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
    if (user) req.user = user;
    next();
  } catch (err) {
    next(); // invalid/expired token on a public route — just proceed as anonymous
  }
}

module.exports = { protect, requireRole, optionalAuth };
