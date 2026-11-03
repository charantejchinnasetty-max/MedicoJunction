'use strict';
const { isApi, json } = require('../utils/http');

function notFound(req, res) {
  if (isApi(req)) return json(res, false, 'NOT_FOUND', 'This endpoint does not exist.', {}, 404);
  res.status(404).type('text/html; charset=utf-8')
    .send('<!doctype html><meta name="viewport" content="width=device-width"><h1>Page not found</h1><p>The page you requested does not exist.</p>');
}

/** PHP set_exception_handler: log details, show a generic message (never SQL errors). */
function errorHandler(err, req, res, next) {
  if (err && (err.type === 'entity.too.large' || err.type === 'entity.parse.failed') && isApi(req)) {
    return json(res, false, 'INVALID_REQUEST', 'The request could not be read.', {}, 400);
  }
  console.error(err);
  if (res.headersSent) return res.end();
  if (isApi(req)) return json(res, false, 'SERVER_ERROR', 'We could not complete this request. Please try again.', {}, 500);
  res.status(500).type('text/html; charset=utf-8')
    .send('<!doctype html><meta name="viewport" content="width=device-width"><h1>Temporarily unavailable</h1><p>Please try again. Your request could not be completed.</p>');
}

module.exports = { notFound, errorHandler };
