'use strict';
// The rules for "alert buyers who saved this shop", as pure functions (no database, no network).
// Keeping the rules apart from the sending makes them easy to read, change and test.
const MIN_DROP_PERCENT = 5;          // a price must fall by at least this much to count as a "drop"
const COOLDOWN_MINUTES = 60;         // a shop can alert its savers at most once an hour
const MAX_RECIPIENTS = 500;          // safety cap per alert

function isPriceDrop(oldPrice, newPrice) {
  const o = Number(oldPrice), n = Number(newPrice);
  if (!(o > 0) || !(n >= 0) || n >= o) return false;
  return ((o - n) / o) * 100 >= MIN_DROP_PERCENT;
}

const naira = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');
const clip = (t, max) => (String(t || '').length > max ? String(t).slice(0, max - 1) + '…' : String(t || ''));
const link = (shopId) => '/buyer-dashboard.html?shop=' + encodeURIComponent(String(shopId));

function newProductMessage(shopName, product, shopId) {
  return {
    title: `🛍️ New at ${clip(shopName || 'a shop you saved', 40)}`,
    body: `${clip(product.name, 60)} · ${naira(product.price)}`,
    url: link(shopId),
    tag: 'shop-' + String(shopId),
  };
}

function priceDropMessage(shopName, product, oldPrice, shopId) {
  return {
    title: `💸 Price drop at ${clip(shopName || 'a shop you saved', 36)}`,
    body: `${clip(product.name, 50)}: ${naira(oldPrice)} → ${naira(product.price)}`,
    url: link(shopId),
    tag: 'drop-' + String(product._id || shopId),
  };
}

// The moment before which a shop is allowed to alert again.
function cooldownCutoff(now) {
  return new Date((now ? new Date(now) : new Date()).getTime() - COOLDOWN_MINUTES * 60 * 1000);
}

module.exports = { MIN_DROP_PERCENT, COOLDOWN_MINUTES, MAX_RECIPIENTS, isPriceDrop, newProductMessage, priceDropMessage, cooldownCutoff };
