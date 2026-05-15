import 'server-only';
import pg from 'pg';

const { Pool } = pg;

let pool;

function getPool() {
  if (!pool) {
    const connectionString = process.env.NEON_DB_URI || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('Missing NEON_DB_URI (or DATABASE_URL) for wallet');
    }
    pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }
  return pool;
}

export async function query(text, params) {
  return getPool().query(text, params);
}

export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
