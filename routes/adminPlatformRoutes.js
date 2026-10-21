'use strict';
// Admin: platform settings, announcements, order analysis. Mounted at /api/admin.
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { protect, requireRole } = require('../middleware/auth');
const Setting = require('../models/Setting');
const Announcement = require('../models/Announcement');
const AdminLog = require('../models/AdminLog');
const Seller = require('../models/Seller');
const User = require('../models/User');
const platform = require('../services/platform');
const push = require('../services/push');
const { getShopAnalytics } = require('../services/adminAnalytics');

const handle = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.status ? e.message : 'Something went wrong. Please try again.' }); }
};
router.use(protect, requireRole('admin'));
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

// ── Platform settings ──
router.get('/settings', handle(async (req, res) => {
  const doc = await Setting.findOne({ key: 'platform' }).lean();
  res.json(Object.assign(platform.shape(doc), { updatedAt: doc && doc.updatedAt }));
}));

router.put('/settings', handle(async (req, res) => {
  const b = req.body || {};
  const set = {};
  if (b.maintenance && typeof b.maintenance === 'object') {
    if (typeof b.maintenance.enabled === 'boolean') set['maintenance.enabled'] = b.maintenance.enabled;
    if (b.maintenance.message !== undefined) set['maintenance.message'] = str(b.maintenance.message, 400);
    if (b.maintenance.eta !== undefined) set['maintenance.eta'] = str(b.maintenance.eta, 80);
  }
  if (typeof b.ordersPaused === 'boolean') set.ordersPaused = b.ordersPaused;
  if (b.ordersPausedMessage !== undefined) set.ordersPausedMessage = str(b.ordersPausedMessage, 300);
  if (!Object.keys(set).length) return res.status(400).json({ message: 'Nothing to change.' });
  set.updatedBy = req.user._id;
  const doc = await Setting.findOneAndUpdate({ key: 'platform' }, { $set: set, $setOnInsert: { key: 'platform' } }, { upsert: true, new: true }).lean();
  platform.clearCache();
  const label = set['maintenance.enabled'] === true ? 'MAINTENANCE_ON' : set['maintenance.enabled'] === false ? 'MAINTENANCE_OFF'
    : set.ordersPaused === true ? 'ORDERS_PAUSED' : set.ordersPaused === false ? 'ORDERS_RESUMED' : 'SETTINGS_EDIT';
  await AdminLog.create({ adminId: req.user._id, action: label, note: 'Platform settings changed' }).catch(() => {});
  res.json(platform.shape(doc));
}));

// ── Announcements ──
router.get('/announcements', handle(async (req, res) => {
  res.json({ announcements: await Announcement.find().sort({ createdAt: -1 }).limit(100).lean() });
}));

router.post('/announcements', handle(async (req, res) => {
  const b = req.body || {};
  const title = str(b.title, 120), message = str(b.message, 1500);
  if (title.length < 3 || message.length < 5) return res.status(400).json({ message: 'Add a title and a message.' });
  const audience = ['sellers', 'buyers', 'all'].includes(b.audience) ? b.audience : 'sellers';
  const type = ['info', 'important', 'warning'].includes(b.type) ? b.type : 'info';
  let expiresAt = null;
  if (b.expiresAt) { expiresAt = new Date(b.expiresAt); if (isNaN(expiresAt)) return res.status(400).json({ message: 'Invalid expiry date.' }); }
  const a = await Announcement.create({ title, message, audience, type, expiresAt, active: true, createdBy: req.user._id });
  await AdminLog.create({ adminId: req.user._id, action: 'ANNOUNCEMENT_POST', note: title }).catch(() => {});

  let notified = 0;
  if (b.notify === true && push.isConfigured()) {          // also buzz their phones
    const roles = audience === 'sellers' ? ['seller'] : audience === 'buyers' ? ['buyer'] : ['seller', 'buyer'];
    const users = await User.find({ role: { $in: roles }, isSuspended: { $ne: true }, isDeleted: { $ne: true } }).select('_id role').limit(5000).lean();
    for (const u of users) {
      notified += await push.sendToUser(u._id, { title: '📢 ' + title, body: message.slice(0, 120), url: u.role === 'seller' ? '/seller-dashboard.html' : '/buyer-dashboard.html', tag: 'ann-' + a._id });
    }
  }
  res.status(201).json({ announcement: a, notified });
}));

router.put('/announcements/:id', handle(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid id.' });
  const set = {};
  if (typeof req.body.active === 'boolean') set.active = req.body.active;
  if (req.body.title !== undefined) set.title = str(req.body.title, 120);
  if (req.body.message !== undefined) set.message = str(req.body.message, 1500);
  const a = await Announcement.findByIdAndUpdate(req.params.id, { $set: set }, { new: true }).lean();
  if (!a) return res.status(404).json({ message: 'Announcement not found.' });
  res.json({ announcement: a });
}));

router.delete('/announcements/:id', handle(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid id.' });
  await Announcement.deleteOne({ _id: req.params.id });
  res.json({ ok: true });
}));

// ── Order analysis: every approved shop, ranked by orders in the chosen period ──
router.get('/analytics/shops', handle(async (req, res) => {
  res.json(await getShopAnalytics());
}));

module.exports = router;
