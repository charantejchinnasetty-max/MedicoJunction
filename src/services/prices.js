'use strict';
const db = require('../config/database');
const { ValidationError } = require('../utils/errors');
const { cleanText, isNumeric, str, validDate } = require('../utils/validation');
const { audit } = require('./audit');

const RATE_FIELDS = ['breakfast_rate', 'lunch_rate', 'dinner_rate'];

/** Latest saved rates for a month ("YYYY-MM"); history is kept, newest row wins. */
const ratesFor = (month) => db.one('SELECT * FROM meal_prices WHERE month_year=? ORDER BY id DESC LIMIT 1', [month]);

/** PHP saveRates(): non-negative rates below ₹999,999, rounded to paise. Returns the month. */
async function saveRates(req) {
  const body = req.body || {};
  const month = cleanText(body, 'month', 7, true);
  if (!validDate(`${month}-01`)) throw new ValidationError('Choose a valid month.');
  const values = RATE_FIELDS.map((k) => {
    const v = str(body[k]) ?? '';
    if (!isNumeric(v) || Number(v) < 0 || Number(v) > 999999) throw new ValidationError('Enter non-negative meal rates below ₹999,999.');
    return Math.round(Number(v) * 100) / 100;
  });
  await db.withTransaction(async (conn) => {
    const old = await db.rows('SELECT * FROM meal_prices WHERE month_year=?', [month], conn);
    await db.query('INSERT INTO meal_prices(month_year,breakfast_rate,lunch_rate,dinner_rate) VALUES(?,?,?,?)', [month, ...values], conn);
    await audit(req, 'meal_rates_changed', old, { month, rates: values }, '', conn);
  });
  return month;
}

module.exports = { ratesFor, saveRates };
