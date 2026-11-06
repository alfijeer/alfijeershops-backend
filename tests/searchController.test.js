'use strict';
// Runs the real search controller against small in-memory shops and products (no database needed).
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const match = (doc, f) => Object.entries(f).every(([k, v]) => {
  if (k === '$and') return v.every((x) => match(doc, x));
  if (k === '$or') return v.some((x) => match(doc, x));
  const val = doc[k];
  if (v instanceof RegExp) return v.test(val || '');
  if (v && typeof v === 'object' && v.$in) return v.$in.map(String).includes(String(val));
  return String(val) === String(v);
});
const model = (rows) => ({ find: (f) => { let r = rows.filter((d) => match(d, f || {})); const q = { select: () => q, sort: () => q, limit: (n) => { r = r.slice(0, n); return q; }, lean: async () => r }; return q; } });

const shops = [
  { _id: 'A', shopNumber: 1, businessName: 'Musa Phones', category: 'Phones & Electronics', city: 'Kano', state: 'Kano', status: 'approved' },
  { _id: 'B', shopNumber: 2, businessName: 'Zainab Gadgets', category: 'Phones & Electronics', city: 'Kaduna', state: 'Kaduna', status: 'approved' },
  { _id: 'C', shopNumber: 12, businessName: 'Ali Fashion', category: 'Fashion & Clothing', city: 'Kano', state: 'Kano', status: 'approved' }
];
const products = [
  { _id: 'p1', seller: 'A', name: 'Samsung Galaxy A05', price: 80000, category: 'Phones & Electronics', description: '', images: [] },
  { _id: 'p2', seller: 'A', name: 'Tecno Spark 20', price: 120000, category: 'Phones & Electronics', description: '', images: [] },
  { _id: 'p3', seller: 'C', name: 'Nike sneakers', price: 15000, category: 'Fashion & Clothing', description: '', images: [] }
];
const orig = Module._load;
Module._load = function (r, p, i) {
  if (r.endsWith('models/Seller')) return model(shops);
  if (r.endsWith('models/Product')) return model(products);
  return orig.apply(this, arguments);
};
const { search } = require('../controllers/searchController');
const run = async (q, category) => { let out; await search({ query: { q, category } }, { json: (o) => { out = o; } }, (e) => { throw e; }); return out; };

test('"samsung": Samsung products first, plus the other phone shops, no fashion shops', async () => {
  const r = await run('samsung');
  assert.strictEqual(r.mode, 'exact');
  assert.deepStrictEqual(r.products.map((p) => p.name), ['Samsung Galaxy A05']);   // not the Tecno
  assert.ok(r.categoryShops.some((s) => s._id === 'B'));
  assert.ok(![...r.categoryShops, ...r.shops].some((s) => s._id === 'C'));
});

test('"Samsung Galaxy AO7" is not listed: similar item + phone shops to ask, never a dead end', async () => {
  const r = await run('Samsung Galaxy AO7');
  assert.strictEqual(r.mode, 'related');
  assert.strictEqual(r.products.length, 0);
  assert.deepStrictEqual(r.similarProducts.map((p) => p.name), ['Samsung Galaxy A05']);
  assert.deepStrictEqual(r.categoryShops.map((s) => s._id).sort(), ['A', 'B']);
});

test('the letter O typed for a zero still finds the model', async () => {
  products.push({ _id: 'p9', seller: 'B', name: 'Samsung Galaxy A07', price: 95000, category: 'Phones & Electronics', description: '', images: [] });
  const r = await run('Samsung Galaxy AO7');
  assert.strictEqual(r.mode, 'exact');
  assert.deepStrictEqual(r.products.map((p) => p.name), ['Samsung Galaxy A07']);
  products.pop();
});

test('multi-word: brand + product type ("nike shoes") uses the category for the type word', async () => {
  const r = await run('nike shoes');
  assert.strictEqual(r.mode, 'exact');
  assert.deepStrictEqual(r.products.map((p) => p.name), ['Nike sneakers']);
});

test('a shop is found by name, and a category browse lists shops and products in it', async () => {
  assert.ok((await run('musa')).shops.some((s) => s._id === 'A'));
  const cat = await run('', 'Fashion & Clothing');
  assert.deepStrictEqual(cat.shops.map((s) => s._id), ['C']);
  assert.strictEqual(cat.products.length, 1);
});

test('searching inside the wrong category says so honestly instead of showing unrelated items', async () => {
  const r = await run('samsung', 'Fashion & Clothing');
  assert.notStrictEqual(r.mode, 'exact');
  assert.strictEqual(r.products.length, 0);
});

test('gibberish and symbol-only searches get category shortcuts, never the whole catalogue', async () => {
  for (const q of ['zzzqqq', '(a+)+$', '!!!']) {
    const r = await run(q);
    assert.strictEqual(r.mode, 'none', q);
    assert.ok(r.categories.length > 0);
    assert.strictEqual(r.products.length + r.shops.length, 0);
  }
});

test('shop number: "12", "#12", "Shop 012" and "shop 12" all find that shop', async () => {
  for (const q of ['12', '#12', 'Shop 012', 'shop 12']) {
    const r = await run(q);
    assert.strictEqual(r.mode, 'exact', q);
    assert.deepStrictEqual(r.shops.map((s) => s._id), ['C'], q);
  }
});

test('shop number plus a word searches inside that shop only', async () => {
  const r = await run('shop 1 samsung');
  assert.deepStrictEqual(r.products.map((p) => p.name), ['Samsung Galaxy A05']);
  assert.deepStrictEqual(r.shops.map((s) => s._id), ['A']);
  const none = await run('shop 12 samsung');          // Ali Fashion has no Samsung
  assert.strictEqual(none.products.length, 0);
});

test('a number that is not a shop is still searched as a product word', async () => {
  const r = await run('99');
  assert.strictEqual(r.shops.length, 0);
});
