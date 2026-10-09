'use strict';
const mongoose = require('mongoose');
// Everything an admin does is recorded here: who, what, when, why.
const schema = new mongoose.Schema({
  adminId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  action: { type: String, required: true },          // e.g. VIEW_PROOF, REFUND, PAYMENT_VALID
  orderId: { type: mongoose.Schema.Types.ObjectId, index: true },
  shopId: { type: mongoose.Schema.Types.ObjectId, index: true },
  note: String,
  at: { type: Date, default: Date.now }
});
module.exports = mongoose.models.AdminLog || mongoose.model('AdminLog', schema);
