'use strict';
// Date helpers equivalent to the PHP DateTimeImmutable / date() calls used by the app.
// process.env.TZ is Asia/Kolkata (see config/env.js), so local getters are IST.

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n) => String(n).padStart(2, '0');

const now = () => new Date();

/** Parse "Y-m-d", "Y-m-d H:i:s" or "H:i:s" (today) as IST local time. */
function parse(value) {
  if (value instanceof Date) return value;
  const s = String(value);
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) { const d = new Date(); d.setHours(+m[1], +m[2], +(m[3] || 0), 0); return d; }
  return new Date(NaN);
}

const daysInMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

/** Subset of PHP date() format characters used by the application. */
function format(value, pattern) {
  const d = parse(value);
  const h = d.getHours();
  const map = {
    Y: () => String(d.getFullYear()), m: () => pad(d.getMonth() + 1), d: () => pad(d.getDate()),
    j: () => String(d.getDate()), H: () => pad(h), i: () => pad(d.getMinutes()), s: () => pad(d.getSeconds()),
    D: () => DAYS[d.getDay()], M: () => MONTHS[d.getMonth()].slice(0, 3), F: () => MONTHS[d.getMonth()],
    g: () => String(h % 12 || 12), h: () => pad(h % 12 || 12), A: () => (h < 12 ? 'AM' : 'PM'),
    t: () => pad(daysInMonth(d)),
  };
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') { out += pattern[++i] || ''; continue; }
    out += map[c] ? map[c]() : c;
  }
  return out;
}

const today = () => { const d = now(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const ymd = (d) => format(d, 'Y-m-d');
const ymdhis = (d) => format(d, 'Y-m-d H:i:s');
const unix = (d = now()) => Math.floor(d.getTime() / 1000);

module.exports = { now, parse, format, today, addDays, ymd, ymdhis, unix, daysInMonth };
