'use strict';
const time = require('../utils/time');
const { ValidationError } = require('../utils/errors');
const { flash, url } = require('../utils/http');
const { render } = require('../utils/view');
const { str } = require('../utils/validation');
const reports = require('../services/reports');
const { getMeals, serviceStatus } = require('../services/meals');
const { getPublicSettings } = require('../services/settings');
const { mealsTakenOn } = require('../services/attendance');
const { updateOwnPhoto } = require('../services/employees');
const { isSafeUploadPath } = require('../services/images');

async function base() {
  return { meals: await getMeals(), settings: await getPublicSettings() };
}

const queryOf = (req) => {
  const out = {};
  for (const [k, v] of Object.entries(req.query || {})) out[k] = str(v);
  return out;
};

async function dashboard(req, res, opts = {}) {
  const ctx = await base();
  const at = time.now();
  const taken = await mealsTakenOn(req.user.id, time.ymd(at));
  const byMeal = {};
  for (const a of taken) byMeal[a.meal_type_id] = a;
  let f;
  try {
    f = reports.filters(queryOf(req), Number(req.user.id), 'month');
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    f = reports.filters({}, Number(req.user.id), 'month');
  }
  render(req, res, 'employee/dashboard', {
    ...ctx,
    error: opts.error || '',
    service: serviceStatus(ctx.meals, at),
    takenCount: taken.length,
    byMeal,
    counts: await reports.totals(f, ctx.meals),
    photoOk: Boolean(req.user.photo) && isSafeUploadPath(req.user.photo),
  });
}

async function scan(req, res, opts = {}) {
  render(req, res, 'employee/scan', { ...(await base()), error: opts.error || '' });
}

async function history(req, res, opts = {}) {
  const ctx = await base();
  let filterError = '';
  let f;
  try {
    f = reports.filters(queryOf(req), Number(req.user.id), 'month');
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    filterError = err.message;
    f = reports.filters({}, Number(req.user.id), 'month');
  }
  const records = await reports.attendanceRows(f);
  const byDate = {};
  for (const r of records) (byDate[r.meal_date] ||= {})[r.meal_type_id] = r;
  const days = [];
  for (let d = time.parse(f.to), first = time.parse(f.from); d >= first; d = time.addDays(d, -1)) {
    const date = time.ymd(d);
    days.push({ date, entries: byDate[date] || {} });
  }
  render(req, res, 'employee/history', { ...ctx, error: opts.error || '', filterError, f, counts: await reports.totals(f, ctx.meals), days });
}

async function profile(req, res, opts = {}) {
  render(req, res, 'employee/profile', { ...(await base()), error: opts.error || '' });
}

async function profileAction(req, res) {
  try {
    await updateOwnPhoto(req);
    flash(req, 'Your profile has been updated.');
    res.redirect(url('/employee/profile.php'));
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    await profile(req, res, { error: err.message });
  }
}

module.exports = { dashboard, scan, history, profile, profileAction };
