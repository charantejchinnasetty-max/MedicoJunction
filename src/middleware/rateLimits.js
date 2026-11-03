'use strict';
const { rateLimit } = require('express-rate-limit');
const { json } = require('../utils/http');
const { normalizeMobile, str } = require('../utils/validation');

const LOGIN_MESSAGE = 'Too many login attempts. Please wait 15 minutes and try again.';
const common = { standardHeaders: 'draft-7', legacyHeaders: false };

/** Normalised login attempt, used for the per-account bucket (PHP login-page.php). */
function parseLoginAttempt(req, res, next) {
  const body = req.body || {};
  const role = str(body.role) === 'admin' ? 'admin' : 'employee';
  let username = (str(body.username) ?? '').trim().slice(0, 50);
  if (role === 'employee') username = normalizeMobile(username);
  req.loginAttempt = { role, username, password: str(body.password) ?? '' };
  next();
}

/** Login limits render the login page with the PHP message instead of a bare 429. */
function loginLimiter(options, render) {
  return rateLimit({
    ...common,
    windowMs: 15 * 60 * 1000,
    ...options,
    handler: (req, res) => render(req, res.status(429), LOGIN_MESSAGE),
  });
}

function makeLoginLimiters(render) {
  return [
    loginLimiter({ limit: 40 }, render), // per IP (default key generator)
    loginLimiter({ limit: 10, keyGenerator: (req) => `login:${req.loginAttempt.role}:${req.loginAttempt.username.toLowerCase()}` }, render),
  ];
}

const scanLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  limit: 12,
  keyGenerator: (req) => `scan:${req.user.id}`,
  handler: (req, res) => json(res, false, 'RATE_LIMITED', 'Please wait a minute before scanning again.', {}, 429),
});

const qrLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  limit: 10,
  keyGenerator: (req) => `qr:${req.user.id}`,
  handler: (req, res) => json(res, false, 'RATE_LIMITED', 'Please wait before refreshing the QR.', {}, 429),
});

module.exports = { parseLoginAttempt, makeLoginLimiters, scanLimiter, qrLimiter, LOGIN_MESSAGE };
