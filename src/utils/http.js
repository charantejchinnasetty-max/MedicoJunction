'use strict';
const env = require('../config/env');

/** PHP http_build_query() for flat objects. */
function buildQuery(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    p.append(k, Array.isArray(v) ? String(v[v.length - 1]) : String(v));
  }
  return p.toString();
}

const url = (path) => env.basePath + path;
const isApi = (req) => (req.originalUrl || '').split('?')[0].includes('/api/');

/** PHP jsonResponse(): { success, code, message, data } */
function json(res, ok, code, message, data = {}, status = 200) {
  // PHP json_encode([]) is "[]"; keep the same wire format for empty data.
  const payload = data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0 ? [] : data;
  res.status(status).type('application/json; charset=utf-8').send(JSON.stringify({ success: ok, code, message, data: payload }));
}

/** PHP $_SESSION['flash'] */
function flash(req, message) {
  req.session.flash = message;
}

module.exports = { buildQuery, url, isApi, json, flash };
