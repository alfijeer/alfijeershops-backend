'use strict';
// The homepage's "fresh arrivals": newest products from approved shops only, capped, with the shop name attached.
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const shops = [
  { _id: 'A', businessName: 'Musa Phones', shopNumber: 1, city: 'Kano', status: 'approved' },
  { _id: 'P', businessName: 'Pending Shop', shopNumber: 9, city: 'Kano', status: 'pending' },
];
const products = [
  { _id: 'p1', seller: 'A', name: 'Old', price: 1, images: [], createdAt: new Date('2026-01-01') },
  { _id: 'p2', seller: 'A', name: 'Newest', price: 2, images: ['x.jpg'], createdAt: new Date('2026-03-01') },
  { _id: 'p3', seller: 'P', name: 'FromPendingShop', price: 3, images: [], createdAt: new Date('2026-04-01') },
  { _id: 'p4', seller: 'A', name: 'Middle', price: 4, images: [], createdAt: new Date('2026-02-01') },
];
const chain = (rows) => { const q = { select: () => q, lean: async () => rows, sort: (s) => { rows = [...rows].sort((a, b) => b.createdAt - a.createdAt); return q; }, limit: (n) => { rows = rows.slice(0, n); return q; } }; return q; };
const orig = Module._load;
Module._load = function (r) {
  if (r.endsWith('models/Seller')) return { find: (f) => chain(shops.filter((s) => !f || !f.status || s.status === f.status)) };
  if (r.endsWith('models/Product')) return { find: (f) => chain(products.filter((p) => f.seller.$in.includes(String(p.seller)))) };
  return orig.apply(this, arguments);
};
const { listLatestProducts } = require('../controllers/productController');
const run = async (limit) => { let out; const headers = {}; await listLatestProducts({ query: { limit } }, { set: (k, v) => { headers[k] = v; }, json: (o) => { out = o; } }); return { out, headers }; };

test('newest first, approved shops only, shop name attached', async () => {
  const { out, headers } = await run();
  assert.deepStrictEqual(out.products.map((p) => p.name), ['Newest', 'Middle', 'Old']);   // the pending shop's product is never shown
  assert.strictEqual(out.products[0].shopName, 'Musa Phones');
  assert.strictEqual(out.products[0].image, 'x.jpg');
  assert.ok(headers['Cache-Control']);
});

test('limit keeps only the newest ones (oldest drop off)', async () => {
  const { out } = await run('2');
  assert.deepStrictEqual(out.products.map((p) => p.name), ['Newest', 'Middle']);
});
