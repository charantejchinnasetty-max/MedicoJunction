'use strict';
const { startApp, openAllDay } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

let app;
let admin;
let emp;
let qr;
let attendance;
let time;
test.before(async () => {
  app = await startApp();
  qr = require('../src/services/qr');
  attendance = require('../src/services/attendance');
  time = require('../src/utils/time');
  admin = await app.admin();
  emp = await app.employee();
  await admin.req('/admin/meal-qr.php');
  await emp.req('/employee/scan.php');
});
test.after(() => app.stop());

const issue = async () => (await admin.req('/api/qr-token.php', { method: 'POST', headers: { 'X-CSRF-Token': admin.csrf } })).data.data;
const scan = (token, b = emp) => b.req('/api/scan-meal.php', { method: 'POST', json: { token } });

test('QR token: format, TTL from settings, server-side registration', async () => {
  await app.db.query("UPDATE system_settings SET setting_value='45' WHERE setting_key='qr_ttl'");
  const t = await issue();
  assert.match(t.token, /^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/);
  assert.equal(t.ttl, 45);
  assert.equal(t.expires_at - t.server_time, 45);
  assert.equal(Number((await app.db.one('SELECT COUNT(*) n FROM qr_tokens')).n), 1);
  assert.ok(t.service.message);
});

test('QR endpoint requires admin + CSRF', async () => {
  assert.equal((await admin.req('/api/qr-token.php')).status, 403);
  assert.equal((await emp.req('/api/qr-token.php', { method: 'POST', headers: { 'X-CSRF-Token': emp.csrf } })).status, 401);
});

test('valid scan records the open meal once; second scan is a duplicate', async () => {
  await openAllDay(app.db, 2);
  const { token } = await issue();
  let r = await scan(token);
  assert.equal(r.status, 200);
  assert.equal(r.data.code, 'MEAL_RECORDED');
  assert.equal(r.data.message, 'Lunch recorded successfully. Enjoy your meal!');
  assert.equal(r.data.data.employee, 'Asha Rao');
  const row = await app.db.one('SELECT * FROM meal_attendance WHERE employee_id=1');
  assert.equal(row.source, 'scan');
  assert.ok(row.qr_token_id && row.scan_timestamp);
  r = await scan(token);
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'ALREADY_RECORDED');
  assert.match(r.data.message, /^Lunch already recorded today at \d{1,2}:\d{2} (AM|PM)\.$/);
});

test('simultaneous scans record exactly one meal', async () => {
  await app.db.query('DELETE FROM meal_attendance');
  const { token } = await qr.issueToken();
  const results = await Promise.all(Array.from({ length: 8 }, () => attendance.recordMeal(1, token)));
  assert.equal(results.filter((r) => r.code === 'MEAL_RECORDED').length, 1);
  assert.ok(results.every((r) => ['MEAL_RECORDED', 'ALREADY_RECORDED'].includes(r.code)));
  assert.equal(Number((await app.db.one('SELECT COUNT(*) n FROM meal_attendance')).n), 1);
});

