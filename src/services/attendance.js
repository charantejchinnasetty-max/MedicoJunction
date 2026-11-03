'use strict';
const db = require('../config/database');
const time = require('../utils/time');
const { ValidationError } = require('../utils/errors');
const { cleanText, intval, str, validDate } = require('../utils/validation');
const { audit } = require('./audit');
const { getMeals, activeMeal, serviceStatus } = require('./meals');
const { validateToken } = require('./qr');

/** PHP duplicateResult() */
function duplicateResult(meal, existing) {
  const t = existing.scan_timestamp ? time.format(existing.scan_timestamp, 'g:i A') : 'an unknown time (legacy attendance)';
  return {
    success: false,
    code: 'ALREADY_RECORDED',
    message: `${meal.meal_name} already recorded today at ${t}.`,
    data: { recorded_time: existing.scan_timestamp ? existing.scan_timestamp.slice(11) : null },
  };
}

/**
 * PHP recordMeal(): validate the counter QR, lock the employee, pick the meal from server
 * time, and insert once. The unique key (employee, date, meal) is the final duplicate guard
 * for simultaneous scans. `at` is only overridden by automated tests, never by HTTP input.
 */
async function recordMeal(employeeId, token, at = time.now()) {
  const valid = await validateToken(token, at);
  if (valid.code) return { success: false, code: valid.code, message: valid.message };
  const date = time.ymd(at);
  let meal = null;
  try {
    return await db.withTransaction(async (conn) => {
      const employee = await db.one('SELECT * FROM employees WHERE id=? AND active=1 AND deleted_at IS NULL FOR UPDATE', [employeeId], conn);
      if (!employee) return { success: false, code: 'ACCOUNT_UNAVAILABLE', message: 'This employee account is inactive.' };
      meal = activeMeal(await db.rows('SELECT * FROM meal_types ORDER BY display_order LOCK IN SHARE MODE', [], conn), at);
      if (!meal) return { success: false, code: 'MEAL_CLOSED', message: serviceStatus(await getMeals(conn), at).message };
      const args = [employeeId, date, meal.id];
      const existing = await db.one('SELECT * FROM meal_attendance WHERE employee_id=? AND meal_date=? AND meal_type_id=?', args, conn);
      if (existing && existing.status === 'valid') return duplicateResult(meal, existing);
      // A voided record can only be restored by an administrator, preserving the correction trail.
      if (existing) return { success: false, code: 'ADMIN_REVIEW', message: 'This meal was corrected by an administrator. Contact the mess manager.' };
      await db.query(
        "INSERT INTO meal_attendance(employee_id,meal_date,meal_type_id,scan_timestamp,qr_token_id,source,status) VALUES(?,?,?,?,?,'scan','valid')",
        [...args, time.ymdhis(at), valid.row.id],
        conn,
      );
      return {
        success: true,
        code: 'MEAL_RECORDED',
        message: `${meal.meal_name} recorded successfully. Enjoy your meal!`,
        data: { employee: employee.employee_name, meal: meal.meal_name, date, time: time.format(at, 'H:i:s') },
      };
    });
  } catch (err) {
    if (db.isDuplicate(err) && meal) {
      const existing = await db.one('SELECT * FROM meal_attendance WHERE employee_id=? AND meal_date=? AND meal_type_id=?', [employeeId, date, meal.id]);
      if (existing) return duplicateResult(meal, existing);
    }
    throw err;
  }
}

/**
 * PHP correctAttendance(): add a missed meal, correct an entry, or void it — always with a
 * reason and an audit record inside the same transaction. Returns the affected date.
 */
async function correctAttendance(req) {
  const body = req.body || {};
  const id = intval(body.id);
  const action = str(body.action) ?? 'save';
  if (!['save', 'void'].includes(action)) throw new ValidationError('Unknown attendance action.');
  const reason = cleanText(body, 'reason', 500, true);
  if (Buffer.byteLength(reason) < 8) throw new ValidationError('Please give a meaningful correction reason (at least 8 characters).');
  const employee = intval(body.employee_id);
  const meal = intval(body.meal_type_id);
  const date = cleanText(body, 'meal_date', 10);
  if (!validDate(date) || date > time.ymd(time.now())) throw new ValidationError('Attendance date must be today or earlier.');
  if (!(await db.one('SELECT id FROM employees WHERE id=?', [employee])) || !(await db.one('SELECT id FROM meal_types WHERE id=?', [meal]))) {
    throw new ValidationError('Choose a valid employee and meal.');
  }
  if (action === 'void' && !id) throw new ValidationError('Choose an existing attendance record to void.');
  try {
    await db.withTransaction(async (conn) => {
      const old = id ? await db.one('SELECT * FROM meal_attendance WHERE id=? FOR UPDATE', [id], conn) : null;
      if (id && !old) throw new ValidationError('Attendance not found.');
      let recordId = id;
      if (id && action === 'void') {
        await db.query("UPDATE meal_attendance SET status='void' WHERE id=?", [id], conn);
      } else if (id) {
        await db.query("UPDATE meal_attendance SET employee_id=?,meal_type_id=?,meal_date=?,status='valid' WHERE id=?", [employee, meal, date, id], conn);
      } else {
        const r = await db.query("INSERT INTO meal_attendance(employee_id,meal_type_id,meal_date,source,status) VALUES(?,?,?,'manual','valid')", [employee, meal, date], conn);
        recordId = r.insertId;
      }
      await audit(req, `attendance_${action}`, old, await db.one('SELECT * FROM meal_attendance WHERE id=?', [recordId], conn), reason, conn);
    });
  } catch (err) {
    if (db.isDuplicate(err)) throw new ValidationError('This employee already has this meal on this date. Edit the existing record, including voided records in the activity log.');
    throw err;
  }
  return date;
}

/** Employee dashboard: today's valid meals keyed by meal type. */
async function mealsTakenOn(employeeId, date) {
  return db.rows("SELECT * FROM meal_attendance WHERE employee_id=? AND meal_date=? AND status='valid'", [employeeId, date]);
}

module.exports = { recordMeal, correctAttendance, duplicateResult, mealsTakenOn };
