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
router.route('/employees').get(admin.employeesPage).post(optionalImage('photo'), verifyCsrf, admin.postAction(admin.employeesAction, admin.employeesPage));
router.route('/attendance').get(admin.attendancePage).post(verifyCsrf, admin.postAction(admin.attendanceAction, admin.attendancePage));
router.route('/meal-settings').get(admin.mealSettingsPage).post(verifyCsrf, admin.postAction(admin.mealSettingsAction, admin.mealSettingsPage));
router.route('/settings').get(admin.settingsPage).post(optionalImage('logo'), verifyCsrf, admin.postAction(admin.settingsAction, admin.settingsPage));
router.route('/meal_prices').get(admin.mealPricesPage).post(verifyCsrf, admin.postAction(admin.mealPricesAction, admin.mealPricesPage));

// Read-only pages.
router.route('/dashboard').get(admin.dashboard).post(verifyCsrf, admin.unsupported(admin.dashboard));
router.route('/employee-view').get(admin.employeeView).post(verifyCsrf, admin.unsupported(admin.employeeView));
router.route(['/reports', '/report']).get(admin.reportsPage).post(verifyCsrf, admin.unsupported(admin.reportsPage));
router.route('/audit').get(admin.auditPage).post(verifyCsrf, admin.unsupported(admin.auditPage));
router.route('/meal-qr').get(admin.mealQr).post(verifyCsrf, admin.mealQr);

// CSV downloads.
router.route('/export_report').get(exportsCtl.exportReport).post(verifyCsrf, exportsCtl.exportReport);
router.route('/export_employees').get(exportsCtl.exportEmployees).post(verifyCsrf, exportsCtl.exportEmployees);

// Retired legacy endpoints from the PHP version: GET redirects, anything else 410.
const retired = {
  '/attendance_load': '/admin/attendance',
  '/attendance_report': '/admin/attendance',
  '/attendance_save': '/admin/attendance',
  '/delete_employee': '/admin/employees',
  '/edit_employee': '/admin/employees',
  '/profile': '/admin/settings',
  '/users': '/admin/settings',
};
for (const [path, target] of Object.entries(retired)) {
  router.all(path, (req, res) => {
    if (req.method !== 'GET') return res.status(410).type('text/plain; charset=utf-8').send('This legacy action has been retired. Use the current administration form.');
    res.redirect(url(target));
  });
}

module.exports = router;