test('invalid, tampered and unregistered tokens are rejected', async () => {
  const { token } = await qr.issueToken();
  const now = time.now();
  assert.equal((await scan('not-a-token')).data.code, 'INVALID_QR');
  assert.equal((await attendance.recordMeal(1, token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a'), now)).message, 'Invalid QR. Scan the Medico Junction counter QR.');
  await app.db.query('UPDATE qr_tokens SET status=0');
  assert.equal((await attendance.recordMeal(1, token, now)).message, 'QR is no longer valid. Scan the latest counter QR.');
  const bad = await emp.req('/api/scan-meal.php', { method: 'POST', body: 'garbage', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': emp.csrf } });
  assert.equal(bad.data.code, 'INVALID_QR');
});

test('expired QR is rejected (test clock)', async () => {
  const { token } = await qr.issueToken();
  const later = new Date(Date.now() + 61 * 1000);
  const r = await attendance.recordMeal(1, token, later);
  assert.equal(r.code, 'QR_EXPIRED');
  assert.equal(r.message, 'QR expired. Please scan the latest QR displayed at the counter.');
});

test('meal outside allowed time and inactive meals are rejected', async () => {
  await app.db.query('DELETE FROM meal_attendance');
  // All meals active, but every window is over for the day.
  await app.db.query("UPDATE meal_types SET status=1, end_inclusive=0, start_time=CASE id WHEN 1 THEN '00:00:00' WHEN 2 THEN '00:00:02' ELSE '00:00:04' END, end_time=CASE id WHEN 1 THEN '00:00:01' WHEN 2 THEN '00:00:03' ELSE '00:00:05' END");
  let r = await attendance.recordMeal(1, (await qr.issueToken()).token);
  assert.equal(r.code, 'MEAL_CLOSED');
  assert.equal(r.message, 'Dinner service is closed for today.');
  // An all-day meal that has been switched off is not open either.
  await openAllDay(app.db, 2);
  await app.db.query('UPDATE meal_types SET status=0 WHERE id=2');
  r = await attendance.recordMeal(1, (await qr.issueToken()).token);
  assert.equal(r.code, 'MEAL_CLOSED');
  assert.equal(Number((await app.db.one('SELECT COUNT(*) n FROM meal_attendance')).n), 0);
});

test('inactive employee cannot scan', async () => {
  await openAllDay(app.db, 2);
  const { token } = await qr.issueToken();
  await app.db.query('UPDATE employees SET active=0 WHERE id=1');
  const r = await attendance.recordMeal(1, token);
  assert.equal(r.code, 'ACCOUNT_UNAVAILABLE');
  await app.db.query('UPDATE employees SET active=1 WHERE id=1');
});

test('manual attendance, correction, void, duplicate prevention, admin review', async () => {
  await app.db.query('DELETE FROM meal_attendance');
  await openAllDay(app.db, 2);
  const today = time.ymd(time.now());
  await admin.req('/admin/attendance.php?correct=new');
  // reason is mandatory and meaningful
  assert.match((await admin.post('/admin/attendance.php', { id: '0', employee_id: '1', meal_type_id: '2', meal_date: today, action: 'save', reason: 'short' })).text, /at least 8 characters/);
  // future dates are not allowed
  assert.match((await admin.post('/admin/attendance.php', { id: '0', employee_id: '1', meal_type_id: '2', meal_date: '2099-01-01', action: 'save', reason: 'Future attempt' })).text, /today or earlier/);
  // add missed meal
  let r = await admin.post('/admin/attendance.php', { id: '0', employee_id: '1', meal_type_id: '2', meal_date: today, action: 'save', reason: 'Scanner was offline' });
  assert.equal(r.location, `/admin/attendance.php?preset=custom&from=${today}&to=${today}`);
  const row = await app.db.one('SELECT * FROM meal_attendance WHERE employee_id=1');
  assert.equal(row.source, 'manual');
  // duplicate manual entry
  await admin.req('/admin/attendance.php?correct=new');
  assert.match((await admin.post('/admin/attendance.php', { id: '0', employee_id: '1', meal_type_id: '2', meal_date: today, action: 'save', reason: 'Second attempt here' })).text, /already has this meal on this date/);
  // QR scan sees the manual record as a duplicate with unknown time
  const { token } = await issue();
  r = await scan(token);
  assert.equal(r.data.code, 'ALREADY_RECORDED');
  assert.match(r.data.message, /an unknown time \(legacy attendance\)/);
  // void → scan needs admin review
  await admin.req(`/admin/attendance.php?correct=${row.id}`);
  r = await admin.post('/admin/attendance.php', { id: String(row.id), employee_id: '1', meal_type_id: '2', meal_date: today, action: 'void', reason: 'Recorded by mistake' });
  assert.equal(r.status, 302);
  assert.equal((await app.db.one('SELECT status FROM meal_attendance WHERE id=?', [row.id])).status, 'void');
  assert.equal((await scan(token)).data.code, 'ADMIN_REVIEW');
  // edit correction restores it, changing the meal
  await admin.post('/admin/attendance.php', { id: String(row.id), employee_id: '1', meal_type_id: '3', meal_date: today, action: 'save', reason: 'It was actually dinner' });
  const fixed = await app.db.one('SELECT * FROM meal_attendance WHERE id=?', [row.id]);
  assert.equal(fixed.status, 'valid');
  assert.equal(Number(fixed.meal_type_id), 3);
  const audits = await app.db.rows("SELECT action,reason,old_value FROM audit_logs WHERE action LIKE 'attendance_%' ORDER BY id");
  assert.deepEqual(audits.map((a) => a.action), ['attendance_save', 'attendance_void', 'attendance_save']);
  assert.equal(audits[1].reason, 'Recorded by mistake');
  assert.notEqual(audits[1].old_value, 'null');
  // void without a record is refused (PHP would have inserted a new row)
  await admin.req('/admin/attendance.php?correct=new');
  assert.match((await admin.post('/admin/attendance.php', { id: '0', employee_id: '1', meal_type_id: '1', meal_date: today, action: 'void', reason: 'Nothing to void' })).text, /existing attendance record to void/);
});

test('scan endpoint is rate limited per employee (12 per minute)', async () => {
  await app.db.query('UPDATE employees SET active=1 WHERE id=2');
  const other = await app.employee('9123456789');
  await other.req('/employee/scan.php');
  let last;
  for (let i = 0; i < 13; i++) last = await scan('x', other);
  assert.equal(last.status, 429);
  assert.equal(last.data.code, 'RATE_LIMITED');
});

test('employee pages show today\'s meals and history', async () => {
  const dash = await emp.req('/employee/dashboard.php');
  assert.match(dash.text, /Today’s meals/);
  const hist = await emp.req('/employee/history.php');
  assert.match(hist.text, /Day by day/);
});
