const mongoose = require('mongoose');

// Where buyers send their money. Never part of any public shop data: the field is excluded from every
// query unless asked for with .select('+bankDetails'), and a buyer only ever sees a copy that was saved on
// their own order at the moment the seller accepted it (see services/orderService.js).
const bankDetailsSchema = new mongoose.Schema(
  {
    bankName: { type: String, trim: true },
    accountName: { type: String, trim: true },
    accountNumber: { type: String, trim: true },
  },
  { _id: false }
);

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
    bankDetails: { type: bankDetailsSchema, default: undefined, select: false }, // sensitive — see note above

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'suspended'],
      default: 'pending',
      index: true,
    },
    rejectionReason: { type: String, default: null },

    // Set when an admin deletes a shop that has order history (the record is kept, anonymized, so past orders
    // stay intact). A deleted shop is NEVER public and can never be approved or reactivated again.
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null, index: true },   // when it entered the 30-day holding period
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    purgedAt: { type: Date, default: null },                  // set once the holding period is over and the shop was removed for good
    // How things were just before deletion, so "Restore" can put everything back exactly as it was.
    preDelete: {
      type: new mongoose.Schema(
        { status: String, userSuspended: Boolean, userSuspendedReason: String },
        { _id: false }
      ),
      default: undefined,
    },

    // Verification badge: an admin has looked at this shop's ID and confirmed the owner is real.
    isVerified: { type: Boolean, default: false, index: true },
    verifiedAt: { type: Date, default: null },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // The last time buyers who saved this shop were notified (keeps alerts from becoming spam).
    lastAlertAt: { type: Date, default: null },

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
