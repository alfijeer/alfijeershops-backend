const crypto = require('crypto');
const User = require('../models/User');
const Buyer = require('../models/Buyer');
const Seller = require('../models/Seller');
const generateToken = require('../utils/generateToken');
const sendEmail = require('../utils/sendEmail');
const { cleanBankDetails } = require('../utils/bankDetails');

// POST /api/auth/register
// Buyers send JSON (see auth.html completeBuyerReg): fullName, email, phone,
// password, state, city, role: 'buyer'.
// Sellers send multipart/form-data (see auth.html completeSellerReg):
// fullName, businessName, category, phone, whatsappNumber, state, city,
// address, latitude, longitude, description, email, password, role: 'seller',
// bankName, accountName, accountNumber (all three required: this is where buyers pay),
// plus optional govId and shopPhoto files.
async function register(req, res) {
  const { role } = req.body;

  if (role === 'seller') {
    return registerSeller(req, res);
  }
  return registerBuyer(req, res);
}

async function registerBuyer(req, res) {
  const { fullName, email, phone, password, state, city } = req.body;

  if (!fullName || !email || !phone || !password) {
    return res.status(400).json({ message: 'Full name, email, phone, and password are all required.' });
  }

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    return res.status(409).json({ message: 'An account with that email already exists.' });
  }

  const user = await User.create({ fullName, email, phone, password, state, city, role: 'buyer' });
  await Buyer.create({ user: user._id, state, city });

  const token = generateToken(user._id, user.role);
  res.status(201).json({ token, role: user.role, user: user.toPublicJSON() });
}

async function registerSeller(req, res) {
  const {
    fullName, businessName, category, phone, whatsappNumber,
    state, city, address, latitude, longitude, description, email, password,
  } = req.body;

  if (!fullName || !businessName || !phone || !state || !email || !password) {
    return res.status(400).json({ message: 'Please fill in all required fields.' });
  }

  // A seller cannot register without payment details, so every approved shop can receive money from day one.
  // Checked before anything is created, so a mistake here never leaves a half-made account behind.
  const bank = cleanBankDetails(req.body);
  if (!bank.ok) return res.status(400).json({ message: bank.message });

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    return res.status(409).json({ message: 'An account with that email already exists.' });
  }

  const user = await User.create({ fullName, email, phone, password, state, city, role: 'seller' });

  const shopPhotoFile = req.files?.shopPhoto?.[0];
  const govIdFile = req.files?.govId?.[0];

  const seller = await Seller.create({
    user: user._id,
    businessName,
    category: category || 'Other',
    whatsappNumber: whatsappNumber || phone,
    state,
    city,
    address,
    description,
    bankDetails: bank.value,
    latitude: latitude !== undefined && latitude !== '' ? Number(latitude) : null,
    longitude: longitude !== undefined && longitude !== '' ? Number(longitude) : null,
    shopPhotoUrl: shopPhotoFile ? shopPhotoFile.path : null,
    govIdUrl: govIdFile ? govIdFile.path : null,
    status: 'pending',
  });

  const token = generateToken(user._id, user.role);
  res.status(201).json({
    token,
    role: user.role,
    user: user.toPublicJSON(),
    seller: { _id: seller._id, businessName: seller.businessName, status: seller.status },
  });
}

// POST /api/auth/login
async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Please provide both email and password.' });
  }

  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  if (!user || !(await user.comparePassword(password))) {
    return res.status(401).json({ message: 'Invalid email or password. Please try again.' });
  }
  if (user.isDeleted) {
    return res.status(403).json({ message: 'This account no longer exists.' });
  }
  if (user.isSuspended) {
    return res.status(403).json({ message: user.suspendedReason ? `Your account has been suspended: ${user.suspendedReason}` : 'Your account has been suspended. Contact support for help.' });
  }

  const token = generateToken(user._id, user.role);
  const payload = { token, role: user.role, user: user.toPublicJSON() };

  if (user.role === 'seller') {
    const seller = await Seller.findOne({ user: user._id });
    if (seller) payload.seller = seller;
  }

  res.json(payload);
}

// POST /api/auth/forgot-password — body: { email }
// Always responds with the same generic success message whether or not the
// email exists, so this endpoint can't be used to check which emails are
// registered.
async function forgotPassword(req, res) {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: 'Please provide your email address.' });

  const genericMessage = 'If an account exists for that email, a reset link has been sent.';

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) return res.json({ message: genericMessage });

  // Plaintext token goes in the email link; only its hash is stored, so a
  // database leak alone could never be used to reset someone's password.
  const rawToken = crypto.randomBytes(32).toString('hex');
  user.resetPasswordToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  user.resetPasswordExpires = Date.now() + 30 * 60 * 1000; // 30 minutes
  await user.save();

  const frontendUrl = process.env.FRONTEND_URL || 'https://arewa-square-frontend.vercel.app';
  const resetUrl = `${frontendUrl}/reset-password.html?token=${rawToken}&email=${encodeURIComponent(user.email)}`;

  try {
    await sendEmail({
      to: user.email,
      subject: 'Reset your ALFIJEER password',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #001233;">Reset your password</h2>
          <p>Hi ${user.fullName || ''},</p>
          <p>We received a request to reset your ALFIJEER password. Click the button below to choose a new one — this link expires in 30 minutes.</p>
          <p style="text-align: center; margin: 28px 0;">
            <a href="${resetUrl}" style="background: #FFBE1A; color: #001233; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: bold;">Reset Password</a>
          </p>
          <p>If you didn't request this, you can safely ignore this email — your password won't change.</p>
          <p style="color: #888; font-size: 0.85em;">ALFIJEER — The Digital Market Place For Nigeria</p>
        </div>
      `,
    });
  } catch (err) {
    // Roll back the token if the email genuinely couldn't be sent, so a
    // broken email config doesn't leave an unusable dangling token.
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();
    console.error('Failed to send password reset email:', err.message);
    return res.status(500).json({ message: 'Could not send the reset email right now. Please try again shortly.' });
  }

  res.json({ message: genericMessage });
}

// POST /api/auth/reset-password — body: { email, token, newPassword }
async function resetPassword(req, res) {
  const { email, token, newPassword } = req.body;
  if (!email || !token || !newPassword) {
    return res.status(400).json({ message: 'Missing email, token, or new password.' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters.' });
  }

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  const user = await User.findOne({
    email: email.toLowerCase(),
    resetPasswordToken: hashedToken,
    resetPasswordExpires: { $gt: Date.now() },
  }).select('+resetPasswordToken +resetPasswordExpires');

  if (!user) {
    return res.status(400).json({ message: 'This reset link is invalid or has expired. Please request a new one.' });
  }

  user.password = newPassword; // re-hashed automatically by the pre-save hook
  user.resetPasswordToken = null;
  user.resetPasswordExpires = null;
  await user.save();

  res.json({ message: 'Password updated. You can now log in with your new password.' });
}

module.exports = { register, login, forgotPassword, resetPassword };
