'use strict';
const express = require('express');
const api = require('../controllers/apiController');
const { requireAdmin, requireEmployee } = require('../middleware/auth');
const { verifyCsrf } = require('../middleware/csrf');
const { scanLimiter, qrLimiter } = require('../middleware/rateLimits');

const router = express.Router();
const rawBody = express.text({ type: () => true, limit: '8kb' });

// Employee: record a meal from the counter QR (POST, JSON { token }, X-CSRF-Token header).
router.all('/scan-meal.php', requireEmployee, rawBody, verifyCsrf, scanLimiter, api.readScanBody, api.scanMeal);

// Admin endpoints.
router.all('/qr-token.php', requireAdmin, verifyCsrf, qrLimiter, api.qrToken);
router.get('/dashboard-stats.php', requireAdmin, api.dashboardStats);
router.get('/reports.php', requireAdmin, api.reportsApi);
router.use(api.notFound);

module.exports = router;
