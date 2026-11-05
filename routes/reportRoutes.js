'use strict';
// Mounted at /api/reports
const express = require('express');
const router = express.Router();
const { protect, requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { createReport, listReports, reviewReport } = require('../controllers/reportController');

router.post('/', protect, requireRole('buyer'), asyncHandler(createReport));
router.get('/', protect, requireRole('admin'), asyncHandler(listReports));
router.put('/:id', protect, requireRole('admin'), asyncHandler(reviewReport));

module.exports = router;
