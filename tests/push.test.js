'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const subs = [{ user: 'U-buyer', endpoint: 'https://push/ok', keys: { p256dh: 'a', auth: 'b' } }, { user: 'U-buyer', endpoint: 'https://push/dead', keys: { p256dh: 'a', auth: 'b' } }, { user: 'U-shop', endpoint: 'https://push/shop', keys: { p256dh: 'a', auth: 'b' } }];
const sent = [], deleted = [];
const orig = Module._load;
Module._load = function (r) {
  if (r.endsWith('models/PushSubscription')) return { find: (f) => ({ lean: async () => subs.filter((s) => s.user === f.user) }), deleteOne: async (f) => { deleted.push(f.endpoint); } };
  if (r.endsWith('models/User')) return { find: () => ({ select: () => ({ lean: async () => [{ _id: 'U-admin' }] }) }) };
  if (r.endsWith('models/Seller')) return { findById: () => ({ select: () => ({ lean: async () => ({ user: 'U-shop' }) }) }) };
  if (r === 'web-push') return { setVapidDetails() {}, sendNotification: async (s, body) => { if (s.endpoint.endsWith('dead')) { const e = new Error('gone'); e.statusCode = 410; throw e; } sent.push([s.endpoint, JSON.parse(body).title]); } };
  return orig.apply(this, arguments);
};
const push = require('../services/push');

test('the person who acted is not notified of their own action', () => {
  assert.deepStrictEqual(push.messagesFor('PENDING', 'SELLER'), []);
  assert.deepStrictEqual(push.messagesFor('ACCEPTED', 'BUYER'), []);
  assert.strictEqual(push.messagesFor('PENDING', 'SYSTEM')[0].party, 'SELLER');
  assert.deepStrictEqual(push.messagesFor('ACCEPTED', 'SELLER').map((m) => m.party), ['BUYER']);
  assert.deepStrictEqual(push.messagesFor('CANCELLED', 'SYSTEM').map((m) => m.party).sort(), ['BUYER', 'SELLER']);
  assert.ok(push.messagesFor('DISPUTED', 'BUYER').some((m) => m.party === 'ADMIN'));
  assert.deepStrictEqual(push.messagesFor('NOT_A_STATUS', 'SELLER'), []);
});

test('does nothing (and does not throw) when the keys are not set', async () => {
  delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY;
  await push.notifyOrderChange({ _id: 'o1', buyer: 'U-buyer', seller: 'S1' }, 'ACCEPTED', 'SELLER');
  assert.strictEqual(sent.length, 0);
});

test('sends to the right person and removes dead subscriptions', async () => {
  process.env.VAPID_PUBLIC_KEY = 'x'; process.env.VAPID_PRIVATE_KEY = 'y';
  await push.notifyOrderChange({ _id: 'o1', buyer: 'U-buyer', seller: 'S1' }, 'ACCEPTED', 'SELLER');
  assert.deepStrictEqual(sent, [['https://push/ok', '✅ Order accepted']]);
  assert.deepStrictEqual(deleted, ['https://push/dead']);
  sent.length = 0;
  await push.notifyOrderChange({ _id: 'o2', buyer: 'U-buyer', seller: 'S1' }, 'PENDING', 'BUYER');   // new order -> the shop
  assert.deepStrictEqual(sent, [['https://push/shop', '🛒 New order']]);
});
