const express = require('express');
const router = express.Router();
const { protect, requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const {
  listBuyers,
  getMyProfile,
  updateMyProfile,
  suspendBuyer,
  reactivateBuyer,
  getBuyerOrders,
  deleteBuyer,
  getSaved,
  setSaved,
  setSavedPrefs,
} = require('../controllers/buyerController');

// '/me' and '/profile' are literal paths, kept above the '/:id'-style
// admin routes below so they're never accidentally shadowed.
router.get('/me', protect, requireRole('buyer'), asyncHandler(getMyProfile));
router.put('/profile', protect, requireRole('buyer'), asyncHandler(updateMyProfile));

router.get('/saved', protect, requireRole('buyer'), asyncHandler(getSaved));
router.put('/saved/prefs', protect, requireRole('buyer'), asyncHandler(setSavedPrefs));
router.put('/saved', protect, requireRole('buyer'), asyncHandler(setSaved));

router.get('/', protect, requireRole('admin'), asyncHandler(listBuyers));
router.get('/:id/orders', protect, requireRole('admin'), asyncHandler(getBuyerOrders));
router.put('/:id/suspend', protect, requireRole('admin'), asyncHandler(suspendBuyer));
router.put('/:id/reactivate', protect, requireRole('admin'), asyncHandler(reactivateBuyer));
router.delete('/:id', protect, requireRole('admin'), asyncHandler(deleteBuyer));

module.exports = router;
