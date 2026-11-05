const mongoose = require('mongoose');

// A thin profile layer over User for buyer-specific fields. Kept separate
// (rather than cramming everything onto User) so it can grow independently —
// e.g. saved shops, once that moves from localStorage to a real endpoint
// (see buyer-dashboard.html's as_saved_shops comment).
const buyerSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    state: { type: String, trim: true },
    city: { type: String, trim: true },

    // Shops this buyer has saved with the heart. Kept on the server (not just in the phone) so we can
    // send an alert when one of them adds a product or drops a price.
    savedShops: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Seller' }], default: [], index: true },
    notifyShopUpdates: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Buyer', buyerSchema);
