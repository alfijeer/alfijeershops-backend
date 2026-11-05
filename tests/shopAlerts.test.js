'use strict';
const test = require('node:test');
const assert = require('node:assert');
const r = require('../services/shopAlertRules');

test('only a real price drop counts', () => {
  assert.strictEqual(r.isPriceDrop(10000, 9000), true);   // -10%
  assert.strictEqual(r.isPriceDrop(10000, 9500), true);   // exactly -5%
  assert.strictEqual(r.isPriceDrop(10000, 9600), false);  // -4%: too small to bother anyone
  assert.strictEqual(r.isPriceDrop(10000, 10000), false);
  assert.strictEqual(r.isPriceDrop(10000, 12000), false); // a rise is never an alert
  assert.strictEqual(r.isPriceDrop(0, 0), false);
  assert.strictEqual(r.isPriceDrop('abc', 5), false);
  assert.strictEqual(r.isPriceDrop(5000, 0), true);       // free is a drop
});

test('messages are short, readable and link to the shop', () => {
  const m = r.newProductMessage('Amina Fabrics', { name: 'Ankara 6 yards', price: 15000 }, 'abc123');
  assert.match(m.title, /Amina Fabrics/);
  assert.match(m.body, /Ankara 6 yards/);
  assert.match(m.body, /15,000/);
  assert.strictEqual(m.url, '/buyer-dashboard.html?shop=abc123');
  const d = r.priceDropMessage('Amina Fabrics', { _id: 'p1', name: 'Ankara', price: 12000 }, 15000, 'abc123');
  assert.match(d.body, /15,000.*12,000/);
  assert.strictEqual(d.tag, 'drop-p1');
});

test('very long names are shortened', () => {
  const m = r.newProductMessage('x'.repeat(200), { name: 'y'.repeat(200), price: 1 }, 's');
  assert.ok(m.title.length < 70);
  assert.ok(m.body.length < 80);
});

test('cooldown cutoff is one hour back', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  assert.strictEqual(r.cooldownCutoff(now).toISOString(), '2026-11-10T11:00:00.000Z');
});
