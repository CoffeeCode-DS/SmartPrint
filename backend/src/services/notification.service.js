const notificationsRepo = require('../db/notifications.repo');
const { generateSecureId } = require('../utils/id');
const { serializeNotification } = require('../utils/serializers');
const emitter = require('../sockets/emitter');
const EVENTS = require('../sockets/events');

/**
 * Creates a notification, persists it (so it survives a refresh/reconnect),
 * and pushes it live to anyone currently viewing this session. The exact
 * same serialized shape is used for the socket push and the REST list
 * endpoint, so the frontend never has to handle two different formats.
 */
function notify({ sessionId, type, message }) {
  const row = notificationsRepo.create({
    id: generateSecureId(16),
    sessionId,
    type,
    message,
  });
  const serialized = serializeNotification(row);

  emitter.emitToSession(sessionId, EVENTS.NOTIFICATION_CREATED, serialized);
  return serialized;
}

function listForSession(sessionId) {
  return notificationsRepo.findBySession(sessionId).map(serializeNotification);
}

module.exports = { notify, listForSession };
