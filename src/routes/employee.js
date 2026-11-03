'use strict';
const express = require('express');
const employee = require('../controllers/employeeController');
const { requireEmployee } = require('../middleware/auth');
const { verifyCsrf } = require('../middleware/csrf');
const { optionalImage } = require('../middleware/upload');

const router = express.Router();
router.use(requireEmployee);

router.get('/dashboard', employee.dashboard);
router.get('/scan', employee.scan);
router.get('/history', employee.history);
router.route('/profile').get(employee.profile).post(optionalImage('photo'), verifyCsrf, employee.profileAction);

module.exports = router;
