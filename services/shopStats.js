'use strict';
// Shop analytics. computeStats is PURE (easy to test); getShopStats fetches the data.
const cfg = require('../config/orders');

const HOURS = 3600000;
const reached = (o, status) => o.status === status || (o.statusHistory || []).some((h) => h.to === status);
const at = (o, status) => { const h = (o.statusHistory || []).find((x) => x.to === status); return h ? new Date(h.at) : null; };
const avg = (arr) => (arr.length ? arr.reduce((s, n) => s + n, 0) / arr.length : null);
const rate = (n, d) => (d >= cfg.MIN_SAMPLE ? n / d : null); // null = "not enough data"

function computeStats(orders, shop, range) {
  const sub = orders.filter((o) => reached(o, 'PAYMENT_SUBMITTED')).length;
  const delivered = orders.filter((o) => reached(o, 'DELIVERED')).length;
  const t = {
    total: orders.length,
    completed: orders.filter((o) => o.status === 'COMPLETED').length,
    cancelled: orders.filter((o) => o.status === 'CANCELLED').length,
    refunded: orders.filter((o) => o.status === 'REFUNDED').length,
    paymentConfirmed: orders.filter((o) => reached(o, 'PAYMENT_CONFIRMED')).length,
    delivered,
    paymentIssues: orders.filter((o) => reached(o, 'PAYMENT_ISSUE')).length,
    disputes: orders.filter((o) => reached(o, 'DISPUTED')).length
  };

  const acceptHours = [];
  const deliveryHours = [];
  orders.forEach((o) => {
    const acc = at(o, 'ACCEPTED');
    if (acc) acceptHours.push((acc - new Date(o.createdAt)) / HOURS);
    const conf = at(o, 'PAYMENT_CONFIRMED');
    const del = at(o, 'DELIVERED');
    if (conf && del && del > conf) deliveryHours.push((del - conf) / HOURS);
  });

  const rates = {
    completion: rate(t.completed, t.total),
    cancellation: rate(t.cancelled, t.total),
    dispute: rate(t.disputes, t.delivered),        // out of orders that were delivered
    paymentIssue: rate(t.paymentIssues, sub)       // out of orders where the buyer marked payment
  };
  const timing = { avgAcceptHours: avg(acceptHours), avgDeliveryHours: avg(deliveryHours) };
  const strikes = (shop && shop.strikes) || 0;
  const trust = {
    verificationStatus: shop ? shop.status : null,
    memberSince: shop ? shop.createdAt : null,
    strikes,
    sellerTimeoutCount: orders.filter((o) => o.cancelReason === 'SELLER_TIMEOUT' || o.cancelReason === 'SELLER_NO_TOTAL').length,
    sellerFaultRefunds: orders.filter((o) => o.refund && o.refund.faultParty === 'SELLER' && ['REFUND_PENDING', 'REFUNDED'].includes(o.status)).length
  };

  const F = cfg.FLAGS;
  const flags = [];
  if (rates.dispute != null && rates.dispute > F.HIGH_DISPUTE_RATE) flags.push('HIGH_DISPUTE_RATE');
  if (rates.cancellation != null && rates.cancellation > F.HIGH_CANCEL_RATE) flags.push('HIGH_CANCEL_RATE');
  if (strikes >= F.MULTIPLE_STRIKES) flags.push('MULTIPLE_STRIKES');
  if (timing.avgAcceptHours != null && t.total >= cfg.MIN_SAMPLE && timing.avgAcceptHours > F.SLOW_ACCEPT_HOURS) flags.push('SLOW_ACCEPTANCE');
  if (timing.avgDeliveryHours != null && t.delivered >= cfg.MIN_SAMPLE && timing.avgDeliveryHours > F.SLOW_DELIVERY_HOURS) flags.push('SLOW_DELIVERY');

  return { range, enoughData: t.total >= cfg.MIN_SAMPLE, minSample: cfg.MIN_SAMPLE, totals: t, rates, timing, trust, flags };
}

const RANGE_DAYS = { all: null, '30d': 30, '7d': 7 };

async function getShopStats(shopId, range) {
  const mongoose = require('mongoose');
  const Order = require('../models/Order');
  const key = Object.prototype.hasOwnProperty.call(RANGE_DAYS, range) ? range : 'all';
  const filter = { seller: shopId };
  if (RANGE_DAYS[key]) filter.createdAt = { $gte: new Date(Date.now() - RANGE_DAYS[key] * 24 * HOURS) };
  const [orders, shop] = await Promise.all([
    Order.find(filter).select('status createdAt statusHistory cancelReason refund').limit(5000).lean(),
    mongoose.model(cfg.SELLER_MODEL).findById(shopId).lean()
  ]);
  return computeStats(orders, shop, key);
}

module.exports = { computeStats, getShopStats };
