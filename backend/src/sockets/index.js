const EVENTS = require('./events');
const emitter = require('./emitter');
const { logActivity } = require('../db/logs.repo');
const authService = require('../services/auth.service');

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Wires up all Socket.IO connection handling. Called once from server.js.
 */
function initSockets(io) {
  emitter.setIo(io);

  io.on('connection', (socket) => {
    // The global queue room exposes filenames/status across ALL sessions —
    // it must carry the same RBAC guarantee as the REST /api/print-jobs
    // routes, not just rely on the frontend not showing a "join" button.
    socket.on(EVENTS.QUEUE_JOIN, ({ token } = {}) => {
      const payload = token && authService.verifyToken(token);
      if (!payload || !['ADMIN', 'OPERATOR'].includes(payload.role)) {
        socket.emit(EVENTS.ERROR_NOTIFICATION, { message: 'Not authorized to view the print queue.' });
        return;
      }
      socket.join(emitter.QUEUE_ROOM);
    });

    socket.on(EVENTS.SESSION_JOIN, ({ sessionId, role } = {}) => {
      if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
        socket.emit(EVENTS.ERROR_NOTIFICATION, { message: 'Invalid session ID' });
        return;
      }
      const safeRole = role === 'uploader' ? 'uploader' : 'viewer';

      socket.join(emitter.roomName(sessionId));
      socket.data.sessionId = sessionId;
      socket.data.role = safeRole;

      socket.emit(EVENTS.SESSION_JOINED, { sessionId });
      socket.to(emitter.roomName(sessionId)).emit(EVENTS.CLIENT_CONNECTED, { role: safeRole });

      logActivity({ sessionId, action: 'SOCKET_CONNECTED', details: { role: safeRole } });
    });

    // Relayed, not persisted: lets the uploading device (phone) signal the
    // dashboard in real time while a large file is transferring.
    socket.on(EVENTS.UPLOAD_STARTED, ({ sessionId } = {}) => {
      if (socket.data.sessionId !== sessionId) return;
      socket.to(emitter.roomName(sessionId)).emit(EVENTS.UPLOAD_STARTED, {});
    });

    socket.on(EVENTS.UPLOAD_PROGRESS, ({ sessionId, percent } = {}) => {
      if (socket.data.sessionId !== sessionId) return;
      const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
      socket.to(emitter.roomName(sessionId)).emit(EVENTS.UPLOAD_PROGRESS, { percent: safePercent });
    });

    socket.on('disconnect', () => {
      if (socket.data.sessionId) {
        socket
          .to(emitter.roomName(socket.data.sessionId))
          .emit(EVENTS.CLIENT_DISCONNECTED, { role: socket.data.role });
      }
    });
  });
}

module.exports = { initSockets };
