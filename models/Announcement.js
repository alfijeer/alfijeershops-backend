'use strict';
// A message from the ALFIJEER team, shown inside the seller (or buyer) dashboard.
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  message: { type: String, required: true, trim: true, maxlength: 1500 },
  audience: { type: String, enum: ['sellers', 'buyers', 'all'], default: 'sellers', index: true },
  type: { type: String, enum: ['info', 'important', 'warning'], default: 'info' },
  active: { type: Boolean, default: true, index: true },
  expiresAt: { type: Date, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });
module.exports = mongoose.models.Announcement || mongoose.model('Announcement', schema);
