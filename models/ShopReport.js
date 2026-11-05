'use strict';
// A buyer telling the admin team "something is wrong with this shop".
// Separate from Dispute on purpose: a Dispute is about ONE ORDER (and money); a ShopReport is about the
// SHOP itself (fake listings, scams, abusive behaviour) and needs no order at all.
const mongoose = require('mongoose');

const REASONS = ['fake_products', 'scam_or_fraud', 'wrong_info', 'abusive_behavior', 'other'];

const schema = new mongoose.Schema(
  {
    shop: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller', required: true, index: true },
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reason: { type: String, enum: REASONS, required: true },
    details: { type: String, trim: true, maxlength: 500, default: '' },
    status: { type: String, enum: ['open', 'reviewed', 'dismissed'], default: 'open', index: true },
    adminNote: { type: String, trim: true, maxlength: 500, default: '' },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One person cannot pile several OPEN reports onto the same shop (they can report again after it is reviewed).
schema.index({ shop: 1, reporter: 1 }, { unique: true, partialFilterExpression: { status: 'open' } });

module.exports = mongoose.models.ShopReport || mongoose.model('ShopReport', schema);
module.exports.REASONS = REASONS;
