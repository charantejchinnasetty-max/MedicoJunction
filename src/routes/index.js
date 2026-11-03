'use strict';
const express = require('express');
const auth = require('../controllers/authController');
const { verifyCsrf } = require('../middleware/csrf');
const { parseLoginAttempt, makeLoginLimiters } = require('../middleware/rateLimits');
const adminRoutes = require('./admin');
const employeeRoutes = require('./employee');
const apiRoutes = require('./api');

const router = express.Router();

// Public: index.php, login.php, logout.php (same URLs as the PHP application).
router.get(['/', '/index.php'], auth.home);
router.get('/login.php', (req, res) => auth.renderLogin(req, res));
router.post('/login.php', verifyCsrf, parseLoginAttempt, ...makeLoginLimiters(auth.renderLimited), auth.login);
router.all('/logout.php', verifyCsrf, auth.logout);

router.use('/admin', adminRoutes);
router.use('/employee', employeeRoutes);
router.use('/api', apiRoutes);

module.exports = router;
