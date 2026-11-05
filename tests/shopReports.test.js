'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const orig = Module._load;
Module._load = function (r) {
  if (r === 'mongoose') return { isValidObjectId: (v) => /^[a-f0-9]{24}$/i.test(String(v)) };
  if (r.endsWith('models/ShopReport')) return { REASONS: ['fake_products', 'scam_or_fraud', 'wrong_info', 'abusive_behavior', 'other'] };
  if (r.endsWith('models/Seller') || r.endsWith('models/AdminLog')) return {};
  if (r.endsWith('services/push')) return { notifyAdmins() {} };
  return orig.apply(this, arguments);
};
const { validateReport } = require('../controllers/reportController');

test('a report needs a known reason', () => {
  assert.strictEqual(validateReport({}).ok, false);
  assert.strictEqual(validateReport({ reason: 'hacking' }).ok, false);
  assert.strictEqual(validateReport({ reason: 'scam_or_fraud' }).ok, true);
});

test('"other" must explain itself, and details stay short', () => {
  assert.strictEqual(validateReport({ reason: 'other', details: 'bad' }).ok, false);
  assert.strictEqual(validateReport({ reason: 'other', details: 'They sold me a fake phone' }).ok, true);
  assert.strictEqual(validateReport({ reason: 'wrong_info', details: 'x'.repeat(501) }).ok, false);
});

test('details are trimmed', () => {
  assert.strictEqual(validateReport({ reason: 'wrong_info', details: '  wrong phone number  ' }).details, 'wrong phone number');
});
