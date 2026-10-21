'use strict';
// Platform-wide switches the admin controls (one document, key "platform").
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  maintenance: {
    enabled: { type: Boolean, default: false },
    message: { type: String, default: '' },
    eta: { type: String, default: '' }              // free text, e.g. "Back by 4pm"
  },
  ordersPaused: { type: Boolean, default: false },  // visitors can still browse; new orders are blocked
  ordersPausedMessage: { type: String, default: '' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });
module.exports = mongoose.models.Setting || mongoose.model('Setting', schema);
