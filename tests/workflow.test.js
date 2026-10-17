'use strict';
// Run with:  node --test
const test = require('node:test');
const assert = require('node:assert');
const { buildTransition, checkBuyerLimit, cleanFulfilment, ACTIONS, TERMINAL, TIMER_RULES, ADMIN_DECISIONS } = require('../services/workflow');
const { computeStats } = require('../services/shopStats');
const { cleanBankDetails, isBankComplete } = require('../utils/bankDetails');
const cfg = require('../config/orders');

const BUYER = { id: 'b1', role: 'BUYER' };
const SELLER = { id: 's1', role: 'SELLER', shopId: 'shop1' };
const ADMIN = { id: 'a1', role: 'ADMIN' };
const SYSTEM = { id: null, role: 'SYSTEM' };
const mk = (status, extra) => Object.assign({ _id: 'o1', buyer: 'b1', seller: 'shop1', total: 5000, status, replacementCount: 0 }, extra || {});
const NOW = new Date('2026-10-04T10:00:00Z');
const BANK = { bankName: 'GTBank', accountName: 'Aisha Small Chops', accountNumber: '0123456789' };
// By default the seller has saved valid bank details (ctx.bank); tests of the bank rules pass their own ctx
const go = (order, action, actor, payload, ctx) => buildTransition(order, action, actor, payload || {}, NOW, ctx === undefined ? { bank: BANK } : ctx);
const apply = (order, t) => Object.assign({}, order, t.set);
const delivery = (status, extra) => mk(status, Object.assign({ fulfilment: 'DELIVERY', productTotal: 2000, total: 2000 }, extra || {}));
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

// ═══════════ Version 1: pickup / delivery flow ═══════════

test('pickup happy path: no total step, bank details copied onto the order when the seller accepts', () => {
  let o = mk('PENDING', { fulfilment: 'PICKUP' });
  const accept = go(o, 'SELLER_ACCEPT', SELLER);
  assert.strictEqual(accept.to, 'ACCEPTED');
  assert.strictEqual(accept.set.paymentDetails.accountNumber, '0123456789');
  assert.deepStrictEqual(Object.keys(accept.set.paymentDetails).sort(), ['accountName', 'accountNumber', 'bankName', 'sharedAt']);
  o = apply(o, accept);
  fails(() => go(o, 'SELLER_SEND_TOTAL', SELLER, { deliveryFee: 100 }), 'BAD_STATE');   // pickup has no fee to send
  assert.strictEqual(go(o, 'BUYER_PAID', BUYER, { method: 'Bank transfer' }).to, 'PAYMENT_SUBMITTED');
});

test('delivery happy path: total is sent, accepted, then bank details are revealed and the order completes', () => {
  let o = delivery('PENDING');
  const steps = [
    ['SELLER_ACCEPT', SELLER, {}, 'ACCEPTED'],
    ['SELLER_SEND_TOTAL', SELLER, { deliveryFee: 100 }, 'TOTAL_SENT'],
    ['BUYER_ACCEPT_TOTAL', BUYER, {}, 'TOTAL_ACCEPTED'],
    ['BUYER_PAID', BUYER, { method: 'Bank transfer', reference: ' TRX-77 ' }, 'PAYMENT_SUBMITTED'],
    ['SELLER_CONFIRM_PAYMENT', SELLER, {}, 'PAYMENT_CONFIRMED'],
    ['SELLER_DELIVER', SELLER, {}, 'DELIVERED'],
    ['BUYER_CONFIRM_RECEIPT', BUYER, {}, 'COMPLETED']
  ];
  for (const [action, actor, payload, expected] of steps) {
    const t = go(o, action, actor, payload);
    assert.strictEqual(t.to, expected, action);
    if (action === 'SELLER_ACCEPT') assert.strictEqual(t.set.paymentDetails, undefined, 'bank details stay hidden until the buyer accepts the total');
    if (action === 'BUYER_ACCEPT_TOTAL') assert.strictEqual(t.set.paymentDetails.accountNumber, '0123456789');
    if (action === 'BUYER_PAID') { assert.strictEqual(t.set['payment.amount'], 2100); assert.strictEqual(t.set['payment.reference'], 'TRX-77'); }
    o = apply(o, t);
  }
  assert.strictEqual(o.total, 2100);
  assert.strictEqual(o.productTotal, 2000);
  assert.strictEqual(o.deliveryFee, 100);
  assert.strictEqual(o.deadlineAt, null);
});

