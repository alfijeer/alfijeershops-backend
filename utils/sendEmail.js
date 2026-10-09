// ══════════════════════════════════════════════════════════
// Sends email via Resend's HTTPS API — NOT raw SMTP.
//
// Why: Railway (like most cloud hosts) blocks outbound SMTP
// connections (ports 25/465/587) on free/hobby plans to prevent
// spam abuse. That's a platform-level restriction, not something
// fixable in code. Resend's API is a normal HTTPS request, so it
// works the same way your Cloudinary uploads already do — no
// blocked ports involved.
//
// Setup: sign up free at resend.com, verify a sending domain (or
// use their shared onboarding domain to start), get an API key,
// and add it as RESEND_API_KEY in Railway.
// ══════════════════════════════════════════════════════════

async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('Email is not configured on the server yet (missing RESEND_API_KEY).');
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'ALFIJEER <onboarding@resend.dev>',
      to,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Resend API error (${res.status}): ${errBody}`);
  }
}

module.exports = sendEmail;
