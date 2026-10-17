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
const { ownsOrder, fulfilmentOf } = require('../services/workflow');

const handle = (fn) => async (req, res, next) => {
  try { await fn(req, res, next); }
  catch (e) {
    if (!e.status) console.error(e);
    res.status(e.status || 500).json({ message: e.status ? e.message : 'Something went wrong. Please try again.', code: e.code });
  }
};
const badId = (req, res) => { if (mongoose.isValidObjectId(req.params.id)) return false; res.status(400).json({ message: 'Invalid order id.' }); return true; };

router.use(protect);

// Turns upload problems into plain messages instead of server errors
const takeFiles = (fn) => (req, res, next) => fn(req, res, (err) => {
  if (!err) return next();
  const m = err.code === 'LIMIT_FILE_SIZE' ? 'Each photo must be 5 MB or less.'
    : err.code === 'LIMIT_UNEXPECTED_FILE' ? 'You can attach up to 3 photos.'
    : 'Upload failed. Please use JPG, PNG or WEBP photos.';
  res.status(400).json({ message: m });
});
// Checks owner and status BEFORE any file is accepted, so rejected requests never leave stray uploads behind
const needsStatus = (status) => handle(async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid order id.' });
  const o = await Order.findById(req.params.id).select('buyer seller status').lean();
  if (!o || !ownsOrder(o, req.actor)) return res.status(404).json({ message: 'Order not found.' });
  if (o.status !== status) return res.status(409).json({ message: `This is not possible while the order is ${o.status}.` });
  next();
});
// Same idea for "I have paid": a pickup order pays from ACCEPTED, a delivery order only after the total was accepted
const canPayNow = handle(async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid order id.' });
  const o = await Order.findById(req.params.id).select('buyer seller status fulfilment').lean();
  if (!o || !ownsOrder(o, req.actor)) return res.status(404).json({ message: 'Order not found.' });
  const ok = o.status === 'TOTAL_ACCEPTED' || (o.status === 'ACCEPTED' && fulfilmentOf(o) === 'PICKUP');
  if (!ok) return res.status(409).json({ message: `You cannot pay while the order is ${o.status}.` });
  next();
});
// Body fields that may only ever be filled in by our own upload routes (a browser must not be able to point us at any link)
const FILE_FIELDS = ['proofImageUrl', 'proofPublicId', 'proofFormat', 'evidence'];
const fileInfo = (f) => ({ url: f.path, publicId: f.filename, format: String(f.path).split('.').pop().split('?')[0] });

// Buyer places an order.
// body: { shopId, items: [{ productId, quantity }], fulfilment: 'PICKUP' | 'DELIVERY', delivery?: { name, phone, address, landmark?, note? } }
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
  res.json({ order: svc.publicOrder(order) });
}));

// The payment receipt, as a short-lived private link. Only the buyer of the order and the shop it was placed with can open it.
router.get('/:id/receipt', requireOrderRole('BUYER', 'SELLER'), handle(async (req, res) => {
  if (badId(req, res)) return;
  res.json({ url: await svc.receiptLink(req.params.id, req.actor) });
}));

// "I have paid", with an optional receipt. multipart: method (text), reference (optional text), receipt (optional image).
router.post('/:id/pay', requireOrderRole('BUYER'), canPayNow, takeFiles(proofUpload.single('receipt')), handle(async (req, res) => {
  if (badId(req, res)) return;
  const f = req.file ? fileInfo(req.file) : null;
  const order = await svc.transition(req.params.id, 'BUYER_PAID', req.actor, {
    method: req.body.method, reference: req.body.reference,
    proofImageUrl: f && f.url, proofPublicId: f && f.publicId, proofFormat: f && f.format
  });
  res.json({ order: svc.publicOrder(order) });
}));

// Buyer uploads a receipt (only while the order is in PAYMENT_ISSUE). multipart field name: "proof"
router.post('/:id/proof', requireOrderRole('BUYER'), needsStatus('PAYMENT_ISSUE'), takeFiles(proofUpload.single('proof')), handle(async (req, res) => {
  if (badId(req, res)) return;
  if (!req.file) return res.status(400).json({ message: 'Please choose a receipt image.' });
  const url = req.file.path;
  const order = await svc.transition(req.params.id, 'BUYER_UPLOAD_PROOF', req.actor, {
    proofImageUrl: url, proofPublicId: req.file.filename, proofFormat: String(url).split('.').pop().split('?')[0],
    amount: req.body.amount || undefined, reference: req.body.reference || undefined
  });
  res.json({ order: svc.publicOrder(order) });
}));

// Buyer reports "not as ordered" with up to 3 optional photos (the item, or the payment receipt).
// multipart: reason (text) + evidence (files). Photos go to the same PRIVATE folder as payment proofs.
router.post('/:id/dispute', requireOrderRole('BUYER'), needsStatus('DELIVERED'), takeFiles(proofUpload.array('evidence', 3)), handle(async (req, res) => {
  const evidence = (req.files || []).map(fileInfo);
  res.json({ order: svc.publicOrder(await svc.transition(req.params.id, 'BUYER_DISPUTE', req.actor, { reason: req.body.reason, evidence })) });
}));

// Buyer and seller buttons. Only BUYER_* and SELLER_* actions can come through here;
// timers and admin decisions can never be called from this route.
router.post('/:id/actions/:action', requireOrderRole('BUYER', 'SELLER'), handle(async (req, res) => {
  if (badId(req, res)) return;
  if (!/^(BUYER|SELLER)_[A-Z_]+$/.test(req.params.action) || req.params.action === 'BUYER_UPLOAD_PROOF') return res.status(400).json({ message: 'Unknown action.' });
  const body = Object.assign({}, req.body);
  FILE_FIELDS.forEach((k) => delete body[k]); // files only come in through the upload routes above, never as links in a button press
  res.json({ order: svc.publicOrder(await svc.transition(req.params.id, req.params.action, req.actor, body)) });
}));

module.exports = router;
