'use strict';
// GET /api/search?q=samsung galaxy a07&category=Phones & Electronics     (public)
const Seller = require('../models/Seller');
const Product = require('../models/Product');
const core = require('../services/searchCore');

// Approved shops change rarely: keep them in memory for 30 seconds instead of reading them on every keystroke.
let cache = { at: 0, shops: [] };
async function approvedShops() {
  if (Date.now() - cache.at < 30000) return cache.shops;
  const shops = await Seller.find({ status: 'approved' }).select('businessName category city state shopNumber').limit(5000).lean();
  cache = { at: Date.now(), shops };
  return shops;
}

const productView = (p, shopById) => {
  const s = shopById.get(String(p.seller)) || {};
  return { _id: p._id, name: p.name, price: p.price, category: p.category, image: (p.images && p.images[0]) || null,
    description: String(p.description || '').slice(0, 160),
    shopId: p.seller, shopName: s.businessName || '', shopNumber: s.shopNumber, city: s.city || '' };
};

async function search(req, res, next) {
  try {
    const q = String(req.query.q || '').slice(0, 80);
    const category = String(req.query.category || '').slice(0, 60);
    const inCat = !!category && category !== 'all';
    const shops = await approvedShops();

    // A shop number ("12", "#12", "shop 12") finds that shop; "shop 12 samsung" searches inside it.
    const sn = core.extractShopNumber(q);
    const numberShops = sn.number === null ? [] : shops.filter((s) => Number(s.shopNumber) === sn.number);
    const tokens = core.tokenize(numberShops.length ? sn.rest : q);
    const phrase = tokens.join(' ');
    const pool = numberShops.length ? numberShops : shops;      // where products and shops are looked for

    if (numberShops.length && !tokens.length) {
      return res.json({ query: q, mode: 'exact', inferredCategories: [], products: [], similarProducts: [], categoryShops: [],
        shops: numberShops.map((s) => ({ _id: s._id, reason: 'number', productCount: 0 })) });
    }
    if (!tokens.length && !inCat) {
      const counts0 = {};
      shops.forEach((s) => { counts0[s.category] = (counts0[s.category] || 0) + 1; });
      return res.json({ query: q, mode: 'none', inferredCategories: [], products: [], shops: [], similarProducts: [], categoryShops: [],
        categories: Object.entries(counts0).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count) });
    }
    const shopById = new Map(shops.map((s) => [String(s._id), s]));
    const ids = pool.map((s) => s._id);

    // 1) EXACT: every word matches
    const filter = { seller: { $in: ids } };
    if (inCat) filter.category = category;
    Object.assign(filter, core.strictProductFilter(tokens));
    const found = await Product.find(filter).sort({ createdAt: -1 }).limit(150).lean();
    const products = found.map((p) => ({ p, s: core.scoreProduct(p, tokens, phrase) }))
      .sort((a, b) => b.s - a.s).slice(0, 40).map((x) => productView(x.p, shopById));

    // exact shops: name / category / city match, plus the owners of matching products
    const byProduct = new Map();
    found.forEach((p) => byProduct.set(String(p.seller), (byProduct.get(String(p.seller)) || 0) + 1));
    const exact = new Map();
    pool.forEach((s) => {
      if (inCat && s.category !== category && !byProduct.has(String(s._id))) return;
      if (tokens.length && !core.shopMatches(s, tokens) && !byProduct.has(String(s._id))) return;
      exact.set(String(s._id), { _id: s._id, reason: byProduct.has(String(s._id)) ? 'product' : (tokens.length ? 'name' : 'category'), productCount: byProduct.get(String(s._id)) || 0 });
    });
    const exactShops = [...exact.values()].sort((a, b) => b.productCount - a.productCount);

    // 2) RELATED: shops in the categories the words imply ("samsung" -> phone & electronics shops)
    const inferred = tokens.length && !inCat && !numberShops.length ? core.inferCategories(tokens) : [];
    const categoryShops = inferred.length
      ? shops.filter((s) => inferred.includes(s.category) && !exact.has(String(s._id))).slice(0, 12).map((s) => ({ _id: s._id, category: s.category }))
      : [];

    // 3) SIMILAR products when nothing matched every word (Samsung Galaxy A07 missing -> other Samsung / Galaxy items)
    let similarProducts = [];
    if (!products.length && tokens.length) {
      const lf = { seller: { $in: ids } };
      if (inCat) lf.category = category;
      Object.assign(lf, core.looseProductFilter(tokens));
      const loose = await Product.find(lf).sort({ createdAt: -1 }).limit(80).lean();
      similarProducts = loose.map((p) => ({ p, s: core.scoreProduct(p, tokens, phrase) })).filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s).slice(0, 12).map((x) => productView(x.p, shopById));
    }

    const mode = (products.length || exactShops.length) ? 'exact' : (similarProducts.length || categoryShops.length) ? 'related' : 'none';
    const counts = {};
    shops.forEach((s) => { counts[s.category] = (counts[s.category] || 0) + 1; });
    res.json({
      query: q, mode, inferredCategories: inferred, products, shops: exactShops, similarProducts, categoryShops,
      categories: mode === 'none' ? Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count) : undefined
    });
  } catch (e) { next(e); }
}

module.exports = { search };
