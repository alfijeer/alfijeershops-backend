'use strict';
// Web-push notifications ("New order from Amina"). Never throws and never blocks an order:
// if the keys are not set, or the web-push package is missing, it quietly does nothing.
const PushSubscription = require('../models/PushSubscription');
const Seller = require('../models/Seller');
const User = require('../models/User');

// Who hears about each new status, and what they read. B = the buyer, S = the shop.
const MESSAGES = {
  PENDING:              { S: ['🛒 New order', 'A buyer just placed an order. Open it to respond.'] },
  ACCEPTED:             { B: ['✅ Order accepted', 'The shop accepted your order. Open it to see the next step.'] },
  TOTAL_SENT:           { B: ['🚚 Delivery total ready', 'The shop sent your total with delivery. Review and accept it.'] },
  TOTAL_ACCEPTED:       { S: ['👍 Total accepted', 'The buyer accepted the total. Payment is next.'] },
  PAYMENT_SUBMITTED:    { S: ['💰 Payment sent', 'The buyer says they have paid. Check your account and confirm.'] },
  PAYMENT_CONFIRMED:    { B: ['💰 Payment confirmed', 'The shop confirmed your payment.'] },
  PAYMENT_ISSUE:        { B: ['⚠️ Payment problem', 'There is a problem with the payment. Open the order.'], S: ['⚠️ Payment problem', 'There is a problem with the payment. Open the order.'] },
  DELIVERED:            { B: ['📦 Order delivered', 'The shop marked your order as delivered. Please confirm you got it.'] },
  COMPLETED:            { B: ['🎉 Order complete', 'Your order is complete. Thank you for shopping on ALFIJEER.'], S: ['🎉 Order complete', 'An order was completed.'] },
  CANCELLED:            { B: ['❌ Order cancelled', 'Your order was cancelled. Open it for details.'], S: ['❌ Order cancelled', 'An order was cancelled.'] },
  DISPUTED:             { B: ['⚖️ Dispute opened', 'A dispute was opened on your order.'], S: ['⚖️ Dispute opened', 'A dispute was opened on an order.'] },
  DELIVERY_REVIEW:      { B: ['🔎 Under review', 'Your order is being reviewed by ALFIJEER.'], S: ['🔎 Under review', 'An order is being reviewed by ALFIJEER.'] },
  REFUND_PENDING:       { B: ['↩️ Refund pending', 'Your refund is being processed.'], S: ['↩️ Refund pending', 'A refund is pending on an order.'] },
  REPLACEMENT_PENDING:  { B: ['🔁 Replacement pending', 'A replacement is being arranged.'], S: ['🔁 Replacement pending', 'A replacement is pending on an order.'] },
  REFUNDED:             { B: ['↩️ Refunded', 'Your order was refunded.'], S: ['↩️ Refunded', 'An order was refunded.'] }
};

// Situations the admin team must hear about straight away
const ADMIN_ALERTS = {
  DISPUTED: ['⚖️ New dispute', 'A buyer opened a dispute. Open Orders to review it.'],
  PAYMENT_ISSUE: ['⚠️ Payment problem', 'An order has a payment issue that may need you.'],
  DELIVERY_REVIEW: ['🔎 Delivery needs review', 'An order was sent to you for review.']
};

// Pure: who should be told, and what. The person who just acted is never notified about their own action.
function messagesFor(toStatus, actorRole) {
  const m = MESSAGES[toStatus] || {};
  const out = [];
  if (m.B && actorRole !== 'BUYER') out.push({ party: 'BUYER', title: m.B[0], body: m.B[1], url: '/buyer-dashboard.html' });
  if (m.S && actorRole !== 'SELLER') out.push({ party: 'SELLER', title: m.S[0], body: m.S[1], url: '/seller-dashboard.html' });
  if (ADMIN_ALERTS[toStatus]) out.push({ party: 'ADMIN', title: ADMIN_ALERTS[toStatus][0], body: ADMIN_ALERTS[toStatus][1], url: '/admin.orders.html' });
  return out;
}

let webpush = null, ready = false;
function setup() {
  if (ready) return true;
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  try {
    webpush = require('web-push');
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:Alfijeershops@gmail.com', pub, priv);
    ready = true;
  } catch (e) { console.warn('[push] web-push unavailable:', e.message); }
  return ready;
}
const isConfigured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

async function sendToUser(userId, payload) {
  if (!setup() || !userId) return 0;
  const subs = await PushSubscription.find({ user: userId }).lean();
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload), { TTL: 60 * 60 * 24 });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await PushSubscription.deleteOne({ endpoint: s.endpoint }).catch(() => {});
      else console.warn('[push] send failed:', e.statusCode || e.message);
    }
  }));
  return sent;
}

// Called after every order change. Fire and forget.
async function notifyOrderChange(order, toStatus, actorRole) {
  try {
    if (!isConfigured() || !order) return;
    for (const m of messagesFor(toStatus, actorRole)) {
      const payload = { title: m.title, body: m.body, url: m.url, tag: 'order-' + String(order._id) };
      if (m.party === 'ADMIN') {
        const admins = await User.find({ role: 'admin' }).select('_id').lean();
        for (const a of admins) await sendToUser(a._id, payload);
        continue;
      }
      let userId = null;
      if (m.party === 'BUYER') userId = order.buyer;
      else { const shop = await Seller.findById(order.seller).select('user').lean(); userId = shop && shop.user; }
      await sendToUser(userId, payload);
    }
  } catch (e) { console.warn('[push] notify failed:', e.message); }
}

module.exports = { messagesFor, notifyOrderChange, sendToUser, isConfigured, MESSAGES };
