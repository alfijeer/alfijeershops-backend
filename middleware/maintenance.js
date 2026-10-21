'use strict';
// When the admin takes the platform offline, every API call answers 503 "MAINTENANCE" — except health checks,
// the public status call, login (which lets admins in) and anything done by a logged-in admin.
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { getSettings } = require('../services/platform');

const OPEN_PATHS = ['/health', '/platform/status', '/auth/login'];

async function maintenanceGate(req, res, next) {
  try {
    const s = await getSettings();
    if (!s.maintenance.enabled) return next();
    if (OPEN_PATHS.includes(req.path)) return next();
    const h = req.headers.authorization || '';
    if (h.startsWith('Bearer ')) {
      try {
        const decoded = jwt.verify(h.split(' ')[1], process.env.JWT_SECRET);
        const u = await User.findById(decoded.id).select('role').lean();
        if (u && u.role === 'admin') return next();
      } catch (e) { /* fall through to the maintenance answer */ }
    }
    return res.status(503).json({ code: 'MAINTENANCE', message: s.maintenance.message, eta: s.maintenance.eta });
  } catch (e) { next(); }   // never let the gate itself take the site down
}
module.exports = { maintenanceGate };
