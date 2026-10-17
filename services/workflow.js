'use strict';
// The order state machine. PURE: no database, no Express. Everything the permissions table says lives here.
// Every status change in the system must go through buildTransition().
const cfg = require('../config/orders');
const { cleanBankDetails, isBankComplete, BANK_REQUIRED_MESSAGE } = require('../utils/bankDetails');

const TERMINAL = ['COMPLETED', 'CANCELLED', 'REFUNDED'];
const FAULT = ['SELLER', 'BUYER', 'NONE'];

class OrderError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const bad = (m) => { throw new OrderError(400, 'VALIDATION', m); };
const text = (v, min, label) => {
  if (typeof v !== 'string' || v.trim().length < min) bad(`${label} is required (at least ${min} characters).`);
  return v.trim();
};
const squash = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

// Orders created before pickup/delivery existed have no value: they are pickup orders.
const fulfilmentOf = (o) => (o && o.fulfilment === 'DELIVERY' ? 'DELIVERY' : 'PICKUP');
const productTotalOf = (o) => (o.productTotal != null ? Number(o.productTotal) : Number(o.total));

// How long a status may last. A delivery order in ACCEPTED is waiting for the SELLER, so it has its own clock.
const deadlineFor = (status, now, fulfilment) => {
  let h = cfg.DEADLINE_HOURS[status];
  if (fulfilment === 'DELIVERY' && cfg.DEADLINE_HOURS_DELIVERY[status]) h = cfg.DEADLINE_HOURS_DELIVERY[status];
  return h ? new Date(now.getTime() + h * 3600000) : null;
};
const issueSet = (reporter, reason, now) => ({
  'payment.status': 'ISSUE',
  'payment.issueReason': reason,
  'payment.issueReportedBy': reporter,
  'payment.proofDueAt': deadlineFor('PAYMENT_ISSUE', now)
});
const confirmSet = (role, actor, now) => ({
  'payment.status': 'CONFIRMED', 'payment.confirmedBy': actor.id || null,
  'payment.confirmedByRole': role, 'payment.confirmedAt': now
});
const adminReason = (o, p) => { text(p.reason, 5, 'A reason'); };
const withFault = (o, p) => {
  text(p.reason, 5, 'A reason');
  if (!FAULT.includes(p.faultParty)) bad('Choose who was at fault: SELLER, BUYER or NONE.');
};
const faultSet = (o, p, now) => ({ 'refund.faultParty': p.faultParty, 'refund.decidedAt': now });
const notStruck = (o) => {
  if (o.refund && o.refund.strikeApplied) throw new OrderError(409, 'BAD_STATE', 'A strike was already applied for this order.');
};

// ── Delivery orders ──
const needsDelivery = (message) => (o) => {
  if (fulfilmentOf(o) !== 'DELIVERY') throw new OrderError(409, 'BAD_STATE', message);
};
function parseFee(v) {
  const n = typeof v === 'string' ? Number(v.replace(/[,\s₦]/g, '')) : Number(v);
  if (v === '' || v == null || !Number.isInteger(n) || n < 0 || n > cfg.MAX_DELIVERY_FEE) {
    bad(`Enter the delivery fee as a whole amount in naira, from 0 to ${cfg.MAX_DELIVERY_FEE.toLocaleString('en-NG')}.`);
  }
  return n;
}

// Validates the "how do you want to receive your order" part of a new order. Returns what to save.
function cleanFulfilment(body) {
  const raw = body && body.fulfilment != null ? String(body.fulfilment).toUpperCase() : 'PICKUP';
  if (!cfg.FULFILMENT.includes(raw)) bad('Choose pickup or delivery.');
  if (raw === 'PICKUP') return { fulfilment: 'PICKUP' };
  const d = (body && body.delivery) || {};
  const name = squash(d.name), address = squash(d.address), landmark = squash(d.landmark), note = squash(d.note);
  const phone = String(d.phone == null ? '' : d.phone).replace(/[\s()-]/g, '');
  if (name.length < 2 || name.length > 80) bad('Please enter the customer name for the delivery.');
  if (!/^\+?\d{10,15}$/.test(phone)) bad('Please enter a valid phone number for the delivery.');
  if (address.length < 5 || address.length > 250) bad('Please enter the full delivery address.');
  if (landmark.length > 120) bad('The landmark is too long (maximum 120 characters).');
  if (note.length > 300) bad('The delivery note is too long (maximum 300 characters).');
  return { fulfilment: 'DELIVERY', delivery: { name, phone, address, landmark: landmark || undefined, note: note || undefined } };
}