test('a seller without complete bank details cannot accept an order', () => {
  for (const bank of [undefined, null, {}, { bankName: 'GTBank', accountName: 'Aisha', accountNumber: '12345' }, { bankName: 'GTBank', accountNumber: '0123456789' }]) {
    assert.throws(() => go(mk('PENDING'), 'SELLER_ACCEPT', SELLER, {}, { bank }),
      (e) => e.code === 'BANK_DETAILS_REQUIRED' && e.status === 409 && e.message === 'Complete your payment details before accepting customer orders.');
  }
  fails(() => go(mk('PENDING'), 'SELLER_ACCEPT', SELLER, {}, {}), 'BANK_DETAILS_REQUIRED');
  // declining never needs bank details
  assert.strictEqual(go(mk('PENDING'), 'SELLER_DECLINE', SELLER, {}, {}).to, 'CANCELLED');
});

test('delivery fee: whole naira, 0 allowed, limited, seller only, only while ACCEPTED', () => {
  const o = delivery('ACCEPTED');
  assert.strictEqual(go(o, 'SELLER_SEND_TOTAL', SELLER, { deliveryFee: 0 }).set.total, 2000);            // free delivery
  assert.strictEqual(go(o, 'SELLER_SEND_TOTAL', SELLER, { deliveryFee: '1,500' }).set.total, 3500);       // typed with a comma
  assert.strictEqual(go(o, 'SELLER_SEND_TOTAL', SELLER, { deliveryFee: cfg.MAX_DELIVERY_FEE }).set.deliveryFee, cfg.MAX_DELIVERY_FEE);
  for (const bad of [undefined, '', 'abc', -1, 10.5, cfg.MAX_DELIVERY_FEE + 1, NaN, null]) fails(() => go(o, 'SELLER_SEND_TOTAL', SELLER, { deliveryFee: bad }), 'VALIDATION');
  fails(() => go(o, 'SELLER_SEND_TOTAL', BUYER, { deliveryFee: 100 }), 'FORBIDDEN');
  fails(() => go(delivery('PENDING'), 'SELLER_SEND_TOTAL', SELLER, { deliveryFee: 100 }), 'BAD_STATE');
  fails(() => go(delivery('TOTAL_SENT'), 'SELLER_SEND_TOTAL', SELLER, { deliveryFee: 100 }), 'BAD_STATE');  // the fee cannot be changed after it was sent
});

test('the total is fixed once sent: price comes from productTotal, never from the old total plus a new fee', () => {
  const t = go(delivery('ACCEPTED'), 'SELLER_SEND_TOTAL', SELLER, { deliveryFee: 300 });
  assert.deepStrictEqual([t.set.productTotal, t.set.deliveryFee, t.set.total], [2000, 300, 2300]);
  // an order that was created before productTotal existed falls back to its total
  const legacy = mk('ACCEPTED', { fulfilment: 'DELIVERY', total: 1800 });
  assert.strictEqual(go(legacy, 'SELLER_SEND_TOTAL', SELLER, { deliveryFee: 200 }).set.total, 2000);
});

test('payment: delivery orders cannot be paid before the total is accepted; receipt is optional and safe', () => {
  fails(() => go(delivery('ACCEPTED'), 'BUYER_PAID', BUYER, { method: 'Transfer' }), 'BAD_STATE');
  fails(() => go(delivery('TOTAL_SENT'), 'BUYER_PAID', BUYER, { method: 'Transfer' }), 'BAD_STATE');
  const paid = go(delivery('TOTAL_ACCEPTED', { total: 2100 }), 'BUYER_PAID', BUYER, { method: 'POS' });
  assert.strictEqual(paid.set['payment.amount'], 2100);
  assert.strictEqual(paid.set['payment.proofImageUrl'], undefined);                         // no receipt: fine
  const withReceipt = go(mk('ACCEPTED'), 'BUYER_PAID', BUYER, { method: 'POS', proofImageUrl: 'https://img.example/r.jpg', proofPublicId: 'alfijeer/payment-proofs/r1', proofFormat: 'png' });
  assert.strictEqual(withReceipt.set['payment.proofPublicId'], 'alfijeer/payment-proofs/r1');
  assert.strictEqual(withReceipt.set['payment.proofFormat'], 'png');
  fails(() => go(mk('ACCEPTED'), 'BUYER_PAID', BUYER, { method: 'POS', proofImageUrl: 'http://insecure.example/r.jpg', proofPublicId: 'x' }), 'VALIDATION');
  fails(() => go(mk('ACCEPTED'), 'BUYER_PAID', BUYER, { method: 'POS', proofImageUrl: 'https://img.example/r.jpg' }), 'VALIDATION');   // must come from our own upload
  fails(() => go(mk('ACCEPTED'), 'BUYER_PAID', BUYER, {}), 'VALIDATION');                    // payment method still required
});

