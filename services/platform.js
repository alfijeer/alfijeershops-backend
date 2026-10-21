'use strict';
// Reads the platform switches. Cached for a few seconds so the gate adds almost no database load.
const Setting = require('../models/Setting');

const DEFAULT_MAINTENANCE_MESSAGE = 'ALFIJEER is down for a short maintenance. We are making things better and will be back shortly.';
let cache = null, cachedAt = 0;
const TTL_MS = 10 * 1000;

function shape(doc) {
  const m = (doc && doc.maintenance) || {};
  return {
    maintenance: { enabled: !!m.enabled, message: m.message || DEFAULT_MAINTENANCE_MESSAGE, eta: m.eta || '' },
    ordersPaused: !!(doc && doc.ordersPaused),
    ordersPausedMessage: (doc && doc.ordersPausedMessage) || 'Ordering is paused for a moment. You can still browse shops — please try again soon.'
  };
}

async function getSettings(force) {
  if (!force && cache && Date.now() - cachedAt < TTL_MS) return cache;
  try {
    const doc = await Setting.findOne({ key: 'platform' }).lean();
    cache = shape(doc); cachedAt = Date.now();
  } catch (e) {
    console.error('[platform] settings read failed:', e.message);
    if (!cache) cache = shape(null);             // if the database hiccups, stay OPEN rather than lock everyone out
  }
  return cache;
}
const clearCache = () => { cache = null; cachedAt = 0; };

module.exports = { getSettings, clearCache, shape, DEFAULT_MAINTENANCE_MESSAGE };
