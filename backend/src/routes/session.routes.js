const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const controller = require('../controllers/session.controller');

const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// POST /api/sessions - create a new session (generates the underlying ID a QR will encode)
router.post('/', asyncHandler(controller.createSession));

// GET /api/sessions/:id - fetch current session state (used for reconnect/refresh recovery)
router.get('/:id', asyncHandler(controller.getSession));

// GET /api/sessions/:id/qr - get the QR code image (data URL) for a session
router.get('/:id/qr', asyncHandler(controller.getSessionQr));

// POST /api/sessions/:id/extend - extend an active session's TTL
router.post('/:id/extend', asyncHandler(controller.extendSession));

// POST /api/sessions/:id/cancel - cancel a session early
router.post('/:id/cancel', asyncHandler(controller.cancelSession));

// POST /api/sessions/:id/end - end a session and clear unprinted files
router.post('/:id/end', asyncHandler(controller.endSession));

// POST /api/sessions/:id/revoke - operator revoke session (staff only)
router.post('/:id/revoke', authenticate, requireRole('ADMIN', 'OPERATOR'), asyncHandler(controller.endSession));

module.exports = router;
