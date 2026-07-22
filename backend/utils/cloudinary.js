// Cloudinary SDK auto-parses CLOUDINARY_URL on import.
// Ignore placeholders / invalid values so the API can boot without real credentials.
if (
  process.env.CLOUDINARY_URL &&
  !String(process.env.CLOUDINARY_URL).startsWith('cloudinary://')
) {
  delete process.env.CLOUDINARY_URL;
}

const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

module.exports = cloudinary;
