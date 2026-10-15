'use strict';
// REPLACES the old Order model. Field names buyer / seller / orderId are kept on purpose,
// so buyerController, sellerController and the Dispute model keep working unchanged.
const mongoose = require('mongoose');
const { Schema } = mongoose;

const STATUSES = [
  'PENDING', 'ACCEPTED', 'PAYMENT_SUBMITTED', 'PAYMENT_CONFIRMED', 'DELIVERED', 'COMPLETED',
  'CANCELLED', 'PAYMENT_ISSUE', 'DELIVERY_REVIEW', 'DISPUTED', 'REPLACEMENT_PENDING',
  'REFUND_PENDING', 'REFUNDED'
];

const historySchema = new Schema({
  from: { type: String, enum: STATUSES, default: null },
  to: { type: String, enum: STATUSES, required: true },
  by: Schema.Types.ObjectId,                                   // null when the system acts
  byRole: { type: String, enum: ['BUYER', 'SELLER', 'ADMIN', 'SYSTEM'], required: true },
  reason: String,
  at: { type: Date, default: Date.now }
}, { _id: false });

const orderSchema = new Schema({
  orderId: { type: String, required: true, unique: true },     // ALF-20261004-0001
  buyer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  seller: { type: Schema.Types.ObjectId, ref: 'Seller', required: true, index: true },

  items: [{ productId: Schema.Types.ObjectId, name: String, price: Number, quantity: Number, _id: false }],
  total: { type: Number, required: true, min: 0 },

  status: { type: String, enum: STATUSES, default: 'PENDING', index: true },
  statusChangedAt: { type: Date, default: Date.now },
  deadlineAt: Date,

  payment: {
    status: { type: String, enum: ['NOT_SUBMITTED', 'SUBMITTED', 'CONFIRMED', 'ISSUE', 'FAILED'], default: 'NOT_SUBMITTED' },
    method: String,
    amount: Number,
    reference: String,
    submittedAt: Date,
    proofImageUrl: String,          // only filled when a payment issue opens
    proofPublicId: String,          // private Cloudinary id, used to make short-lived links
    proofFormat: String,
    proofDueAt: Date,
    issueReason: String,
    issueReportedBy: { type: String, enum: ['BUYER', 'SELLER', 'SYSTEM'] },
    confirmedBy: Schema.Types.ObjectId,
    confirmedByRole: { type: String, enum: ['SELLER', 'ADMIN'] },
    confirmedAt: Date,
    resolution: String
  },

  dispute: {
    reason: String,
    openedAt: Date,
    evidence: [{ url: String, publicId: String, format: String, _id: false }]   // up to 3 private photos from the buyer
  },
  replacementCount: { type: Number, default: 0 },
  refund: {
    faultParty: { type: String, enum: ['SELLER', 'BUYER', 'NONE'] },
    decidedAt: Date,
    strikeApplied: { type: Boolean, default: false }
  },

  cancelReason: { type: String, enum: ['SELLER_TIMEOUT', 'SELLER_DECLINED', 'BUYER_CANCELLED', 'PAYMENT_DEADLINE_EXPIRED', 'PAYMENT_INVALID', 'ADMIN_DECISION'] },
  cancelledBy: { type: String, enum: ['BUYER', 'SELLER', 'SYSTEM', 'ADMIN'] },
  cancelNote: String,

  statusHistory: [historySchema]
}, { timestamps: true });

orderSchema.index({ status: 1, deadlineAt: 1 });  // timer job
orderSchema.index({ seller: 1, status: 1 });      // seller pages + shop analytics

module.exports = mongoose.model('Order', orderSchema);
module.exports.STATUSES = STATUSES;
