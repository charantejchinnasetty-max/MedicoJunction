'use strict';
/** Spreadsheet formula-injection guard used by the PHP exports. */
const neutralise = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /^[=+@\-\t\r\n]/.test(s) ? `'${s}` : s;
};

/** PHP fputcsv() line: quote when needed, double embedded quotes, "\n" terminator. */
function line(values) {
  return `${values.map((v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\\\n\r\t ]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')}\n`;
}

/** PHP exportCsv(): employee summary (with costs) or detailed register. */
function reportCsv(view, meals, data) {
  let out = '﻿';
  const put = (r) => { out += line(r.map(neutralise)); };
  if (view === 'summary') {
    put(['Employee', 'Employee ID', ...meals.map((m) => m.meal_name), 'Total meals', 'Amount INR', 'Meals missing rates']);
    for (const r of data) {
      put([r.employee_name, r.employee_code, ...meals.map((m) => r.counts[m.id] || 0), r.total, r.amount.toFixed(2), r.missing_rates]);
    }
  } else {
    put(['Employee', 'Employee ID', 'Department', 'Date', 'Meal', 'Scan time IST', 'Source', 'Status']);
    for (const r of data) {
      put([r.employee_name, r.employee_code, r.department, r.meal_date, r.meal_name, r.scan_timestamp ?? 'Not available', r.source, r.status]);
    }
  }
  return out;
}

function employeesCsv(list) {
  let out = line(['Name', 'Employee ID', 'Department', 'Designation', 'Status']);
  for (const r of list) out += line([r.employee_name, r.employee_code, r.department, r.designation, r.active].map(neutralise));
  return out;
}

const reportFilename = (view, from) => `medico-junction-${view}-${from}.csv`;

module.exports = { line, neutralise, reportCsv, employeesCsv, reportFilename };
