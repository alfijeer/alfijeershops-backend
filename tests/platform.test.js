'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
let settingDoc = null, role = 'buyer';
const orig = Module._load;
Module._load = function (r) {
  if (r.endsWith('models/Setting')) return { findOne: () => ({ lean: async () => settingDoc }) };
  if (r.endsWith('models/User')) return { findById: () => ({ select: () => ({ lean: async () => ({ role }) }) }) };
  if (r === 'jsonwebtoken') return { verify: (t) => { if (t === 'bad') throw new Error('x'); return { id: 'u1' }; } };
  if (r.endsWith('models/Order')) return {};
  if (r.endsWith('models/Seller')) return {};
  return orig.apply(this, arguments);
};
const platform = require('../services/platform');
const { maintenanceGate } = require('../middleware/maintenance');
const { buildRows, summarize } = require('../services/adminAnalytics');

const run = async (path, token) => {
  let status = null, body = null, nexted = false;
  const res = { status(c) { status = c; return this; }, json(b) { body = b; } };
  await maintenanceGate({ path, headers: token ? { authorization: 'Bearer ' + token } : {} }, res, () => { nexted = true; });
  return { status, body, nexted };
};

test('open by default', async () => { platform.clearCache(); assert.ok((await run('/products')).nexted); });

test('maintenance blocks visitors, lets health/status/login and admins through', async () => {
  settingDoc = { maintenance: { enabled: true, message: 'Back at 4pm', eta: '4pm' } }; platform.clearCache();
  const blocked = await run('/products');
  assert.strictEqual(blocked.status, 503); assert.strictEqual(blocked.body.code, 'MAINTENANCE'); assert.strictEqual(blocked.body.message, 'Back at 4pm');
  for (const p of ['/health', '/platform/status', '/auth/login']) assert.ok((await run(p)).nexted, p);
  role = 'seller'; assert.strictEqual((await run('/orders', 'tok')).status, 503);
  assert.strictEqual((await run('/orders', 'bad')).status, 503);
  role = 'admin'; assert.ok((await run('/orders', 'tok')).nexted);
  settingDoc = null; platform.clearCache();
});

const { periodStarts } = require('../services/adminAnalytics');

test('periods use Lagos midnight, Monday weeks and calendar months', () => {
  // Wed 21 Oct 2026, 05:49 Lagos = 04:49 UTC
  const st = periodStarts(new Date('2026-10-21T04:49:00Z'));
  assert.strictEqual(st.today.toISOString(), '2026-10-20T23:00:00.000Z');       // 00:00 Wed in Lagos
  assert.strictEqual(st.yesterday.toISOString(), '2026-10-19T23:00:00.000Z');
  assert.strictEqual(st.week.toISOString(), '2026-10-18T23:00:00.000Z');        // Monday 19 Oct, 00:00 Lagos
  assert.strictEqual(st.month.toISOString(), '2026-09-30T23:00:00.000Z');       // 1 Oct, 00:00 Lagos
  // 00:30 Lagos on Thursday is still Wednesday in UTC: "today" must already be Thursday
  assert.strictEqual(periodStarts(new Date('2026-10-21T23:30:00Z')).today.toISOString(), '2026-10-21T23:00:00.000Z');
  // Sunday belongs to the week that began the previous Monday
  assert.strictEqual(periodStarts(new Date('2026-10-25T12:00:00Z')).week.toISOString(), '2026-10-18T23:00:00.000Z');
});

test('order analysis rows follow the admin layout, with activity labels', () => {
  const now = new Date('2026-10-21T12:00:00Z'), ago = (d) => new Date(now - d * 86400000);
  const shops = [1, 2, 3, 4, 5].map((n) => ({ _id: 'S' + n, businessName: 'Shop 00' + n, shopNumber: n }));
  const agg = [
    { _id: 'S1', today: 8, yesterday: 6, week: 36, month: 145, total: 820, completed: 700, cancelled: 80, paymentIssues: 12, disputed: 5, open: 9, overdue: 0, value: 4000000, firstOrderAt: ago(410), lastOrderAt: ago(0) },
    { _id: 'S2', today: 1, yesterday: 0, week: 4, month: 17, total: 96, completed: 90, cancelled: 4, paymentIssues: 1, disputed: 0, open: 2, overdue: 1, value: 300000, firstOrderAt: ago(96), lastOrderAt: ago(0) },
    { _id: 'S3', today: 0, yesterday: 0, week: 0, month: 2, total: 15, completed: 14, cancelled: 1, paymentIssues: 0, disputed: 0, open: 0, overdue: 0, value: 90000, firstOrderAt: ago(60), lastOrderAt: ago(5) },
    { _id: 'S4', today: 0, yesterday: 0, week: 0, month: 0, total: 40, completed: 40, cancelled: 0, paymentIssues: 0, disputed: 0, open: 0, overdue: 0, value: 1, firstOrderAt: ago(200), lastOrderAt: ago(30) }
  ];
  const rows = buildRows(agg, shops, now);
  assert.deepStrictEqual(rows.map((r) => r.shopName), ['Shop 001', 'Shop 002', 'Shop 004', 'Shop 003', 'Shop 005']);   // busiest today first, ties by week then all-time
  const by = Object.fromEntries(rows.map((r) => [r.shopName, r]));
  assert.strictEqual(by['Shop 001'].activity, 'VERY_ACTIVE');
  assert.strictEqual(by['Shop 002'].activity, 'ACTIVE');
  assert.strictEqual(by['Shop 003'].activity, 'QUIET');
  assert.strictEqual(by['Shop 004'].activity, 'STOPPED');            // last order 30 days ago
  assert.strictEqual(by['Shop 005'].activity, 'NO_ORDERS');
  assert.strictEqual(by['Shop 001'].avgPerDay, 2);                   // 820 / 410 days
  assert.strictEqual(by['Shop 001'].paymentIssues, 12);
  assert.ok(by['Shop 002'].alerts.includes('OVERDUE'));
  const s = summarize(rows);
  assert.strictEqual(s.today, 9); assert.strictEqual(s.week, 40); assert.strictEqual(s.total, 971);
  assert.strictEqual(s.stopped, 1); assert.strictEqual(s.noOrders, 1); assert.strictEqual(s.veryActive, 1);
});
