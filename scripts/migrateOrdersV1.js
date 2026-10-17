'use strict';
// ONE-TIME: brings orders that are already in progress into the Version 1 pickup/delivery workflow.
//   npm run migrate:orders-v1            -> shows what it WOULD do (changes nothing)
//   npm run migrate:orders-v1 -- --apply -> does it
//
// What it does (and what it deliberately does not do):
//   1. Every existing order becomes a PICKUP order (fulfilment: PICKUP, productTotal = total, deliveryFee = 0).
//      Pickup is the flow they were already following (ACCEPTED -> PAYMENT_SUBMITTED -> ...), so NO STATUS CHANGES
//      and no deadlines are touched: every order continues exactly where it is.
//   2. Orders still waiting for the buyer's payment (ACCEPTED, PAYMENT_SUBMITTED, PAYMENT_ISSUE) get a copy of the
//      seller's bank details on the order, if that seller has saved them, so the buyer sees them on screen.
//      If the seller has none yet, the order is left as it is and listed below so you can ask that seller to add them
//      (the buyer is still told to ask the seller for payment details on WhatsApp, as before).
// Safe to run more than once: it only touches orders that have not been converted yet.
//
// Run the older script first if you still have old-style orders:  npm run migrate:orders
require('dotenv').config();
const mongoose = require('mongoose');
const { isBankComplete, cleanBankDetails } = require('../utils/bankDetails');

const NEEDS_BANK_COPY = ['ACCEPTED', 'PAYMENT_SUBMITTED', 'PAYMENT_ISSUE'];

(async () => {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGO_URI);
  const orders = mongoose.connection.collection('orders');   // raw collections: no schema defaults get in the way
  const sellers = mongoose.connection.collection('sellers');

  const todo = await orders.find({ fulfilment: { $exists: false } }).toArray();
  console.log(`${todo.length} order(s) to convert to the pickup/delivery workflow.${apply ? '' : ' (dry run: add --apply to convert)'}`);

  const bankCache = new Map();
  const bankOf = async (sellerId) => {
    const key = String(sellerId);
    if (!bankCache.has(key)) {
      const s = await sellers.findOne({ _id: sellerId }, { projection: { bankDetails: 1, businessName: 1 } });
      bankCache.set(key, { bank: s && isBankComplete(s.bankDetails) ? cleanBankDetails(s.bankDetails).value : null, name: s && s.businessName });
    }
    return bankCache.get(key);
  };

  let converted = 0, copied = 0;
  const waiting = new Map(); // seller name -> number of orders waiting without bank details
  for (const o of todo) {
    const set = { fulfilment: 'PICKUP', productTotal: o.total, deliveryFee: 0 };
    let note = 'pickup';
    if (NEEDS_BANK_COPY.includes(o.status) && !o.paymentDetails) {
      const { bank, name } = await bankOf(o.seller);
      if (bank) { set.paymentDetails = Object.assign({}, bank, { sharedAt: new Date() }); note += ' + bank details copied'; copied++; }
      else { waiting.set(name || String(o.seller), (waiting.get(name || String(o.seller)) || 0) + 1); note += ' (seller has no bank details yet)'; }
    }
    console.log(`  ${o.orderId || o._id}  ${o.status}  -> ${note}`);
    if (apply) { await orders.updateOne({ _id: o._id, fulfilment: { $exists: false } }, { $set: set }); converted++; }
  }

  console.log(apply ? `Converted ${converted} order(s); copied bank details onto ${copied}.` : 'Nothing changed.');
  if (waiting.size) {
    console.log('\nThese shops have orders waiting for payment but have NOT saved bank details yet. Ask them to add them under Settings → Payment Details:');
    for (const [name, n] of waiting) console.log(`  - ${name}: ${n} order(s)`);
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
