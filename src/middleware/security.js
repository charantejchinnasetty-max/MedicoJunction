'use strict';
const helmet = require('helmet');
const env = require('../config/env');

// Same Content-Security-Policy and headers the PHP bootstrap sent.
const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      mediaSrc: ["'self'", 'blob:'],
      connectSrc: ["'self'"],
      workerSrc: ["'self'", 'blob:'],
      frameAncestors: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  frameguard: { action: 'sameorigin' },
  referrerPolicy: { policy: 'same-origin' },
  crossOriginEmbedderPolicy: false,
  strictTransportSecurity: env.isProd ? { maxAge: 15552000 } : false,
});

/** Dynamic responses must never be cached (PHP: Cache-Control: no-store). */
function noStore(req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

module.exports = { securityHeaders, noStore };
