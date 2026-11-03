'use strict';
const time = require('../utils/time');
const { ValidationError } = require('../utils/errors');
const { json } = require('../utils/http');
const { intval } = require('../utils/validation');
const reports = require('../services/reports');
const { issueToken } = require('../services/qr');
const { recordMeal } = require('../services/attendance');
const { queryOf } = require('./adminController');

/** Body of /api/scan-meal.php: JSON { token }. Anything else is simply an invalid token. */
function readScanBody(req, res, next) {
  let token = '';
  try {
    const body = typeof req.body === 'string' && req.body !== '' ? JSON.parse(req.body) : null;
    if (body && typeof body === 'object' && typeof body.token === 'string') token = body.token;
  } catch { /* invalid JSON → empty token → INVALID_QR */ }
  req.scanToken = token;
  next();
}

/** PHP api.php scan-meal */
async function scanMeal(req, res) {
  const result = await recordMeal(Number(req.user.id), req.scanToken);
  json(res, result.success, result.code, result.message, result.data || {}, result.success ? 200 : 409);
}

/** PHP api.php qr-token */
async function qrToken(req, res) {
  json(res, true, 'QR_READY', 'Counter QR refreshed.', await issueToken());
}

function filtersOr422(req, res) {
  try {
    return reports.filters(queryOf(req));
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    json(res, false, 'INVALID_FILTER', err.message, {}, 422);
    return null;
  }
}

/** PHP api.php dashboard-stats: selected range plus the last 7 days for the week chart. */
async function dashboardStats(req, res) {
  const f = filtersOr422(req, res);
  if (!f) return;
  const d = await reports.dashboardData(f);
  const today = time.today();
  const week = { ...f, from: time.ymd(time.addDays(today, -6)), to: time.ymd(today) };
  d.week = (await reports.dashboardData(week)).daily;
  json(res, true, 'STATS_READY', 'Statistics loaded.', d);
}

/** PHP api.php reports */
async function reportsApi(req, res) {
  const f = filtersOr422(req, res);
  if (!f) return;
  const page = Math.max(1, req.query.page === undefined ? 1 : intval(req.query.page));
  json(res, true, 'REPORT_READY', 'Report loaded.', { totals: await reports.totals(f), rows: await reports.attendanceRows(f, page) });
}

function notFound(req, res) {
  json(res, false, 'NOT_FOUND', 'This endpoint does not exist.', {}, 404);
}

module.exports = { readScanBody, scanMeal, qrToken, dashboardStats, reportsApi, notFound };
