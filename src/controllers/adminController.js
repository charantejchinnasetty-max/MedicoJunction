'use strict';
const { one } = require('../config/database');
const time = require('../utils/time');
const { ValidationError } = require('../utils/errors');
const { flash, url } = require('../utils/http');
const { render } = require('../utils/view');
const { intval, str, validDate } = require('../utils/validation');
const reports = require('../services/reports');
const employees = require('../services/employees');
const meals = require('../services/meals');
const prices = require('../services/prices');
const settings = require('../services/settings');
const attendance = require('../services/attendance');
const { listAudit } = require('../services/audit');

/** Current flat query string values (PHP $_GET). */
const queryOf = (req) => {
  const out = {};
  for (const [k, v] of Object.entries(req.query || {})) out[k] = str(v);
  return out;
};

/**
 * Shared page context (PHP admin-pages.php preamble): filters with the page's default
 * preset. An invalid range shows its message and falls back to today with $_GET cleared.
 */
async function context(req, fallback = 'today') {
  let query = queryOf(req);
  let filterError = null;
  let f;
  try {
    f = reports.filters(query, null, fallback);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    filterError = err.message;
    query = {};
    f = reports.filters({});
  }
  return {
    query,
    filterError,
    f,
    meals: await meals.getMeals(),
    settings: await settings.getPublicSettings(),
    employeeOptions: await employees.employeeOptions(),
    departmentOptions: await employees.departmentOptions(),
  };
}

const errorOf = (ctx, opts) => ctx.filterError ?? opts.error ?? '';

/**
 * Run a POST action; on a validation problem re-render the same page with the message and
 * the submitted values (PHP: catch InvalidArgumentException → $error).
 */
function postAction(action, page) {
  return async (req, res) => {
    try {
      await action(req, res);
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      await page(req, res, { error: err.message, posted: true });
    }
  };
}

/* ---------- pages ---------- */

async function dashboard(req, res, opts = {}) {
  const ctx = await context(req);
  render(req, res, 'admin/dashboard', { ...ctx, error: errorOf(ctx, opts), d: await reports.dashboardData(ctx.f) });
}

async function attendancePage(req, res, opts = {}) {
  const ctx = await context(req);
  const { query, f } = ctx;
  let form = null;
  if (query.correct !== undefined || opts.posted) {
    const body = opts.posted ? req.body || {} : {};
    const id = intval(body.id ?? query.correct);
    const record = id ? await one('SELECT * FROM meal_attendance WHERE id=?', [id]) : null;
    const values = {};
    for (const k of ['employee_id', 'meal_date', 'reason']) if (body[k] !== undefined) values[k] = str(body[k]);
    form = { id, record, values };
  }
  const count = await reports.countAttendance(f);
  const pages = Math.max(1, Math.ceil(count / reports.PAGE_SIZE));
  const page = Math.max(1, Math.min(pages, query.page === undefined ? 1 : intval(query.page)));
  const sort = query.sort ?? 'date';
  const dir = query.dir ?? 'desc';
  render(req, res, 'admin/attendance', {
    ...ctx,
    error: errorOf(ctx, opts),
    form,
    today: time.ymd(time.now()),
    counts: await reports.totals(f, ctx.meals),
    count,
    pages,
    page,
    sort,
    dir,
    rows: await reports.attendanceRows(f, page, sort, dir),
  });
}

async function employeesPage(req, res, opts = {}) {
  const ctx = await context(req);
  const { query } = ctx;
  const body = req.body || {};
  let form = null;
  if (query.edit !== undefined || (opts.posted && (str(body.action) ?? 'save') === 'save')) {
    const id = intval(opts.posted ? body.id ?? query.edit : query.edit);
    let values = id ? (await employees.getEmployee(id)) || {} : {};
    if (opts.posted) {
      const posted = {};
      for (const [k, v] of Object.entries(body)) posted[k] = str(v);
      values = { ...values, ...posted };
    }
    form = { id, values };
  }
  const q = (query.q ?? '').trim().slice(0, 100);
  const status = query.status ?? 'all';
  render(req, res, 'admin/employees', { ...ctx, error: errorOf(ctx, opts), form, q, status, list: await employees.listEmployees(q, status) });
}

async function employeeView(req, res, opts = {}) {
  const ctx = await context(req);
  const r = await employees.getEmployee(intval(ctx.query.id));
  let counts = [];
  if (r) {
    const n = time.now();
    const f = { ...ctx.f, employee: r.id, preset: 'month', from: time.format(n, 'Y-m-01'), to: time.format(n, 'Y-m-t') };
    counts = await reports.totals(f, ctx.meals);
  }
  render(req, res, 'admin/employee-view', { ...ctx, error: errorOf(ctx, opts), r, counts });
}

