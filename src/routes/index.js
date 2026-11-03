'use strict';
const express = require('express');
const auth = require('../controllers/authController');
const { verifyCsrf } = require('../middleware/csrf');
const { parseLoginAttempt, makeLoginLimiters } = require('../middleware/rateLimits');
const adminRoutes = require('./admin');
const employeeRoutes = require('./employee');
const apiRoutes = require('./api');

const router = express.Router();

// Public pages.
router.get('/', auth.home);
router.get('/login', (req, res) => auth.renderLogin(req, res));
router.post('/login', verifyCsrf, parseLoginAttempt, ...makeLoginLimiters(auth.renderLimited), auth.login);
router.all('/logout', verifyCsrf, auth.logout);

router.use('/admin', adminRoutes);
router.use('/employee', employeeRoutes);
router.use('/api', apiRoutes);

module.exports = router;
