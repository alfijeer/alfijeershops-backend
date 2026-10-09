const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const upload = require('../middleware/upload');
const asyncHandler = require('../utils/asyncHandler');
const { register, login, forgotPassword, resetPassword } = require('../controllers/authController');

// ══════════════════════════════════════════════════════════
// Each auth action gets its own limit, tuned to how it's actually used —
// a single shared limit across all of /api/auth was too strict for
// registration specifically (a large, sometimes-slow multipart upload
// that legitimately needs retry room) and didn't account for many real
// users sharing one IP behind carrier-grade NAT.
// ══════════════════════════════════════════════════════════

const registerLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 minutes
  max: 30, // generous — allows for shared IPs and genuine retries on slow connections
  message: { message: "You've tried a few times in a row — please wait a couple of minutes before trying again." },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30, // meaningful brute-force protection, without punishing shared-IP users for a couple of typo retries
  message: { message: "You've tried a few times in a row — please wait a couple of minutes before trying again." },
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // stricter — this one sends an email each time, so it also guards against spamming someone's inbox
  message: { message: 'Please wait a few minutes before requesting another reset link.' },
});

// upload.fields() safely no-ops for non-multipart requests (buyer JSON
// registration), so this one route serves both buyer and seller signup —
// matching the two fetch('/auth/register', ...) call sites in auth.html.
router.post(
  '/register',
  registerLimiter,
  upload.fields([
    { name: 'shopPhoto', maxCount: 1 },
    { name: 'govId', maxCount: 1 },
  ]),
  asyncHandler(register)
);

router.post('/login', loginLimiter, asyncHandler(login));
router.post('/forgot-password', forgotPasswordLimiter, asyncHandler(forgotPassword));
router.post('/reset-password', asyncHandler(resetPassword));

module.exports = router;
