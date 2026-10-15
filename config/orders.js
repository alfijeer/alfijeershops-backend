'use strict';
// One place for every business rule number. Change here, not in the logic.
module.exports = {
  ORDER_PREFIX: 'ALF',
  TIMEZONE: 'Africa/Lagos',

  MAX_OPEN_ORDERS: 3, // a buyer may have this many open orders at once, at most one per shop

  // Time allowed in each status before the timer acts (or before an admin case is flagged "stuck")
  DEADLINE_HOURS: {
    PENDING: 48, ACCEPTED: 48, PAYMENT_SUBMITTED: 24, PAYMENT_ISSUE: 24,
    PAYMENT_CONFIRMED: 168, REPLACEMENT_PENDING: 168, DELIVERED: 72, REFUND_PENDING: 72
  },

  // Admin may open payment proof only in these statuses
  PROOF_VISIBLE_STATUSES: ['PAYMENT_ISSUE', 'DISPUTED', 'DELIVERY_REVIEW', 'REFUND_PENDING', 'REPLACEMENT_PENDING'],
  PROOF_LINK_SECONDS: 300, // how long a proof link works

  MIN_SAMPLE: 10, // below this many orders, rates show as "not enough data"
  FLAGS: { HIGH_DISPUTE_RATE: 0.15, HIGH_CANCEL_RATE: 0.30, MULTIPLE_STRIKES: 2, SLOW_ACCEPT_HOURS: 24, SLOW_DELIVERY_HOURS: 120 },

  // Matches your real models
  ROLE_MAP: { buyer: 'BUYER', seller: 'SELLER', admin: 'ADMIN' },
  SELLER_MODEL: 'Seller',
  USER_MODEL: 'User',
  APPROVED_STATUS: 'approved',
  PRODUCT: { model: 'Product', shopField: 'seller', nameField: 'name', priceField: 'price' }
};
