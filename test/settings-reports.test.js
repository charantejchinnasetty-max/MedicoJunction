'use strict';
const { startApp } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');

let app;
let admin;
test.before(async () => { app = await startApp(); admin = await app.admin(); });
test.after(() => app.stop());

const timings = (o = {}) => ({ 'start[1]': '06:00', 'end[1]': '11:00', 'active[1]': 'on', 'start[2]': '12:00:00', 'end[2]': '15:00:00', 'active[2]': 'on', 'inclusive[2]': 'on', 'start[3]': '19:00:00', 'end[3]': '23:30:00', 'active[3]': 'on', 'inclusive[3]': 'on', ...o });

test('change meal timing (applies immediately) and reject overlaps', async () => {
  await admin.req('/admin/meal-settings');
  let r = await admin.post('/admin/meal-settings', timings({ 'end[2]': '15:30:00', 'inclusive[3]': undefined }));
  assert.equal(r.location, '/admin/meal-settings');
  const lunch = await app.db.one('SELECT * FROM meal_types WHERE id=2');
  assert.equal(lunch.end_time, '15:30:00');
  assert.equal(Number((await app.db.one('SELECT end_inclusive e FROM meal_types WHERE id=3')).e), 0);
  r = await admin.post('/admin/meal-settings', timings({ 'end[1]': '12:30' }));
  assert.match(r.text, /Active meal windows must not overlap\./);
  r = await admin.post('/admin/meal-settings', timings({ 'active[2]': undefined, 'end[1]': '12:30' }));
  assert.equal(r.status, 302, 'inactive meals may overlap');
  assert.ok(await app.db.one("SELECT id FROM audit_logs WHERE action='meal_timings_changed'"));
});

test('change QR TTL with 30–60 s bounds', async () => {
  await admin.req('/admin/settings');
  assert.match((await admin.post('/admin/settings', { company_name: 'Medico Junction', qr_ttl: '10' })).text, /between 30 and 60 seconds/);
  const r = await admin.post('/admin/settings', { company_name: 'Medico Junction Hyderabad', qr_ttl: '30' });
  assert.equal(r.location, '/admin/settings');
  assert.equal((await app.db.one("SELECT setting_value v FROM system_settings WHERE setting_key='qr_ttl'")).v, '30');
  const page = await admin.req('/admin/settings');
  assert.match(page.text, /Company settings saved\./);
  assert.match(page.text, /<title>Settings · Medico Junction Hyderabad<\/title>/);
  const log = await app.db.one("SELECT old_value FROM audit_logs WHERE action='settings_changed'");
  assert.doesNotMatch(log.old_value, /employee_default_password_hash/);
});

test('upload logo', async () => {
  const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: '#2a7' } }).png().toBuffer();
  await admin.req('/admin/settings');
  const fd = new FormData();
  fd.append('csrf', admin.csrf); fd.append('company_name', 'Medico Junction'); fd.append('qr_ttl', '60');
  fd.append('logo', new Blob([png], { type: 'image/png' }), 'logo.png');
  assert.equal((await admin.req('/admin/settings', { method: 'POST', multipart: fd })).status, 302);
  const logo = (await app.db.one("SELECT setting_value v FROM system_settings WHERE setting_key='logo'")).v;
  assert.match(logo, /^assets\/uploads\/[a-f0-9]{32}\.png$/);
  assert.match((await admin.req('/admin/dashboard')).text, new RegExp(`src="/${logo}"`));
  assert.equal((await admin.req(`/${logo}`)).status, 200);
});

