const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { authenticate, optionalAuthenticate, requireRole } = require('../middleware/auth');
const controller = require('../controllers/printJob.controller');

const router = express.Router();

// POST /api/print-jobs - queue a file for printing ({ fileId, force? })
// Kiosk users can trigger printing for their uploaded documents without requiring staff login
router.post('/', optionalAuthenticate, asyncHandler(controller.createPrintJob));

// GET /api/print-jobs/:id - poll status of a specific job (used in kiosk PrintDialog)
router.get('/:id', optionalAuthenticate, asyncHandler(controller.getPrintJob));

// The global print queue and operator actions are staff tooling — require auth
router.use(authenticate, requireRole('ADMIN', 'OPERATOR'));

// GET /api/print-jobs - list the queue (optionally ?sessionId=...)
router.get('/', asyncHandler(controller.listQueue));

// POST /api/print-jobs/:id/verify - physical print confirmation (YES/NO)
router.post('/:id/verify', asyncHandler(controller.verifyPrintJob));

// POST /api/print-jobs/:id/retry
router.post('/:id/retry', asyncHandler(controller.retryPrintJob));

// POST /api/print-jobs/:id/retry-remaining - partial print recovery
router.post('/:id/retry-remaining', asyncHandler(controller.retryRemainingJob));

// POST /api/print-jobs/:id/restart - restart entire job
router.post('/:id/restart', asyncHandler(controller.restartEntireJob));

// POST /api/print-jobs/:id/switch-printer - change printer on failure
router.post('/:id/switch-printer', asyncHandler(controller.switchPrinter));

// POST /api/print-jobs/:id/cancel
router.post('/:id/cancel', asyncHandler(controller.cancelPrintJob));

module.exports = router;
