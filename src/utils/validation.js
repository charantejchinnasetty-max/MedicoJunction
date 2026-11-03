'use strict';
const { ValidationError } = require('./errors');

/** A single scalar from a parsed body/query value (PHP keeps the last duplicate key). */
function str(value) {
  if (Array.isArray(value)) value = value[value.length - 1];
  if (value === undefined || value === null) return undefined;
  return typeof value === 'object' ? '' : String(value);
}

/** PHP (int) cast semantics for request input: leading integer, otherwise 0. */
function intval(value) {
  const s = str(value);
  if (s === undefined) return 0;
  const n = parseInt(s.trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

/** PHP cleanText(): trimmed string, max byte length, optional required. */
function cleanText(source, key, max, required = false) {
  const v = (str(source[key]) ?? '').trim();
  if (Buffer.byteLength(v, 'utf8') > max || (required && v === '')) {
    throw new ValidationError(`Please enter a valid ${key.replace(/_/g, ' ')}.`);
  }
  return v;
}

/** Strict YYYY-MM-DD that is a real calendar date. */
function validDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** Indian mobile numbers: strip formatting, +91 / leading 0 prefixes. */
function normalizeMobile(value) {
  let digits = String(value).replace(/[^0-9]/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits[0] === '0') digits = digits.slice(1);
  return digits;
}

const isIndianMobile = (m) => /^[6-9][0-9]{9}$/.test(m);

/** PHP is_numeric() for decimal input such as meal rates. */
const isNumeric = (v) => typeof v === 'string' && /^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/.test(v);

module.exports = { str, intval, cleanText, validDate, normalizeMobile, isIndianMobile, isNumeric };
