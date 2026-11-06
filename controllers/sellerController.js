const Seller = require('../models/Seller');
const Product = require('../models/Product');
const User = require('../models/User');
const Order = require('../models/Order');
const { getNextSequence } = require('../models/Counter');
const AdminLog = require('../models/AdminLog');
const { cleanBankDetails, hasBankFields, isBankComplete } = require('../utils/bankDetails');
const { daysLeft, canRestore, RETENTION_DAYS } = require('../services/shopLifecycle');
const { purgeShop } = require('../services/shopPurge');

// Shapes a Seller doc (with populated `user`) into what the frontend expects:
// phone comes from the linked User, whatsappNumber/latitude/longitude/etc.
// stay top-level, matching every s.<field> read across buyer-dashboard.html,
// shop-detail.html, admin.html, and directions.html.
function shapeSeller(sellerDoc, includeTrust) {
  const s = sellerDoc.toObject ? sellerDoc.toObject() : sellerDoc;
  return {
    _id: s._id,
    shopNumber: s.shopNumber,
    businessName: s.businessName,
    category: s.category,
    phone: s.user?.phone || null,
    whatsappNumber: s.whatsappNumber || s.user?.phone || null,
    state: s.state,
    city: s.city,
    address: s.address,
    description: s.description,
    latitude: s.latitude,
    longitude: s.longitude,
    shopPhotoUrl: s.shopPhotoUrl,
    status: s.status,
    isDeleted: !!s.isDeleted,
    isVerified: !!s.isVerified, // the public badge: an admin checked this shop's ID
    rejectionReason: s.rejectionReason,
    totalViews: s.totalViews,
    whatsappClicks: s.whatsappClicks,
    callClicks: s.callClicks,
    savedCount: s.savedCount,
    createdAt: s.createdAt,
    // Order trust record: admin screens only (never sent to the public)
    ...(includeTrust ? {
      strikes: s.strikes || 0, completedOrders: s.completedOrders || 0, disputeCount: s.disputeCount || 0,
      verifiedAt: s.verifiedAt || null,
      deletedAt: s.deletedAt || null, purgedAt: s.purgedAt || null,
      daysLeft: daysLeft(s), canRestore: canRestore(s),
    } : {}),
  };
}

// GET /api/sellers?limit=N
// Public buyers only ever see approved shops. An authenticated admin
// (req.user set by optional auth — see routes/sellerRoutes.js) sees every
// status, since admin.html's tabs (Pending/Approved/Suspended/Rejected)
// all read from this same endpoint.
async function listSellers(req, res) {
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const filter = req.user?.role === 'admin' ? {} : { status: 'approved', isDeleted: { $ne: true } };

  const sellers = await Seller.find(filter)
    .populate('user', 'phone')
    .sort({ createdAt: -1 })
    .limit(limit);

  const isAdmin = req.user?.role === 'admin';
  res.json({ sellers: sellers.map((x) => shapeSeller(x, isAdmin)) }); // explicit arrow: map() must not pass its index as includeTrust
}

// GET /api/sellers/public/:id — one approved shop, for shop links a seller shares (shop-detail.html?id=...).
// Works for any shop however old; the list endpoint only returns the newest ones.
async function getPublicShop(req, res) {
  const id = String(req.params.id || '');
  if (!/^[a-f0-9]{24}$/i.test(id)) return res.status(404).json({ message: 'Shop not found.' });
  const seller = await Seller.findById(id).populate('user', 'phone');
  if (!seller || seller.status !== 'approved' || seller.isDeleted) return res.status(404).json({ message: 'Shop not found.' });
  res.json({ seller: shapeSeller(seller) });
}

// GET /api/sellers/me — the logged-in seller's own profile + products
async function getMyShop(req, res) {
  // bankDetails is hidden by default; the seller may read their own
  const seller = await Seller.findOne({ user: req.user._id }).select('+bankDetails').populate('user', 'fullName phone email');
  if (!seller) return res.status(404).json({ message: 'No shop found for this account.' });

  const products = await Product.find({ seller: seller._id }).sort({ createdAt: -1 });

  const s = seller.toObject();
  res.json({
    seller: {
      ...s,
      paymentDetailsComplete: isBankComplete(s.bankDetails), // the dashboard uses this to remind the seller before an order arrives
      whatsappNumber: s.whatsappNumber,
      user: { fullName: s.user?.fullName, phone: s.user?.phone, email: s.user?.email },
    },
    products,
  });
}

