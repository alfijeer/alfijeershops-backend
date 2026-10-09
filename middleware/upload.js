const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// ══════════════════════════════════════════════════════════
// File uploads now go straight to Cloudinary — this replaces the
// earlier local-disk version, which Railway wiped on every redeploy.
//
// Requires three Railway variables:
//   CLOUDINARY_CLOUD_NAME
//   CLOUDINARY_API_KEY
//   CLOUDINARY_API_SECRET
// (find all three on your Cloudinary dashboard homepage)
//
// Controllers read the uploaded file's URL from `file.path`, which
// multer-storage-cloudinary sets to the final secure Cloudinary URL —
// see authController.js and productController.js.
// ══════════════════════════════════════════════════════════

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'alfijeer',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    // Keeps uploads reasonably sized without the seller needing to think about it.
    transformation: [{ width: 1600, height: 1600, crop: 'limit' }],
  },
});

const upload = multer({
  storage,
  limits: { fileSize: (Number(process.env.MAX_UPLOAD_SIZE_MB) || 5) * 1024 * 1024 },
});

module.exports = upload;

