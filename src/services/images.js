'use strict';
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
const env = require('../config/env');
const db = require('../config/database');
const { ValidationError } = require('../utils/errors');

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_SIDE = 3000;
// Images kept in the database (Vercel) are scaled down to this size so they stay small
// enough for MySQL packets and for Vercel responses (4.5 MB). Logos and profile photos are
// never shown larger than this.
const DB_MAX_SIDE = 1200;
const NAME_RE = /^[a-f0-9]{32}\.png$/;

let tableReady = null;
/** Table for uploads when UPLOAD_STORAGE=database (created on first use, also by npm run migrate). */
function ensureUploadTable() {
  tableReady ??= db.pool.query(
    'CREATE TABLE IF NOT EXISTS uploaded_files (name VARCHAR(64) NOT NULL PRIMARY KEY, mime VARCHAR(40) NOT NULL, data LONGBLOB NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB',
  ).catch((err) => { tableReady = null; throw err; });
  return tableReady;
}

/**
 * PHP uploadImage(): accept JPG/PNG up to 2 MB and 3000×3000, decode it, and re-encode it
 * as a new PNG with a random name. Re-encoding drops metadata and anything smuggled inside
 * the file. Returns the stored relative path ("assets/uploads/<hex>.png") or null.
 */
async function saveUploadedImage(req) {
  if (req.uploadError) throw new ValidationError(req.uploadError);
  const file = req.file;
  if (!file || (file.size === 0 && !file.originalname)) return null;
  if (file.size > MAX_BYTES) throw new ValidationError('Upload a JPG or PNG image smaller than 2 MB.');

  let meta;
  try {
    meta = await sharp(file.buffer, { limitInputPixels: MAX_SIDE * MAX_SIDE }).metadata();
  } catch {
    meta = null;
  }
  // A real JPEG/PNG signature that cannot be parsed is a damaged image (PHP: GD decode failure).
  const signature = file.buffer.subarray(0, 8);
  const looksLikeImage = signature.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) || signature.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!meta && looksLikeImage) throw new ValidationError('The image could not be read.');
  if (!meta || !['jpeg', 'png'].includes(meta.format) || !meta.width || !meta.height || meta.width > MAX_SIDE || meta.height > MAX_SIDE) {
    throw new ValidationError('Choose a JPG or PNG image up to 3000 × 3000 pixels.');
  }

  const inDatabase = env.uploadStorage === 'database';
  let png;
  try {
    let img = sharp(file.buffer, { failOn: 'error', limitInputPixels: MAX_SIDE * MAX_SIDE });
    if (inDatabase) img = img.rotate().resize(DB_MAX_SIDE, DB_MAX_SIDE, { fit: 'inside', withoutEnlargement: true });
    png = await img.png({ compressionLevel: 9 }).toBuffer();
  } catch {
    throw new ValidationError('The image could not be read.');
  }

  const name = `${crypto.randomBytes(16).toString('hex')}.png`;
  if (inDatabase) {
    await ensureUploadTable();
    await db.query('INSERT INTO uploaded_files(name,mime,data) VALUES(?,?,?)', [name, 'image/png', png]);
  } else {
    await fs.mkdir(env.uploadDir, { recursive: true });
    await fs.writeFile(path.join(env.uploadDir, name), png, { flag: 'wx', mode: 0o644 });
  }
  return `assets/uploads/${name}`;
}

/**
 * GET /assets/uploads/<name>: files on disk are left to the static handler; anything else is
 * looked up in uploaded_files (images uploaded while running on Vercel).
 */
async function serveUploadedImage(req, res, next) {
  const name = req.params.file;
  if (!NAME_RE.test(name)) return next();
  try {
    await fs.access(path.join(env.uploadDir, name));
    return next();
  } catch { /* not on disk */ }
  let row;
  try {
    await ensureUploadTable();
    row = await db.one('SELECT mime,data FROM uploaded_files WHERE name=?', [name]);
  } catch (err) {
    return next(err);
  }
  if (!row) return next();
  res.set({ 'Content-Type': row.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
  res.send(row.data);
}

/** Only files this app generated are ever rendered as images. */
const isSafeUploadPath = (p) => typeof p === 'string' && /^assets\/uploads\/[a-zA-Z0-9_.-]+\.(png|jpg|jpeg)$/.test(p);

module.exports = { saveUploadedImage, serveUploadedImage, ensureUploadTable, isSafeUploadPath };
