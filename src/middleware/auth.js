'use strict';
const { one } = require('../config/database');
const { isApi, json, url } = require('../utils/http');
const { IDLE_SECONDS } = require('./session');

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * PHP auth($role): role check, 8 h idle timeout, account still active, and
 * session_version unchanged (password reset / deactivation logs everyone out).
 */
function requireRole(role) {
  return async (req, res, next) => {
    try {
      const identity = req.session.identity || {};
      if (identity.role !== role || nowSeconds() - (req.session.last_active || 0) > IDLE_SECONDS) {
        if (isApi(req)) return json(res, false, 'LOGIN_REQUIRED', 'Please log in to continue.', {}, 401);
        return res.redirect(url('/login.php'));
      }
      const user = await one(
        role === 'admin'
          ? 'SELECT * FROM admins WHERE id=? AND status=1'
          : 'SELECT * FROM employees WHERE id=? AND active=1 AND deleted_at IS NULL',
        [identity.id],
      );
      if (!user || Number(user.session_version) !== Number(identity.version ?? -1)) {
        delete req.session.identity;
        if (isApi(req)) return json(res, false, 'ACCOUNT_UNAVAILABLE', 'Your account is inactive or your password changed. Please log in again.', {}, 403);
        return res.redirect(url('/login.php'));
      }
      req.session.last_active = nowSeconds();
      delete user.password;
      req.user = user;
      res.locals.user = user;
      res.locals.role = role;
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requireAdmin: requireRole('admin'), requireEmployee: requireRole('employee') };
