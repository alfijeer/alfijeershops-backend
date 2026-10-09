const express = require('express');
const router = express.Router();
const { protect, requireRole } = require('../middleware/auth');
const upload = require('../middleware/upload');
const asyncHandler = require('../utils/asyncHandler');
const {
  listProductsBySeller,
  listMyProducts,
  createProduct,
  updateProduct,
  deleteProduct,
} = require('../controllers/productController');

// /mine is a distinct literal path (no :id-style route in this router to
// collide with), but kept above the collection GET for readability.
router.get('/mine', protect, requireRole('seller'), asyncHandler(listMyProducts));
router.get('/', asyncHandler(listProductsBySeller)); // public — ?sellerId=

router.post('/', protect, requireRole('seller'), upload.array('images', 6), asyncHandler(createProduct));
router.put('/:id', protect, requireRole('seller'), upload.array('images', 6), asyncHandler(updateProduct));
router.delete('/:id', protect, requireRole('seller'), asyncHandler(deleteProduct));

module.exports = router;
