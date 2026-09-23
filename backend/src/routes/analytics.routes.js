const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { authenticate, requireRole } = require('../middleware/auth');
const controller = require('../controllers/analytics.controller');

const router = express.Router();
router.use(authenticate, requireRole('ADMIN', 'OPERATOR'));

// GET /api/analytics/summary - aggregate stats for the analytics dashboard
router.get('/summary', asyncHandler(controller.getSummary));

// GET /api/analytics/export-pdf - generate and download official executive PDF report
router.get('/export-pdf', asyncHandler(controller.exportPdf));

module.exports = router;
