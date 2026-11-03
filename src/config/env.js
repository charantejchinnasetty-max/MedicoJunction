'use strict';
// The whole application works in Indian Standard Time, exactly like the PHP version
// (date_default_timezone_set('Asia/Kolkata')). This must run before any Date is created.
process.env.TZ = 'Asia/Kolkata';

const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

const ROOT = path.join(__dirname, '..', '..');
const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';
// Vercel sets VERCEL=1 for builds and functions.
const onVercel = Boolean(process.env.VERCEL);

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function basePath(value) {
  const v = String(value || '').trim().replace(/\/+$/, '');
  if (v === '') return '';
  if (!/^\/[A-Za-z0-9._~\-/]*$/.test(v)) throw new Error('BASE_PATH must look like /mess_management');
  return v;
}

let sessionSecret = process.env.SESSION_SECRET || '';
const placeholderSecret = sessionSecret === '' || sessionSecret.startsWith('change_this');
if (placeholderSecret || sessionSecret.length < 32) {
  if (isProd) throw new Error('SESSION_SECRET must be set to a random value of at least 32 characters in production.');
  // Development only: a per-process secret (sessions reset when the server restarts).
  sessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn('[config] SESSION_SECRET is not set; using a temporary development secret.');
}

if (onVercel && basePath(process.env.BASE_PATH) !== '') {
  throw new Error('BASE_PATH must be empty on Vercel (static files are served from /assets).');
}
if (onVercel && (process.env.QR_SECRET || '').length < 32) {
  throw new Error('QR_SECRET must be set on Vercel (64 random hex characters); the server has no storage/qr.key.');
}

// Vercel always sits behind its own HTTPS proxy.
const trustProxy = process.env.TRUST_PROXY || (onVercel ? '1' : undefined);

/** DB_SSL=true for hosted MySQL that requires TLS (Aiven, TiDB Cloud, …). DB_SSL_CA: CA certificate (PEM). */
function dbSsl() {
  if (!bool(process.env.DB_SSL, false)) return undefined;
  let ca = (process.env.DB_SSL_CA || '').replace(/\\n/g, '\n').trim();
  // Either the PEM text itself (Vercel) or the path of a .pem file (local scripts).
  if (ca && !ca.startsWith('-----BEGIN')) ca = fs.readFileSync(path.resolve(ROOT, ca), 'utf8');
  return { minVersion: 'TLSv1.2', rejectUnauthorized: true, ...(ca ? { ca } : {}) };
}

const uploadStorage = (process.env.UPLOAD_STORAGE || (onVercel ? 'database' : 'disk')).toLowerCase();
if (!['disk', 'database'].includes(uploadStorage)) throw new Error('UPLOAD_STORAGE must be "disk" or "database".');

module.exports = Object.freeze({
  ROOT,
  nodeEnv,
  isProd,
  isTest: nodeEnv === 'test',
  onVercel,
  port: Number(process.env.PORT || 3000),
  baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
  basePath: basePath(process.env.BASE_PATH),
  timezone: 'Asia/Kolkata',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME || 'mess_management',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    // Each Vercel function instance keeps its own small pool.
    connectionLimit: Number(process.env.DB_POOL_SIZE || (onVercel ? 3 : 10)),
    ssl: dbSsl(),
  },
  sessionSecret,
  // Secure cookies whenever the app is served over HTTPS (always in production).
  cookieSecure: bool(process.env.COOKIE_SECURE, isProd),
  trustProxy: trustProxy === undefined || trustProxy === '' ? false : (/^\d+$/.test(trustProxy) ? Number(trustProxy) : bool(trustProxy, trustProxy)),
  qrSecret: process.env.QR_SECRET || '',
  uploadDir: path.join(ROOT, 'assets', 'uploads'),
  // "disk": assets/uploads/ (default). "database": table uploaded_files (default on Vercel,
  // whose file system is read-only).
  uploadStorage,
});
