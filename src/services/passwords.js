'use strict';
const bcrypt = require('bcrypt');
const db = require('../config/database');
const { ValidationError } = require('../utils/errors');

const COST = 12;
// Verified when an account does not exist, so response time does not reveal valid usernames.
const DUMMY_HASH = '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.';

/** PHP password_hash() produces $2y$ bcrypt hashes; they are identical to $2b$. */
const toNodeHash = (hash) => String(hash || '').replace(/^\$2y\$/, '$2b$');
const isBcrypt = (hash) => /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(String(hash || ''));

async function verifyPassword(password, hash) {
  const usable = isBcrypt(hash);
  const ok = await bcrypt.compare(String(password), usable ? toNodeHash(hash) : DUMMY_HASH);
  return usable && ok;
}

const hashPassword = (password) => bcrypt.hash(String(password), COST);

/** PHP employeePasswordHash(): the common employee password configured by the administrator. */
async function employeePasswordHash(conn) {
  const row = await db.one("SELECT setting_value FROM system_settings WHERE setting_key='employee_default_password_hash'", [], conn);
  const hash = row ? String(row.setting_value) : '';
  if (!isBcrypt(hash)) {
    throw new ValidationError('The common employee password is not configured yet. Set it with "npm run set-employee-password" on the server.');
  }
  return hash;
}

module.exports = { verifyPassword, hashPassword, employeePasswordHash, isBcrypt };
