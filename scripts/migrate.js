'use strict';
// Node port of scripts/migrate.php — additive "medico-v1" migration.
// Original tables and every original record are retained. Safe to run more than once.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const env = require('../src/config/env');
const db = require('../src/config/database');
const { hashPassword, isBcrypt } = require('../src/services/passwords');
const { normalizeMobile, isIndianMobile } = require('../src/utils/validation');
const { store } = require('../src/middleware/session');

const keepOrHash = async (value) => (isBcrypt(value) ? value : hashPassword(value));

async function columns(table) {
  return (await db.rows(`SHOW COLUMNS FROM \`${table}\``)).map((c) => c.Field);
}

async function main() {
  const sql = fs.readFileSync(path.join(env.ROOT, 'database', 'upgrade.sql'), 'utf8');
  for (const statement of sql.split(';')) if (statement.trim()) await db.pool.query(statement);
  await store.init(); // sessions table

  const keyFile = path.join(env.ROOT, 'storage', 'qr.key');
  if (!env.qrSecret && !fs.existsSync(keyFile)) {
    fs.mkdirSync(path.dirname(keyFile), { recursive: true, mode: 0o700 });
    fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    console.log('Created storage/qr.key (QR signing key).');
  }

  if (await db.one("SELECT version FROM schema_migrations WHERE version='medico-v1'")) {
    console.log('Already migrated.');
    return;
  }

  const existing = await columns('employees');
  const add = {
    department_id: 'INT NULL',
    designation: "VARCHAR(100) NOT NULL DEFAULT ''",
    password_hash: 'VARCHAR(255) NULL',
    session_version: 'INT NOT NULL DEFAULT 1',
    updated_at: 'TIMESTAMP NULL DEFAULT NULL',
    // Present in every database the PHP app ran against; added only if an older copy lacks them.
    mobile_login: 'VARCHAR(15) NULL UNIQUE',
    deleted_at: 'DATETIME NULL',
  };
  for (const [column, type] of Object.entries(add)) {
    if (!existing.includes(column)) await db.pool.query(`ALTER TABLE employees ADD \`${column}\` ${type}`);
  }

  let old = 0;
  await db.withTransaction(async (conn) => {
    await db.query("INSERT IGNORE INTO departments(department_name) SELECT DISTINCT department FROM employees WHERE department IS NOT NULL AND department<>''", [], conn);
    await db.query('UPDATE employees e JOIN departments d ON d.department_name=e.department SET e.department_id=d.id WHERE e.department_id IS NULL', [], conn);

    for (const u of await db.rows("SELECT id,username,password FROM users WHERE role='admin'", [], conn)) {
      const hash = await keepOrHash(u.password);
      await db.query('INSERT IGNORE INTO admins(name,username,password_hash) VALUES(?,?,?)', [u.username, u.username, hash], conn);
      await db.query('UPDATE users SET password=? WHERE id=?', [hash, u.id], conn);
    }
    if (!Number((await db.one('SELECT COUNT(*) n FROM admins', [], conn)).n)) {
      throw new Error('No legacy admin found; create an administrator with "npm run create-admin" and run the migration again.');
    }
    for (const u of await db.rows("SELECT id,password FROM employees WHERE password IS NOT NULL AND password<>''", [], conn)) {
      await db.query('UPDATE employees SET password_hash=?,password=NULL WHERE id=?', [await keepOrHash(u.password), u.id], conn);
    }
    // Employees without a login name get their normalised mobile, when valid and unused.
    for (const e of await db.rows('SELECT id,mobile FROM employees WHERE mobile_login IS NULL AND mobile IS NOT NULL', [], conn)) {
      const m = normalizeMobile(e.mobile);
      if (isIndianMobile(m) && !(await db.one('SELECT id FROM employees WHERE mobile_login=?', [m], conn))) {
        await db.query('UPDATE employees SET mobile_login=? WHERE id=?', [m, e.id], conn);
      }
    }
    // Legacy created_at is a save timestamp, NOT evidence of an actual scan time.
    await db.query("INSERT INTO meal_attendance(employee_id,meal_type_id,meal_date,scan_timestamp,status,source,legacy_id,created_at) SELECT a.employee_id,m.id,a.attendance_date,NULL,IF(a.status=1,'valid','void'),'legacy',a.id,a.created_at FROM attendance a JOIN meal_types m ON m.meal_name=a.meal_type WHERE NOT EXISTS(SELECT 1 FROM meal_attendance n WHERE n.legacy_id=a.id)", [], conn);
    old = Number((await db.one('SELECT COUNT(*) n FROM attendance', [], conn)).n);
    const migrated = Number((await db.one('SELECT COUNT(*) n FROM meal_attendance WHERE legacy_id IS NOT NULL', [], conn)).n);
    if (old !== migrated) throw new Error('Attendance reconciliation failed.');
    await db.query("INSERT INTO schema_migrations(version) VALUES('medico-v1')", [], conn);
  });
  console.log(`Migration complete: ${old} legacy attendance records preserved.`);
}

main()
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => db.pool.end());
