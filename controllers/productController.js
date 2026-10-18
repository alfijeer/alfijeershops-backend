const Product = require('../models/Product');
const Seller = require('../models/Seller');

// GET /api/products?sellerId=ID — public, used by buyer-dashboard.html's
// shop modal and shop-detail.html's product grid.
async function listProductsBySeller(req, res) {
  const { sellerId } = req.query;
  if (!sellerId) return res.status(400).json({ message: 'sellerId query param is required.' });

  const products = await Product.find({ seller: sellerId }).sort({ createdAt: -1 });
  res.json({ products });
}

// GET /api/products/latest?limit=8 — public. The newest products from approved shops, for the homepage.
// Newest first; as shops add products the oldest simply fall off the end of the list.
async function listLatestProducts(req, res) {
  const limit = Math.min(Math.max(Number(req.query.limit) || 8, 1), 24);
  const shops = await Seller.find({ status: 'approved' }).select('businessName shopNumber city').lean();
  const byId = new Map(shops.map((s) => [String(s._id), s]));
  const rows = await Product.find({ seller: { $in: [...byId.keys()] } }).sort({ createdAt: -1 }).limit(limit).lean();
  res.set('Cache-Control', 'public, max-age=30');
  res.json({
    products: rows.map((p) => {
      const s = byId.get(String(p.seller)) || {};
      return { _id: p._id, name: p.name, price: p.price, category: p.category, image: (p.images && p.images[0]) || null,
        createdAt: p.createdAt, shopId: p.seller, shopName: s.businessName || '', shopNumber: s.shopNumber, city: s.city || '' };
    }),
  });
}

// GET /api/products/mine — the logged-in seller's own products
async function listMyProducts(req, res) {
  const seller = await Seller.findOne({ user: req.user._id });
  if (!seller) return res.status(404).json({ message: 'No shop found for this account.' });

  const products = await Product.find({ seller: seller._id }).sort({ createdAt: -1 });
  res.json({ products });
}

// POST /api/products — multipart/form-data: name, price, category,
// description, images[] (see seller-dashboard.html's saveProduct)
async function createProduct(req, res) {
  const seller = await Seller.findOne({ user: req.user._id });
  if (!seller) return res.status(404).json({ message: 'No shop found for this account.' });
  if (seller.status !== 'approved') {
    return res.status(403).json({ message: 'Your shop must be approved before you can list products.' });
  }

  const { name, price, category, description } = req.body;
  if (!name || !price || !category) {
    return res.status(400).json({ message: 'Name, price, and category are required.' });
  }

  const images = (req.files || []).map((f) => f.path);

  const product = await Product.create({
    seller: seller._id,
    name,
    price: Number(price),
    category,
    description,
    images,
  });

  res.status(201).json({ product });
}

// PUT /api/products/:id — seller can only edit their own product
async function updateProduct(req, res) {
  const seller = await Seller.findOne({ user: req.user._id });
  if (!seller) return res.status(404).json({ message: 'No shop found for this account.' });

  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ message: 'Product not found.' });
  if (String(product.seller) !== String(seller._id)) {
    return res.status(403).json({ message: 'You can only edit your own products.' });
  }

  const { name, price, category, description } = req.body;
  if (name !== undefined) product.name = name;
  if (price !== undefined) product.price = Number(price);
  if (category !== undefined) product.category = category;
  if (description !== undefined) product.description = description;

  if (req.files && req.files.length > 0) {
    product.images = req.files.map((f) => f.path);
  }

  await product.save();
  res.json({ product });
}

// DELETE /api/products/:id — seller can only delete their own product
async function deleteProduct(req, res) {
  const seller = await Seller.findOne({ user: req.user._id });
  if (!seller) return res.status(404).json({ message: 'No shop found for this account.' });

  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ message: 'Product not found.' });
  if (String(product.seller) !== String(seller._id)) {
    return res.status(403).json({ message: 'You can only delete your own products.' });
  }

  await product.deleteOne();
  res.json({ message: 'Product deleted.' });
}

module.exports = {
  listProductsBySeller,
  listLatestProducts,
  listMyProducts,
  createProduct,
  updateProduct,
  deleteProduct,
};
