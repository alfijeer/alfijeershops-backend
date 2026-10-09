'use strict';
// REPLACES the old routes/orderRoutes.js.   Mounted at /api/orders in server.js.
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { requireOrderRole } = require('../middleware/orderRoles');
const proofUpload = require('../middleware/proofUpload');
const Order = require('../models/Order');
const svc = require('../services/orderService');
const { ownsOrder } = require('../services/workflow');

const handle = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    if (!e.status) console.error(e);
    res.status(e.status || 500).json({ message: e.status ? e.message : 'Something went wrong. Please try again.', code: e.code });
  }
};
const badId = (req, res) => { if (mongoose.isValidObjectId(req.params.id)) return false; res.status(400).json({ message: 'Invalid order id.' }); return true; };

router.use(protect);

// Buyer places an order. body: { shopId, items: [{ productId, quantity }] }
router.post('/', requireOrderRole('BUYER'), handle(async (req, res) => {
  if (req.user.isSuspended) return res.status(403).json({ message: 'Your account is suspended. You cannot place new orders.' });
  res.status(201).json({ order: await svc.createOrder(req.actor, req.body) });
}));

router.get('/mine', requireOrderRole('BUYER'), handle(async (req, res) => {
  res.json({ orders: await svc.listForBuyer(req.actor.id) });
}));

router.get('/shop', requireOrderRole('SELLER'), handle(async (req, res) => {
  res.json({ orders: await svc.listForShop(req.actor.shopId, req.query.status) });
}));
// Old URL used by the existing seller dashboard
router.get('/seller', requireOrderRole('SELLER'), handle(async (req, res) => {
  res.json({ orders: await svc.listForShop(req.actor.shopId, req.query.status) });
}));

router.get('/:id', requireOrderRole('BUYER', 'SELLER'), handle(async (req, res) => {
  if (badId(req, res)) return;
  const order = await Order.findById(req.params.id).lean();
  if (!order || !ownsOrder(order, req.actor)) return res.status(404).json({ message: 'Order not found.' });
  res.json({ order });
}));

// Buyer uploads a receipt (only while the order is in PAYMENT_ISSUE). multipart field name: "proof"
router.post('/:id/proof', requireOrderRole('BUYER'), (req, res, next) => proofUpload.single('proof')(req, res, next), handle(async (req, res) => {
  if (badId(req, res)) return;
  if (!req.file) return res.status(400).json({ message: 'Please choose a receipt image.' });
  const url = req.file.path;
  const order = await svc.transition(req.params.id, 'BUYER_UPLOAD_PROOF', req.actor, {
    proofImageUrl: url, proofPublicId: req.file.filename, proofFormat: String(url).split('.').pop().split('?')[0],
    amount: req.body.amount || undefined, reference: req.body.reference || undefined
  });
  res.json({ order });
}));

// Buyer and seller buttons. Only BUYER_* and SELLER_* actions can come through here;
// timers and admin decisions can never be called from this route.
router.post('/:id/actions/:action', requireOrderRole('BUYER', 'SELLER'), handle(async (req, res) => {
  if (badId(req, res)) return;
  if (!/^(BUYER|SELLER)_[A-Z_]+$/.test(req.params.action) || req.params.action === 'BUYER_UPLOAD_PROOF') return res.status(400).json({ message: 'Unknown action.' });
  res.json({ order: await svc.transition(req.params.id, req.params.action, req.actor, req.body) });
}));

module.exports = router;
