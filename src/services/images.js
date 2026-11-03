'use strict';
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
const env = require('../config/env');
const { ValidationError } = require('../utils/errors');

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_SIDE = 3000;

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

  let png;
  try {
    png = await sharp(file.buffer, { failOn: 'error', limitInputPixels: MAX_SIDE * MAX_SIDE }).png().toBuffer();
  } catch {
    throw new ValidationError('The image could not be read.');
  }

  const name = `${crypto.randomBytes(16).toString('hex')}.png`;
  await fs.mkdir(env.uploadDir, { recursive: true });
  await fs.writeFile(path.join(env.uploadDir, name), png, { flag: 'wx', mode: 0o644 });
  return `assets/uploads/${name}`;
}

/** Only files this app generated are ever rendered as images. */
const isSafeUploadPath = (p) => typeof p === 'string' && /^assets\/uploads\/[a-zA-Z0-9_.-]+\.(png|jpg|jpeg)$/.test(p);

module.exports = { saveUploadedImage, isSafeUploadPath };
