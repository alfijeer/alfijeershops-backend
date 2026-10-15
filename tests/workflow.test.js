'use strict';
// Run with:  node --test
const test = require('node:test');
const assert = require('node:assert');
const { buildTransition, checkBuyerLimit, ACTIONS, TERMINAL, TIMER_RULES, ADMIN_DECISIONS } = require('../services/workflow');
const { computeStats } = require('../services/shopStats');

const BUYER = { id: 'b1', role: 'BUYER' };
const SELLER = { id: 's1', role: 'SELLER', shopId: 'shop1' };
const ADMIN = { id: 'a1', role: 'ADMIN' };
const SYSTEM = { id: null, role: 'SYSTEM' };
const mk = (status, extra) => Object.assign({ _id: 'o1', buyer: 'b1', seller: 'shop1', total: 5000, status, replacementCount: 0 }, extra || {});
const go = (order, action, actor, payload) => buildTransition(order, action, actor, payload || {}, new Date('2026-10-04T10:00:00Z'));
const fails = (fn, code) => assert.throws(fn, (e) => e.code === code, 'expected ' + code);

test('happy path from PENDING to COMPLETED', () => {
  let o = mk('PENDING');
  const steps = [
    ['SELLER_ACCEPT', SELLER, {}, 'ACCEPTED'],
    ['BUYER_PAID', BUYER, { method: 'Bank transfer' }, 'PAYMENT_SUBMITTED'],
    ['SELLER_CONFIRM_PAYMENT', SELLER, {}, 'PAYMENT_CONFIRMED'],
    ['SELLER_DELIVER', SELLER, {}, 'DELIVERED'],
    ['BUYER_CONFIRM_RECEIPT', BUYER, {}, 'COMPLETED']
  ];
  for (const [action, actor, payload, expected] of steps) {
    const t = go(o, action, actor, payload);
    assert.strictEqual(t.to, expected);
    assert.strictEqual(t.history.from, o.status);
    assert.strictEqual(t.history.byRole, actor.role);
    o = Object.assign({}, o, t.set);
  }
  assert.strictEqual(o.deadlineAt, null); // terminal status has no deadline
});

test('roles are enforced', () => {
  fails(() => go(mk('PAYMENT_SUBMITTED'), 'SELLER_CONFIRM_PAYMENT', BUYER), 'FORBIDDEN');
  fails(() => go(mk('PENDING'), 'SELLER_ACCEPT', ADMIN), 'FORBIDDEN');
  fails(() => go(mk('PENDING'), 'TIMER_PENDING_EXPIRE', SELLER), 'FORBIDDEN');
});

test('ownership is enforced', () => {
  fails(() => go(mk('PENDING'), 'SELLER_ACCEPT', { id: 's2', role: 'SELLER', shopId: 'shop2' }), 'FORBIDDEN');
  fails(() => go(mk('ACCEPTED'), 'BUYER_CANCEL', { id: 'b2', role: 'BUYER' }), 'FORBIDDEN');
});

test('actions only work from the right status', () => {
  fails(() => go(mk('PENDING'), 'BUYER_PAID', BUYER, { method: 'Transfer' }), 'BAD_STATE');
  fails(() => go(mk('ACCEPTED'), 'SELLER_DELIVER', SELLER), 'BAD_STATE');
  fails(() => go(mk('PAYMENT_SUBMITTED'), 'BUYER_CONFIRM_RECEIPT', BUYER), 'BAD_STATE');
});

test('terminal statuses allow no action at all', () => {
  const actors = { BUYER, SELLER, ADMIN, SYSTEM };
  for (const status of TERMINAL) {
    for (const name of Object.keys(ACTIONS)) {
      const actor = actors[ACTIONS[name].roles[0]];
      assert.throws(() => go(mk(status), name, actor, { reason: 'test reason', faultParty: 'NONE', method: 'x', proofImageUrl: 'https://x.y/z' }), undefined, `${name} must fail from ${status}`);
    }
  }
});

test('admin cannot confirm payment or complete a normal order', () => {
  fails(() => go(mk('PAYMENT_SUBMITTED'), 'PAYMENT_VALID', ADMIN, { reason: 'looks fine' }), 'BAD_STATE');
  fails(() => go(mk('DELIVERED'), 'REJECT', ADMIN, { reason: 'looks fine' }), 'BAD_STATE');
});

test('after payment is confirmed there is no plain cancel, only refund', () => {
  for (const s of ['PAYMENT_CONFIRMED', 'DELIVERED', 'REPLACEMENT_PENDING']) {
    fails(() => go(mk(s), 'ADMIN_CANCEL', ADMIN, { reason: 'fraud found' }), 'BAD_STATE');
    const t = go(mk(s), 'ADMIN_REFUND', ADMIN, { reason: 'fraud found', faultParty: 'SELLER' });
    assert.strictEqual(t.to, 'REFUND_PENDING');
    assert.strictEqual(t.set['refund.faultParty'], 'SELLER');
  }
  assert.strictEqual(go(mk('PAYMENT_SUBMITTED'), 'ADMIN_CANCEL', ADMIN, { reason: 'fraud found' }).to, 'CANCELLED');
});

