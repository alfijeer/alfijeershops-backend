const User = require('../models/User');
const Buyer = require('../models/Buyer');
const Order = require('../models/Order');

// GET /api/buyers?limit=N — admin only, read by admin.html's Buyers tab
async function listBuyers(req, res) {
  const limit = Math.min(Number(req.query.limit) || 50, 500);

  const buyers = await Buyer.find()
    .populate('user', 'fullName phone email createdAt isSuspended suspendedReason isDeleted')
    .sort({ createdAt: -1 })
    .limit(limit);

  // Flatten to what admin.html reads: b.name/b.fullName, b.phone, b.city, b.createdAt
  const shaped = buyers
    .filter((b) => !b.user?.isDeleted) // deleted accounts drop off the active list entirely
    .map((b) => ({
      _id: b._id,
      userId: b.user?._id,
      fullName: b.user?.fullName,
      name: b.user?.fullName,
      phone: b.user?.phone,
      email: b.user?.email,
      state: b.state,
      city: b.city,
      createdAt: b.user?.createdAt || b.createdAt,
      isSuspended: !!b.user?.isSuspended,
      suspendedReason: b.user?.suspendedReason || null,
    }));

  res.json({ buyers: shaped });
}

// GET /api/buyers/me — the logged-in buyer's own profile, read by
// buyer-dashboard.html's Profile tab (and its sidebar/greeting).
async function getMyProfile(req, res) {
  const buyer = await Buyer.findOne({ user: req.user._id }).populate('user', 'fullName phone email createdAt');
  if (!buyer) return res.status(404).json({ message: 'No buyer profile found for this account.' });

  res.json({
    buyer: {
      _id: buyer._id,
      city: buyer.city,
      state: buyer.state,
      createdAt: buyer.user?.createdAt || buyer.createdAt,
      user: {
        fullName: buyer.user?.fullName,
        email: buyer.user?.email,
        phone: buyer.user?.phone,
      },
    },
  });
}

// PUT /api/buyers/profile — the logged-in buyer updates their own city/state
async function updateMyProfile(req, res) {
  const buyer = await Buyer.findOne({ user: req.user._id });
  if (!buyer) return res.status(404).json({ message: 'No buyer profile found for this account.' });

  if (req.body.city !== undefined) buyer.city = req.body.city;
  if (req.body.state !== undefined) buyer.state = req.body.state;
  await buyer.save();

  res.json({ message: 'Profile updated.', buyer });
}

// PUT /api/buyers/:id/suspend — admin only. :id is the Buyer document's id
// (matching what listBuyers returns), not the User id.
async function suspendBuyer(req, res) {
  const { reason } = req.body;
  const buyer = await Buyer.findById(req.params.id);
  if (!buyer) return res.status(404).json({ message: 'Buyer not found.' });

  await User.findByIdAndUpdate(buyer.user, { isSuspended: true, suspendedReason: reason || null });
  res.json({ message: 'Buyer suspended.' });
}

// PUT /api/buyers/:id/reactivate — admin only
async function reactivateBuyer(req, res) {
  const buyer = await Buyer.findById(req.params.id);
  if (!buyer) return res.status(404).json({ message: 'Buyer not found.' });

  await User.findByIdAndUpdate(buyer.user, { isSuspended: false, suspendedReason: null });
  res.json({ message: 'Buyer reactivated.' });
}

// GET /api/buyers/:id/orders — admin only, view a buyer's order history
// (useful when investigating a dispute or complaint).
async function getBuyerOrders(req, res) {
  const buyer = await Buyer.findById(req.params.id);
  if (!buyer) return res.status(404).json({ message: 'Buyer not found.' });

  const orders = await Order.find({ buyer: buyer.user }).populate('seller', 'businessName').sort({ createdAt: -1 });
  const shaped = orders.map((o) => ({
    _id: o._id,
    orderId: o.orderId,
    sellerName: o.seller?.businessName,
    items: o.items,
    total: o.total,
    status: o.status,
    createdAt: o.createdAt,
  }));

  res.json({ orders: shaped });
}

