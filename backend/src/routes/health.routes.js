const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { sendSuccess } = require('../middleware/errorHandler');
const healthController = require('../controllers/health.controller');

const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/ping - simple liveness check for dev/testing
router.get('/ping', (req, res) => {
  sendSuccess(res, { ok: true, timestamp: new Date().toISOString() });
});

// GET /api/health & GET /api/system/health - comprehensive subsystem health status
router.get('/health', asyncHandler(healthController.getHealth));
router.get('/system/health', asyncHandler(healthController.getHealth));

// GET /api/system/consistency - database vs filesystem orphan & audit integrity report (protected)
router.get('/system/consistency', authenticate, requireRole('ADMIN', 'OPERATOR'), asyncHandler(healthController.getConsistency));

module.exports = router;
