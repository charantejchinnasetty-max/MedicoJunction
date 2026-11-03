'use strict';
const db = require('../config/database');
const time = require('../utils/time');
const { ValidationError } = require('../utils/errors');
const { cleanText, intval, isIndianMobile, normalizeMobile, validDate } = require('../utils/validation');
const { audit } = require('./audit');
const { saveUploadedImage } = require('./images');
const { employeePasswordHash } = require('./passwords');

const withoutSecrets = (row) => {
  if (!row) return row;
  const { password, password_hash, ...rest } = row; // eslint-disable-line no-unused-vars
  return rest;
};

/**
 * PHP saveEmployee(): create or edit an employee. New employees, and edits with
 * "reset password" ticked, get the common employee password and their sessions are ended.
 */
async function saveEmployee(req) {
  const body = req.body || {};
  let id = intval(body.id);
  const old = id ? await db.one('SELECT * FROM employees WHERE id=?', [id]) : null;
  if (id && !old) throw new ValidationError('Employee not found.');
  if (old && old.deleted_at !== null) throw new ValidationError('Restore this deleted employee before editing their profile.');

  const name = cleanText(body, 'employee_name', 100, true);
  const code = cleanText(body, 'employee_code', 20, true);
  const mobile = normalizeMobile(cleanText(body, 'mobile', 15, true));
  if (!isIndianMobile(mobile)) throw new ValidationError('Enter a valid mobile number.');
  const dept = cleanText(body, 'department', 50);
  const designation = cleanText(body, 'designation', 100);
  const join = cleanText(body, 'joining_date', 10);
  if (join !== '' && !validDate(join)) throw new ValidationError('Enter a valid joining date.');
  const active = body.active !== undefined ? 1 : 0;
  const resetPassword = !id || body.reset_password !== undefined;
  const photo = (await saveUploadedImage(req)) ?? (old ? old.photo : null);

  try {
    await db.withTransaction(async (conn) => {
      let departmentId = null;
      if (dept !== '') {
        await db.query('INSERT IGNORE INTO departments(department_name) VALUES(?)', [dept], conn);
        departmentId = (await db.one('SELECT id FROM departments WHERE department_name=?', [dept], conn)).id;
      }
      const args = [name, code, mobile, mobile, dept, departmentId, designation, join || null, active, photo];
      if (id) {
        const saved = await db.query('UPDATE employees SET employee_name=?,employee_code=?,mobile=?,mobile_login=?,department=?,department_id=?,designation=?,joining_date=?,active=?,photo=?,updated_at=NOW() WHERE id=? AND deleted_at IS NULL', [...args, id], conn);
        if (!saved.affectedRows) throw new ValidationError('This employee was deleted. Restore them before editing.');
      } else {
        const r = await db.query('INSERT INTO employees(employee_name,employee_code,mobile,mobile_login,department,department_id,designation,joining_date,active,photo) VALUES(?,?,?,?,?,?,?,?,?,?)', args, conn);
        id = r.insertId;
      }
      if (resetPassword) {
        await db.query('UPDATE employees SET password_hash=?,password=NULL,session_version=session_version+1 WHERE id=?', [await employeePasswordHash(conn), id], conn);
      } else if (old && (Number(old.active) !== active || old.mobile_login !== mobile)) {
        await db.query('UPDATE employees SET session_version=session_version+1 WHERE id=?', [id], conn);
      }
      const after = await db.one('SELECT id,employee_name,employee_code,mobile,department,designation,active,photo FROM employees WHERE id=?', [id], conn);
      await audit(req, old ? 'employee_updated' : 'employee_created', withoutSecrets(old), after, '', conn);
      if (resetPassword) await audit(req, 'employee_password_reset', null, { employee_id: id }, '', conn);
    });
  } catch (err) {
    if (db.isDuplicate(err)) throw new ValidationError('That employee ID or mobile number is already in use.');
    throw err;
  }
}

/** PHP changeEmployeeDeletion(): soft delete / restore. Attendance is never removed. */
async function changeEmployeeDeletion(req, id, deleted) {
  await db.withTransaction(async (conn) => {
    const cols = 'id,employee_name,employee_code,active,deleted_at,session_version';
    const old = await db.one(`SELECT ${cols} FROM employees WHERE id=? FOR UPDATE`, [id], conn);
    if (!old) throw new ValidationError('Employee not found.');
    if ((old.deleted_at !== null) === deleted) return;
    await db.query('UPDATE employees SET deleted_at=?,active=0,session_version=session_version+1,updated_at=NOW() WHERE id=?', [deleted ? time.ymdhis(time.now()) : null, id], conn);
    const next = await db.one(`SELECT ${cols} FROM employees WHERE id=?`, [id], conn);
    await audit(
      req,
      deleted ? 'employee_deleted' : 'employee_restored',
      old,
      next,
      deleted ? 'Employee removed from employee list; login disabled and attendance retained.' : 'Employee restored as inactive; administrator can activate through Edit.',
      conn,
    );
  });
}

/** Employee list with search and status filter (current / active / inactive / deleted). */
async function listEmployees(q, status) {
  let where = `(employee_name LIKE ? OR employee_code LIKE ? OR department LIKE ?) AND deleted_at IS ${status === 'deleted' ? 'NOT NULL' : 'NULL'}`;
  const args = [`%${q}%`, `%${q}%`, `%${q}%`];
  if (status === '0' || status === '1') { where += ' AND active=?'; args.push(Number(status)); }
  return db.rows(`SELECT * FROM employees WHERE ${where} ORDER BY employee_name`, args);
}

const getEmployee = (id) => db.one('SELECT * FROM employees WHERE id=?', [id]);
const employeeOptions = () => db.rows('SELECT id,employee_name,employee_code FROM employees ORDER BY employee_name');
const departmentOptions = () => db.rows('SELECT * FROM departments ORDER BY department_name');
const exportRows = () => db.rows('SELECT employee_name,employee_code,department,designation,active FROM employees WHERE deleted_at IS NULL ORDER BY employee_name');

/** Employee portal: replace own profile photo. */
async function updateOwnPhoto(req) {
  const photo = (await saveUploadedImage(req)) ?? req.user.photo;
  await db.query('UPDATE employees SET photo=?,updated_at=NOW() WHERE id=?', [photo, req.user.id]);
}

module.exports = { saveEmployee, changeEmployeeDeletion, listEmployees, getEmployee, employeeOptions, departmentOptions, exportRows, updateOwnPhoto };