// DELETE /api/buyers/:id — admin only.
// If the buyer has no order history, their account is fully removed.
// If they DO have orders, we anonymize instead of hard-deleting — deleting
// the User document outright would leave those orders pointing at nothing,
// breaking anyone (seller, admin) who looks back at that order later.
// Anonymizing also permanently locks them out, same as a real delete would.
async function deleteBuyer(req, res) {
  const buyer = await Buyer.findById(req.params.id);
  if (!buyer) return res.status(404).json({ message: 'Buyer not found.' });

  const hasOrders = await Order.exists({ buyer: buyer.user });

  if (!hasOrders) {
    await User.findByIdAndDelete(buyer.user);
    await buyer.deleteOne();
    return res.json({ message: 'Buyer account permanently deleted.' });
  }

  const anonEmail = `deleted-${buyer.user}@alfijeer.invalid`;
  await User.findByIdAndUpdate(buyer.user, {
    fullName: 'Deleted User',
    email: anonEmail,
    phone: '',
    isDeleted: true,
    isSuspended: true,
  });
  res.json({ message: 'This buyer has order history, so their account was anonymized and permanently locked instead of removed — their past orders remain intact for your records.' });
}

// ── Saved shops (the ♥) — now kept on the server so we can alert buyers about them ──
const mongoose = require('mongoose');
const Seller = require('../models/Seller');

// GET /api/buyers/saved
async function getSaved(req, res) {
  const buyer = await Buyer.findOne({ user: req.user._id }).select('savedShops notifyShopUpdates').lean();
  res.json({ ids: ((buyer && buyer.savedShops) || []).map(String), notify: buyer ? buyer.notifyShopUpdates !== false : true });
}

// PUT /api/buyers/saved  body: { ids: [shopId, ...] } — replaces the list. The phone sends the merged list.
async function setSaved(req, res) {
  const raw = Array.isArray(req.body && req.body.ids) ? req.body.ids : null;
  if (!raw) return res.status(400).json({ message: 'ids must be a list.' });
  const wanted = [...new Set(raw.map(String).filter((id) => mongoose.isValidObjectId(id)))].slice(0, 200);

  // keep only shops that really exist and are not deleted
  const real = await Seller.find({ _id: { $in: wanted }, isDeleted: { $ne: true } }).select('_id').lean();
  const ids = wanted.filter((id) => real.some((r) => String(r._id) === id));

  const buyer = await Buyer.findOneAndUpdate({ user: req.user._id }, { $setOnInsert: { user: req.user._id } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  const before = new Set((buyer.savedShops || []).map(String));
  const after = new Set(ids);
  const added = ids.filter((id) => !before.has(id));
  const removed = [...before].filter((id) => !after.has(id));

  buyer.savedShops = ids;
  await buyer.save();

  // keep the shop's "saved by N buyers" number honest
  if (added.length) await Seller.updateMany({ _id: { $in: added } }, { $inc: { savedCount: 1 } });
  if (removed.length) await Seller.updateMany({ _id: { $in: removed }, savedCount: { $gt: 0 } }, { $inc: { savedCount: -1 } });

  res.json({ ids, notify: buyer.notifyShopUpdates !== false });
}

// PUT /api/buyers/saved/prefs  body: { notify: true|false } — the on/off switch for alerts
async function setSavedPrefs(req, res) {
  const notify = !!(req.body && req.body.notify);
  await Buyer.findOneAndUpdate({ user: req.user._id }, { $set: { notifyShopUpdates: notify }, $setOnInsert: { user: req.user._id } }, { upsert: true });
  res.json({ notify });
}

module.exports = {
  getSaved,
  setSaved,
  setSavedPrefs,
  listBuyers,
  getMyProfile,
  updateMyProfile,
  suspendBuyer,
  reactivateBuyer,
  getBuyerOrders,
  deleteBuyer,
};
