'use strict';
// Moves overdue orders along so nothing stays stuck. Safe on several servers at once:
// the status check inside transition() means only one of them can win.
const Order = require('../models/Order');
const { TIMER_RULES } = require('./workflow');
const { transition } = require('./orderService');

const SYSTEM = { id: null, role: 'SYSTEM' };
let running = false;

async function runTimers(now) {
  if (running) return {};
  running = true;
  const done = {};
  try {
    // Each rule may carry an extra filter (e.g. delivery vs pickup) so the timer acts only on the party who was expected to act
    for (const [status, action, extra] of TIMER_RULES) {
      const due = await Order.find(Object.assign({ status, deadlineAt: { $lte: now || new Date() } }, extra || {})).select('_id').limit(200).lean();
      for (const o of due) {
        try { await transition(o._id, action, SYSTEM); done[action] = (done[action] || 0) + 1; }
        catch (e) { if (e.code !== 'CONFLICT') console.error(`[timers] ${action} on ${o._id}:`, e.message); }
      }
    }
  } finally { running = false; }
  return done;
}

function startTimers(everyMs) {
  const run = () => runTimers().then((d) => { if (Object.keys(d).length) console.log('[timers]', d); }).catch((e) => console.error('[timers]', e.message));
  run();
  return setInterval(run, everyMs || 5 * 60 * 1000);
}
module.exports = { runTimers, startTimers };
