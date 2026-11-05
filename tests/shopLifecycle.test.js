'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { RETENTION_DAYS, purgeDate, purgeCutoff, daysLeft, canRestore } = require('../services/shopLifecycle');

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-10T12:00:00Z');
const deleted = (daysAgo, extra) => Object.assign({ isDeleted: true, deletedAt: new Date(now.getTime() - daysAgo * DAY), purgedAt: null }, extra);

test('a shop can be restored for 30 days, not after', () => {
  assert.strictEqual(RETENTION_DAYS, 30);
  assert.strictEqual(canRestore(deleted(0), now), true);
  assert.strictEqual(canRestore(deleted(29), now), true);
  assert.strictEqual(canRestore(deleted(30), now), false);
  assert.strictEqual(canRestore(deleted(45), now), false);
});

test('a shop that is not deleted, or already purged, can never be restored', () => {
  assert.strictEqual(canRestore({ isDeleted: false }, now), false);
  assert.strictEqual(canRestore(deleted(1, { purgedAt: now }), now), false);
  assert.strictEqual(canRestore(null, now), false);
});

test('daysLeft counts down and stops at 0', () => {
  assert.strictEqual(daysLeft(deleted(0), now), 30);
  assert.strictEqual(daysLeft(deleted(10), now), 20);
  assert.strictEqual(daysLeft(deleted(40), now), 0);
  assert.strictEqual(daysLeft({ isDeleted: false }, now), null);
  assert.strictEqual(daysLeft(deleted(5, { purgedAt: now }), now), null);
});

test('purgeCutoff is exactly 30 days before now', () => {
  assert.strictEqual(purgeCutoff(now).getTime(), now.getTime() - 30 * DAY);
  assert.strictEqual(purgeDate(new Date(now.getTime() - 30 * DAY)).getTime(), now.getTime());
});
