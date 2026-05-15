import 'server-only';
import crypto from 'crypto';

export function newObjectId() {
  return crypto.randomBytes(12).toString('hex');
}
