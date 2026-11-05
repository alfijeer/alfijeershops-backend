'use strict';
// Delete = hide + lock out + keep for 30 days. Restore = put everything back exactly as it was.
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

let shop, userUpdates, logs, purged;
const orig = Module._load;
Module._load = function (r) {
  if (r.endsWith('models/Seller')) return { findById: () => ({ select: () => shop, then: (f) => f(shop) }) };
  if (r.endsWith('models/User')) return {
    findById: () => ({ select: async () => ({ isSuspended: false, suspendedReason: null }) }),
    findByIdAndUpdate: async (id, patch) => { userUpdates.push(patch); },
  };
  if (r.endsWith('models/AdminLog')) return { create: async (x) => { logs.push(x.action); } };
  if (r.endsWith('services/shopPurge')) return { purgeShop: async () => { purged = true; return 'removed'; } };
  if (r.endsWith('models/Product') || r.endsWith('models/Order')) return {};
  if (r.endsWith('models/Counter')) return { getNextSequence: async () => 1 };
  return orig.apply(this, arguments);
};
const c = require('../controllers/sellerController');

const makeShop = (extra) => Object.assign({
  _id: 'S1', user: 'U1', status: 'approved', isDeleted: false, isVerified: true, businessName: 'Amina Fabrics',
  save: async function () { return this; }, toObject() { return Object.assign({}, this); },
}, extra);
const res = () => { const r = { code: 200 }; r.status = (n) => { r.code = n; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };
const reset = (extra) => { shop = makeShop(extra); userUpdates = []; logs = []; purged = false; };
const req = { params: { id: 'S1' }, user: { _id: 'ADMIN' } };

test('delete hides the shop, locks the owner out and starts the 30-day clock', async () => {
  reset();
  const r = res(); await c.deleteSeller(req, r);
  assert.strictEqual(r.code, 200);
  assert.strictEqual(shop.isDeleted, true);
  assert.strictEqual(shop.status, 'suspended');
  assert.ok(shop.deletedAt instanceof Date);
  assert.strictEqual(shop.preDelete.status, 'approved');
  assert.strictEqual(userUpdates[0].isSuspended, true);
  assert.deepStrictEqual(logs, ['SHOP_DELETED']);
  assert.strictEqual(purged, false);   // nothing is destroyed yet
});

test('restore brings back the old status and unlocks the owner', async () => {
  reset();
  await c.deleteSeller(req, res());
  userUpdates = [];
  const r = res(); await c.restoreSeller(req, r);
  assert.strictEqual(r.code, 200);
  assert.strictEqual(shop.isDeleted, false);
  assert.strictEqual(shop.status, 'approved');
  assert.strictEqual(userUpdates[0].isSuspended, false);
  assert.deepStrictEqual(logs, ['SHOP_DELETED', 'SHOP_RESTORED']);
});

test('after 30 days restore is refused', async () => {
  reset({ isDeleted: true, deletedAt: new Date(Date.now() - 31 * 86400000), preDelete: { status: 'approved' } });
  const r = res(); await c.restoreSeller(req, r);
  assert.strictEqual(r.code, 400);
  assert.strictEqual(shop.isDeleted, true);
});

test('a deleted shop cannot be approved or reactivated back to life', async () => {
  reset({ isDeleted: true, deletedAt: new Date(), status: 'suspended' });
  let r = res(); await c.approveSeller(req, r); assert.strictEqual(r.code, 400);
  r = res(); await c.reactivateSeller(req, r); assert.strictEqual(r.code, 400);
  assert.strictEqual(shop.status, 'suspended');
});

test('"delete forever" only works on a shop that is already in the Deleted tab', async () => {
  reset();
  let r = res(); await c.deleteSellerForever(req, r);
  assert.strictEqual(r.code, 400); assert.strictEqual(purged, false);
  reset({ isDeleted: true, deletedAt: new Date() });
  r = res(); await c.deleteSellerForever(req, r);
  assert.strictEqual(r.code, 200); assert.strictEqual(purged, true);
});

test('a shop can only be verified when approved and it has an ID on file', async () => {
  reset({ isVerified: false, govIdUrl: null });
  let r = res(); await c.verifySeller(req, r); assert.strictEqual(r.code, 400);
  reset({ isVerified: false, govIdUrl: 'https://x/id.jpg', status: 'pending' });
  r = res(); await c.verifySeller(req, r); assert.strictEqual(r.code, 400);
  reset({ isVerified: false, govIdUrl: 'https://x/id.jpg' });
  r = res(); await c.verifySeller(req, r);
  assert.strictEqual(r.code, 200); assert.strictEqual(shop.isVerified, true);
  assert.deepStrictEqual(logs, ['SHOP_VERIFIED']);
});
