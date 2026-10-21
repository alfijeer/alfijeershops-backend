'use strict';
// One place for every business rule number. Change here, not in the logic.
module.exports = {
  ORDER_PREFIX: 'ALF',
  TIMEZONE: 'Africa/Lagos',

  MAX_OPEN_ORDERS: 3, // a buyer may have this many open orders at once, at most one per shop

  // Time allowed in each status before the timer acts (or before an admin case is flagged "stuck").
  // Every clock is tied to WHO is expected to act next, so nobody is penalised for waiting on someone else:
  //   PENDING            seller must accept or decline
  //   ACCEPTED (pickup)  buyer must pay                      -> see DEADLINE_HOURS_DELIVERY for the delivery case
  //   TOTAL_SENT         buyer must accept or cancel the total
  //   TOTAL_ACCEPTED     buyer must pay
  //   PAYMENT_SUBMITTED  seller must confirm the money
  //   PAYMENT_CONFIRMED  seller must deliver (admin reviews if late, nobody is struck automatically)
  //   DELIVERED          buyer must confirm or report a problem
  DEADLINE_HOURS: {
    PENDING: 48, ACCEPTED: 48, TOTAL_SENT: 24, TOTAL_ACCEPTED: 48, PAYMENT_SUBMITTED: 24, PAYMENT_ISSUE: 24,
    PAYMENT_CONFIRMED: 168, REPLACEMENT_PENDING: 168, DELIVERED: 72, REFUND_PENDING: 72
  },
  // A delivery order sitting in ACCEPTED is waiting for the SELLER to send the total, not for the buyer to pay.
  DEADLINE_HOURS_DELIVERY: { ACCEPTED: 24 },

  // Delivery orders
  FULFILMENT: ['PICKUP', 'DELIVERY'],
  MAX_DELIVERY_FEE: 100000, // naira; the seller may enter 0 (free delivery) up to this amount
  DELIVERY_FEE_NOTICE: "Delivery fee is based on the delivery location and the current rider's charge.",

  // Admin may open payment proof only in these statuses. The buyer and the shop of the order can always open their own receipt.
  PROOF_VISIBLE_STATUSES: ['PAYMENT_ISSUE', 'DISPUTED', 'DELIVERY_REVIEW', 'REFUND_PENDING', 'REPLACEMENT_PENDING'],
  PROOF_LINK_SECONDS: 300, // how long a proof link works

  MIN_SAMPLE: 10, // below this many orders, rates show as "not enough data"
  FLAGS: { HIGH_DISPUTE_RATE: 0.15, HIGH_CANCEL_RATE: 0.30, MULTIPLE_STRIKES: 2, SLOW_ACCEPT_HOURS: 24, SLOW_DELIVERY_HOURS: 120 },

  // Admin order analysis: how a shop is labelled by its recent activity
  ACTIVITY: { VERY_ACTIVE_WEEK: 10, QUIET_MONTH_MAX: 2, STOPPED_DAYS: 14 },

  // Matches your real models
  ROLE_MAP: { buyer: 'BUYER', seller: 'SELLER', admin: 'ADMIN' },
  SELLER_MODEL: 'Seller',
  USER_MODEL: 'User',
  APPROVED_STATUS: 'approved',
  PRODUCT: { model: 'Product', shopField: 'seller', nameField: 'name', priceField: 'price' }
};
