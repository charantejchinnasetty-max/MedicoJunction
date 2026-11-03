'use strict';
const crypto = require('crypto');
const { one } = require('../config/database');
const { audit } = require('../services/audit');
const { verifyPassword } = require('../services/passwords');
const { getPublicSettings } = require('../services/settings');
const { render } = require('../utils/view');
const { url } = require('../utils/http');
const { str } = require('../utils/validation');

const FAILED = 'Login details are incorrect or your account is inactive. Contact your administrator if you need access.';

async function renderLogin(req, res, error = '') {
  const body = req.method === 'POST' ? req.body || {} : {};
  render(req, res, 'login', {
    settings: await getPublicSettings(),
    error,
    form: { role: str(body.role) ?? '', username: str(body.username) ?? '' },
  });
}

/** Called by the login rate limiters with the PHP "too many attempts" message. */
function renderLimited(req, res, message) {
  renderLogin(req, res, message).catch(req.next);
}

const promisify = (fn) => new Promise((resolve, reject) => fn((err) => (err ? reject(err) : resolve())));

/** PHP login-page.php POST */
async function login(req, res) {
  const { role, username, password } = req.loginAttempt;
  const user = await one(
    role === 'admin'
      ? 'SELECT * FROM admins WHERE username=? AND status=1'
      : 'SELECT * FROM employees WHERE mobile_login=? AND active=1 AND deleted_at IS NULL',
    [username],
  );
  const ok = await verifyPassword(password, user ? user.password_hash : null);
  if (!ok || !user || !user.password_hash) return renderLogin(req, res, FAILED);

  // New session id after login (session fixation protection) and a fresh CSRF token.
  await promisify((cb) => req.session.regenerate(cb));
  req.session.csrf = crypto.randomBytes(32).toString('hex');
  req.session.identity = { id: user.id, role, version: user.session_version };
  req.session.last_active = Math.floor(Date.now() / 1000);
  if (role === 'admin') await audit(req, 'admin_login');
  await promisify((cb) => req.session.save(cb));
  res.redirect(url(`/${role}/dashboard`));
}

/** PHP logout.php (POST + CSRF only). */
async function logout(req, res) {
  await promisify((cb) => req.session.destroy(cb));
  res.clearCookie('MJSESSION', { path: url('') || '/', httpOnly: true, sameSite: 'lax', secure: req.secure });
  res.redirect(url('/login'));
}

/** PHP index.php */
function home(req, res) {
  const identity = req.session.identity;
  res.redirect(url(identity ? `/${identity.role === 'admin' ? 'admin' : 'employee'}/dashboard` : '/login'));
}

module.exports = { renderLogin, renderLimited, login, logout, home };
