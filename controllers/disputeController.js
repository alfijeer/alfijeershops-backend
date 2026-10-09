const Dispute = require('../models/Dispute');

// GET /api/disputes — admin only, read by admin.html's Disputes tab.
// Was a placeholder on the frontend; this is the real endpoint it should
// point at once deployed.
async function listDisputes(req, res) {
  const disputes = await Dispute.find()
    .populate('buyer', 'fullName phone')
    .populate('seller', 'businessName')
    .populate('order', 'orderId total')
    .sort({ createdAt: -1 });

  res.json({ disputes });
}

// POST /api/disputes — a buyer reports an issue with an order.
// Not yet called from the frontend, but here so the feature can be wired
// up (e.g. a "Report an Issue" button on the buyer's order history).
async function createDispute(req, res) {
  const { orderId, sellerId, reason } = req.body;
  if (!orderId || !sellerId || !reason) {
    return res.status(400).json({ message: 'orderId, sellerId, and reason are required.' });
  }

  const dispute = await Dispute.create({
    order: orderId,
    seller: sellerId,
    buyer: req.user._id,
    reason,
  });

  res.status(201).json({ dispute });
}

// PUT /api/disputes/:id/resolve — admin resolves a dispute
async function resolveDispute(req, res) {
  const { resolutionNote } = req.body;
  const dispute = await Dispute.findById(req.params.id);
  if (!dispute) return res.status(404).json({ message: 'Dispute not found.' });

  dispute.status = 'resolved';
  dispute.resolutionNote = resolutionNote || null;
  await dispute.save();

  res.json({ message: 'Dispute resolved.', dispute });
}

module.exports = { listDisputes, createDispute, resolveDispute };
