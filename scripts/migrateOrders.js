'use strict';
// ONE-TIME: converts old orders (new / confirmed / completed / cancelled) to the new workflow.
//   npm run migrate:orders            -> shows what it WOULD do
//   npm run migrate:orders -- --apply -> does it
// Old orders had no payment step, so:  new -> PENDING (fresh 48h clock),  confirmed -> PAYMENT_CONFIRMED (fresh 7-day clock),
// completed -> COMPLETED,  cancelled -> CANCELLED (reason ADMIN_DECISION).  Every converted order gets a history note.
require('dotenv').config();
const mongoose = require('mongoose');
const Order = require('../models/Order');
const { nextOrderNumber } = require('../utils/orderNumber');
const cfg = require('../config/orders');

const MAP = { new: 'PENDING', confirmed: 'PAYMENT_CONFIRMED', completed: 'COMPLETED', cancelled: 'CANCELLED' };
const hours = (h) => new Date(Date.now() + h * 3600000);

(async () => {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGO_URI);
  const col = Order.collection;                     // raw collection: old values would fail the new enum
  const old = await col.find({ status: { $in: Object.keys(MAP) } }).toArray();
  console.log(`${old.length} old-style order(s) found.${apply ? '' : ' (dry run: add --apply to convert)'}`);
  let n = 0;
  for (const o of old) {
    const status = MAP[o.status];
    const when = o.updatedAt || o.createdAt || new Date();
    const set = {
      status, statusChangedAt: when,
      deadlineAt: status === 'PENDING' ? hours(cfg.DEADLINE_HOURS.PENDING) : status === 'PAYMENT_CONFIRMED' ? hours(cfg.DEADLINE_HOURS.PAYMENT_CONFIRMED) : null,
      replacementCount: 0,
      'payment.status': status === 'PAYMENT_CONFIRMED' || status === 'COMPLETED' ? 'CONFIRMED' : 'NOT_SUBMITTED',
      statusHistory: [{ from: null, to: status, byRole: 'SYSTEM', reason: 'Converted from the old order system (was "' + o.status + '")', at: new Date() }]
    };
    if (status === 'CANCELLED') { set.cancelReason = 'ADMIN_DECISION'; set.cancelledBy = 'ADMIN'; }
    console.log(`  ${o.orderId}: ${o.status} -> ${status}`);
    if (apply) { await col.updateOne({ _id: o._id }, { $set: set }); n++; }
  }
  console.log(apply ? `Converted ${n} order(s).` : 'Nothing changed.');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
