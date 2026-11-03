'use strict';
const mysql = require('mysql2/promise');
const env = require('./env');

// One shared pool. Dates are returned as strings ("2026-11-03 12:40:00") exactly as PDO did,
// so every comparison and formatting rule from the PHP code keeps the same meaning.
const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  connectionLimit: env.db.connectionLimit,
  waitForConnections: true,
  charset: 'utf8mb4',
  dateStrings: true,
  timezone: '+05:30',
  supportBigNumbers: true,
  ...(env.db.ssl ? { ssl: env.db.ssl } : {}),
  enableKeepAlive: true,
});

// Same as the PHP bootstrap: SET time_zone = '+05:30' on every connection.
pool.pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+05:30'");
});

const clean = (args) => args.map((v) => (v === undefined ? null : v));

/** Run a parameterised statement. `conn` may be a transaction connection. */
async function query(sql, args = [], conn = pool) {
  const [result] = await conn.execute(sql, clean(args));
  return result;
}
async function rows(sql, args = [], conn = pool) {
  return query(sql, args, conn);
}
async function one(sql, args = [], conn = pool) {
  const result = await query(sql, args, conn);
  return result[0] || null;
}

/** Run `fn(conn)` inside a transaction; commits on success, rolls back on any error. */
async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch { /* connection already broken */ }
    throw err;
  } finally {
    conn.release();
  }
}

const isDuplicate = (err) => err && (err.errno === 1062 || err.code === 'ER_DUP_ENTRY');

module.exports = { pool, query, rows, one, withTransaction, isDuplicate };
