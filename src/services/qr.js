'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const env = require('../config/env');
const db = require('../config/database');
const time = require('../utils/time');
const { intval } = require('../utils/validation');
const { getSetting } = require('./settings');
const { getMeals, serviceStatus } = require('./meals');

const KEY_FILE = path.join(env.ROOT, 'storage', 'qr.key');
let cachedSecret = null;

/** PHP qrSecret(): QR_SECRET env var, otherwise storage/qr.key (created by `npm run migrate`). */
function qrSecret() {
  if (cachedSecret) return cachedSecret;
  let key = env.qrSecret;
  if (!key) {
    try { key = fs.readFileSync(KEY_FILE, 'utf8'); } catch { key = ''; }
  }
  if (!key || key.length < 32) throw new Error('QR signing key is missing. Run "npm run migrate" or set QR_SECRET.');
  cachedSecret = key.trim();
  return cachedSecret;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (s) => crypto.createHmac('sha256', qrSecret()).update(s).digest('hex');

/** PHP issueToken(): signed, short-lived (30–60 s), registered server-side. */
async function issueToken() {
  const at = time.now();
  const iat = time.unix(at);
  const ttl = Math.max(30, Math.min(60, intval(await getSetting('qr_ttl', '60'))));
  const payload = Buffer.from(JSON.stringify({ v: 1, nonce: crypto.randomBytes(24).toString('hex'), iat, exp: iat + ttl })).toString('base64url');
  const token = `${payload}.${hmac(payload)}`;
  await db.query('INSERT INTO qr_tokens(token_hash,issued_at,expires_at,status) VALUES(?,?,?,1)', [
    sha256(token), time.ymdhis(at), time.ymdhis(new Date(at.getTime() + ttl * 1000)),
  ]);
  return { token, expires_at: iat + ttl, server_time: iat, ttl, service: serviceStatus(await getMeals(), at) };
}

/** PHP validateToken(): signature, payload shape, expiry, and server-side registry. */
async function validateToken(token, at, conn) {
  const ts = time.unix(at);
  const m = typeof token === 'string' && token.length <= 1024 ? /^([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/.exec(token) : null;
  if (!m || !crypto.timingSafeEqual(Buffer.from(hmac(m[1])), Buffer.from(m[2]))) {
    return { code: 'INVALID_QR', message: 'Invalid QR. Scan the Medico Junction counter QR.' };
  }
  let p;
  try { p = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')); } catch { p = null; }
  if (!p || typeof p !== 'object' || p.v !== 1 || !Number.isInteger(p.iat) || !Number.isInteger(p.exp) || p.iat > ts || p.exp - p.iat > 60 || p.exp <= p.iat) {
    return { code: 'INVALID_QR', message: 'Invalid QR token.' };
  }
  if (p.exp <= ts) return { code: 'QR_EXPIRED', message: 'QR expired. Please scan the latest QR displayed at the counter.' };
  const row = await db.one('SELECT * FROM qr_tokens WHERE token_hash=? AND status=1', [sha256(token)], conn);
  if (!row || time.unix(time.parse(row.expires_at)) <= ts) {
    return { code: 'INVALID_QR', message: 'QR is no longer valid. Scan the latest counter QR.' };
  }
  return { row };
}

module.exports = { issueToken, validateToken, qrSecret };
