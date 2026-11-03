'use strict';
const db = require('../config/database');
const time = require('../utils/time');
const { ValidationError } = require('../utils/errors');
const { intval, str, validDate } = require('../utils/validation');
const { getMeals, serviceStatus } = require('./meals');

const PAGE_SIZE = 25;

/**
 * PHP filters(): date presets, custom range (max ~3 years), employee/department/meal/search.
 * `employee` forces an employee (employee portal). Throws ValidationError for bad ranges.
 */
function filters(query = {}, employee = null, fallback = 'today') {
  const today = time.today();
  const preset = str(query.preset) ?? fallback;
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const ranges = {
    today: [today, today],
    yesterday: [time.addDays(today, -1), time.addDays(today, -1)],
    week: [time.addDays(today, -((today.getDay() + 6) % 7)), today], // Monday this week
    month: [firstOfMonth, new Date(today.getFullYear(), today.getMonth() + 1, 0)],
    previous: [new Date(today.getFullYear(), today.getMonth() - 1, 1), new Date(today.getFullYear(), today.getMonth(), 0)],
  };
  const [from, to] = Object.prototype.hasOwnProperty.call(ranges, preset) ? ranges[preset] : [today, today];
  let start = time.ymd(from);
  let end = time.ymd(to);
  if (preset === 'custom') {
    start = str(query.from) ?? start;
    end = str(query.to) ?? end;
  }
  const span = validDate(start) && validDate(end) ? (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 1000 : 0;
  if (!validDate(start) || !validDate(end) || start > end || span > 366 * 86400 * 3) {
    throw new ValidationError('Choose a valid date range of up to three years.');
  }
  return {
    preset,
    from: start,
    to: end,
    employee: employee ?? Math.max(0, intval(query.employee)),
    department: Math.max(0, intval(query.department)),
    meal: Math.max(0, intval(query.meal)),
    q: (str(query.q) ?? '').trim().slice(0, 100),
  };
}

/** PHP whereAttendance(): only fixed column names are interpolated; values are parameters. */
function whereAttendance(f) {
  let sql = "a.status='valid' AND a.meal_date BETWEEN ? AND ?";
  const args = [f.from, f.to];
  for (const [k, col] of [['employee', 'a.employee_id'], ['department', 'e.department_id'], ['meal', 'a.meal_type_id']]) {
    if (f[k]) { sql += ` AND ${col}=?`; args.push(f[k]); }
  }
  if (f.q !== '') { sql += ' AND (e.employee_name LIKE ? OR e.employee_code LIKE ?)'; args.push(`%${f.q}%`, `%${f.q}%`); }
  return [sql, args];
}

const SORT_COLUMNS = { date: 'a.meal_date', employee: 'e.employee_name', code: 'e.employee_code', meal: 'm.display_order', time: 'a.scan_timestamp' };

/** PHP attendanceRows(): optional 25-row page, whitelisted sort column and direction. */
async function attendanceRows(f, page = null, sort = 'date', direction = 'desc') {
  const [where, args] = whereAttendance(f);
  const col = SORT_COLUMNS[sort] || 'a.meal_date';
  const dir = direction === 'asc' ? 'ASC' : 'DESC';
  let sql = `SELECT a.*,e.employee_name,e.employee_code,COALESCE(d.department_name,'Unassigned') department,m.meal_name FROM meal_attendance a JOIN employees e ON e.id=a.employee_id JOIN meal_types m ON m.id=a.meal_type_id LEFT JOIN departments d ON d.id=e.department_id WHERE ${where} ORDER BY ${col} ${dir},a.id DESC`;
  if (page !== null) sql += ` LIMIT ${PAGE_SIZE} OFFSET ${Math.max(0, Math.trunc(page) - 1) * PAGE_SIZE}`;
  return db.rows(sql, args);
}

async function countAttendance(f) {
  const [where, args] = whereAttendance(f);
  const r = await db.one(`SELECT COUNT(*) n FROM meal_attendance a JOIN employees e ON e.id=a.employee_id WHERE ${where}`, args);
  return Number(r.n);
}

/** PHP totals(): count per meal type, in display order, zero-filled. */
async function totals(f, meals) {
  const [where, args] = whereAttendance(f);
  const data = await db.rows(`SELECT a.meal_type_id,COUNT(*) n FROM meal_attendance a JOIN employees e ON e.id=a.employee_id WHERE ${where} GROUP BY a.meal_type_id`, args);
  const counts = new Map(data.map((r) => [Number(r.meal_type_id), Number(r.n)]));
  return (meals || (await getMeals())).map((m) => ({ id: m.id, name: m.meal_name, count: counts.get(Number(m.id)) || 0 }));
}

/**
 * PHP summaryRows(): per-employee meal counts and cost using the latest monthly rate for each
 * meal's month. Employees with zero meals are included so absences are visible.
 */
async function summaryRows(f) {
  const [where, args] = whereAttendance(f);
  const data = await db.rows(
    `SELECT e.id,e.employee_name,e.employee_code,m.id meal_id,COUNT(*) n,SUM(CASE m.id WHEN 1 THEN COALESCE(p.breakfast_rate,0) WHEN 2 THEN COALESCE(p.lunch_rate,0) WHEN 3 THEN COALESCE(p.dinner_rate,0) ELSE 0 END) amount,SUM(p.id IS NULL) missing_rates FROM meal_attendance a JOIN employees e ON e.id=a.employee_id JOIN meal_types m ON m.id=a.meal_type_id LEFT JOIN meal_prices p ON p.id=(SELECT MAX(p2.id) FROM meal_prices p2 WHERE p2.month_year=DATE_FORMAT(a.meal_date,'%Y-%m')) WHERE ${where} GROUP BY e.id,e.employee_name,e.employee_code,m.id ORDER BY e.employee_name`,
    args,
  );
  let es = '1=1';
  const ea = [];
  for (const [k, col] of [['employee', 'id'], ['department', 'department_id']]) if (f[k]) { es += ` AND ${col}=?`; ea.push(f[k]); }
  if (f.q !== '') { es += ' AND (employee_name LIKE ? OR employee_code LIKE ?)'; ea.push(`%${f.q}%`, `%${f.q}%`); }
  const result = new Map();
  for (const r of await db.rows(`SELECT id,employee_name,employee_code FROM employees WHERE ${es} ORDER BY employee_name`, ea)) {
    result.set(Number(r.id), { ...r, counts: {}, total: 0, amount: 0, missing_rates: 0 });
  }
  for (const r of data) {
    const id = Number(r.id);
    if (!result.has(id)) result.set(id, { id, employee_name: r.employee_name, employee_code: r.employee_code, counts: {}, total: 0, amount: 0, missing_rates: 0 });
    const row = result.get(id);
    row.counts[r.meal_id] = Number(r.n);
    row.total += Number(r.n);
    row.amount += parseFloat(r.amount) || 0;
    row.missing_rates += Number(r.missing_rates) || 0;
  }
  return [...result.values()];
}

/** PHP dashboardData() */
async function dashboardData(f) {
  const [where, args] = whereAttendance(f);
  const meals = await getMeals();
  const daily = (await db.rows(`SELECT a.meal_date,a.meal_type_id,COUNT(*) n FROM meal_attendance a JOIN employees e ON e.id=a.employee_id WHERE ${where} GROUP BY a.meal_date,a.meal_type_id ORDER BY a.meal_date`, args))
    .map((r) => ({ meal_date: r.meal_date, meal_type_id: Number(r.meal_type_id), n: Number(r.n) }));
  const active = await db.one('SELECT COUNT(*) n FROM employees WHERE active=1 AND deleted_at IS NULL');
  const all = await db.one('SELECT COUNT(*) n FROM employees WHERE deleted_at IS NULL');
  return {
    totals: await totals(f, meals),
    active_employees: Number(active.n),
    employees: Number(all.n),
    daily,
    recent: (await attendanceRows(f, 1)).slice(0, 6),
    service: serviceStatus(meals, time.now()),
    server_time: time.unix(),
    from: f.from,
    to: f.to,
  };
}

module.exports = { filters, whereAttendance, attendanceRows, countAttendance, totals, summaryRows, dashboardData, PAGE_SIZE };