// PUT /api/sellers/profile — the logged-in seller updates their own shop
async function updateMyShop(req, res) {
  const seller = await Seller.findOne({ user: req.user._id });
  if (!seller) return res.status(404).json({ message: 'No shop found for this account.' });

  const editable = ['businessName', 'category', 'state', 'city', 'address', 'description', 'whatsappNumber'];
  editable.forEach((field) => {
    if (req.body[field] !== undefined) seller[field] = req.body[field];
  });
  if (req.body.latitude !== undefined) seller.latitude = Number(req.body.latitude);
  if (req.body.longitude !== undefined) seller.longitude = Number(req.body.longitude);
  if (req.file) seller.shopPhotoUrl = req.file.path; // new banner/shop photo, uploaded straight to Cloudinary

  // Settings → Payment Details. All three fields travel together and must be valid, so a seller can edit
  // them but can never blank them out. Validated before anything else is saved.
  let bank = null;
  if (hasBankFields(req.body)) {
    bank = cleanBankDetails(req.body);
    if (!bank.ok) return res.status(400).json({ message: bank.message });
  }

  await seller.save();
  if (bank) await Seller.updateOne({ _id: seller._id }, { $set: { bankDetails: bank.value } }); // hidden field: written directly

  // Never echo the bank details back from here: GET /sellers/me is the one place the owner reads them.
  const fresh = await Seller.findById(seller._id).select('+bankDetails').lean();
  const out = seller.toObject();
  delete out.bankDetails;
  res.json({ seller: out, paymentDetailsComplete: isBankComplete(fresh && fresh.bankDetails) });
}

// PUT /api/sellers/:id/approve — admin only
async function approveSeller(req, res) {
  const seller = await Seller.findById(req.params.id);
  if (!seller) return res.status(404).json({ message: 'Shop not found.' });
  if (seller.isDeleted) return res.status(400).json({ message: 'This shop was deleted and cannot be approved again.' });

  if (!seller.shopNumber) {
    seller.shopNumber = await getNextSequence('shopNumber');
  }
  seller.status = 'approved';
  seller.rejectionReason = null;
  await seller.save();

  res.json({ message: 'Shop approved.', seller });
}

// PUT /api/sellers/:id/reject — admin only, body: { reason }
async function rejectSeller(req, res) {
  const { reason } = req.body;
  if (!reason || !reason.trim()) {
    return res.status(400).json({ message: 'A rejection reason is required.' });
  }
  const seller = await Seller.findById(req.params.id);
  if (!seller) return res.status(404).json({ message: 'Shop not found.' });
  if (seller.isDeleted) return res.status(400).json({ message: 'This shop is deleted. Restore it first if you need to change it.' });

  seller.status = 'rejected';
  seller.rejectionReason = reason.trim();
  await seller.save();

  res.json({ message: 'Application rejected.', seller });
}

// PUT /api/sellers/:id/suspend — admin only
async function suspendSeller(req, res) {
  const seller = await Seller.findById(req.params.id);
  if (!seller) return res.status(404).json({ message: 'Shop not found.' });
  if (seller.isDeleted) return res.status(400).json({ message: 'This shop is deleted. Restore it first if you need to change it.' });

  seller.status = 'suspended';
  await seller.save();
  res.json({ message: 'Shop suspended.', seller });
}

// PUT /api/sellers/:id/reactivate — admin only
async function reactivateSeller(req, res) {
  const seller = await Seller.findById(req.params.id);
  if (!seller) return res.status(404).json({ message: 'Shop not found.' });
  if (seller.isDeleted) return res.status(400).json({ message: 'This shop was deleted and cannot be reactivated.' });

  seller.status = 'approved';
  await seller.save();
  res.json({ message: 'Shop reactivated.', seller });
}

// PUT /api/sellers/:id — admin only, direct edit of a seller's shop details
// (e.g. correcting a listing on the seller's behalf, at their request).
async function adminUpdateSeller(req, res) {
  const seller = await Seller.findById(req.params.id);
  if (!seller) return res.status(404).json({ message: 'Shop not found.' });
  if (seller.isDeleted) return res.status(400).json({ message: 'This shop is deleted. Restore it first if you need to change it.' });

  const editable = ['businessName', 'category', 'state', 'city', 'address', 'description', 'whatsappNumber'];
  editable.forEach((field) => {
    if (req.body[field] !== undefined) seller[field] = req.body[field];
  });
  if (req.body.latitude !== undefined) seller.latitude = Number(req.body.latitude);
  if (req.body.longitude !== undefined) seller.longitude = Number(req.body.longitude);

  await seller.save();
  res.json({ message: 'Shop updated.', seller: shapeSeller(seller) });
}

// ── Admin log helper: who did what to which shop ──
const log = (req, action, shopId, note) => AdminLog.create({ adminId: req.user._id, action, shopId, note }).catch(() => {});

// DELETE /api/sellers/:id — admin only. SOFT delete.
// The shop disappears from the public site and its owner is locked out immediately, but nothing is destroyed:
// it waits in the admin "Deleted" tab for 30 days, where it can be restored. After that services/shopPurge.js
// removes it for good (or anonymizes it if it has order history).
async function deleteSeller(req, res) {
  const seller = await Seller.findById(req.params.id);
  if (!seller) return res.status(404).json({ message: 'Shop not found.' });
  if (seller.isDeleted) return res.status(400).json({ message: 'This shop is already deleted.' });

  const owner = await User.findById(seller.user).select('isSuspended suspendedReason');

  // Remember how things were, so Restore can put them back exactly.
  seller.preDelete = {
    status: seller.status,
    userSuspended: !!(owner && owner.isSuspended),
    userSuspendedReason: (owner && owner.suspendedReason) || null,
  };
  seller.isDeleted = true;
  seller.deletedAt = new Date();
  seller.deletedBy = req.user._id;
  seller.status = 'suspended';
  await seller.save();

  await User.findByIdAndUpdate(seller.user, {
    isSuspended: true,
    suspendedReason: 'This shop was removed by ALFIJEER. Contact support if you think this is a mistake.',
  });

  await log(req, 'SHOP_DELETED', seller._id, `Moved to Deleted — can be restored for ${RETENTION_DAYS} days`);
  res.json({ message: `Shop deleted. You can restore it from the Deleted tab for the next ${RETENTION_DAYS} days.`, seller: shapeSeller(seller, true) });
}

