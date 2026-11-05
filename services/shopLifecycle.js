'use strict';
// The rules for deleting a shop, written as small pure functions (no database) so they are easy to read and test.
//
//   delete  ->  30 days in the "Deleted" tab (can be restored)  ->  removed for good
//
const RETENTION_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

// The moment a deleted shop becomes eligible for permanent removal.
function purgeDate(deletedAt) {
  return new Date(new Date(deletedAt).getTime() + RETENTION_DAYS * DAY);
}

// Shops deleted at or before this moment are past their holding period.
function purgeCutoff(now) {
  return new Date((now ? new Date(now) : new Date()).getTime() - RETENTION_DAYS * DAY);
}

// Whole days left to undo (0 = expires today). null when there is nothing to undo.
function daysLeft(seller, now) {
  if (!seller || !seller.isDeleted || !seller.deletedAt || seller.purgedAt) return null;
  const ms = purgeDate(seller.deletedAt).getTime() - (now ? new Date(now) : new Date()).getTime();
  return Math.max(0, Math.ceil(ms / DAY));
}

function canRestore(seller, now) {
  if (!seller || !seller.isDeleted || seller.purgedAt || !seller.deletedAt) return false;
  return new Date(now || Date.now()).getTime() < purgeDate(seller.deletedAt).getTime();
}

module.exports = { RETENTION_DAYS, purgeDate, purgeCutoff, daysLeft, canRestore };
