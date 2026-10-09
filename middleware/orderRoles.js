'use strict';
// Use AFTER protect(). Builds req.actor = { id, role, shopId } for the order workflow.
const cfg = require('../config/orders');
const Seller = require('../models/Seller');

async function resolveActor(req) {
  const u = req.user || {};
  const role = cfg.ROLE_MAP[u.role] || null;
  const actor = { id: u._id, role, shopId: undefined };
  if (role === 'SELLER') {
    const shop = await Seller.findOne({ user: u._id }).select('_id');
    actor.shopId = shop ? shop._id : null;
  }
  return actor;
}

const requireOrderRole = (...roles) => async (req, res, next) => {
  try {
    const actor = await resolveActor(req);
    if (!actor.id || !roles.includes(actor.role)) return res.status(403).json({ message: 'You do not have permission to do that.' });
    if (actor.role === 'SELLER' && !actor.shopId) return res.status(404).json({ message: 'No shop found for this account.' });
    if (req.user.isDeleted) return res.status(403).json({ message: 'This account is closed.' });
    req.actor = actor;
    next();
  } catch (e) { next(e); }
};

module.exports = { requireOrderRole, resolveActor };
