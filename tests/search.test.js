'use strict';
const test = require('node:test');
const assert = require('node:assert');
const c = require('../services/searchCore');

test('words are cleaned, de-duplicated and stop-words removed', () => {
  assert.deepStrictEqual(c.tokenize('  Samsung  GALAXY!! a07 '), ['samsung', 'galaxy', 'a07']);
  assert.deepStrictEqual(c.tokenize('buy the cheap phones near me'), ['phones']);
  assert.strictEqual(c.tokenize('a b c d e f g h i j').length <= 6, true);
});

test('typing the letter O for zero still finds the model, and plurals work', () => {
  assert.ok(c.variants('ao7').includes('a07'));
  assert.ok(c.variants('phones').includes('phone'));
  assert.ok(!c.variants('shoes').includes('sho'));
});

test('brands and product words imply the right category (real registration categories)', () => {
  assert.deepStrictEqual(c.inferCategories(['samsung']), ['Phones & Electronics']);
  assert.ok(c.inferCategories(['sneakers']).includes('Fashion & Clothing'));
  assert.ok(c.inferCategories(['furniture']).includes('Home & Furniture'));
  assert.deepStrictEqual(c.inferCategories(['zzzz']), []);
});

test('user text can never become a regex pattern', () => {
  assert.strictEqual(c.escapeRegex('a.*(b)'), 'a\\.\\*\\(b\\)');
  const f = c.strictProductFilter(['(a+)+$']);
  assert.ok(f.$and[0].$or[0].name.test('x(a+)+$y')); // matched literally
  assert.ok(!f.$and[0].$or[0].name.test('aaaa'));
});

test('a brand never matches a whole category, a product-type word can (in a multi-word search)', () => {
  const only = JSON.stringify(c.strictProductFilter(['samsung']));
  assert.ok(!only.includes('$in'));                                    // "samsung" must show Samsung, not every phone
  const combo = c.strictProductFilter(['samsung', 'phone']);
  assert.ok(!JSON.stringify(combo.$and[0]).includes('$in'));           // brand: text only
  assert.ok(JSON.stringify(combo.$and[1]).includes('$in'));            // "phone": category counts
  assert.ok(c.isBrand('samsung') && c.isBrand('Galaxy'.toLowerCase()) && !c.isBrand('phone'));
});

test('product ranking: name beats description; full phrase beats partial', () => {
  const t = ['samsung', 'galaxy'];
  const a = c.scoreProduct({ name: 'Samsung Galaxy A07', description: '' }, t, 'samsung galaxy');
  const b = c.scoreProduct({ name: 'Phone case', description: 'fits Samsung Galaxy' }, t, 'samsung galaxy');
  const d = c.scoreProduct({ name: 'Samsung TV', description: '' }, t, 'samsung galaxy');
  assert.ok(a > d && d > b);
});

test('shops match on name, category, city or state; every word must match', () => {
  const shop = { businessName: 'Musa Phones', category: 'Phones & Electronics', city: 'Kano', state: 'Kano' };
  assert.ok(c.shopMatches(shop, ['musa']));
  assert.ok(c.shopMatches(shop, ['phone', 'kano']));
  assert.ok(!c.shopMatches(shop, ['phone', 'abuja']));
});
