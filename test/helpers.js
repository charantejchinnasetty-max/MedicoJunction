'use strict';
// Integration-test harness: builds a throw-away MySQL database from database/schema.sql,
// seeds known accounts, and starts the app on a random port.
//
// Configure with TEST_DB_HOST / TEST_DB_PORT / TEST_DB_USER / TEST_DB_PASSWORD / TEST_DB_NAME.
// The database name must contain "test"; it is dropped and recreated by every test file.
const fs = require('fs');
const path = require('path');

const dbName = process.env.TEST_DB_NAME || 'medico_junction_test';
if (!/test/i.test(dbName)) throw new Error('TEST_DB_NAME must contain "test" — this database is dropped by the tests.');
Object.assign(process.env, {
  NODE_ENV: 'test',
  DB_HOST: process.env.TEST_DB_HOST || process.env.DB_HOST || '127.0.0.1',
  DB_PORT: process.env.TEST_DB_PORT || process.env.DB_PORT || '3306',
  DB_USER: process.env.TEST_DB_USER || process.env.DB_USER || 'root',
  DB_PASSWORD: process.env.TEST_DB_PASSWORD ?? process.env.DB_PASSWORD ?? '',
  DB_NAME: dbName,
  BASE_PATH: '',
  SESSION_SECRET: 'test-secret-that-is-long-enough-for-the-config-check-0123456789',
  QR_SECRET: 'a'.repeat(64),
  COOKIE_SECURE: 'false',
});

const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

const ROOT = path.join(__dirname, '..');
const ADMIN = { username: 'admin', password: 'Admin@12345' };
const STAFF_PASSWORD = 'Staff@12345';

async function resetDatabase() {
  const conn = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, multipleStatements: true });
  await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
  await conn.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4`);
  await conn.query(`USE \`${dbName}\``);
  await conn.query(fs.readFileSync(path.join(ROOT, 'database', 'schema.sql'), 'utf8'));
  const adminHash = await bcrypt.hash(ADMIN.password, 4);
  const staffHash = (await bcrypt.hash(STAFF_PASSWORD, 4)).replace(/^\$2b\$/, '$2y$'); // PHP-style hash
  await conn.query('INSERT INTO admins(name,username,password_hash) VALUES(?,?,?)', ['Mess Manager', ADMIN.username, adminHash]);
  await conn.query("INSERT INTO system_settings VALUES('employee_default_password_hash',?)", [staffHash]);
  await conn.query("INSERT INTO departments(department_name) VALUES('Kitchen')");
  await conn.query(
    `INSERT INTO employees(employee_name,employee_code,mobile,mobile_login,department,department_id,designation,active,password_hash,deleted_at) VALUES
     ('Asha Rao','EMP001','9876543210','9876543210','Kitchen',1,'Cook',1,?,NULL),
     ('Bala Kumar','EMP002','9123456789','9123456789','Kitchen',1,'Helper',0,?,NULL),
     ('Chitra Devi','EMP003','8000000001','8000000001','Kitchen',1,'',1,?,NOW())`,
    [staffHash, staffHash, staffHash],
  );
  await conn.end();
}

/** Minimal browser: cookie jar, CSRF token tracking, form/JSON/multipart posts. */
class Browser {
  constructor(origin) { this.origin = origin; this.cookie = ''; this.csrf = ''; }
  async req(p, { method = 'GET', form, json, multipart, body: rawBody, headers = {} } = {}) {
    const h = { ...headers };
    if (this.cookie) h.Cookie = this.cookie;
    let body = rawBody;
    if (form) { body = new URLSearchParams(Object.entries(form).filter(([, x]) => x !== undefined)).toString(); h['Content-Type'] = 'application/x-www-form-urlencoded'; }
    if (json !== undefined) { body = JSON.stringify(json); h['Content-Type'] = 'application/json'; h['X-CSRF-Token'] ??= this.csrf; }
    if (multipart) body = multipart;
    const res = await fetch(this.origin + p, { method, headers: h, body, redirect: 'manual' });
    const set = res.headers.getSetCookie().find((c) => c.startsWith('MJSESSION='));
    if (set) this.cookie = set.split(';')[0];
    const text = await res.text();
    const m = /name="csrf" value="([^"]+)"|name="csrf-token" content="([^"]+)"/.exec(text);
    if (m) this.csrf = m[1] || m[2];
    let data = null;
    if ((res.headers.get('content-type') || '').includes('json')) data = JSON.parse(text);
    return { status: res.status, location: res.headers.get('location'), headers: res.headers, text, data };
  }
  post(p, fields = {}) { return this.req(p, { method: 'POST', form: { csrf: this.csrf, ...fields } }); }
  async login(role, username, password) {
    await this.req('/login');
    return this.post('/login', { role, username, password });
  }
}

async function startApp() {
  await resetDatabase();
  const { createApp } = require('../src/app');
  const db = require('../src/config/database');
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    db,
    browser: () => new Browser(origin),
    admin: async () => { const b = new Browser(origin); await b.login('admin', ADMIN.username, ADMIN.password); return b; },
    employee: async (mobile = '9876543210') => { const b = new Browser(origin); await b.login('employee', mobile, STAFF_PASSWORD); return b; },
    async stop() { await new Promise((r) => server.close(r)); await db.pool.end(); },
  };
}

/** Make every meal window closed except one that is open for the whole day. */
async function openAllDay(db, mealId = 2) {
  await db.query("UPDATE meal_types SET status=0, start_time='00:00:00', end_time='00:00:01' WHERE id<>?", [mealId]);
  await db.query("UPDATE meal_types SET status=1, start_time='00:00:00', end_time='23:59:59', end_inclusive=1 WHERE id=?", [mealId]);
}

module.exports = { startApp, Browser, ADMIN, STAFF_PASSWORD, openAllDay };
