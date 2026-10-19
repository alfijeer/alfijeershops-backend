'use strict';
// A suspended seller is locked out at login AND on every request, even with a token issued before the suspension.
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

let users = {}, shops = {};
const orig = Module._load;
Module._load = function (r) {
  if (r === 'jsonwebtoken') return { verify: (t) => ({ id: t }), sign: () => 'x' };
  if (r.endsWith('models/User')) return { findById: async (id) => users[id] || null };
  if (r.endsWith('models/Seller')) return { findOne: (f) => ({ select: () => ({ lean: async () => shops[String(f.user)] || null }) }) };
  return orig.apply(this, arguments);
};
const { protect, accessBlock } = require('../middleware/auth');
const run = async (id) => {
  let out = { next: false };
  await protect({ headers: { authorization: 'Bearer ' + id } }, { status: (c) => ({ json: (b) => { out = { code: c, body: b }; } }) }, () => { out.next = true; });
  return out;
};

test('a normal seller gets through', async () => {
  users = { u1: { _id: 'u1', role: 'seller' } }; shops = { u1: { status: 'approved' } };
  assert.strictEqual((await run('u1')).next, true);
});
test('suspending the SHOP locks the seller out of every request', async () => {
  users = { u1: { _id: 'u1', role: 'seller' } }; shops = { u1: { status: 'suspended' } };
  const r = await run('u1');
  assert.strictEqual(r.code, 403); assert.strictEqual(r.body.code, 'ACCOUNT_SUSPENDED'); assert.ok(!r.next);
});
test('a suspended or deleted person is locked out, with the reason shown', async () => {
  users = { b1: { _id: 'b1', role: 'buyer', isSuspended: true, suspendedReason: 'fraud' }, d1: { _id: 'd1', role: 'buyer', isDeleted: true } };
  const r = await run('b1'); assert.strictEqual(r.code, 403); assert.match(r.body.message, /fraud/);
  assert.strictEqual((await run('d1')).body.code, 'ACCOUNT_DELETED');
});
test('a pending or rejected shop can still sign in to see its status; an admin is never blocked by a flag', async () => {
  users = { u2: { _id: 'u2', role: 'seller' }, a: { _id: 'a', role: 'admin', isSuspended: true } };
  shops = { u2: { status: 'pending' } };
  assert.strictEqual((await run('u2')).next, true);
  assert.strictEqual((await run('a')).next, true);
});
test('a deleted token owner is rejected', async () => {
  users = {}; assert.strictEqual((await run('ghost')).code, 401);
});