async function reportsPage(req, res, opts = {}) {
  const ctx = await context(req, 'month');
  const { f, query } = ctx;
  const view = query.view === 'detail' ? 'detail' : 'summary';
  const locals = { ...ctx, error: errorOf(ctx, opts), view, counts: await reports.totals(f, ctx.meals), detailRows: [], summary: null };
  if (view === 'detail') {
    locals.detailRows = await reports.attendanceRows(f);
  } else {
    const list = await reports.summaryRows(f);
    const summary = { list, grand: 0, amount: 0, missing: 0, cols: {} };
    for (const r of list) {
      summary.grand += r.total;
      summary.amount += r.amount;
      summary.missing += r.missing_rates;
      for (const m of ctx.meals) summary.cols[m.id] = (summary.cols[m.id] || 0) + (r.counts[m.id] || 0);
    }
    locals.summary = summary;
  }
  render(req, res, 'admin/reports', locals);
}

async function mealSettingsPage(req, res, opts = {}) {
  const ctx = await context(req);
  render(req, res, 'admin/meal-settings', { ...ctx, error: errorOf(ctx, opts) });
}

async function settingsPage(req, res, opts = {}) {
  const ctx = await context(req);
  render(req, res, 'admin/settings', { ...ctx, error: errorOf(ctx, opts) });
}

async function mealPricesPage(req, res, opts = {}) {
  const ctx = await context(req);
  let month = ctx.query.month ?? time.format(time.now(), 'Y-m');
  if (!validDate(`${month}-01`)) month = time.format(time.now(), 'Y-m');
  render(req, res, 'admin/meal-prices', { ...ctx, error: errorOf(ctx, opts), month, rates: await prices.ratesFor(month) });
}

async function auditPage(req, res, opts = {}) {
  const ctx = await context(req);
  const page = Math.max(1, ctx.query.page === undefined ? 1 : intval(ctx.query.page));
  const parse = (v) => { try { return JSON.parse(v); } catch { return null; } };
  const list = (await listAudit(page)).map((r) => ({
    ...r,
    details: JSON.stringify({ before: parse(r.old_value), after: parse(r.new_value) }, null, 4).replace(/\//g, '\\/'),
  }));
  render(req, res, 'admin/audit', { ...ctx, error: errorOf(ctx, opts), list, page });
}

async function mealQr(req, res) {
  render(req, res, 'admin/meal-qr', { settings: await settings.getPublicSettings() });
}

/** POST to a page without a form (PHP: "This action is not supported."). */
function unsupported(page) {
  return (req, res) => page(req, res, { error: 'This action is not supported.', posted: true });
}

/* ---------- actions ---------- */

async function employeesAction(req, res) {
  const action = str((req.body || {}).action) ?? 'save';
  if (action === 'delete' || action === 'restore') {
    await employees.changeEmployeeDeletion(req, intval(req.body.id), action === 'delete');
    flash(req, action === 'delete'
      ? 'Employee deleted. Attendance history is preserved. You can restore them from the Deleted filter.'
      : 'Employee restored as inactive. Use Edit to activate their account.');
    return res.redirect(url(`/admin/employees.php${action === 'restore' ? '?status=0' : ''}`));
  }
  if (action !== 'save') throw new ValidationError('Unknown employee action.');
  await employees.saveEmployee(req);
  flash(req, 'Employee saved. Attendance history is preserved.');
  res.redirect(url('/admin/employees.php'));
}

async function attendanceAction(req, res) {
  const date = await attendance.correctAttendance(req);
  flash(req, 'Correction saved with an audit trail.');
  res.redirect(url(`/admin/attendance.php?preset=custom&from=${date}&to=${date}`));
}

async function mealSettingsAction(req, res) {
  await meals.saveMealSettings(req);
  flash(req, 'Meal timings updated. New scans use these timings immediately.');
  res.redirect(url('/admin/meal-settings.php'));
}

async function settingsAction(req, res) {
  await settings.saveSettings(req);
  flash(req, 'Company settings saved.');
  res.redirect(url('/admin/settings.php'));
}

async function mealPricesAction(req, res) {
  const month = await prices.saveRates(req);
  flash(req, `Meal rates saved for ${month}.`);
  res.redirect(url(`/admin/meal_prices.php?month=${encodeURIComponent(month)}`));
}

module.exports = {
  dashboard,
  attendancePage,
  employeesPage,
  employeeView,
  reportsPage,
  mealSettingsPage,
  settingsPage,
  mealPricesPage,
  auditPage,
  mealQr,
  unsupported,
  postAction,
  employeesAction,
  attendanceAction,
  mealSettingsAction,
  settingsAction,
  mealPricesAction,
  queryOf,
};
