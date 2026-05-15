const { getPool } = require('../db/pool');
const { ensureSchema } = require('../db/runSchema');

const connectDB = async () => {
  try {
    const pool = getPool();
    await pool.query('SELECT 1');
    await ensureSchema();
    console.log('PostgreSQL (Neon) connected and schema ensured');
  } catch (error) {
    console.error(`Database connection error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
