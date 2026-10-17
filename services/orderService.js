'use strict';
// Database layer. All business rules live in workflow.js; this file loads, saves and records.
const mongoose = require('mongoose');
const { v2: cloudinary } = require('cloudinary');
const cfg = require('../config/orders');
const Order = require('../models/Order');
const Seller = require('../models/Seller');
const Product = require('../models/Product');
const AdminLog = require('../models/AdminLog');
const { nextOrderNumber } = require('../utils/orderNumber');
const { buildTransition, deadlineFor, checkBuyerLimit, cleanFulfilment, ownsOrder, TERMINAL, OrderError } = require('./workflow');

// Actions that need the seller's saved bank details (the workflow checks them and, when due, copies them onto the order)
const NEEDS_BANK = ['SELLER_ACCEPT', 'BUYER_ACCEPT_TOTAL'];

// What the buyer and the shop get to see of an order: the receipt itself never leaves the server
// (only a flag, plus short-lived links from receiptLink below).
function publicOrder(o) {
  if (!o) return o;
  const plain = o.toObject ? o.toObject() : o;
  const p = Object.assign({}, plain.payment || {});
  p.hasProof = !!(p.proofImageUrl || p.proofPublicId);
  delete p.proofImageUrl; delete p.proofPublicId; delete p.proofFormat;
  return Object.assign({}, plain, { payment: p });
}

// A short-lived link to a private image. Falls back to the stored link only when told to (admin screens, older orders).
function signedLink(publicId, format, fallbackUrl) {
  if (publicId) {
    return cloudinary.utils.private_download_url(publicId, format || 'jpg', {
      resource_type: 'image', type: 'authenticated', expires_at: Math.floor(Date.now() / 1000) + cfg.PROOF_LINK_SECONDS
    });
  }
  return fallbackUrl;
}

// The payment receipt of one order, for the buyer who placed it or the shop it was placed with. Nobody else.
async function receiptLink(orderId, actor) {
  const o = await Order.findById(orderId).select('buyer seller payment.proofPublicId payment.proofFormat').lean();
  if (!o || !['BUYER', 'SELLER'].includes(actor.role) || !ownsOrder(o, actor)) throw new OrderError(404, 'NOT_FOUND', 'Order not found.');
  const p = o.payment || {};
  if (!p.proofPublicId) throw new OrderError(404, 'NO_RECEIPT', 'No receipt was uploaded for this order.');
  return signedLink(p.proofPublicId, p.proofFormat);
}

// The ONE function that changes an order's status. Atomic: it only saves if the status is still what we read.
async function transition(orderId, action, actor, payload) {
  const order = await Order.findById(orderId).lean();
  if (!order) throw new OrderError(404, 'NOT_FOUND', 'Order not found.');
  const ctx = {};
  if (NEEDS_BANK.includes(action)) {
    const shop = await Seller.findById(order.seller).select('+bankDetails').lean();
    ctx.bank = shop && shop.bankDetails;
  }
  const t = buildTransition(order, action, actor, payload, new Date(), ctx);

  const update = { $set: t.set, $push: { statusHistory: t.history } };
  if (t.inc) update.$inc = t.inc;
  const filter = Object.assign({ _id: order._id, status: order.status }, t.guard || {});
  const updated = await Order.findOneAndUpdate(filter, update, { new: true }).lean();
  if (!updated) throw new OrderError(409, 'CONFLICT', 'This order was just updated by someone else. Refresh and try again.');

  await applySellerCounters(order.seller, t.counters);
  if (actor.role === 'ADMIN') {
    await AdminLog.create({ adminId: actor.id, action, orderId: order._id, shopId: order.seller, note: t.history.reason })
      .catch((e) => console.error('AdminLog failed:', e.message));
  }
  return updated;
}

// Running totals on the Seller record (strikes, completedOrders, disputeCount).
// The shop-stats route recalculates from orders, so these are a convenience and can be rebuilt any time.
async function applySellerCounters(shopId, counters) {
  if (!counters || !Object.keys(counters).length) return;
  try { await Seller.updateOne({ _id: shopId }, { $inc: counters }); }
  catch (e) { console.error('Seller counters failed:', e.message); }
}

