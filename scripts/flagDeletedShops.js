// One-time migration for shops deleted BEFORE the 30-day "undo" feature existed.
// Those shops were anonymized on the spot (businessName "Deleted Shop", owner User.isDeleted = true).
// This marks them as deleted AND already permanently removed, so they stay out of every public list,
// show in the admin "Deleted" tab as "Removed permanently", and can never be restored or reactivated.
// Run once:  node scripts/flagDeletedShops.js
require('dotenv').config();
const mongoose = require('mongoose');
const Seller = require('../models/Seller');
const User = require('../models/User');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const deletedUsers = await User.find({ isDeleted: true, role: 'seller' }).select('_id').lean();
  const ids = deletedUsers.map((u) => u._id);
  const now = new Date();
  const r = await Seller.updateMany(
    { $or: [{ user: { $in: ids } }, { businessName: 'Deleted Shop' }], purgedAt: null },
    { $set: { isDeleted: true, status: 'suspended', isVerified: false, deletedAt: now, purgedAt: now } }
  );
  console.log(`Flagged ${r.modifiedCount} previously deleted shop(s).`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
