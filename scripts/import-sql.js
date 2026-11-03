'use strict';
// Load a .sql dump (e.g. exported from phpMyAdmin / XAMPP) into the database configured in
// the environment — typically the hosted MySQL used by Vercel:
//
//   node --env-file=.env.vercel scripts/import-sql.js mess_management.sql
//
// Afterwards run: node --env-file=.env.vercel scripts/migrate.js
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const env = require('../src/config/env');

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: node --env-file=.env.vercel scripts/import-sql.js <dump.sql>');
  const sql = fs.readFileSync(path.resolve(file), 'utf8');
  const conn = await mysql.createConnection({
    host: env.db.host, port: env.db.port, user: env.db.user, password: env.db.password, database: env.db.database,
    ssl: env.db.ssl, multipleStatements: true, charset: 'utf8mb4',
  });
  try {
    console.log(`Importing ${path.basename(file)} into ${env.db.database} on ${env.db.host} …`);
    await conn.query(sql);
    const [tables] = await conn.query('SHOW TABLES');
    console.log(`Done. ${tables.length} tables in ${env.db.database}.`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Import failed:', err.message);
  if (/primary key/i.test(err.message)) console.error('Your MySQL host requires a primary key on every table: turn off "sql_require_primary_key" in its settings and run the import again.');
  process.exit(1);
});
