const notificationService = require('../services/notification.service');
const { sendSuccess, AppError } = require('../middleware/errorHandler');

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

async function listNotifications(req, res) {
  const { sessionId } = req.query;
  if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new AppError('A valid sessionId query parameter is required.', 400);
  }
  const notifications = notificationService.listForSession(sessionId);
  sendSuccess(res, { notifications });
}

module.exports = { listNotifications };
