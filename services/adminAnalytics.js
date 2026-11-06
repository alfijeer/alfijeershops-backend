'use strict';
// "Order analysis" for the admin: what every shop is doing, in Lagos time.
// periodStarts / buildRows / summarize are PURE (tested); getShopAnalytics does the database work.
const cfg = require('../config/orders');
const Order = require('../models/Order');
const Seller = require('../models/Seller');
const { TERMINAL } = require('./workflow');

const DAY = 86400000;
const LAGOS_OFFSET_MS = 3600000; // Africa/Lagos is UTC+1 all year (no daylight saving)

// Start of "today", "yesterday", this week (Monday) and this month, as real instants, using Lagos midnight.
function periodStarts(now) {
  const l = new Date(now.getTime() + LAGOS_OFFSET_MS);                 // shifted so the UTC fields read like Lagos clock time
  const midnightUtcFields = Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate());
  const today = new Date(midnightUtcFields - LAGOS_OFFSET_MS);
  const dow = (l.getUTCDay() + 6) % 7;                                  // Monday = 0
  return {
    today,
    yesterday: new Date(today.getTime() - DAY),
    week: new Date(today.getTime() - dow * DAY),
    month: new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), 1) - LAGOS_OFFSET_MS)
  };
}

// How a shop is doing, from its own numbers.
function activityOf(r, now) {
  const A = cfg.ACTIVITY;
  if (!r.total) return 'NO_ORDERS';
  const idleDays = r.lastOrderAt ? (now - new Date(r.lastOrderAt)) / DAY : Infinity;
  if (idleDays > A.STOPPED_DAYS) return 'STOPPED';
  if (r.week >= A.VERY_ACTIVE_WEEK) return 'VERY_ACTIVE';
  if (r.month <= A.QUIET_MONTH_MAX) return 'QUIET';
  return 'ACTIVE';
}

// agg rows: { _id: shopId, today, yesterday, week, month, total, completed, cancelled, refunded, paymentIssues, disputed, open, overdue, value, firstOrderAt, lastOrderAt }
function buildRows(agg, shops, now) {
  now = now || new Date();
  const byShop = new Map(agg.map((a) => [String(a._id), a]));
  const F = cfg.FLAGS;
  const rows = shops.map((s) => {
    const a = byShop.get(String(s._id)) || {};
    const r = {
      shopId: String(s._id), shopName: s.businessName, shopNumber: s.shopNumber, city: s.city || '', phone: s.whatsappNumber || '',
      today: a.today || 0, yesterday: a.yesterday || 0, week: a.week || 0, month: a.month || 0, total: a.total || 0,
      completed: a.completed || 0, cancelled: a.cancelled || 0, refunded: a.refunded || 0, paymentIssues: a.paymentIssues || 0,
      disputed: a.disputed || 0, open: a.open || 0, overdue: a.overdue || 0, revenue: a.value || 0,
      firstOrderAt: a.firstOrderAt || null, lastOrderAt: a.lastOrderAt || null
    };
    // average per day since the shop's first order (at least 1 day, so a brand-new shop is not inflated)
    const days = r.firstOrderAt ? Math.max(1, Math.ceil((now - new Date(r.firstOrderAt)) / DAY)) : 0;
    r.avgPerDay = days ? Math.round((r.total / days) * 10) / 10 : 0;
    r.activity = activityOf(r, now);
    const alerts = [];
    if (r.overdue > 0) alerts.push('OVERDUE');
    if (r.total >= cfg.MIN_SAMPLE && r.cancelled / r.total > F.HIGH_CANCEL_RATE) alerts.push('HIGH_CANCEL_RATE');
    if (r.total >= cfg.MIN_SAMPLE && r.disputed / r.total > F.HIGH_DISPUTE_RATE) alerts.push('HIGH_DISPUTE_RATE');
    if (r.disputed > 0 && r.total < cfg.MIN_SAMPLE) alerts.push('DISPUTE');
    r.alerts = alerts;
    return r;
  });
  // busiest today first, then this week, then all-time
  rows.sort((x, y) => y.today - x.today || y.week - x.week || y.total - x.total || String(x.shopName).localeCompare(String(y.shopName)));
  return rows;
}

function summarize(rows) {
  const sum = (k) => rows.reduce((t, r) => t + r[k], 0);
  const count = (a) => rows.filter((r) => r.activity === a).length;
  return {
    today: sum('today'), yesterday: sum('yesterday'), week: sum('week'), month: sum('month'), total: sum('total'),
    completed: sum('completed'), cancelled: sum('cancelled'), paymentIssues: sum('paymentIssues'), revenue: sum('revenue'),
    open: sum('open'), overdue: sum('overdue'),
    veryActive: count('VERY_ACTIVE'), active: count('ACTIVE'), quiet: count('QUIET'), stopped: count('STOPPED'), noOrders: count('NO_ORDERS'),
    shops: rows.length,
    needsAttention: rows.filter((r) => r.activity === 'STOPPED' || r.alerts.length).length
  };
}

async function getShopAnalytics(now) {
  now = now || new Date();
  const st = periodStarts(now);
  const since = (d) => ({ $cond: [{ $gte: ['$createdAt', d] }, 1, 0] });
  const agg = await Order.aggregate([
    { $group: {
        _id: '$seller',
        today: { $sum: since(st.today) },
        yesterday: { $sum: { $cond: [{ $and: [{ $gte: ['$createdAt', st.yesterday] }, { $lt: ['$createdAt', st.today] }] }, 1, 0] } },
        week: { $sum: since(st.week) },
        month: { $sum: since(st.month) },
        total: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $eq: ['$status', 'CANCELLED'] }, 1, 0] } },
        refunded: { $sum: { $cond: [{ $eq: ['$status', 'REFUNDED'] }, 1, 0] } },
        paymentIssues: { $sum: { $cond: [{ $in: ['PAYMENT_ISSUE', { $ifNull: ['$statusHistory.to', []] }] }, 1, 0] } },
        disputed: { $sum: { $cond: [{ $in: ['DISPUTED', { $ifNull: ['$statusHistory.to', []] }] }, 1, 0] } },
        open: { $sum: { $cond: [{ $in: ['$status', TERMINAL] }, 0, 1] } },
        overdue: { $sum: { $cond: [{ $and: [{ $not: [{ $in: ['$status', TERMINAL] }] }, { $ne: [{ $ifNull: ['$deadlineAt', null] }, null] }, { $lt: ['$deadlineAt', now] }] }, 1, 0] } },
        value: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, { $ifNull: ['$total', 0] }, 0] } },
        firstOrderAt: { $min: '$createdAt' },
        lastOrderAt: { $max: '$createdAt' }
    } }
  ]);
  const shops = await Seller.find({ status: cfg.APPROVED_STATUS }).select('businessName shopNumber city whatsappNumber').lean();
  const rows = buildRows(agg, shops, now);
  return { generatedAt: now, timezone: cfg.TIMEZONE, periodStarts: st, summary: summarize(rows), shops: rows };
}

module.exports = { buildRows, summarize, periodStarts, activityOf, getShopAnalytics };