test('cancel rules: before payment only; refusing a total has its own reason; admin can cancel in the new statuses', () => {
  for (const s of ['PENDING', 'ACCEPTED', 'TOTAL_ACCEPTED']) assert.strictEqual(go(delivery(s), 'BUYER_CANCEL', BUYER).set.cancelReason, 'BUYER_CANCELLED', s);
  fails(() => go(delivery('PAYMENT_SUBMITTED'), 'BUYER_CANCEL', BUYER), 'BAD_STATE');
  fails(() => go(delivery('TOTAL_SENT'), 'BUYER_CANCEL', BUYER), 'BAD_STATE');
  const declined = go(delivery('TOTAL_SENT'), 'BUYER_DECLINE_TOTAL', BUYER);
  assert.strictEqual(declined.to, 'CANCELLED');
  assert.strictEqual(declined.set.cancelReason, 'TOTAL_DECLINED');
  assert.strictEqual(declined.set.cancelledBy, 'BUYER');
  fails(() => go(delivery('ACCEPTED'), 'BUYER_DECLINE_TOTAL', BUYER), 'BAD_STATE');
  for (const s of ['TOTAL_SENT', 'TOTAL_ACCEPTED']) assert.strictEqual(go(delivery(s), 'ADMIN_CANCEL', ADMIN, { reason: 'fraud found' }).to, 'CANCELLED', s);
});

test('buyer cannot accept a total when the seller has no payment details to show', () => {
  fails(() => go(delivery('TOTAL_SENT'), 'BUYER_ACCEPT_TOTAL', BUYER, {}, { bank: null }), 'BANK_DETAILS_REQUIRED');
});

// ═══════════ Fair timers: each one acts on whoever was expected to act next ═══════════

test('timers: a delivery order waiting in ACCEPTED is the seller\'s fault; a pickup order waiting in ACCEPTED is the buyer\'s', () => {
  const d = go(delivery('ACCEPTED'), 'TIMER_TOTAL_NOT_SENT', SYSTEM);
  assert.strictEqual(d.set.cancelReason, 'SELLER_NO_TOTAL');
  fails(() => go(delivery('ACCEPTED'), 'TIMER_PAYMENT_EXPIRE', SYSTEM), 'BAD_STATE');   // never blame the buyer for the seller's silence
  const p = go(mk('ACCEPTED'), 'TIMER_PAYMENT_EXPIRE', SYSTEM);
  assert.strictEqual(p.set.cancelReason, 'PAYMENT_DEADLINE_EXPIRED');
  fails(() => go(mk('ACCEPTED'), 'TIMER_TOTAL_NOT_SENT', SYSTEM), 'BAD_STATE');         // pickup has no total to wait for
  fails(() => go(mk('ACCEPTED', { fulfilment: 'PICKUP' }), 'TIMER_TOTAL_NOT_SENT', SYSTEM), 'BAD_STATE');
});

test('timers: buyer silence on a total, and buyer not paying after accepting it, are the buyer\'s', () => {
  assert.strictEqual(go(delivery('TOTAL_SENT'), 'TIMER_TOTAL_EXPIRE', SYSTEM).set.cancelReason, 'TOTAL_EXPIRED');
  assert.strictEqual(go(delivery('TOTAL_ACCEPTED'), 'TIMER_PAYMENT_EXPIRE', SYSTEM).set.cancelReason, 'PAYMENT_DEADLINE_EXPIRED');
  for (const s of ['PENDING', 'TOTAL_SENT']) fails(() => go(mk(s), 'TIMER_PAYMENT_EXPIRE', SYSTEM), 'BAD_STATE');
});

test('timer rules cover every waiting status and pick the right action by order type', () => {
  const rule = (status, fulfilment) => TIMER_RULES.filter(([s, , f]) => {
    if (s !== status) return false;
    if (!f) return true;
    return fulfilment === 'DELIVERY' ? f.fulfilment === 'DELIVERY' : (f.fulfilment && f.fulfilment.$ne === 'DELIVERY');
  }).map(([, a]) => a);
  assert.deepStrictEqual(rule('ACCEPTED', 'PICKUP'), ['TIMER_PAYMENT_EXPIRE']);
  assert.deepStrictEqual(rule('ACCEPTED', 'DELIVERY'), ['TIMER_TOTAL_NOT_SENT']);
  assert.deepStrictEqual(rule('TOTAL_SENT'), ['TIMER_TOTAL_EXPIRE']);
  assert.deepStrictEqual(rule('TOTAL_ACCEPTED'), ['TIMER_PAYMENT_EXPIRE']);
  // every status a timer watches has a deadline, so no order can wait forever
  for (const [status] of TIMER_RULES) assert.ok(cfg.DEADLINE_HOURS[status] > 0, status + ' needs a deadline');
});