// ── Bank details ──
// ctx.bank is the seller's saved bank details, loaded by the service layer (this file never touches the database).
const requireBank = (message) => (o, p, ctx) => {
  if (!ctx || !isBankComplete(ctx.bank)) throw new OrderError(409, 'BANK_DETAILS_REQUIRED', message);
};
const bankCopy = (ctx, now) => Object.assign({}, cleanBankDetails(ctx.bank).value, { sharedAt: now });

/*
 Each action: who (roles), from which statuses (from), to which status (to) or `same` (no status change).
 validate(order, payload, ctx) may throw. set(order, payload, now, actor, ctx) returns extra fields to save.
 cancel = [cancelReason, cancelledBy]; strike = seller gets a strike; inc = counters on the order.
*/
const ACTIONS = {
  // ── Buyer ──
  // Before any payment the buyer may walk away. (Seeing a total and refusing it is BUYER_DECLINE_TOTAL.)
  BUYER_CANCEL: { roles: ['BUYER'], from: ['PENDING', 'ACCEPTED', 'TOTAL_ACCEPTED'], to: 'CANCELLED', cancel: ['BUYER_CANCELLED', 'BUYER'], note: 'Buyer cancelled' },
  BUYER_ACCEPT_TOTAL: { roles: ['BUYER'], from: ['TOTAL_SENT'], to: 'TOTAL_ACCEPTED', note: 'Buyer accepted the total',
    validate: requireBank("The seller's payment details are not available right now. Please contact the seller."),
    set: (o, p, now, actor, ctx) => ({ paymentDetails: bankCopy(ctx, now) }) },
  BUYER_DECLINE_TOTAL: { roles: ['BUYER'], from: ['TOTAL_SENT'], to: 'CANCELLED', cancel: ['TOTAL_DECLINED', 'BUYER'], note: 'Buyer did not accept the total' },
  // Pickup orders pay from ACCEPTED. Delivery orders pay only after the buyer accepted the total.
  // The receipt is optional. It arrives through the dedicated upload route (never from the request body of /actions).
  BUYER_PAID: { roles: ['BUYER'], from: ['ACCEPTED', 'TOTAL_ACCEPTED'], to: 'PAYMENT_SUBMITTED', note: 'Buyer marked payment as made',
    validate: (o) => {
      if (o.status === 'ACCEPTED' && fulfilmentOf(o) === 'DELIVERY') throw new OrderError(409, 'BAD_STATE', 'Wait for the seller to send the total before paying.');
    },
    set: (o, p, now) => {
      const s = { 'payment.status': 'SUBMITTED', 'payment.method': text(p.method, 2, 'Payment method'), 'payment.amount': o.total, 'payment.submittedAt': now };
      if (p.reference != null && String(p.reference).trim()) s['payment.reference'] = String(p.reference).trim().slice(0, 100);
      if (p.proofImageUrl != null) {
        if (!/^https:\/\//.test(String(p.proofImageUrl)) || !p.proofPublicId) bad('The receipt could not be saved. Please try again.');
        s['payment.proofImageUrl'] = String(p.proofImageUrl);
        s['payment.proofPublicId'] = String(p.proofPublicId);
        s['payment.proofFormat'] = String(p.proofFormat || 'jpg');
      }
      return s;
    } },
  BUYER_REPORT_PAYMENT_ISSUE: { roles: ['BUYER'], from: ['PAYMENT_SUBMITTED'], to: 'PAYMENT_ISSUE',
    set: (o, p, now) => issueSet('BUYER', text(p.reason, 5, 'Issue description'), now) },
  BUYER_UPLOAD_PROOF: { roles: ['BUYER'], from: ['PAYMENT_ISSUE'], same: true, note: 'Payment proof uploaded',
    set: (o, p) => {
      if (!/^https:\/\//.test(String(p.proofImageUrl || ''))) bad('A valid https proof image link is required.');
      const s = { 'payment.proofImageUrl': String(p.proofImageUrl) };
      if (p.proofPublicId) { s['payment.proofPublicId'] = String(p.proofPublicId); s['payment.proofFormat'] = String(p.proofFormat || 'jpg'); }
      if (p.amount != null) { const a = Number(p.amount); if (!(a > 0)) bad('Amount must be a positive number.'); s['payment.amount'] = a; }
      if (p.reference) s['payment.reference'] = String(p.reference).trim().slice(0, 100);
      return s;
    } },
  BUYER_CONFIRM_RECEIPT: { roles: ['BUYER'], from: ['DELIVERED'], to: 'COMPLETED', note: 'Buyer confirmed receipt' },
  BUYER_DISPUTE: { roles: ['BUYER'], from: ['DELIVERED'], to: 'DISPUTED',
    set: (o, p, now) => {
      const s = { 'dispute.reason': text(p.reason, 5, 'Dispute reason'), 'dispute.openedAt': now };
      if (p.evidence != null) {                       // optional photos: the item received, or the payment receipt
        if (!Array.isArray(p.evidence) || p.evidence.length > 3) bad('You can attach up to 3 photos.');
        s['dispute.evidence'] = p.evidence.map((e) => {
          if (!/^https:\/\//.test(String((e && e.url) || ''))) bad('One of the photos is not valid.');
          return { url: String(e.url), publicId: e.publicId ? String(e.publicId) : undefined, format: String(e.format || 'jpg') };
        });
      }
      return s;
    } },
  BUYER_CONFIRM_REFUND: { roles: ['BUYER'], from: ['REFUND_PENDING'], to: 'REFUNDED', note: 'Buyer confirmed refund received' },

  // ── Seller ──
  // Accepting needs the shop's bank details. For pickup they are shown to the buyer right away, so a copy is saved now.
  // For delivery the copy is saved later, when the buyer accepts the total.
  SELLER_ACCEPT: { roles: ['SELLER'], from: ['PENDING'], to: 'ACCEPTED', note: 'Seller accepted the order',
    validate: requireBank(BANK_REQUIRED_MESSAGE),
    set: (o, p, now, actor, ctx) => (fulfilmentOf(o) === 'PICKUP' ? { paymentDetails: bankCopy(ctx, now) } : {}) },
  SELLER_DECLINE: { roles: ['SELLER'], from: ['PENDING'], to: 'CANCELLED', cancel: ['SELLER_DECLINED', 'SELLER'], note: 'Seller declined the order' },
  SELLER_SEND_TOTAL: { roles: ['SELLER'], from: ['ACCEPTED'], to: 'TOTAL_SENT', note: 'Seller sent the total with the delivery fee',
    validate: (o, p) => {
      needsDelivery('This is a pickup order, so there is no delivery fee to send.')(o);
      parseFee(p.deliveryFee);
    },
    set: (o, p) => { const fee = parseFee(p.deliveryFee); const base = productTotalOf(o); return { productTotal: base, deliveryFee: fee, total: base + fee }; } },
  SELLER_CONFIRM_PAYMENT: { roles: ['SELLER'], from: ['PAYMENT_SUBMITTED', 'PAYMENT_ISSUE'], to: 'PAYMENT_CONFIRMED', note: 'Seller confirmed payment',
    set: (o, p, now, actor) => confirmSet('SELLER', actor, now) },
  SELLER_REPORT_PAYMENT_ISSUE: { roles: ['SELLER'], from: ['PAYMENT_SUBMITTED'], to: 'PAYMENT_ISSUE',
    set: (o, p, now) => issueSet('SELLER', text(p.reason, 5, 'Issue description'), now) },
  SELLER_DELIVER: { roles: ['SELLER'], from: ['PAYMENT_CONFIRMED', 'REPLACEMENT_PENDING'], to: 'DELIVERED', note: 'Seller marked as delivered' },
  // After payment is confirmed an order never goes straight to CANCELLED: it goes through REFUND_PENDING.
  SELLER_REQUEST_CANCEL: { roles: ['SELLER'], from: ['PAYMENT_CONFIRMED'], to: 'REFUND_PENDING',
    set: (o, p, now) => { text(p.reason, 5, 'A reason'); return { 'refund.faultParty': 'SELLER', 'refund.decidedAt': now }; } },

  // ── System timers (each one is the answer to "who was expected to act, and did not?") ──
  TIMER_PENDING_EXPIRE: { roles: ['SYSTEM'], from: ['PENDING'], to: 'CANCELLED', cancel: ['SELLER_TIMEOUT', 'SYSTEM'], note: 'Seller did not accept in time' },
  // Seller accepted a delivery order but never sent the total: the seller was expected to act.
  TIMER_TOTAL_NOT_SENT: { roles: ['SYSTEM'], from: ['ACCEPTED'], to: 'CANCELLED', cancel: ['SELLER_NO_TOTAL', 'SYSTEM'], note: 'Seller did not send the total in time',
    validate: needsDelivery('Only delivery orders wait for a total.') },
  // Buyer was shown the total and neither accepted nor cancelled: the buyer was expected to act.
  TIMER_TOTAL_EXPIRE: { roles: ['SYSTEM'], from: ['TOTAL_SENT'], to: 'CANCELLED', cancel: ['TOTAL_EXPIRED', 'SYSTEM'], note: 'Buyer did not respond to the total in time' },
  // Buyer was expected to pay: a pickup order in ACCEPTED, or a delivery order after the total was accepted.
  TIMER_PAYMENT_EXPIRE: { roles: ['SYSTEM'], from: ['ACCEPTED', 'TOTAL_ACCEPTED'], to: 'CANCELLED', cancel: ['PAYMENT_DEADLINE_EXPIRED', 'SYSTEM'], note: 'Buyer did not pay in time',
    validate: (o) => {
      if (o.status === 'ACCEPTED' && fulfilmentOf(o) === 'DELIVERY') throw new OrderError(409, 'BAD_STATE', 'This delivery order is waiting for the seller, not the buyer.');
    } },
  TIMER_SELLER_SILENT: { roles: ['SYSTEM'], from: ['PAYMENT_SUBMITTED'], to: 'PAYMENT_ISSUE', note: 'Seller did not respond to the payment in time',
    set: (o, p, now) => issueSet('SYSTEM', 'Seller did not respond in time', now) },
  // Late delivery only sends the order to admin review. Nobody is struck automatically, because for a pickup order
  // the buyer may simply not have come to collect it: the admin sees the order type and decides who was at fault.
  TIMER_DELIVERY_LATE: { roles: ['SYSTEM'], from: ['PAYMENT_CONFIRMED', 'REPLACEMENT_PENDING'], to: 'DELIVERY_REVIEW', note: 'Delivery deadline passed' },
  TIMER_AUTO_COMPLETE: { roles: ['SYSTEM'], from: ['DELIVERED'], to: 'COMPLETED', note: 'Auto-completed: buyer did not respond' },
  TIMER_REFUND_OVERDUE: { roles: ['SYSTEM'], from: ['REFUND_PENDING'], same: true, clearDeadline: true, strike: true,
    note: 'Refund overdue: strike applied', validate: notStruck, set: () => ({ 'refund.strikeApplied': true }),
    guard: { 'refund.strikeApplied': { $ne: true } } },

  // ── Admin (exceptions only) ──
  PAYMENT_VALID: { roles: ['ADMIN'], from: ['PAYMENT_ISSUE'], to: 'PAYMENT_CONFIRMED', strike: true, validate: adminReason,
    set: (o, p, now, actor) => ({ ...confirmSet('ADMIN', actor, now), 'payment.resolution': p.reason.trim() }) },
  PAYMENT_INVALID: { roles: ['ADMIN'], from: ['PAYMENT_ISSUE'], to: 'CANCELLED', cancel: ['PAYMENT_INVALID', 'ADMIN'], validate: adminReason,
    set: (o, p) => ({ 'payment.status': 'FAILED', 'payment.resolution': p.reason.trim() }) },
  EXTEND: { roles: ['ADMIN'], from: ['DELIVERY_REVIEW'], to: 'PAYMENT_CONFIRMED', validate: adminReason },
  REFUND: { roles: ['ADMIN'], from: ['DELIVERY_REVIEW', 'DISPUTED'], to: 'REFUND_PENDING', validate: withFault, set: faultSet },
  REJECT: { roles: ['ADMIN'], from: ['DISPUTED'], to: 'COMPLETED', validate: adminReason },
  REPLACE: { roles: ['ADMIN'], from: ['DISPUTED'], to: 'REPLACEMENT_PENDING', inc: { replacementCount: 1 },
    validate: (o, p) => {
      adminReason(o, p);
      if ((o.replacementCount || 0) >= 1) throw new OrderError(409, 'BAD_STATE', 'This order already had one replacement. Choose refund or reject.');
    } },
  STRIKE_SELLER: { roles: ['ADMIN'], from: ['REFUND_PENDING'], same: true, clearDeadline: true, strike: true,
    validate: (o, p) => { adminReason(o, p); notStruck(o); }, set: () => ({ 'refund.strikeApplied': true }),
    guard: { 'refund.strikeApplied': { $ne: true } } },
  ADMIN_CANCEL: { roles: ['ADMIN'], from: ['PENDING', 'ACCEPTED', 'TOTAL_SENT', 'TOTAL_ACCEPTED', 'PAYMENT_SUBMITTED', 'PAYMENT_ISSUE'], to: 'CANCELLED', cancel: ['ADMIN_DECISION', 'ADMIN'], validate: adminReason },
  ADMIN_REFUND: { roles: ['ADMIN'], from: ['PAYMENT_CONFIRMED', 'DELIVERED', 'REPLACEMENT_PENDING'], to: 'REFUND_PENDING', validate: withFault, set: faultSet }
};

// Admin screen decision names are the same as the action names above
const ADMIN_DECISIONS = Object.keys(ACTIONS).filter((k) => ACTIONS[k].roles.includes('ADMIN'));

// Which timer action runs on which status when deadlineAt has passed.
// The optional third value narrows which orders it applies to (a database filter): the timer never has to guess who is at fault.
const TIMER_RULES = [
  ['PENDING', 'TIMER_PENDING_EXPIRE'],
  ['ACCEPTED', 'TIMER_PAYMENT_EXPIRE', { fulfilment: { $ne: 'DELIVERY' } }],   // pickup: waiting for the buyer to pay
  ['ACCEPTED', 'TIMER_TOTAL_NOT_SENT', { fulfilment: 'DELIVERY' }],            // delivery: waiting for the seller's total
  ['TOTAL_SENT', 'TIMER_TOTAL_EXPIRE'],
  ['TOTAL_ACCEPTED', 'TIMER_PAYMENT_EXPIRE'],
  ['PAYMENT_SUBMITTED', 'TIMER_SELLER_SILENT'],
  ['PAYMENT_CONFIRMED', 'TIMER_DELIVERY_LATE'],
  ['REPLACEMENT_PENDING', 'TIMER_DELIVERY_LATE'],
  ['DELIVERED', 'TIMER_AUTO_COMPLETE'],
  ['REFUND_PENDING', 'TIMER_REFUND_OVERDUE']
];

function ownsOrder(order, actor) {
  if (actor.role === 'BUYER') return String(order.buyer) === String(actor.id);
  if (actor.role === 'SELLER') return String(order.seller) === String(actor.shopId);
  return true; // ADMIN and SYSTEM act on any order
}

// Buyer limit: up to MAX_OPEN_ORDERS open orders at once, at most one per shop.
// A slot frees up when an order reaches COMPLETED, CANCELLED or REFUNDED.
function checkBuyerLimit(openOrders, shopId) {
  if (openOrders.some((o) => String(o.shopId) === String(shopId))) {
    throw new OrderError(409, 'OPEN_ORDER_IN_SHOP', 'You already have an open order with this shop. Finish it before ordering from this shop again.');
  }
  if (openOrders.length >= cfg.MAX_OPEN_ORDERS) {
    throw new OrderError(409, 'ORDER_LIMIT', `You can have up to ${cfg.MAX_OPEN_ORDERS} open orders at a time. Complete one before placing another.`);
  }
}

// Checks role, ownership, current status and input, then returns exactly what to save.
// ctx carries facts the service layer looked up for us (today: ctx.bank, the seller's bank details).
function buildTransition(order, action, actor, payload, now, ctx) {
  now = now || new Date();
  const p = payload || {};
  const def = ACTIONS[action];
  if (!def) throw new OrderError(400, 'UNKNOWN_ACTION', 'Unknown action.');
  if (!actor || !def.roles.includes(actor.role)) throw new OrderError(403, 'FORBIDDEN', 'You cannot do this action.');
  if (!ownsOrder(order, actor)) throw new OrderError(403, 'FORBIDDEN', 'This order does not belong to you.');
  if (!def.from.includes(order.status)) {
    throw new OrderError(409, 'BAD_STATE', `This action is not allowed while the order is ${order.status}.`);
  }
  if (def.validate) def.validate(order, p, ctx);

  const set = def.set ? def.set(order, p, now, actor, ctx) : {};
  const to = def.same ? order.status : def.to;
  if (!def.same) {
    set.status = to;
    set.statusChangedAt = now;
    set.deadlineAt = deadlineFor(to, now, fulfilmentOf(order));
  } else if (def.clearDeadline) {
    set.deadlineAt = null;
  }
  const reason = typeof p.reason === 'string' && p.reason.trim() ? p.reason.trim().slice(0, 500) : (def.note || null);
  if (def.cancel) {
    set.cancelReason = def.cancel[0];
    set.cancelledBy = def.cancel[1];
    if (actor.role === 'ADMIN') set.cancelNote = reason;
  }

  const counters = {};
  if (def.strike) counters.strikes = 1;
  if (!def.same && to === 'COMPLETED') counters.completedOrders = 1;
  if (to === 'DISPUTED') counters.disputeCount = 1;

  return {
    from: order.status, to, set,
    inc: def.inc || null,
    counters,
    guard: def.guard || null,
    history: { from: order.status, to, by: actor.id || null, byRole: actor.role, reason, at: now }
  };
}

module.exports = {
  TERMINAL, FAULT, ACTIONS, ADMIN_DECISIONS, TIMER_RULES, OrderError,
  buildTransition, deadlineFor, ownsOrder, checkBuyerLimit, cleanFulfilment, fulfilmentOf, productTotalOf
};
