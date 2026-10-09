const express = require('express');
const router = express.Router();
const { protect, requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { listDisputes, createDispute, resolveDispute } = require('../controllers/disputeController');

router.get('/', protect, requireRole('admin'), asyncHandler(listDisputes));
router.post('/', protect, requireRole('buyer'), asyncHandler(createDispute));
router.put('/:id/resolve', protect, requireRole('admin'), asyncHandler(resolveDispute));

module.exports = router;