// PUT /api/sellers/:id/restore — admin only. The undo button.
async function restoreSeller(req, res) {
  const seller = await Seller.findById(req.params.id);
  if (!seller) return res.status(404).json({ message: 'Shop not found.' });
  if (!canRestore(seller)) {
    return res.status(400).json({ message: 'This shop can no longer be restored — its ' + RETENTION_DAYS + '-day holding period is over.' });
  }

  const before = seller.preDelete || {};
  seller.isDeleted = false;
  seller.deletedAt = null;
  seller.deletedBy = null;
  seller.status = before.status || 'suspended';
  seller.preDelete = undefined;
  await seller.save();

  await User.findByIdAndUpdate(seller.user, {
    isSuspended: !!before.userSuspended,
    suspendedReason: before.userSuspended ? before.userSuspendedReason || null : null,
  });

  await log(req, 'SHOP_RESTORED', seller._id, `Restored to status "${seller.status}"`);
  res.json({ message: 'Shop restored.', seller: shapeSeller(seller, true) });
}

// DELETE /api/sellers/:id/permanent — admin only. "Delete forever" for a shop that is already in the Deleted tab.
async function deleteSellerForever(req, res) {
  const seller = await Seller.findById(req.params.id);
  if (!seller) return res.status(404).json({ message: 'Shop not found.' });
  if (!seller.isDeleted) return res.status(400).json({ message: 'Delete the shop first, then you can remove it permanently.' });
  if (seller.purgedAt) return res.status(400).json({ message: 'This shop was already removed permanently.' });

  const shopId = seller._id;
  const result = await purgeShop(seller);
  await log(req, 'SHOP_PURGED', shopId, result === 'removed' ? 'Removed completely (no orders)' : 'Anonymized (order history kept)');
  res.json({
    message: result === 'removed'
      ? 'Shop permanently removed.'
      : 'This shop has order history, so it was anonymized and permanently locked — past orders remain intact.',
  });
}

// ── Verification badge ──
// GET /api/sellers/:id/id-document — admin only. The ONLY way to look at a seller's ID, and every look is logged.
async function getSellerIdDocument(req, res) {
  if (!/^[a-f0-9]{24}$/i.test(String(req.params.id))) return res.status(404).json({ message: 'Shop not found.' });
  const seller = await Seller.findById(req.params.id).select('+govIdUrl businessName');
  if (!seller) return res.status(404).json({ message: 'Shop not found.' });
  await log(req, 'VIEW_GOV_ID', seller._id, 'Opened seller ID for verification');
  res.json({ govIdUrl: seller.govIdUrl || null, businessName: seller.businessName });
}

// PUT /api/sellers/:id/verify — admin only. Only a live, approved shop can earn the badge.
async function verifySeller(req, res) {
  const seller = await Seller.findById(req.params.id).select('+govIdUrl');
  if (!seller) return res.status(404).json({ message: 'Shop not found.' });
  if (seller.isDeleted || seller.status !== 'approved') return res.status(400).json({ message: 'Only an approved shop can be verified.' });
  if (!seller.govIdUrl) return res.status(400).json({ message: 'This shop has no ID on file, so it cannot be verified.' });

  seller.isVerified = true;
  seller.verifiedAt = new Date();
  seller.verifiedBy = req.user._id;
  await seller.save();
  await log(req, 'SHOP_VERIFIED', seller._id, 'Verification badge given');
  res.json({ message: 'Verified badge added.', seller: shapeSeller(seller, true) });
}

// PUT /api/sellers/:id/unverify — admin only
async function unverifySeller(req, res) {
  const seller = await Seller.findById(req.params.id);
  if (!seller) return res.status(404).json({ message: 'Shop not found.' });
  seller.isVerified = false;
  seller.verifiedAt = null;
  seller.verifiedBy = null;
  await seller.save();
  await log(req, 'SHOP_UNVERIFIED', seller._id, 'Verification badge removed');
  res.json({ message: 'Verified badge removed.', seller: shapeSeller(seller, true) });
}

module.exports = {
  listSellers,
  getPublicShop,
  getMyShop,
  updateMyShop,
  adminUpdateSeller,
  approveSeller,
  rejectSeller,
  suspendSeller,
  reactivateSeller,
  deleteSeller,
  restoreSeller,
  deleteSellerForever,
  getSellerIdDocument,
  verifySeller,
  unverifySeller,
};