test('deadlines follow who must act: delivery ACCEPTED is the seller\'s shorter clock', () => {
  const H = 3600000;
  const hoursOf = (t) => (t.set.deadlineAt - NOW) / H;
  assert.strictEqual(hoursOf(go(delivery('PENDING'), 'SELLER_ACCEPT', SELLER)), cfg.DEADLINE_HOURS_DELIVERY.ACCEPTED);   // seller owes the total
  assert.strictEqual(hoursOf(go(mk('PENDING'), 'SELLER_ACCEPT', SELLER)), cfg.DEADLINE_HOURS.ACCEPTED);                 // buyer owes the payment
  assert.strictEqual(hoursOf(go(delivery('ACCEPTED'), 'SELLER_SEND_TOTAL', SELLER, { deliveryFee: 100 })), cfg.DEADLINE_HOURS.TOTAL_SENT);
  assert.strictEqual(hoursOf(go(delivery('TOTAL_SENT'), 'BUYER_ACCEPT_TOTAL', BUYER)), cfg.DEADLINE_HOURS.TOTAL_ACCEPTED);
});

test('terminal statuses still allow nothing, including the new actions', () => {
  const actors = { BUYER, SELLER, ADMIN, SYSTEM };
  for (const status of TERMINAL) {
    for (const name of ['SELLER_SEND_TOTAL', 'BUYER_ACCEPT_TOTAL', 'BUYER_DECLINE_TOTAL', 'TIMER_TOTAL_NOT_SENT', 'TIMER_TOTAL_EXPIRE']) {
      assert.throws(() => go(delivery(status), name, actors[ACTIONS[name].roles[0]], { deliveryFee: 100 }), undefined, `${name} must fail from ${status}`);
    }
  }
});

// ═══════════ Order input and bank details ═══════════

test('new orders: pickup needs nothing more, delivery needs name, phone and address', () => {
  assert.deepStrictEqual(cleanFulfilment({}), { fulfilment: 'PICKUP' });
  assert.deepStrictEqual(cleanFulfilment({ fulfilment: 'pickup', delivery: { name: 'ignored' } }), { fulfilment: 'PICKUP' });
  const ok = cleanFulfilment({ fulfilment: 'DELIVERY', delivery: { name: '  Musa   Bello ', phone: '0803 123-4567', address: '12 Zoo Road, Kano', landmark: ' Near the mosque ', note: '' } });
  assert.strictEqual(ok.fulfilment, 'DELIVERY');
  assert.deepStrictEqual(ok.delivery, { name: 'Musa Bello', phone: '08031234567', address: '12 Zoo Road, Kano', landmark: 'Near the mosque', note: undefined });
  const base = { name: 'Musa', phone: '08031234567', address: '12 Zoo Road, Kano' };
  for (const [field, value] of [['name', ''], ['phone', '123'], ['phone', 'call me'], ['address', 'Kano'], ['landmark', 'x'.repeat(121)], ['note', 'x'.repeat(301)]]) {
    fails(() => cleanFulfilment({ fulfilment: 'DELIVERY', delivery: Object.assign({}, base, { [field]: value }) }), 'VALIDATION');
  }
  fails(() => cleanFulfilment({ fulfilment: 'DELIVERY' }), 'VALIDATION');
  fails(() => cleanFulfilment({ fulfilment: 'COURIER' }), 'VALIDATION');
});

test('bank details: bank name, account name and a 10 digit account number are all required', () => {
  const ok = cleanBankDetails({ bankName: ' GTBank ', accountName: 'Aisha   Small Chops', accountNumber: '0123 456 789' });
  assert.deepStrictEqual(ok, { ok: true, value: { bankName: 'GTBank', accountName: 'Aisha Small Chops', accountNumber: '0123456789' } });
  for (const bad of [{}, { bankName: 'GTBank', accountName: 'Aisha' }, { bankName: 'GTBank', accountName: 'Aisha', accountNumber: '123456789' },
    { bankName: 'GTBank', accountName: 'Aisha', accountNumber: '01234567890' }, { bankName: 'GTBank', accountName: 'Aisha', accountNumber: '01234abc89' },
    { bankName: '', accountName: 'Aisha', accountNumber: '0123456789' }, { bankName: 'GTBank', accountName: ' ', accountNumber: '0123456789' }]) {
    assert.strictEqual(cleanBankDetails(bad).ok, false);
  }
  assert.strictEqual(isBankComplete(BANK), true);
  assert.strictEqual(isBankComplete(null), false);
  assert.strictEqual(isBankComplete({ bankName: 'GTBank' }), false);
});

test('shop stats: a seller who never sent the delivery total counts like a seller who never accepted', () => {
  const orders = [{ status: 'CANCELLED', createdAt: NOW, cancelReason: 'SELLER_NO_TOTAL', statusHistory: [] }, { status: 'CANCELLED', createdAt: NOW, cancelReason: 'TOTAL_EXPIRED', statusHistory: [] }];
  assert.strictEqual(computeStats(orders, { status: 'approved' }, 'all').trust.sellerTimeoutCount, 1); // the buyer's own silence is not held against the shop
});
