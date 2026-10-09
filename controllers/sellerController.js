const Seller = require('../models/Seller');
const Product = require('../models/Product');
const User = require('../models/User');
const Order = require('../models/Order');
const { getNextSequence } = require('../models/Counter');

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
    rejectionReason: s.rejectionReason,
    totalViews: s.totalViews,
    whatsappClicks: s.whatsappClicks,
    callClicks: s.callClicks,
    savedCount: s.savedCount,
    createdAt: s.createdAt,
    // Order trust record: admin screens only (never sent to the public)
    ...(includeTrust ? { strikes: s.strikes || 0, completedOrders: s.completedOrders || 0, disputeCount: s.disputeCount || 0 } : {}),
  };
}

// GET /api/sellers?limit=N
// Public buyers only ever see approved shops. An authenticated admin
// (req.user set by optional auth — see routes/sellerRoutes.js) sees every
// status, since admin.html's tabs (Pending/Approved/Suspended/Rejected)
// all read from this same endpoint.
async function listSellers(req, res) {
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const filter = req.user?.role === 'admin' ? {} : { status: 'approved' };

  const sellers = await Seller.find(filter)
    .populate('user', 'phone')
    .sort({ createdAt: -1 })
    .limit(limit);

  const isAdmin = req.user?.role === 'admin';
  res.json({ sellers: sellers.map((x) => shapeSeller(x, isAdmin)) }); // explicit arrow: map() must not pass its index as includeTrust
}

// GET /api/sellers/me — the logged-in seller's own profile + products
async function getMyShop(req, res) {
  const seller = await Seller.findOne({ user: req.user._id }).populate('user', 'fullName phone email');
  if (!seller) return res.status(404).json({ message: 'No shop found for this account.' });

  const products = await Product.find({ seller: seller._id }).sort({ createdAt: -1 });

  const s = seller.toObject();
  res.json({
    seller: {
      ...s,
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

  await seller.save();
  res.json({ seller });
}

// PUT /api/sellers/:id/approve — admin only
async function approveSeller(req, res) {
  const seller = await Seller.findById(req.params.id);
  if (!seller) return res.status(404).json({ message: 'Shop not found.' });

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

  seller.status = 'rejected';
  seller.rejectionReason = reason.trim();
  await seller.save();

  res.json({ message: 'Application rejected.', seller });
}

// PUT /api/sellers/:id/suspend — admin only
async function suspendSeller(req, res) {
  const seller = await Seller.findById(req.params.id);
  if (!seller) return res.status(404).json({ message: 'Shop not found.' });

  seller.status = 'suspended';
  await seller.save();
  res.json({ message: 'Shop suspended.', seller });
}

// PUT /api/sellers/:id/reactivate — admin only
async function reactivateSeller(req, res) {
  const seller = await Seller.findById(req.params.id);
  if (!seller) return res.status(404).json({ message: 'Shop not found.' });

  seller.status = 'approved';
  await seller.save();
  res.json({ message: 'Shop reactivated.', seller });
}

// PUT /api/sellers/:id — admin only, direct edit of a seller's shop details
// (e.g. correcting a listing on the seller's behalf, at their request).
async function adminUpdateSeller(req, res) {
  const seller = await Seller.findById(req.params.id);
  if (!seller) return res.status(404).json({ message: 'Shop not found.' });

  const editable = ['businessName', 'category', 'state', 'city', 'address', 'description', 'whatsappNumber'];
  editable.forEach((field) => {
    if (req.body[field] !== undefined) seller[field] = req.body[field];
  });
  if (req.body.latitude !== undefined) seller.latitude = Number(req.body.latitude);
  if (req.body.longitude !== undefined) seller.longitude = Number(req.body.longitude);

  await seller.save();
  res.json({ message: 'Shop updated.', seller: shapeSeller(seller) });
}

// DELETE /api/sellers/:id — admin only.
// Same reasoning as deleteBuyer in buyerController.js: if this shop has no
// order history, remove it (and its products, and its login) completely.
// If it DOES have orders, hard-deleting would leave every one of those
// orders pointing at a shop that no longer exists — anonymize instead, so
// order history stays intact and the account is still permanently locked.
async function deleteSeller(req, res) {
  const seller = await Seller.findById(req.params.id);
  if (!seller) return res.status(404).json({ message: 'Shop not found.' });

  const hasOrders = await Order.exists({ seller: seller._id });

  if (!hasOrders) {
    await Product.deleteMany({ seller: seller._id });
    await User.findByIdAndDelete(seller.user);
    await seller.deleteOne();
    return res.json({ message: 'Shop and account permanently deleted.' });
  }

  await Product.deleteMany({ seller: seller._id }); // no live listings for a deleted shop, but order line-items are self-contained snapshots — safe to remove
  const anonEmail = `deleted-${seller.user}@alfijeer.invalid`;
  await User.findByIdAndUpdate(seller.user, {
    fullName: 'Deleted User',
    email: anonEmail,
    phone: '',
    isDeleted: true,
    isSuspended: true,
  });
  seller.businessName = 'Deleted Shop';
  seller.shopPhotoUrl = null;
  seller.status = 'suspended';
  await seller.save();

  res.json({ message: 'This shop has order history, so it was anonymized and permanently locked instead of removed — past orders remain intact for your records.' });
}

module.exports = {
  listSellers,
  getMyShop,
  updateMyShop,
  adminUpdateSeller,
  approveSeller,
  rejectSeller,
  suspendSeller,
  reactivateSeller,
  deleteSeller,
};
