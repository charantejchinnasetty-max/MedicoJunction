'use strict';
const crypto = require('crypto');
const { isApi, json } = require('../utils/http');
const { str } = require('../utils/validation');

/** Every session carries one CSRF token (PHP bootstrap). */
function ensureCsrfToken(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(32).toString('hex');
  res.locals.csrfToken = req.session.csrf;
  next();
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** PHP checkCsrf(): POST only, token from the `csrf` field or X-CSRF-Token header. */
function verifyCsrf(req, res, next) {
  const supplied = str(req.body && req.body.csrf) ?? req.get('X-CSRF-Token') ?? '';
  if (req.method !== 'POST' || !safeEqual(req.session.csrf, supplied)) {
    if (isApi(req)) return json(res, false, 'CSRF_FAILED', 'Your session changed. Reload and try again.', {}, 403);
    return res.status(403).type('text/html; charset=utf-8').send('Your session changed. Reload and try again.');
  }
  next();
}

module.exports = { ensureCsrfToken, verifyCsrf };
