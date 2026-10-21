'use strict';
// Mounted at /api. Public status (for the maintenance screen) and the announcements a signed-in person should see.
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const Announcement = require('../models/Announcement');
const platform = require('../services/platform');

router.get('/platform/status', async (req, res) => {
  const s = await platform.getSettings();
  res.set('Cache-Control', 'no-store');
  res.json({ maintenance: s.maintenance, ordersPaused: s.ordersPaused, ordersPausedMessage: s.ordersPausedMessage });
});

router.get('/announcements', protect, async (req, res) => {
  try {
    const audience = req.user.role === 'seller' ? ['sellers', 'all'] : req.user.role === 'buyer' ? ['buyers', 'all'] : ['sellers', 'buyers', 'all'];
    const now = new Date();
    const list = await Announcement.find({ active: true, audience: { $in: audience }, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] })
      .sort({ createdAt: -1 }).limit(10).select('title message type createdAt').lean();
    res.json({ announcements: list });
  } catch (e) { res.status(500).json({ message: 'Could not load announcements.' }); }
});
module.exports = router;
