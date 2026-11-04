'use strict';
const { isApi, json } = require('../utils/http');

function notFound(req, res) {
  if (isApi(req)) return json(res, false, 'NOT_FOUND', 'This endpoint does not exist.', {}, 404);
  res.status(404).type('text/html; charset=utf-8')
    .send('<!doctype html><meta name="viewport" content="width=device-width"><h1>Page not found</h1><p>The page you requested does not exist.</p>');
}

// Database connection problems (wrong DB_* settings, database offline): say so, with the
// error code, so the person deploying can fix the settings. No hosts or passwords are shown.
const DB_CONNECTION_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNRESET', 'EHOSTUNREACH',
  'ER_ACCESS_DENIED_ERROR', 'ER_ACCESS_DENIED_NO_PASSWORD_ERROR', 'ER_BAD_DB_ERROR', 'ER_DBACCESS_DENIED_ERROR',
  'HANDSHAKE_SSL_ERROR', 'HANDSHAKE_NO_SSL_SUPPORT', 'PROTOCOL_CONNECTION_LOST', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID']);
const isDbConnectionError = (err) => Boolean(err && (DB_CONNECTION_CODES.has(err.code) || (err.fatal && err.syscall)));

/** PHP set_exception_handler: log details, show a generic message (never SQL errors). */
function errorHandler(err, req, res, next) {
  if (err && (err.type === 'entity.too.large' || err.type === 'entity.parse.failed') && isApi(req)) {
    return json(res, false, 'INVALID_REQUEST', 'The request could not be read.', {}, 400);
  }
  console.error(err);
  if (res.headersSent) return res.end();
  if (isApi(req)) return json(res, false, 'SERVER_ERROR', 'We could not complete this request. Please try again.', {}, 500);
  if (isDbConnectionError(err)) {
    return res.status(503).type('text/html; charset=utf-8')
      .send(`<!doctype html><meta name="viewport" content="width=device-width"><h1>Database unavailable</h1><p>The app could not connect to its MySQL database (${String(err.code || 'connection error').replace(/[^A-Z0-9_]/gi, '')}). Check the DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD and DB_SSL settings, and that the database is running.</p>`);
  }
  res.status(500).type('text/html; charset=utf-8')
    .send('<!doctype html><meta name="viewport" content="width=device-width"><h1>Temporarily unavailable</h1><p>Please try again. Your request could not be completed.</p>');
}

module.exports = { notFound, errorHandler, isDbConnectionError };
