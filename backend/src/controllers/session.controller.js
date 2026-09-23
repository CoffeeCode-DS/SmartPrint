const sessionService = require('../services/session.service');
const qrService = require('../services/qr.service');
const { sendSuccess, AppError } = require('../middleware/errorHandler');
const { serializeSession } = require('../utils/serializers');

// Session IDs are base64url strings from crypto.randomBytes(24) -> 32 chars.
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

function validateSessionIdParam(id) {
  if (!id || !SESSION_ID_PATTERN.test(id)) {
    throw new AppError('Invalid session ID format', 400);
  }
}

async function createSession(req, res) {
  const oneTime = req.body?.oneTime !== undefined ? Boolean(req.body.oneTime) : true;
  const createdBy = req.user ? req.user.id : null;
  const session = sessionService.createSession({ oneTime, createdBy });
  sendSuccess(res, { session: serializeSession(session) }, 201);
}

async function getSession(req, res) {
  validateSessionIdParam(req.params.id);
  const session = sessionService.reconnectSession(req.params.id);
  sendSuccess(res, { session: serializeSession(session) });
}

async function getSessionQr(req, res) {
  validateSessionIdParam(req.params.id);
  // Confirm the session exists/is valid before generating a QR for it.
  const session = sessionService.getSessionOrThrow(req.params.id);
  const qrDataUrl = await qrService.generateQrDataUrl(session.id);
  sendSuccess(res, { qrDataUrl, session: serializeSession(session) });
}

async function extendSession(req, res) {
  validateSessionIdParam(req.params.id);
  const session = sessionService.extendSession(req.params.id);
  sendSuccess(res, { session: serializeSession(session) });
}

async function cancelSession(req, res) {
  validateSessionIdParam(req.params.id);
  const session = sessionService.cancelSession(req.params.id);
  sendSuccess(res, { session: serializeSession(session) });
}

async function endSession(req, res) {
  validateSessionIdParam(req.params.id);
  const requestedBy = req.user ? req.user.username : 'customer';
  const reason = req.body?.reason || (req.user ? 'Revoked by operator' : 'Ended by customer');
  const session = sessionService.endSession(req.params.id, { requestedBy, reason });
  sendSuccess(res, { session: serializeSession(session), message: 'Session ended successfully.' });
}

module.exports = { createSession, getSession, getSessionQr, extendSession, cancelSession, endSession };
