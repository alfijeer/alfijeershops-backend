const express = require('express');
const router = express.Router();
const { protect, requireRole, optionalAuth } = require('../middleware/auth');
const upload = require('../middleware/upload');
const asyncHandler = require('../utils/asyncHandler');
const {
  listSellers,
  getMyShop,
  updateMyShop,
  adminUpdateSeller,
  approveSeller,
  rejectSeller,
  suspendSeller,
  reactivateSeller,
  deleteSeller,
} = require('../controllers/sellerController');

// Public list (buyer-dashboard.html, index.html) — but shows every status
// to a logged-in admin (admin.html's Pending/All Sellers tabs read this
// same endpoint with a higher limit).
router.get('/', optionalAuth, asyncHandler(listSellers));

// Seller's own shop
router.get('/me', protect, requireRole('seller'), asyncHandler(getMyShop));
// upload.single() safely no-ops when the request isn't multipart (i.e. the
// seller only changed text fields and didn't touch the banner upload) —
// same pattern as /auth/register.
router.put('/profile', protect, requireRole('seller'), upload.single('shopPhoto'), asyncHandler(updateMyShop));

// Admin actions
router.put('/:id/approve', protect, requireRole('admin'), asyncHandler(approveSeller));
router.put('/:id/reject', protect, requireRole('admin'), asyncHandler(rejectSeller));
router.put('/:id/suspend', protect, requireRole('admin'), asyncHandler(suspendSeller));
router.put('/:id/reactivate', protect, requireRole('admin'), asyncHandler(reactivateSeller));
router.put('/:id', protect, requireRole('admin'), asyncHandler(adminUpdateSeller));
router.delete('/:id', protect, requireRole('admin'), asyncHandler(deleteSeller));

module.exports = router;
