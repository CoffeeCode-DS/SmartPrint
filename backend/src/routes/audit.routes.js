const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { authenticate, requireRole } = require('../middleware/auth');
const controller = require('../controllers/audit.controller');

const router = express.Router();
router.use(authenticate, requireRole('ADMIN'));

// GET /api/audit-logs/verify - verifies cryptographic hash chain integrity
router.get('/verify', asyncHandler(controller.verifyAuditChain));

// GET /api/audit-logs?limit=&offset=
router.get('/', asyncHandler(controller.listAuditLogs));

module.exports = router;
