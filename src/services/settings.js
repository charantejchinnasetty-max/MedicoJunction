'use strict';
const db = require('../config/database');
const { ValidationError } = require('../utils/errors');
const { cleanText, intval } = require('../utils/validation');
const { audit } = require('./audit');
const { saveUploadedImage } = require('./images');

// Never shown, audited or exported.
const SECRET_KEYS = ['employee_default_password_hash'];

/** PHP setting($key, $default): read straight from the database (changes apply immediately). */
async function getSetting(key, fallback = '', conn) {
  const row = await db.one('SELECT setting_value FROM system_settings WHERE setting_key=?', [key], conn);
  return row ? String(row.setting_value) : fallback;
}

/** Public settings used by every rendered page (company name, logo, QR TTL, timezone). */
async function getPublicSettings() {
  const list = await db.rows('SELECT setting_key,setting_value FROM system_settings');
  const out = {};
  for (const r of list) if (!SECRET_KEYS.includes(r.setting_key)) out[r.setting_key] = String(r.setting_value);
  return out;
}

/** PHP saveSettings() */
async function saveSettings(req) {
  const body = req.body || {};
  const name = cleanText(body, 'company_name', 100, true);
  const ttl = body.qr_ttl === undefined ? 60 : intval(body.qr_ttl);
  if (ttl < 30 || ttl > 60) throw new ValidationError('QR validity must be between 30 and 60 seconds.');
  const next = { company_name: name, qr_ttl: String(ttl), timezone: 'Asia/Kolkata' };
  const logo = await saveUploadedImage(req);
  if (logo) next.logo = logo;
  await db.withTransaction(async (conn) => {
    const old = await db.rows("SELECT * FROM system_settings WHERE setting_key<>'employee_default_password_hash'", [], conn);
    for (const [k, v] of Object.entries(next)) {
      await db.query('UPDATE system_settings SET setting_value=? WHERE setting_key=?', [v, k], conn);
    }
    await audit(req, 'settings_changed', old, next, '', conn);
  });
}

module.exports = { getSetting, getPublicSettings, saveSettings };
