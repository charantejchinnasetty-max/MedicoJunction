'use strict';
const multer = require('multer');

const MAX_BYTES = 2 * 1024 * 1024;
const SIZE_MESSAGE = 'Upload a JPG or PNG image smaller than 2 MB.';

// Files stay in memory (max 2 MB) and are decoded + re-encoded by services/images.js
// before anything touches the disk. The original filename is never used.
const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 40, fieldSize: 64 * 1024, parts: 45 },
});

/**
 * multipart/form-data parser for a single optional image field. Upload problems are
 * recorded on req.uploadError so the page can show the same validation message as PHP,
 * instead of failing the whole request.
 */
function optionalImage(field) {
  const handler = parser.single(field);
  return (req, res, next) => {
    handler(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        req.body = req.body || {};
        req.uploadError = SIZE_MESSAGE;
        return next();
      }
      next(err);
    });
  };
}

module.exports = { optionalImage, MAX_BYTES };
