const { query } = require('./pool');

async function ensureSchema() {
  const fs = require('fs');
  const path = require('path');
  const sqlPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await query(sql);
}

module.exports = { ensureSchema };
