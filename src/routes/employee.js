'use strict';
const express = require('express');
const employee = require('../controllers/employeeController');
const { requireEmployee } = require('../middleware/auth');
const { verifyCsrf } = require('../middleware/csrf');
const { optionalImage } = require('../middleware/upload');

const router = express.Router();
router.use(requireEmployee);

router.get('/dashboard.php', employee.dashboard);
router.get('/scan.php', employee.scan);
router.get('/history.php', employee.history);
router.route('/profile.php').get(employee.profile).post(optionalImage('photo'), verifyCsrf, employee.profileAction);

module.exports = router;
