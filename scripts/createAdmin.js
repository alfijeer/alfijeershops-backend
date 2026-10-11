'use strict';
// Creates an ADMIN account, or promotes an existing BUYER account to admin.
// The website's registration can never create an admin (by design), so this is the only way.
//
// Needs MONGO_URI in your .env (the same database your Railway backend uses).
//
// Windows PowerShell:
//   $env:ADMIN_EMAIL="you@example.com"; $env:ADMIN_PASSWORD="a-long-secret-password"
//   $env:ADMIN_NAME="Your Name"; $env:ADMIN_PHONE="08012345678"
//   npm run create-admin
//
// Mac / Linux:
//   ADMIN_EMAIL="you@example.com" ADMIN_PASSWORD="a-long-secret-password" ADMIN_NAME="Your Name" ADMIN_PHONE="08012345678" npm run create-admin
//
// Never write the password in a file or commit it.
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const fail = (m) => { console.error('✖ ' + m); process.exit(1); };

(async () => {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');
  const fullName = String(process.env.ADMIN_NAME || '').trim();
  const phone = String(process.env.ADMIN_PHONE || '').trim();

  if (!/^\S+@\S+\.\S+$/.test(email)) fail('Set ADMIN_EMAIL to a valid email address.');
  if (!process.env.MONGO_URI) fail('MONGO_URI is missing from your .env file.');

  await mongoose.connect(process.env.MONGO_URI);
  let user = await User.findOne({ email }).select('+password');

  if (user) {
    if (user.role === 'admin' && !password) fail('This account is already an admin.');
    if (user.role === 'seller') fail('This email belongs to a SELLER account. Use a different email for the admin account.');
    if (user.isDeleted) fail('This account was deleted. Use a different email.');
    user.role = 'admin';
    user.isSuspended = false;
    if (password) {
      if (password.length < 12) fail('Use a password of at least 12 characters.');
      user.password = password; // hashed automatically on save
    }
    await user.save();
    console.log(`✔ ${email} is now an admin.${password ? ' Password updated.' : ' (Existing password kept.)'}`);
  } else {
    if (password.length < 12) fail('Set ADMIN_PASSWORD to at least 12 characters.');
    if (!fullName || !phone) fail('Set ADMIN_NAME and ADMIN_PHONE too (the account needs them).');
    user = await User.create({ fullName, email, phone, password, role: 'admin' });
    console.log(`✔ Admin account created for ${email}.`);
  }
  console.log('Now log in at your site\'s login page. Admins go straight to the admin dashboard.');
  await mongoose.disconnect();
})().catch((e) => { console.error('✖ ' + e.message); process.exit(1); });
