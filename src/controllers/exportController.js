'use strict';
const reports = require('../services/reports');
const csv = require('../services/csv');
const { getMeals } = require('../services/meals');
const { exportRows } = require('../services/employees');
const { audit } = require('../services/audit');
const { ValidationError } = require('../utils/errors');
const { queryOf } = require('./adminController');

function send(res, filename, body) {
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(body);
}

/** PHP export_report.php → exportCsv($f, summary|detail), default range: this month. */
async function exportReport(req, res) {
  const query = queryOf(req);
  let f;
  let q = query;
  try {
    f = reports.filters(query, null, 'month');
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    q = {};
    f = reports.filters({});
  }
  const view = q.view === 'detail' ? 'detail' : 'summary';
  await audit(req, 'report_exported', null, { filters: f, view });
  const data = view === 'summary' ? await reports.summaryRows(f) : await reports.attendanceRows(f);
  send(res, csv.reportFilename(view, f.from), csv.reportCsv(view, await getMeals(), data));
}

/** PHP export_employees.php */
async function exportEmployees(req, res) {
  await audit(req, 'employees_exported');
  send(res, 'employees.csv', csv.employeesCsv(await exportRows()));
}

module.exports = { exportReport, exportEmployees };
