let ioInstance = null;

const QUEUE_ROOM = 'queue:global';

/**
 * Called once from sockets/index.js after the Socket.IO server is created.
 * Kept as a separate module (rather than passing `io` through every service)
 * so services can emit events without a circular dependency on the socket
 * bootstrap code.
 */
function setIo(io) {
  ioInstance = io;
}

function roomName(sessionId) {
  return `session:${sessionId}`;
}

/**
 * Emits an event to everyone in a session's room. Safe no-op if sockets
 * haven't been initialized yet (e.g. during tests, which don't start
 * a Socket.IO server).
 */
function emitToSession(sessionId, event, payload = {}) {
  if (!ioInstance) return;
  ioInstance.to(roomName(sessionId)).emit(event, payload);
}

/**
 * Emits an event to everyone watching the global print queue (operator view).
 */
function emitToQueue(event, payload = {}) {
  if (!ioInstance) return;
  ioInstance.to(QUEUE_ROOM).emit(event, payload);
}

/**
 * Returns basic telemetry on socket connectivity.
 */
function getSocketStats() {
  if (!ioInstance) {
    return { initialized: false, connectedSockets: 0 };
  }
  const count = ioInstance.engine ? ioInstance.engine.clientsCount : 0;
  return { initialized: true, connectedSockets: count };
}

module.exports = { setIo, emitToSession, emitToQueue, roomName, QUEUE_ROOM, getSocketStats };