test('meal rates: save, validate, history kept', async () => {
  await admin.req('/admin/meal_prices');
  assert.match((await admin.post('/admin/meal_prices', { month: '2026-11', breakfast_rate: '-1', lunch_rate: '1', dinner_rate: '1' })).text, /non-negative meal rates/);
  assert.match((await admin.post('/admin/meal_prices', { month: '2026-11', breakfast_rate: 'abc', lunch_rate: '1', dinner_rate: '1' })).text, /non-negative meal rates/);
  assert.match((await admin.post('/admin/meal_prices', { month: '2026-13', breakfast_rate: '1', lunch_rate: '1', dinner_rate: '1' })).text, /Choose a valid month\./);
  await admin.post('/admin/meal_prices', { month: '2026-10', breakfast_rate: '20', lunch_rate: '40', dinner_rate: '35' });
  const r = await admin.post('/admin/meal_prices', { month: '2026-10', breakfast_rate: '30', lunch_rate: '60.555', dinner_rate: '50' });
  assert.equal(r.location, '/admin/meal_prices?month=2026-10');
  assert.equal(Number((await app.db.one("SELECT COUNT(*) n FROM meal_prices WHERE month_year='2026-10'")).n), 2);
  const page = await admin.req('/admin/meal_prices?month=2026-10');
  assert.match(page.text, /Rates for October 2026/);
  assert.match(page.text, /name="lunch_rate"[^>]*value="60.56"/);
});

test('reports: date filtering, totals, costs, missing rates, CSV', async () => {
  const add = (e, m, d) => app.db.query("INSERT INTO meal_attendance(employee_id,meal_type_id,meal_date,source,status) VALUES(?,?,?,'manual','valid')", [e, m, d]);
  await add(1, 1, '2026-10-05'); await add(1, 2, '2026-10-05'); await add(1, 3, '2026-10-06');
  await add(2, 2, '2026-10-07');
  await add(1, 2, '2026-09-30'); // September has no rates
  await app.db.query("INSERT INTO meal_attendance(employee_id,meal_type_id,meal_date,source,status) VALUES(2,1,'2026-10-07','manual','void')");
  const q = '?preset=custom&from=2026-10-01&to=2026-10-31';
  const api = (await admin.req(`/api/reports${q}`)).data.data;
  assert.deepEqual(api.totals.map((t) => t.count), [1, 2, 1], 'void records are excluded');
  assert.equal(api.rows.length, 4);
  const page = await admin.req(`/admin/reports${q}`);
  // Asha: 30 + 60.56 + 50 = 140.56 ; Bala: 60.56 ; total 201.12
  assert.match(page.text, /₹140\.56/);
  assert.match(page.text, /₹201\.12/);
  const sept = await admin.req('/admin/reports?preset=custom&from=2026-09-01&to=2026-09-30');
  assert.match(sept.text, /1 meals have no rate configured/);
  const filtered = (await admin.req(`/api/reports${q}&employee=2&meal=2`)).data.data;
  assert.equal(filtered.rows.length, 1);
  const csvRes = await admin.req(`/admin/export_report${q}`);
  assert.match(csvRes.headers.get('content-disposition'), /medico-junction-summary-2026-10-01\.csv/);
  assert.match(csvRes.text, /"Asha Rao",EMP001,1,1,1,3,140\.56,0/);
  const detail = await admin.req(`/admin/export_report${q}&view=detail`);
  assert.match(detail.text, /Employee,"Employee ID",Department,Date,Meal,"Scan time IST",Source,Status/);
  assert.ok(await app.db.one("SELECT id FROM audit_logs WHERE action='report_exported'"));
  assert.equal((await admin.req('/api/reports?preset=custom&from=bad')).status, 422);
});

test('dashboard statistics', async () => {
  const r = await admin.req('/api/dashboard-stats?preset=custom&from=2026-10-01&to=2026-10-31');
  const d = r.data.data;
  assert.equal(r.data.code, 'STATS_READY');
  assert.equal(d.active_employees, 1);
  assert.equal(d.employees, 2);
  assert.equal(d.totals.reduce((s, t) => s + t.count, 0), 4);
  assert.ok(Array.isArray(d.week) && Array.isArray(d.daily) && d.recent.length <= 6);
  assert.match((await admin.req('/admin/dashboard?preset=month')).text, /At a glance/);
});

test('activity log page lists audited actions', async () => {
  const r = await admin.req('/admin/audit');
  assert.match(r.text, /settings changed/);
  assert.match(r.text, /meal rates changed/);
  assert.doesNotMatch(r.text, /\$2[aby]\$/, 'no password hashes in the audit page');
});
