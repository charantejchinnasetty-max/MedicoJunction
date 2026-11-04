'use strict';
// Vercel support: uploads kept in the database, the static-file build step, and the
// configuration checks of the Vercel entry point.
process.env.UPLOAD_STORAGE = 'database';
const { startApp } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
let app;
test.before(async () => { app = await startApp(); });
test.after(async () => { await app.stop(); });

test('uploads are stored in the database, scaled down, and served', async () => {
  const admin = await app.admin();
  await admin.req('/admin/settings');
  const jpg = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#3a7' } }).jpeg().toBuffer();
  const fd = new FormData();
  for (const [k, v] of Object.entries({ csrf: admin.csrf, company_name: 'Medico Junction', qr_ttl: '60' })) fd.append(k, v);
  fd.append('logo', new Blob([jpg], { type: 'image/jpeg' }), 'logo.jpg');
  assert.equal((await admin.req('/admin/settings', { method: 'POST', multipart: fd })).status, 302);

  const logo = (await app.db.one("SELECT setting_value v FROM system_settings WHERE setting_key='logo'")).v;
  const name = path.basename(logo);
  assert.equal(fs.existsSync(path.join(ROOT, logo)), false, 'nothing written to disk');
  const row = await app.db.one('SELECT mime, data FROM uploaded_files WHERE name=?', [name]);
  assert.equal(row.mime, 'image/png');
  const meta = await sharp(row.data).metadata();
  assert.equal(meta.format, 'png');
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 800);

  const res = await fetch(`${app.origin}/${logo}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(row.data));
  // Unknown or malformed names are 404s.
  assert.equal((await fetch(`${app.origin}/assets/uploads/${'0'.repeat(32)}.png`)).status, 404);
  assert.equal((await fetch(`${app.origin}/assets/uploads/x.php`)).status, 404);
});

test('vercel-build copies the frontend to public/assets without uploads or dotfiles', () => {
  const out = path.join(ROOT, 'public');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'vercel-build.js')], { stdio: 'pipe' });
  try {
    assert.ok(fs.existsSync(path.join(out, 'assets', 'css', 'medico.css')));
    assert.ok(fs.existsSync(path.join(out, 'assets', 'js', 'medico.js')));
    assert.equal(fs.existsSync(path.join(out, 'assets', 'uploads')), false);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('Vercel entry point explains missing settings instead of crashing', async () => {
  const script = `
    const h = require(${JSON.stringify(path.join(ROOT, 'api', 'index.js'))});
    const res = { setHeader() {}, end(body) { console.log(this.statusCode + ' ' + body.split('\\n')[0]); } };
    h({ url: '/', method: 'GET', headers: {} }, res);`;
  const env = { ...process.env, VERCEL: '1', NODE_ENV: 'production', QR_SECRET: '', SESSION_SECRET: 'x'.repeat(48), BASE_PATH: '' };
  const r = spawnSync(process.execPath, ['-e', script], { env, encoding: 'utf8' });
  assert.match(r.stdout, /^500 Configuration error: QR_SECRET must be set on Vercel/);

  const ok = spawnSync(process.execPath, ['-e', `const h = require(${JSON.stringify(path.join(ROOT, 'api', 'index.js'))}); console.log(typeof h, typeof h.handle); process.exit(0);`],
    { env: { ...env, QR_SECRET: 'b'.repeat(64) }, encoding: 'utf8' });
  assert.equal(ok.stdout.trim(), 'function function', ok.stderr);
});
