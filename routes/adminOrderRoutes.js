'use strict';
// Admin order routes. Mounted at /api/admin in server.js.
const express = require('express');
const mongoose = require('mongoose');
const { v2: cloudinary } = require('cloudinary');
const router = express.Router();
const { protect, requireRole } = require('../middleware/auth');
const { requireOrderRole } = require('../middleware/orderRoles');
const cfg = require('../config/orders');
const Order = require('../models/Order');
const AdminLog = require('../models/AdminLog');
const svc = require('../services/orderService');
const { getShopStats } = require('../services/shopStats');
const { ADMIN_DECISIONS } = require('../services/workflow');

const handle = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    if (!e.status) console.error(e);
    res.status(e.status || 500).json({ message: e.status ? e.message : 'Something went wrong. Please try again.', code: e.code });
  }
};

// Shape used by admin.orders.html / admin.html. The proof link is never sent in lists: only hasProof.
function adminView(o) {
  const p = Object.assign({}, o.payment || {});
  p.hasProof = !!(p.proofImageUrl || p.proofPublicId);
  delete p.proofImageUrl; delete p.proofPublicId; delete p.proofFormat;
  const d = Object.assign({}, o.dispute || {});
  d.evidenceCount = (d.evidence || []).length;
  delete d.evidence;                                  // links are only given out one by one, logged, by the route below
  return Object.assign({}, o, {
    dispute: d,
    shopName: o.seller && o.seller.businessName,
    buyerName: o.buyer && o.buyer.fullName,
    seller: o.seller && o.seller._id ? o.seller._id : o.seller,
    buyer: o.buyer && o.buyer._id ? o.buyer._id : o.buyer,
    payment: p
  });
}

// A short-lived link to a private image. Falls back to the stored link if no private id was saved.
function signedLink(publicId, format, fallbackUrl) {
  if (publicId) {
    return cloudinary.utils.private_download_url(publicId, format || 'jpg', {
      resource_type: 'image', type: 'authenticated', expires_at: Math.floor(Date.now() / 1000) + cfg.PROOF_LINK_SECONDS
    });
  }
  return fallbackUrl;
}
const proofLink = (payment) => signedLink(payment.proofPublicId, payment.proofFormat, payment.proofImageUrl);

router.use(protect, requireRole('admin'), requireOrderRole('ADMIN'));

router.get('/orders', handle(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.shopId && mongoose.isValidObjectId(req.query.shopId)) filter.seller = req.query.shopId;
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
  const orders = await Order.find(filter).sort({ statusChangedAt: -1 }).limit(limit)
    .populate('seller', 'businessName').populate('buyer', 'fullName').lean();
  res.json({ orders: orders.map(adminView) });
}));

router.get('/orders/:id/payment-proof', handle(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid id.' });
  const o = await Order.findById(req.params.id).select('status seller payment').lean();
  if (!o) return res.status(404).json({ message: 'Order not found.' });
  if (!cfg.PROOF_VISIBLE_STATUSES.includes(o.status)) return res.status(403).json({ message: 'Payment proof can only be opened for payment issues, disputes, delivery reviews and refunds.' });
  const p = o.payment || {};
  if (!p.proofImageUrl && !p.proofPublicId) return res.status(404).json({ message: 'No payment proof was uploaded for this order.' });
  await AdminLog.create({ adminId: req.actor.id, action: 'VIEW_PROOF', orderId: o._id, shopId: o.seller, note: 'Opened in status ' + o.status });
  res.json({ url: proofLink(p) });
}));

// The buyer's dispute photos: short-lived private links, and the view is logged.
router.get('/orders/:id/dispute-evidence', handle(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid id.' });
  const o = await Order.findById(req.params.id).select('status seller dispute.evidence').lean();
  if (!o) return res.status(404).json({ message: 'Order not found.' });
  if (!cfg.PROOF_VISIBLE_STATUSES.includes(o.status)) return res.status(403).json({ message: 'Evidence can only be opened while an order is under review or being resolved.' });
  const list = (o.dispute && o.dispute.evidence) || [];
  if (!list.length) return res.status(404).json({ message: 'The buyer did not attach any photos.' });
  await AdminLog.create({ adminId: req.actor.id, action: 'VIEW_EVIDENCE', orderId: o._id, shopId: o.seller, note: `Opened ${list.length} photo(s) in status ${o.status}` });
  res.json({ urls: list.map((e) => signedLink(e.publicId, e.format, e.url)) });
}));

// body: { decision, reason, faultParty? }. The workflow decides whether this decision is allowed right now.
router.put('/orders/:id/resolve', handle(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid id.' });
  const { decision, reason, faultParty } = req.body || {};
  if (!ADMIN_DECISIONS.includes(decision)) return res.status(400).json({ message: 'Unknown decision.' });
  const order = await svc.transition(req.params.id, decision, req.actor, { reason, faultParty });
  res.json({ order: adminView(order) });
}));

router.get('/shops/:id/order-stats', handle(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid id.' });
  res.json(await getShopStats(req.params.id, req.query.range));
}));

module.exports = router;
