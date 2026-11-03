'use strict';
const { startApp, ADMIN } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

let app;
test.before(async () => { app = await startApp(); });
test.after(() => app.stop());

test('admin login succeeds, regenerates the session, and audits', async () => {
  const b = app.browser();
  await b.req('/login');
  const before = b.cookie;
  const r = await b.post('/login', { role: 'admin', username: ADMIN.username, password: ADMIN.password });
  assert.equal(r.status, 302);
  assert.equal(r.location, '/admin/dashboard');
  assert.notEqual(b.cookie, before, 'session id must change on login');
  const page = await b.req('/admin/dashboard');
  assert.equal(page.status, 200);
  assert.match(page.text, /A good day starts with a good meal\./);
  const log = await app.db.one("SELECT * FROM audit_logs WHERE action='admin_login' ORDER BY id DESC LIMIT 1");
  assert.equal(log.admin_id, 1);
});

test('session cookie is httpOnly, SameSite=Lax, session-only', async () => {
  const b = app.browser();
  const r = await b.req('/login');
  const c = r.headers.getSetCookie().find((x) => x.startsWith('MJSESSION='));
  assert.match(c, /HttpOnly/i);
  assert.match(c, /SameSite=Lax/i);
  assert.doesNotMatch(c, /Expires|Max-Age/i);
});

test('incorrect password is refused with a generic message', async () => {
  const r = await app.browser().login('admin', ADMIN.username, 'wrong-password');
  assert.equal(r.status, 200);
  assert.match(r.text, /Login details are incorrect or your account is inactive/);
});

test('employee login works with a formatted mobile number and a PHP $2y$ hash', async () => {
  const b = app.browser();
  const r = await b.login('employee', '+91 98765 43210', 'Staff@12345');
  assert.equal(r.location, '/employee/dashboard');
  assert.match((await b.req('/employee/dashboard')).text, /Hello, Asha Rao\./);
});

test('inactive and deleted employees cannot log in', async () => {
  for (const mobile of ['9123456789', '8000000001']) {
    const r = await app.browser().login('employee', mobile, 'Staff@12345');
    assert.equal(r.status, 200);
    assert.match(r.text, /incorrect or your account is inactive/);
  }
});

test('logout requires POST + CSRF and ends the session', async () => {
  const b = await app.employee();
  assert.equal((await b.req('/logout')).status, 403);
  await b.req('/employee/dashboard'); // CSRF token is rotated at login
  const r = await b.post('/logout');
  assert.equal(r.location, '/login');
  assert.equal((await b.req('/employee/dashboard')).location, '/login');
});

test('unauthorised access is redirected / rejected by role', async () => {
  const anon = app.browser();
  assert.equal((await anon.req('/admin/employees')).location, '/login');
  const api = await anon.req('/api/dashboard-stats');
  assert.equal(api.status, 401);
  assert.equal(api.data.code, 'LOGIN_REQUIRED');
  const emp = await app.employee();
  assert.equal((await emp.req('/admin/dashboard')).location, '/login');
  const admin = await app.admin();
  assert.equal((await admin.req('/employee/dashboard')).location, '/login');
});

test('deactivating an employee ends their active session (session_version)', async () => {
  const emp = await app.employee();
  assert.equal((await emp.req('/employee/dashboard')).status, 200);
  await app.db.query('UPDATE employees SET session_version=session_version+1 WHERE id=1');
  assert.equal((await emp.req('/employee/dashboard')).location, '/login');
  const scan = await emp.req('/api/scan-meal', { method: 'POST', json: { token: 'x' } });
  assert.equal(scan.status, 401);
});

test('CSRF token is required on state-changing forms', async () => {
  const admin = await app.admin();
  const r = await admin.req('/admin/settings', { method: 'POST', form: { csrf: 'forged', company_name: 'X', qr_ttl: '45' } });
  assert.equal(r.status, 403);
  assert.equal((await app.db.one("SELECT setting_value v FROM system_settings WHERE setting_key='company_name'")).v, 'Medico Junction');
});

test('security headers match the PHP application', async () => {
  const r = await app.browser().req('/login');
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('referrer-policy'), 'same-origin');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-powered-by'), null);
});

test('login is rate limited per account (10 per 15 minutes)', async () => {
  let last;
  for (let i = 0; i < 11; i++) last = await app.browser().login('admin', 'nobody', 'bad');
  assert.equal(last.status, 429);
  assert.match(last.text, /Too many login attempts/);
});

test('old .php addresses redirect to clean addresses', async () => {
  const b = app.browser();
  for (const [from, to] of [['/employee/dashboard.php', '/employee/dashboard'], ['/login.php', '/login'], ['/index.php', '/'], ['/admin/reports.php?preset=month', '/admin/reports?preset=month'], ['/admin/attendance..php', '/admin/attendance']]) {
    const r = await b.req(from);
    assert.equal(r.status, 301, from);
    assert.equal(r.location, to, from);
  }
  // Old API addresses keep answering directly (cached counter screens / scanners).
  assert.equal((await b.req('/api/dashboard-stats.php')).status, 401);
  // No .php appears in any link of a rendered page.
  const admin = await app.admin();
  for (const p of ['/admin/dashboard', '/admin/employees', '/admin/reports', '/admin/meal-qr']) assert.doesNotMatch((await admin.req(p)).text, /\.php/, p);
  const emp = await app.employee();
  assert.doesNotMatch((await emp.req('/employee/dashboard')).text, /\.php/);
});
