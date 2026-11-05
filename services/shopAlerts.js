'use strict';
// Sends the alert to every buyer who saved a shop. Never throws, never makes the seller wait.
const Seller = require('../models/Seller');
const Buyer = require('../models/Buyer');
const { sendToUser, isConfigured } = require('./push');
const rules = require('./shopAlertRules');

async function alertSavers(seller, message) {
  if (!isConfigured() || !seller || seller.status !== 'approved' || seller.isDeleted) return 0;

  // Claim the cooldown in ONE atomic step: only one server / request can win, so a seller who uploads
  // ten products in a row alerts their savers once, not ten times.
  const claimed = await Seller.updateOne(
    { _id: seller._id, $or: [{ lastAlertAt: null }, { lastAlertAt: { $lte: rules.cooldownCutoff() } }] },
    { $set: { lastAlertAt: new Date() } }
  );
  if (!claimed.modifiedCount) return 0;

  const savers = await Buyer.find({ savedShops: seller._id, notifyShopUpdates: { $ne: false } }).select('user').limit(rules.MAX_RECIPIENTS).lean();
  let sent = 0;
  for (let i = 0; i < savers.length; i += 20) {
    const batch = savers.slice(i, i + 20);
    const results = await Promise.all(batch.map((b) => sendToUser(b.user, message).catch(() => 0)));
    sent += results.reduce((a, b) => a + b, 0);
  }
  return sent;
}

// Called after a product is created. Fire and forget.
function onNewProduct(seller, product) {
  alertSavers(seller, rules.newProductMessage(seller.businessName, product, seller._id)).catch((e) => console.warn('[alerts]', e.message));
}

// Called after a product's price changed. Only a real drop alerts anyone.
function onPriceChange(seller, product, oldPrice) {
  if (!rules.isPriceDrop(oldPrice, product.price)) return;
  alertSavers(seller, rules.priceDropMessage(seller.businessName, product, oldPrice, seller._id)).catch((e) => console.warn('[alerts]', e.message));
}

module.exports = { alertSavers, onNewProduct, onPriceChange };
