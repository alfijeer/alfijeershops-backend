'use strict';
// ALF-20261004-0001. Uses your existing Counter model (getNextSequence), one counter per day (Nigerian time).
const { getNextSequence } = require('../models/Counter');
const cfg = require('../config/orders');

async function nextOrderNumber(now) {
  const day = (now || new Date()).toLocaleDateString('en-CA', { timeZone: cfg.TIMEZONE }).replace(/-/g, '');
  const seq = await getNextSequence('order-' + day);
  return `${cfg.ORDER_PREFIX}-${day}-${String(seq).padStart(4, '0')}`;
}
module.exports = { nextOrderNumber };
