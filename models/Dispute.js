const mongoose = require('mongoose');

const disputeSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller', required: true },
    reason: { type: String, required: true, trim: true },
    status: { type: String, enum: ['open', 'resolved', 'dismissed'], default: 'open', index: true },
    resolutionNote: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Dispute', disputeSchema);
