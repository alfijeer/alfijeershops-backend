'use strict';
// Database layer. All business rules live in workflow.js; this file loads, saves and records.
const mongoose = require('mongoose');
const cfg = require('../config/orders');
const Order = require('../models/Order');
const Seller = require('../models/Seller');
const Product = require('../models/Product');
const AdminLog = require('../models/AdminLog');
const { nextOrderNumber } = require('../utils/orderNumber');
const { buildTransition, deadlineFor, checkBuyerLimit, TERMINAL, OrderError } = require('./workflow');

// The ONE function that changes an order's status. Atomic: it only saves if the status is still what we read.
async function transition(orderId, action, actor, payload) {
  const order = await Order.findById(orderId).lean();
  if (!order) throw new OrderError(404, 'NOT_FOUND', 'Order not found.');
  const t = buildTransition(order, action, actor, payload, new Date());

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
    status: 'PENDING', statusChangedAt: now, deadlineAt: deadlineFor('PENDING', now),
    statusHistory: [{ from: null, to: 'PENDING', by: buyer.id, byRole: 'BUYER', reason: 'Order placed', at: now }]
  });

  // Safety net for double clicks: if two requests slipped past the check together, undo the extra one
  const openNow = await Order.find({ buyer: buyer.id, status: { $nin: TERMINAL } }).select('seller').lean();
  const inShop = openNow.filter((o) => String(o.seller) === String(shopId)).length;
  if (openNow.length > cfg.MAX_OPEN_ORDERS || inShop > 1) {
    await Order.deleteOne({ _id: doc._id, status: 'PENDING' });
    throw new OrderError(409, 'ORDER_LIMIT', 'Your order limit was reached. Please try again.');
  }
  return doc.toObject();
}

const listForBuyer = (buyerId) => Order.find({ buyer: buyerId }).sort({ createdAt: -1 }).limit(200)
  .populate('seller', 'businessName shopNumber whatsappNumber').lean();
const listForShop = (shopId, status) => Order.find(Object.assign({ seller: shopId }, status ? { status } : {})).sort({ createdAt: -1 }).limit(200)
  .populate('buyer', 'fullName phone').lean();

module.exports = { transition, createOrder, listForBuyer, listForShop };
