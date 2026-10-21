'use strict';
// Mounted at /api/push
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const PushSubscription = require('../models/PushSubscription');
const { isConfigured } = require('../services/push');

// Public: the browser needs this key to subscribe. 503 = notifications are not switched on yet.
router.get('/public-key', (req, res) => {
  if (!isConfigured()) return res.status(503).json({ message: 'Notifications are not enabled yet.' });
  res.json({ key: process.env.VAPID_PUBLIC_KEY });
});

router.post('/subscribe', protect, async (req, res) => {
  try {
    const sub = req.body && req.body.subscription;
    if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 1000
      || !sub.keys || typeof sub.keys.p256dh !== 'string' || typeof sub.keys.auth !== 'string') {
      return res.status(400).json({ message: 'Invalid subscription.' });
    }
    await PushSubscription.findOneAndUpdate(
      { endpoint: sub.endpoint },
      { user: req.user._id, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, userAgent: String(req.headers['user-agent'] || '').slice(0, 200) },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.status(201).json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Could not save notification settings.' }); }
});

router.post('/unsubscribe', protect, async (req, res) => {
  try {
    const endpoint = req.body && req.body.endpoint;
    if (typeof endpoint === 'string') await PushSubscription.deleteOne({ endpoint, user: req.user._id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: 'Could not update notification settings.' }); }
});

module.exports = router;
