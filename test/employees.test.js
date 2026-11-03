'use strict';
const { startApp } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');

let app;
let admin;
test.before(async () => { app = await startApp(); admin = await app.admin(); });
test.after(() => app.stop());

const base = { id: '0', employee_name: 'Dev Patel', employee_code: 'EMP010', mobile: '+91 99887 76655', department: 'Housekeeping', designation: 'Supervisor', joining_date: '2025-05-01', active: 'on' };
const save = async (fields) => { await admin.req('/admin/employees?edit=new'); return admin.post('/admin/employees', fields); };

test('create employee: normalised mobile, new department, common password, audit', async () => {
  const r = await save(base);
  assert.equal(r.location, '/admin/employees');
  const e = await app.db.one("SELECT * FROM employees WHERE employee_code='EMP010'");
  assert.equal(e.mobile, '9988776655');
  assert.equal(e.mobile_login, '9988776655');
  assert.ok(e.password_hash);
  assert.equal((await app.db.one('SELECT department_name n FROM departments WHERE id=?', [e.department_id])).n, 'Housekeeping');
  const actions = (await app.db.rows('SELECT action,new_value FROM audit_logs ORDER BY id')).map((a) => a.action);
  assert.ok(actions.includes('employee_created') && actions.includes('employee_password_reset'));
  const created = await app.db.one("SELECT old_value,new_value FROM audit_logs WHERE action='employee_created'");
  assert.doesNotMatch(created.new_value + created.old_value, /password/);
  assert.match((await admin.req('/admin/employees')).text, /Employee saved\. Attendance history is preserved\./);
  // The new employee can log in with the common password.
  const emp = app.browser();
  assert.equal((await emp.login('employee', '9988776655', 'Staff@12345')).location, '/employee/dashboard');
});

test('duplicate employee code and duplicate mobile are rejected', async () => {
  let r = await save({ ...base, mobile: '9000000009' });
  assert.match(r.text, /That employee ID or mobile number is already in use\./);
  r = await save({ ...base, employee_code: 'EMP099', mobile: '09876543210' });
  assert.match(r.text, /already in use/);
  assert.match(r.text, /value="EMP099"/, 'submitted values are kept in the form');
});

test('validation: mobile, date, required fields, lengths', async () => {
  assert.match((await save({ ...base, employee_code: 'E1', mobile: '12345' })).text, /Enter a valid mobile number\./);
  assert.match((await save({ ...base, employee_code: 'E1', mobile: '9000000001', joining_date: '2026-02-30' })).text, /Enter a valid joining date\./);
  assert.match((await save({ ...base, employee_name: '' })).text, /Please enter a valid employee name\./);
  assert.match((await save({ ...base, employee_code: 'X'.repeat(21) })).text, /Please enter a valid employee code\./);
});

test('edit employee and reset password ends their sessions', async () => {
  const emp = await app.employee('9988776655');
  const id = (await app.db.one("SELECT id FROM employees WHERE employee_code='EMP010'")).id;
  await admin.req(`/admin/employees?edit=${id}`);
  const r = await admin.post('/admin/employees', { ...base, id: String(id), designation: 'Head Supervisor', reset_password: 'on' });
  assert.equal(r.status, 302);
  assert.equal((await app.db.one('SELECT designation d FROM employees WHERE id=?', [id])).d, 'Head Supervisor');
  assert.equal((await emp.req('/employee/dashboard')).location, '/login');
});

test('view employee page', async () => {
  const r = await admin.req('/admin/employee-view?id=1');
  assert.match(r.text, /EMPLOYEE PROFILE/);
  assert.match(r.text, /Asha Rao/);
  assert.match((await admin.req('/admin/employee-view?id=9999')).text, /Employee not found\./);
});

test('soft delete keeps attendance; restore returns the employee as inactive', async () => {
  await app.db.query("INSERT INTO meal_attendance(employee_id,meal_type_id,meal_date,source,status) VALUES(1,1,'2026-10-01','manual','valid')");
  await admin.req('/admin/employees');
  let r = await admin.post('/admin/employees', { id: '1', action: 'delete' });
  assert.equal(r.location, '/admin/employees');
  let e = await app.db.one('SELECT * FROM employees WHERE id=1');
  assert.ok(e.deleted_at);
  assert.equal(Number((await app.db.one('SELECT COUNT(*) n FROM meal_attendance WHERE employee_id=1')).n), 1);
  assert.match((await admin.req('/admin/employees?status=deleted')).text, /Asha Rao/);
  assert.match((await admin.post('/admin/employees', { ...base, id: '1', employee_code: 'EMP001', mobile: '9876543210' })).text, /Restore this deleted employee before editing their profile\./);
  r = await admin.post('/admin/employees', { id: '1', action: 'restore' });
  assert.equal(r.location, '/admin/employees?status=0');
  e = await app.db.one('SELECT * FROM employees WHERE id=1');
  assert.equal(e.deleted_at, null);
  assert.equal(Number(e.active), 0);
  const audits = (await app.db.rows("SELECT action FROM audit_logs WHERE action IN ('employee_deleted','employee_restored')")).map((a) => a.action);
  assert.deepEqual(audits, ['employee_deleted', 'employee_restored']);
});

test('employee photo upload: valid image stored as PNG; invalid rejected', async () => {
  const jpg = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#a52' } }).jpeg().toBuffer();
  const post = async (buf, name, type) => {
    await admin.req('/admin/employees?edit=1');
    const fd = new FormData();
    for (const [k, v] of Object.entries({ csrf: admin.csrf, id: '1', employee_name: 'Asha Rao', employee_code: 'EMP001', mobile: '9876543210', active: 'on' })) fd.append(k, v);
    fd.append('photo', new Blob([buf], { type }), name);
    return admin.req('/admin/employees', { method: 'POST', multipart: fd });
  };
  assert.equal((await post(jpg, '../../x.jpg', 'image/jpeg')).status, 302);
  assert.match((await app.db.one('SELECT photo FROM employees WHERE id=1')).photo, /^assets\/uploads\/[a-f0-9]{32}\.png$/);
  assert.match((await post(Buffer.from('<?php echo 1;'), 'x.png', 'image/png')).text, /Choose a JPG or PNG image up to 3000 × 3000 pixels\./);
  assert.match((await post(Buffer.alloc(2 * 1024 * 1024 + 10), 'x.png', 'image/png')).text, /Upload a JPG or PNG image smaller than 2 MB\./);
});

test('employee CSV export', async () => {
  const r = await admin.req('/admin/export_employees');
  assert.match(r.headers.get('content-disposition'), /employees\.csv/);
  assert.match(r.text, /^Name,"Employee ID",Department,Designation,Status\n/);
});
