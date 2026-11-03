'use strict';
// The whole application works in Indian Standard Time, exactly like the PHP version
// (date_default_timezone_set('Asia/Kolkata')). This must run before any Date is created.
process.env.TZ = 'Asia/Kolkata';

const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

const ROOT = path.join(__dirname, '..', '..');
const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

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

const trustProxy = process.env.TRUST_PROXY;

module.exports = Object.freeze({
  ROOT,
  nodeEnv,
  isProd,
  isTest: nodeEnv === 'test',
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
    connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
  },
  sessionSecret,
  // Secure cookies whenever the app is served over HTTPS (always in production).
  cookieSecure: bool(process.env.COOKIE_SECURE, isProd),
  trustProxy: trustProxy === undefined || trustProxy === '' ? false : (/^\d+$/.test(trustProxy) ? Number(trustProxy) : bool(trustProxy, trustProxy)),
  qrSecret: process.env.QR_SECRET || '',
  uploadDir: path.join(ROOT, 'assets', 'uploads'),
});
