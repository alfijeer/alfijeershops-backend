'use strict';
require('./upload'); // makes sure cloudinary.config(...) has run
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const storage = new CloudinaryStorage({
  cloudinary,
  params: { folder: 'alfijeer/payment-proofs', type: 'authenticated', allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 1600, height: 1600, crop: 'limit' }] }
});
module.exports = multer({ storage, limits: { fileSize: (Number(process.env.MAX_UPLOAD_SIZE_MB) || 5) * 1024 * 1024 } });
