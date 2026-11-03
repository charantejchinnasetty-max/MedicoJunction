'use strict';
// Set the common employee password (system setting "employee_default_password_hash").
// New employees, and employees whose password an admin resets, receive this password.
// Existing employees keep their current password until an admin ticks "Reset" for them.
const db = require('../src/config/database');
const { hashPassword } = require('../src/services/passwords');
const { ask } = require('./lib');

async function main() {
  const password = await ask('Common employee password (min 8 characters): ', { hidden: true });
  if (password.length < 8 || Buffer.byteLength(password) > 72) throw new Error('Password must be 8–72 characters.');
  const hash = await hashPassword(password);
  await db.query(
    "INSERT INTO system_settings(setting_key,setting_value) VALUES('employee_default_password_hash',?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)",
    [hash],
  );
  await db.query("INSERT INTO audit_logs(admin_id,action,old_value,new_value,reason,ip_address,created_at) VALUES(NULL,'employee_password_policy_changed','null','null','Common employee password set from the command line','CLI',NOW())");
  console.log('Common employee password saved. Use "Reset to common employee password" on an employee to apply it.');
}

main()
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => db.pool.end());
