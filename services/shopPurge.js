'use strict';
// Step 2 of "soft delete": after the holding period (or when an admin chooses "Delete forever") the shop is
// really removed. Same rule as before: no order history -> remove everything; has orders -> anonymize and keep
// the shell, so every past order still points at a real record.
const Seller = require('../models/Seller');
const Product = require('../models/Product');
const User = require('../models/User');
const Order = require('../models/Order');
const Buyer = require('../models/Buyer');
const { purgeCutoff } = require('./shopLifecycle');

// Returns 'removed' or 'anonymized'.
async function purgeShop(seller) {
  const hasOrders = await Order.exists({ seller: seller._id });
  await Product.deleteMany({ seller: seller._id });
  await Buyer.updateMany({ savedShops: seller._id }, { $pull: { savedShops: seller._id } }); // nobody keeps a heart on a shop that is gone

  if (!hasOrders) {
    await User.findByIdAndDelete(seller.user);
    await seller.deleteOne();
    return 'removed';
  }

  await User.findByIdAndUpdate(seller.user, {
    fullName: 'Deleted User',
    email: `deleted-${seller.user}@alfijeer.invalid`,
    phone: '',
    isDeleted: true,
    isSuspended: true,
  });
  seller.businessName = 'Deleted Shop';
  seller.shopPhotoUrl = null;
  seller.status = 'suspended';
  seller.isDeleted = true;
  seller.isVerified = false;
  seller.purgedAt = new Date();
  await seller.save();
  return 'anonymized';
}

// Finds every shop whose 30 days are over and purges it. Safe to run often and on several servers.
async function purgeExpiredShops(now) {
  const due = await Seller.find({ isDeleted: true, purgedAt: null, deletedAt: { $ne: null, $lte: purgeCutoff(now) } }).limit(50);
  let n = 0;
  for (const shop of due) {
    try { await purgeShop(shop); n++; } catch (e) { console.error('[purge]', shop._id, e.message); }
  }
  return n;
}

function startShopPurge(everyMs) {
  const run = () => purgeExpiredShops().then((n) => { if (n) console.log('[purge] permanently removed', n, 'deleted shop(s)'); }).catch((e) => console.error('[purge]', e.message));
  run();
  return setInterval(run, everyMs || 6 * 60 * 60 * 1000); // every 6 hours is plenty for a 30-day rule
}

module.exports = { purgeShop, purgeExpiredShops, startShopPurge };