async function createOrder(buyer, body) {
  const { shopId, items } = body || {};
  const how = cleanFulfilment(body); // pickup or delivery (with the delivery details), validated before anything is saved
  if (!mongoose.isValidObjectId(shopId)) throw new OrderError(400, 'VALIDATION', 'A valid shop is required.');
  if (!Array.isArray(items) || !items.length || items.length > 50) throw new OrderError(400, 'VALIDATION', 'Add 1 to 50 items.');

  const shop = await Seller.findById(shopId).lean();
  if (!shop || shop.status !== cfg.APPROVED_STATUS) throw new OrderError(400, 'SHOP_UNAVAILABLE', 'This shop is not available for orders.');

  // Up to 3 open orders at once, one per shop, until one reaches a final status
  const openOrders = await Order.find({ buyer: buyer.id, status: { $nin: TERMINAL } }).select('seller').lean();
  checkBuyerLimit(openOrders.map((o) => ({ shopId: o.seller })), shopId);

  // Prices come from the database, never from the browser
  const wanted = new Map();
  for (const i of items) {
    const qty = Number(i.quantity);
    if (!mongoose.isValidObjectId(i.productId) || !Number.isInteger(qty) || qty < 1 || qty > 99) throw new OrderError(400, 'VALIDATION', 'Each item needs a valid product and a quantity from 1 to 99.');
    wanted.set(String(i.productId), (wanted.get(String(i.productId)) || 0) + qty);
  }
  const products = await Product.find({ _id: { $in: [...wanted.keys()] }, seller: shopId }).lean();
  if (products.length !== wanted.size) throw new OrderError(400, 'VALIDATION', 'Some products were not found in this shop.');

  const lines = products.map((p) => ({ productId: p._id, name: p.name, price: Number(p.price), quantity: wanted.get(String(p._id)) }));
  const total = lines.reduce((s, l) => s + l.price * l.quantity, 0);
  if (!(total > 0)) throw new OrderError(400, 'VALIDATION', 'Order total must be greater than zero.');

  const now = new Date();
  const doc = await Order.create({
    orderId: await nextOrderNumber(now),
    buyer: buyer.id, seller: shopId, items: lines, total,
    fulfilment: how.fulfilment, delivery: how.delivery, productTotal: total, deliveryFee: 0,
    status: 'PENDING', statusChangedAt: now, deadlineAt: deadlineFor('PENDING', now, how.fulfilment),
    statusHistory: [{ from: null, to: 'PENDING', by: buyer.id, byRole: 'BUYER', reason: how.fulfilment === 'DELIVERY' ? 'Order placed (delivery)' : 'Order placed (pickup)', at: now }]
  });

  // Safety net for double clicks: if two requests slipped past the check together, undo the extra one
  const openNow = await Order.find({ buyer: buyer.id, status: { $nin: TERMINAL } }).select('seller').lean();
  const inShop = openNow.filter((o) => String(o.seller) === String(shopId)).length;
  if (openNow.length > cfg.MAX_OPEN_ORDERS || inShop > 1) {
    await Order.deleteOne({ _id: doc._id, status: 'PENDING' });
    throw new OrderError(409, 'ORDER_LIMIT', 'Your order limit was reached. Please try again.');
  }
  return publicOrder(doc.toObject());
}

const listForBuyer = async (buyerId) => (await Order.find({ buyer: buyerId }).sort({ createdAt: -1 }).limit(200)
  .populate('seller', 'businessName shopNumber whatsappNumber').lean()).map(publicOrder);
const listForShop = async (shopId, status) => (await Order.find(Object.assign({ seller: shopId }, status ? { status } : {})).sort({ createdAt: -1 }).limit(200)
  .populate('buyer', 'fullName phone').lean()).map(publicOrder);

module.exports = { transition, createOrder, listForBuyer, listForShop, publicOrder, signedLink, receiptLink };
