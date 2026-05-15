const crypto = require('crypto');

/** 24-char hex id compatible with existing Mongo ObjectId string format in APIs */
function newObjectId() {
  return crypto.randomBytes(12).toString('hex');
}

function isValidObjectId(value) {
  return typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value);
}

module.exports = { newObjectId, isValidObjectId };
