'use strict';
const db = require('../config/database');
const time = require('../utils/time');
const { ValidationError } = require('../utils/errors');
const { audit } = require('./audit');

const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;

/** PHP meals() */
const getMeals = (conn) => db.rows('SELECT * FROM meal_types ORDER BY display_order,id', [], conn);

/** PHP activeMeal(): the enabled meal whose window contains `at` (end inclusive/exclusive). */
function activeMeal(meals, at) {
  const t = time.format(at, 'H:i:s');
  for (const m of meals) {
    if (Number(m.status) && t >= m.start_time && (Number(m.end_inclusive) ? t <= m.end_time : t < m.end_time)) return m;
  }
  return null;
}

/** PHP serviceStatus() */
function serviceStatus(meals, at) {
  const current = activeMeal(meals, at);
  if (current) return { open: true, meal: current, message: `${current.meal_name} service is open.` };
  const active = meals.filter((m) => Number(m.status)).sort((a, b) => (a.start_time < b.start_time ? -1 : a.start_time > b.start_time ? 1 : 0));
  const t = time.format(at, 'H:i:s');
  for (const m of active) {
    if (t < m.start_time) {
      return { open: false, meal: null, message: `Meal service is currently closed. ${m.meal_name} starts at ${time.format(m.start_time, 'g:i A')}.` };
    }
  }
  const last = active.length ? active[active.length - 1].meal_name : 'Meal';
  return { open: false, meal: null, message: `${last} service is closed for today.` };
}

/** PHP validateWindows(): valid times, same-day windows, no overlap between active meals. */
function validateWindows(list) {
  const active = [];
  for (const m of list) {
    for (const k of ['start_time', 'end_time']) if (!TIME_RE.test(m[k])) throw new ValidationError('Enter valid meal times.');
    if (m.start_time >= m.end_time) throw new ValidationError('Each meal must end after it starts, on the same day.');
    if (Number(m.status)) active.push(m);
  }
  active.sort((a, b) => (a.start_time < b.start_time ? -1 : a.start_time > b.start_time ? 1 : 0));
  for (let i = 1; i < active.length; i++) {
    const prev = active[i - 1];
    const cur = active[i];
    if (cur.start_time < prev.end_time || (cur.start_time === prev.end_time && Number(prev.end_inclusive))) {
      throw new ValidationError('Active meal windows must not overlap.');
    }
  }
}

/** PHP saveMealSettings(): form fields start[ID], end[ID], active[ID], inclusive[ID]. */
async function saveMealSettings(req) {
  const body = req.body || {};
  const field = (name, id) => {
    const v = body[`${name}[${id}]`];
    return Array.isArray(v) ? v[v.length - 1] : v;
  };
  const old = await getMeals();
  const next = old.map((m) => {
    let start = String(field('start', m.id) ?? '');
    let end = String(field('end', m.id) ?? '');
    if (start.length === 5) start += ':00';
    if (end.length === 5) end += ':00';
    return { ...m, start_time: start, end_time: end, status: field('active', m.id) !== undefined ? 1 : 0, end_inclusive: field('inclusive', m.id) !== undefined ? 1 : 0 };
  });
  validateWindows(next);
  await db.withTransaction(async (conn) => {
    await db.rows('SELECT id FROM meal_types ORDER BY id FOR UPDATE', [], conn);
    for (const m of next) {
      await db.query('UPDATE meal_types SET start_time=?,end_time=?,status=?,end_inclusive=? WHERE id=?', [m.start_time, m.end_time, m.status, m.end_inclusive, m.id], conn);
    }
    await audit(req, 'meal_timings_changed', old, next, '', conn);
  });
}

module.exports = { getMeals, activeMeal, serviceStatus, validateWindows, saveMealSettings };
