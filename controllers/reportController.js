'use strict';
const mongoose = require('mongoose');
const ShopReport = require('../models/ShopReport');
const Seller = require('../models/Seller');
const AdminLog = require('../models/AdminLog');
const { REASONS } = ShopReport;
const { notifyAdmins } = require('../services/push');

const MAX_REPORTS_PER_DAY = 5; // one person cannot flood the admin queue

// Pure: checks what the buyer sent. Returns { ok, message } or { ok, reason, details }.
function validateReport(body) {
  const reason = String((body && body.reason) || '');
  const details = String((body && body.details) || '').trim();
  if (!REASONS.includes(reason)) return { ok: false, message: 'Please choose a reason.' };
  if (details.length > 500) return { ok: false, message: 'Please keep the details under 500 characters.' };
  if (reason === 'other' && details.length < 10) return { ok: false, message: 'Please tell us a little more about the problem.' };
  return { ok: true, reason, details };
}

// POST /api/reports — a logged-in buyer reports a shop. body: { shopId, reason, details }
async function createReport(req, res) {
  const shopId = String((req.body && req.body.shopId) || '');
  if (!mongoose.isValidObjectId(shopId)) return res.status(400).json({ message: 'A valid shop is required.' });

  const v = validateReport(req.body);
  if (!v.ok) return res.status(400).json({ message: v.message });

  const shop = await Seller.findById(shopId).select('businessName status isDeleted user').lean();
  if (!shop || shop.isDeleted || shop.status !== 'approved') return res.status(404).json({ message: 'Shop not found.' });
  if (String(shop.user) === String(req.user._id)) return res.status(400).json({ message: 'You cannot report your own shop.' });

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await ShopReport.countDocuments({ reporter: req.user._id, createdAt: { $gte: since } });
  if (recent >= MAX_REPORTS_PER_DAY) return res.status(429).json({ message: 'You have sent several reports today. Please try again tomorrow.' });

  try {
    await ShopReport.create({ shop: shopId, reporter: req.user._id, reason: v.reason, details: v.details });
  } catch (e) {
    if (e && e.code === 11000) return res.status(409).json({ message: 'You already reported this shop. Our team is looking at it.' });
    throw e;
  }

  notifyAdmins('🚩 Shop reported', `${shop.businessName || 'A shop'} was reported. Open Reports to review it.`, '/admin.html#reports'); // fire and forget
  res.status(201).json({ message: 'Thank you. Our team will review this shop.' });
}

// GET /api/reports?status=open — admin only. Each report also carries how many OPEN reports its shop has in total.
async function listReports(req, res) {
  const status = ['open', 'reviewed', 'dismissed'].includes(req.query.status) ? req.query.status : null;
  const reports = await ShopReport.find(status ? { status } : {})
    .populate('shop', 'businessName shopNumber status isDeleted')
    .populate('reporter', 'fullName phone')
    .sort({ createdAt: -1 })
    .limit(300)
    .lean();

  const counts = await ShopReport.aggregate([{ $match: { status: 'open' } }, { $group: { _id: '$shop', n: { $sum: 1 } } }]);
  const byShop = new Map(counts.map((c) => [String(c._id), c.n]));

  res.json({
    reports: reports.map((r) => ({
      _id: r._id,
      shopId: r.shop && r.shop._id,
      shopName: r.shop ? r.shop.businessName : 'Unknown shop',
      shopNumber: r.shop ? r.shop.shopNumber : null,
      shopStatus: r.shop ? (r.shop.isDeleted ? 'deleted' : r.shop.status) : null,
      openReportsForShop: r.shop ? byShop.get(String(r.shop._id)) || 0 : 0,
      reporterName: r.reporter ? r.reporter.fullName : 'Unknown',
      reporterPhone: r.reporter ? r.reporter.phone : '',
      reason: r.reason,
      details: r.details,
      status: r.status,
      adminNote: r.adminNote,
      createdAt: r.createdAt,
    })),
    openTotal: [...byShop.values()].reduce((a, b) => a + b, 0),
  });
}

// PUT /api/reports/:id — admin only. body: { status: 'reviewed' | 'dismissed', note }
async function reviewReport(req, res) {
  const status = req.body && req.body.status;
  if (!['reviewed', 'dismissed'].includes(status)) return res.status(400).json({ message: 'Choose "reviewed" or "dismissed".' });
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Report not found.' });

  const report = await ShopReport.findById(req.params.id);
  if (!report) return res.status(404).json({ message: 'Report not found.' });

  report.status = status;
  report.adminNote = String((req.body && req.body.note) || '').trim().slice(0, 500);
  report.reviewedBy = req.user._id;
  report.reviewedAt = new Date();
  await report.save();

  await AdminLog.create({ adminId: req.user._id, action: status === 'reviewed' ? 'REPORT_REVIEWED' : 'REPORT_DISMISSED', shopId: report.shop, note: report.adminNote || undefined }).catch(() => {});
  res.json({ message: 'Report updated.' });
}

module.exports = { createReport, listReports, reviewReport, validateReport, MAX_REPORTS_PER_DAY };
