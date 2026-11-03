'use strict';
const express = require('express');
const admin = require('../controllers/adminController');
const exportsCtl = require('../controllers/exportController');
const { requireAdmin } = require('../middleware/auth');
const { verifyCsrf } = require('../middleware/csrf');
const { optionalImage } = require('../middleware/upload');
const { url } = require('../utils/http');

const router = express.Router();
router.use(requireAdmin);

// Pages with forms: GET renders, POST validates CSRF, runs the action, and on a validation
// error re-renders the page with the message (identical to admin-pages.php).
router.route('/employees.php').get(admin.employeesPage).post(optionalImage('photo'), verifyCsrf, admin.postAction(admin.employeesAction, admin.employeesPage));
router.route('/attendance.php').get(admin.attendancePage).post(verifyCsrf, admin.postAction(admin.attendanceAction, admin.attendancePage));
router.route('/meal-settings.php').get(admin.mealSettingsPage).post(verifyCsrf, admin.postAction(admin.mealSettingsAction, admin.mealSettingsPage));
router.route('/settings.php').get(admin.settingsPage).post(optionalImage('logo'), verifyCsrf, admin.postAction(admin.settingsAction, admin.settingsPage));
router.route('/meal_prices.php').get(admin.mealPricesPage).post(verifyCsrf, admin.postAction(admin.mealPricesAction, admin.mealPricesPage));

// Read-only pages.
router.route('/dashboard.php').get(admin.dashboard).post(verifyCsrf, admin.unsupported(admin.dashboard));
router.route('/employee-view.php').get(admin.employeeView).post(verifyCsrf, admin.unsupported(admin.employeeView));
router.route(['/reports.php', '/report.php']).get(admin.reportsPage).post(verifyCsrf, admin.unsupported(admin.reportsPage));
router.route('/audit.php').get(admin.auditPage).post(verifyCsrf, admin.unsupported(admin.auditPage));
router.route('/meal-qr.php').get(admin.mealQr).post(verifyCsrf, admin.mealQr);

// CSV downloads.
router.route('/export_report.php').get(exportsCtl.exportReport).post(verifyCsrf, exportsCtl.exportReport);
router.route('/export_employees.php').get(exportsCtl.exportEmployees).post(verifyCsrf, exportsCtl.exportEmployees);

// Retired legacy endpoints: same behaviour as the PHP stubs (GET redirects, anything else 410).
const retired = {
  '/attendance..php': '/admin/attendance.php',
  '/attendance_load.php': '/admin/attendance.php',
  '/attendance_report.php': '/admin/attendance.php',
  '/attendance_save.php': '/admin/attendance.php',
  '/delete_employee.php': '/admin/employees.php',
  '/edit_employee.php': '/admin/employees.php',
  '/profile.php': '/admin/settings.php',
  '/users.php': '/admin/settings.php',
};
for (const [path, target] of Object.entries(retired)) {
  router.all(path, (req, res) => {
    if (req.method !== 'GET') return res.status(410).type('text/plain; charset=utf-8').send('This legacy action has been retired. Use the current administration form.');
    res.redirect(url(target));
  });
}

module.exports = router;
