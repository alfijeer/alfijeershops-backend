const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller', required: true, index: true },
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    category: { type: String, trim: true, default: 'Other' },
    description: { type: String, trim: true },
    // Array on purpose — the seller upload form sends multiple files under
    // the "images" field name, and seller-dashboard.html reads images[0].
    images: { type: [String], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Product', productSchema);
