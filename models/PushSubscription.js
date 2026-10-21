'use strict';
// One row per browser/phone that agreed to receive notifications.
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  endpoint: { type: String, required: true, unique: true },
  keys: { p256dh: { type: String, required: true }, auth: { type: String, required: true } },
  userAgent: { type: String, default: '' }
}, { timestamps: true });
module.exports = mongoose.models.PushSubscription || mongoose.model('PushSubscription', schema);
