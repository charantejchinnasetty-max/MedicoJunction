'use strict';
const path = require('path');
const express = require('express');
const env = require('./config/env');
const { securityHeaders, noStore } = require('./middleware/security');
const { sessionMiddleware } = require('./middleware/session');
const { ensureCsrfToken } = require('./middleware/csrf');
const { notFound, errorHandler } = require('./middleware/errors');
const { helpers } = require('./utils/view');
const routes = require('./routes');
const { serveUploadedImage } = require('./services/images');

const ASSETS = path.join(env.ROOT, 'assets');

/** Uploaded files: only generated image names are served (PHP assets/uploads/.htaccess). */
function guardAssets(req, res, next) {
  const p = decodeURIComponent(req.path);
  if (/\.(php[0-9]?|phtml|phar)$/i.test(p) || p.split('/').some((s) => s.startsWith('.'))) return notFound(req, res);
  if (p.startsWith('/uploads/') && !/^\/uploads\/[A-Za-z0-9_-]+\.(png|jpe?g)$/i.test(p)) return notFound(req, res);
  next();
}

/**
 * Old addresses from the PHP version (/admin/employees.php, /login.php, /index.php …).
 * Pages redirect permanently to the clean address; API calls and form posts are served
 * directly so cached pages and the counter screen keep working during the switch-over.
 */
function legacyPhpUrls(req, res, next) {
  const m = /^(.*?)\.+php$/i.exec(req.path);
  if (!m) return next();
  let clean = m[1];
  if (clean === '' || clean === '/' || clean === '/index') clean = '/';
  const i = req.url.indexOf('?');
  const query = i === -1 ? '' : req.url.slice(i);
  if ((req.method === 'GET' || req.method === 'HEAD') && !clean.startsWith('/api/')) {
    return res.redirect(301, `${env.basePath}${clean}${query}`);
  }
  req.url = clean + query;
  next();
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.trustProxy);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  Object.assign(app.locals, helpers);

  app.use(securityHeaders);

  const mount = env.basePath || '/';
  // Uploaded images kept in the database (Vercel); files on disk fall through to static below.
  app.get(`${env.basePath}/assets/uploads/:file`, serveUploadedImage);
  // Static frontend (CSS, JS, images, vendor libraries, uploads) — unchanged files.
  // On Vercel these are served by its CDN from public/assets (see scripts/vercel-build.js).
  app.use(`${env.basePath}/assets`, guardAssets, express.static(ASSETS, { index: false, dotfiles: 'deny', fallthrough: false, maxAge: env.isProd ? '1h' : 0 }));

  app.use(mount, legacyPhpUrls);
  app.use(mount, noStore);
  app.use(mount, express.urlencoded({ extended: false, limit: '100kb', parameterLimit: 200 }));
  app.use(mount, sessionMiddleware);
  app.use(mount, ensureCsrfToken);
  app.use(mount, routes);

  if (env.basePath) app.get('/', (req, res) => res.redirect(`${env.basePath}/`));
  app.use(notFound);
  app.use((err, req, res, next) => {
    // express.static with fallthrough:false reports missing assets as 404 errors.
    if (err && err.status === 404) return notFound(req, res);
    return errorHandler(err, req, res, next);
  });
  return app;
}

module.exports = { createApp };
