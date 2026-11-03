'use strict';
// Create an administrator, or reset an existing administrator's password.
// Usage: npm run create-admin -- --username admin --name "Mess Manager"
const db = require('../src/config/database');
const { hashPassword } = require('../src/services/passwords');
const { ask, args } = require('./lib');

async function main() {
  const a = args();
  const username = String(a.username || (await ask('Admin username: '))).trim();
  if (!/^[A-Za-z0-9._@-]{3,50}$/.test(username)) throw new Error('Username must be 3–50 letters, digits, or . _ @ -');
  const name = String(a.name || username).trim().slice(0, 100);
  const password = await ask('Password (min 8 characters): ', { hidden: true });
  if (password.length < 8 || Buffer.byteLength(password) > 72) throw new Error('Password must be 8–72 characters.');
  const hash = await hashPassword(password);
  const existing = await db.one('SELECT id FROM admins WHERE username=?', [username]);
  if (existing) {
    // A new password ends every session of that administrator.
    await db.query('UPDATE admins SET password_hash=?,status=1,session_version=session_version+1 WHERE id=?', [hash, existing.id]);
    console.log(`Password updated for administrator "${username}".`);
  } else {
    await db.query('INSERT INTO admins(name,username,password_hash) VALUES(?,?,?)', [name, username, hash]);
    console.log(`Administrator "${username}" created.`);
  }
  await db.query("INSERT INTO audit_logs(admin_id,action,old_value,new_value,reason,ip_address,created_at) VALUES(NULL,'admin_account_set','null',?,'Command-line administrator setup','CLI',NOW())", [JSON.stringify({ username })]);
}

main()
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => db.pool.end());
