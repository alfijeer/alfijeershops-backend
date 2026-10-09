const mongoose = require('mongoose');

const sellerSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

    // Permanent, non-transferable — assigned once on approval, never reassigned.
    shopNumber: { type: Number, default: null, index: true },

    businessName: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true, default: 'Other' },
    whatsappNumber: { type: String, trim: true }, // read by the frontend as seller.whatsappNumber
    state: { type: String, required: true, trim: true },
    city: { type: String, trim: true },
    address: { type: String, trim: true },
    description: { type: String, trim: true },

    // Location — powers buyer-side distance sorting and the directions feature.
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },

    shopPhotoUrl: { type: String, default: null },
    govIdUrl: { type: String, default: null, select: false }, // sensitive — admin-only, excluded by default

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'suspended'],
      default: 'pending',
      index: true,
    },
    rejectionReason: { type: String, default: null },

    // Engagement stats surfaced on the seller dashboard.
    totalViews: { type: Number, default: 0 },
    whatsappClicks: { type: Number, default: 0 },
    callClicks: { type: Number, default: 0 },
    savedCount: { type: Number, default: 0 },

    // Order trust record (updated by services/orderService.js; can be rebuilt from orders any time)
    strikes: { type: Number, default: 0 },
    completedOrders: { type: Number, default: 0 },
    disputeCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

sellerSchema.index({ latitude: 1, longitude: 1 });

module.exports = mongoose.model('Seller', sellerSchema);
