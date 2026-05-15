/**
 * Ensures wallet API routes can use PostgreSQL (Neon).
 * The pool is created lazily in `backend/db/pool.js` on first query.
 * @returns {Promise<void>}
 */
export async function connectWalletDB() {
  if (!process.env.NEON_DB_URI && !process.env.DATABASE_URL) {
    throw new Error('Wallet configuration error. Missing NEON_DB_URI (or DATABASE_URL).');
  }
}
