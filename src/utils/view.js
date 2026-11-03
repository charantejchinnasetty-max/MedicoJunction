'use strict';
const env = require('../config/env');
const time = require('./time');
const { buildQuery } = require('./http');

// SVG icons from app/layout.php icon().
const ICONS = {
  dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  attendance: 'M8 3v4 M16 3v4 M4 10h16 M5 5h14v16H5z M8 14h3 M14 14h2 M8 17h3',
  employees: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M17 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87',
  reports: 'M4 3h12l4 4v14H4z M8 16v-4 M12 16V9 M16 16v-6',
  qr: 'M3 3h6v6H3z M15 3h6v6h-6z M3 15h6v6H3z M15 15h2v2h-2z M20 14v4h-3v3 M21 21h-1',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2',
  arrow: 'M5 12h14 M14 7l5 5-5 5',
  check: 'M5 12l4 4L19 6',
  sun: 'M12 3v2 M12 19v2 M3 12h2 M19 12h2 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2 M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
};

const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name] || ICONS.dashboard}"/></svg>`;

/** PHP number_format($n, 2): 1,234.50 */
const money = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** PHP e(): HTML-escape for values placed inside trusted HTML strings. */
const e = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]);

const initial = (name) => String(name || '').charAt(0).toUpperCase();

/** Helpers available in every template. */
const helpers = {
  base: env.basePath,
  icon,
  e,
  fmt: time.format,
  ymd: time.ymd,
  now: time.now,
  money,
  initial,
  qs: buildQuery,
  ucfirst: (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1),
};

/**
 * Render a page. Template line breaks between tags exist only for readability; they are
 * removed so the DOM matches the single-line markup the PHP helpers produced.
 */
function render(req, res, view, locals = {}, status = res.statusCode || 200) {
  const flash = req.session && req.session.flash;
  if (flash !== undefined) delete req.session.flash;
  res.render(view, { flash, error: '', ...locals }, (err, html) => {
    if (err) return req.next(err);
    res.status(status).type('text/html; charset=utf-8').send(html.replace(/>\s*\n\s*</g, '><').trim());
  });
}

module.exports = { helpers, render, icon, money };
