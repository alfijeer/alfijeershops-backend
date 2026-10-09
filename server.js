require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const connectDB = require('./config/db');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/authRoutes');
const sellerRoutes = require('./routes/sellerRoutes');
const buyerRoutes = require('./routes/buyerRoutes');
const productRoutes = require('./routes/productRoutes');
const orderRoutes = require('./routes/orderRoutes');
const disputeRoutes = require('./routes/disputeRoutes');
const adminOrderRoutes = require('./routes/adminOrderRoutes');
const mongoose = require('mongoose');
const { startTimers } = require('./services/timers');

const app = express();

connectDB();

// Railway (and most hosts) sit their app behind a reverse proxy, so every
// request arrives with an X-Forwarded-For header already set. Without this,
// express-rate-limit refuses to trust that header (correctly, since an
// untrusted proxy setting would let it be spoofed to dodge rate limits) and
// throws on every request instead of just working.
app.set('trust proxy', 1);

// ── Security & parsing middleware ──
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } })); // cross-origin so uploaded images load from the frontend's domain
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS — locked to the frontend origins listed in .env, not wide open.
const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow tools like Postman/curl (no origin header) and any listed origin.
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);

// General rate limiting — generous, just a floor against abuse.
app.use(
  '/api',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    message: { message: 'Too many requests. Please try again in a few minutes.' },
  })
);

// Auth routes get their own, more carefully tuned limits — see
// routes/authRoutes.js. A single blanket limit here used to cover
// register/login/forgot-password together, which was too strict for
// registration specifically: it's a large multipart upload (shop photo +
// ID) that legitimately takes a while and sometimes needs a genuine retry
// on slow mobile connections, and many real users in Nigeria share one
// public IP behind carrier-grade NAT — so a low shared limit was locking
// out innocent users, not just abusive ones.

// Uploaded files (shop photos, gov IDs, product images) are served
// directly from Cloudinary now — see middleware/upload.js. Nothing to
// serve locally anymore.

// ── Routes ──
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/sellers', sellerRoutes);
app.use('/api/buyers', buyerRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/disputes', disputeRoutes);
app.use('/api/admin', adminOrderRoutes); // admin order queue, payment proof, decisions, shop order stats

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 ALFIJEER API running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
});

// Order timers: move overdue orders along so nothing stays stuck (every 5 minutes)
mongoose.connection.once('open', () => startTimers());