test('admin decisions need a reason, and refunds need a fault party', () => {
  fails(() => go(mk('DISPUTED'), 'REJECT', ADMIN, {}), 'VALIDATION');
  fails(() => go(mk('DISPUTED'), 'REJECT', ADMIN, { reason: 'no' }), 'VALIDATION');
  fails(() => go(mk('DISPUTED'), 'REFUND', ADMIN, { reason: 'seller sent wrong item' }), 'VALIDATION');
  assert.strictEqual(go(mk('DISPUTED'), 'REFUND', ADMIN, { reason: 'seller sent wrong item', faultParty: 'SELLER' }).to, 'REFUND_PENDING');
});

test('only one replacement per order', () => {
  const t = go(mk('DISPUTED'), 'REPLACE', ADMIN, { reason: 'item damaged' });
  assert.strictEqual(t.to, 'REPLACEMENT_PENDING');
  assert.deepStrictEqual(t.inc, { replacementCount: 1 });
  fails(() => go(mk('DISPUTED', { replacementCount: 1 }), 'REPLACE', ADMIN, { reason: 'item damaged again' }), 'BAD_STATE');
  assert.strictEqual(go(mk('DISPUTED', { replacementCount: 1 }), 'REFUND', ADMIN, { reason: 'second failure', faultParty: 'SELLER' }).to, 'REFUND_PENDING');
});

test('payment issue: buyer proof, then admin decides', () => {
  let o = mk('PAYMENT_SUBMITTED');
  let t = go(o, 'SELLER_REPORT_PAYMENT_ISSUE', SELLER, { reason: 'No money received' });
  assert.strictEqual(t.to, 'PAYMENT_ISSUE');
  assert.strictEqual(t.set['payment.issueReportedBy'], 'SELLER');
  assert.ok(t.set['payment.proofDueAt']);
  o = Object.assign({}, o, t.set);
  fails(() => go(o, 'BUYER_UPLOAD_PROOF', BUYER, { proofImageUrl: 'http://insecure.example/x.jpg' }), 'VALIDATION');
  t = go(o, 'BUYER_UPLOAD_PROOF', BUYER, { proofImageUrl: 'https://img.example/r.jpg', reference: 'TRX123' });
  assert.strictEqual(t.to, 'PAYMENT_ISSUE'); // no status change
  assert.strictEqual(t.set.status, undefined);
  assert.strictEqual(t.history.reason, 'Payment proof uploaded');
  const valid = go(o, 'PAYMENT_VALID', ADMIN, { reason: 'Receipt matches the bank record' });
  assert.strictEqual(valid.to, 'PAYMENT_CONFIRMED');
  assert.deepStrictEqual(valid.counters, { strikes: 1 }); // seller wrongly denied a real payment
  const invalid = go(o, 'PAYMENT_INVALID', ADMIN, { reason: 'Receipt is fake' });
  assert.strictEqual(invalid.set.cancelReason, 'PAYMENT_INVALID');
});

test('timers move overdue orders and record why', () => {
  const expect = {
    TIMER_PENDING_EXPIRE: ['PENDING', 'CANCELLED', 'SELLER_TIMEOUT'],
    TIMER_PAYMENT_EXPIRE: ['ACCEPTED', 'CANCELLED', 'PAYMENT_DEADLINE_EXPIRED'],
    TIMER_SELLER_SILENT: ['PAYMENT_SUBMITTED', 'PAYMENT_ISSUE'],
    TIMER_DELIVERY_LATE: ['PAYMENT_CONFIRMED', 'DELIVERY_REVIEW'],
    TIMER_AUTO_COMPLETE: ['DELIVERED', 'COMPLETED']
  };
  for (const [action, [from, to, cancelReason]] of Object.entries(expect)) {
    const t = go(mk(from), action, SYSTEM);
    assert.strictEqual(t.to, to, action);
    assert.strictEqual(t.history.byRole, 'SYSTEM');
    if (cancelReason) { assert.strictEqual(t.set.cancelReason, cancelReason); assert.strictEqual(t.set.cancelledBy, 'SYSTEM'); }
  }
  assert.strictEqual(go(mk('REPLACEMENT_PENDING'), 'TIMER_DELIVERY_LATE', SYSTEM).to, 'DELIVERY_REVIEW');
  assert.ok(TIMER_RULES.every(([s, a]) => ACTIONS[a].from.includes(s)), 'every timer rule matches an action');
});

test('overdue refund gives one strike only, and order stays REFUND_PENDING', () => {
  const t = go(mk('REFUND_PENDING'), 'TIMER_REFUND_OVERDUE', SYSTEM);
  assert.strictEqual(t.to, 'REFUND_PENDING');
  assert.deepStrictEqual(t.counters, { strikes: 1 });
  assert.strictEqual(t.set.deadlineAt, null);
  fails(() => go(mk('REFUND_PENDING', { refund: { strikeApplied: true } }), 'STRIKE_SELLER', ADMIN, { reason: 'already struck' }), 'BAD_STATE');
});

test('seller cancel after payment confirmation goes to refund with seller at fault', () => {
  const t = go(mk('PAYMENT_CONFIRMED'), 'SELLER_REQUEST_CANCEL', SELLER, { reason: 'Out of stock' });
  assert.strictEqual(t.to, 'REFUND_PENDING');
  assert.strictEqual(t.set['refund.faultParty'], 'SELLER');
});

test('dispute photos: optional, at most 3, https only', () => {
  const o = mk('DELIVERED');
  const ev = (n) => Array.from({ length: n }, (_, i) => ({ url: 'https://img.example/' + i + '.jpg', publicId: 'p' + i, format: 'jpg' }));
  assert.strictEqual(go(o, 'BUYER_DISPUTE', BUYER, { reason: 'Wrong colour' }).set['dispute.evidence'], undefined);   // no photos is fine
  assert.strictEqual(go(o, 'BUYER_DISPUTE', BUYER, { reason: 'Wrong colour', evidence: ev(3) }).set['dispute.evidence'].length, 3);
  fails(() => go(o, 'BUYER_DISPUTE', BUYER, { reason: 'Wrong colour', evidence: ev(4) }), 'VALIDATION');
  fails(() => go(o, 'BUYER_DISPUTE', BUYER, { reason: 'Wrong colour', evidence: [{ url: 'http://insecure/x.jpg' }] }), 'VALIDATION');
});

test('counters: completion and dispute are counted', () => {
  assert.deepStrictEqual(go(mk('DELIVERED'), 'BUYER_CONFIRM_RECEIPT', BUYER).counters, { completedOrders: 1 });
  assert.deepStrictEqual(go(mk('DELIVERED'), 'BUYER_DISPUTE', BUYER, { reason: 'Wrong colour' }).counters, { disputeCount: 1 });
});

test('every admin decision used by the admin screen exists', () => {
  const screen = ['PAYMENT_VALID', 'PAYMENT_INVALID', 'EXTEND', 'REFUND', 'REJECT', 'REPLACE', 'STRIKE_SELLER', 'ADMIN_CANCEL', 'ADMIN_REFUND'];
  assert.deepStrictEqual([...ADMIN_DECISIONS].sort(), [...screen].sort());
});

test('shop stats: counts, rates, small-sample guard, flags', () => {
  const H = 3600000, base = new Date('2026-09-01T00:00:00Z');
  const hist = (...pairs) => pairs.map(([to, hrs]) => ({ to, at: new Date(base.getTime() + hrs * H) }));
  const done = () => ({ status: 'COMPLETED', createdAt: base, statusHistory: hist(['ACCEPTED', 2], ['PAYMENT_SUBMITTED', 3], ['PAYMENT_CONFIRMED', 4], ['DELIVERED', 28], ['COMPLETED', 50]) });
  const few = [done(), done(), { status: 'CANCELLED', createdAt: base, cancelReason: 'SELLER_TIMEOUT', statusHistory: [] }];
  const s1 = computeStats(few, { status: 'approved', strikes: 0 }, 'all');
  assert.strictEqual(s1.totals.total, 3);
  assert.strictEqual(s1.totals.completed, 2);
  assert.strictEqual(s1.rates.completion, null); // under 10 orders: not enough data
  assert.strictEqual(s1.enoughData, false);
  assert.strictEqual(s1.trust.sellerTimeoutCount, 1);

  const many = [];
  for (let i = 0; i < 8; i++) many.push(done());
  for (let i = 0; i < 3; i++) many.push({ status: 'COMPLETED', createdAt: base, statusHistory: hist(['ACCEPTED', 1], ['PAYMENT_CONFIRMED', 2], ['DELIVERED', 10], ['DISPUTED', 11], ['COMPLETED', 20]) });
  const s2 = computeStats(many, { status: 'approved', strikes: 2 }, '30d');
  assert.strictEqual(s2.totals.total, 11);
  assert.strictEqual(s2.totals.disputes, 3);
  assert.ok(Math.abs(s2.rates.dispute - 3 / 11) < 1e-9);
  assert.ok(s2.flags.includes('HIGH_DISPUTE_RATE'));
  assert.ok(s2.flags.includes('MULTIPLE_STRIKES'));
  assert.ok(s2.timing.avgDeliveryHours > 0);
});

test('buyer limit: up to 3 open orders, one per shop', () => {
  const open = (...shops) => shops.map((shopId) => ({ shopId }));
  checkBuyerLimit(open(), 'shopA');                       // none open: fine
  checkBuyerLimit(open('shopA', 'shopB'), 'shopC');       // 2 open, third shop: fine
  fails(() => checkBuyerLimit(open('shopA'), 'shopA'), 'OPEN_ORDER_IN_SHOP');          // same shop again
  fails(() => checkBuyerLimit(open('shopA', 'shopB', 'shopC'), 'shopD'), 'ORDER_LIMIT'); // already 3
});
