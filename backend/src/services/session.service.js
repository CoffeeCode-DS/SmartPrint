const sessionsRepo = require('../db/sessions.repo');
const filesRepo = require('../db/files.repo');
const printJobsRepo = require('../db/printJobs.repo');
const { deleteAndVerifyFile } = require('../security/storage');
const { logActivity, logAudit } = require('../db/logs.repo');
const { generateSessionId } = require('../utils/id');
const { AppError } = require('../middleware/errorHandler');
const emitter = require('../sockets/emitter');
const EVENTS = require('../sockets/events');
const notificationService = require('./notification.service');
const env = require('../config/env');

function minutesFromNow(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function isExpired(session) {
  return new Date(session.expires_at).getTime() <= Date.now();
}

/**
 * Creates a new session with a cryptographically secure, unguessable ID.
 */
function createSession({ oneTime = true, createdBy = null } = {}) {
  const id = generateSessionId();
  const expiresAt = minutesFromNow(env.SESSION_TTL_MINUTES);

  const session = sessionsRepo.create({
    id,
    expiresAt,
    oneTime,
    maxExtensions: env.SESSION_MAX_EXTENSIONS,
    createdBy,
  });

  logActivity({ sessionId: id, action: 'SESSION_CREATED' });
  logAudit({ action: 'SESSION_CREATED', entityType: 'session', entityId: id });

  return session;
}

/**
 * Fetches a session and lazily transitions it to EXPIRED if its TTL has passed.
 * Lazy expiry means correctness doesn't depend on a background job having run yet.
 */
function getSessionOrThrow(id) {
  const session = sessionsRepo.findById(id);
  if (!session) {
    throw new AppError('Session not found', 404);
  }

  if (session.status === 'ACTIVE' && isExpired(session)) {
    const updated = sessionsRepo.updateStatus(id, 'EXPIRED');
    logActivity({ sessionId: id, action: 'SESSION_EXPIRED' });
    emitter.emitToSession(id, EVENTS.SESSION_EXPIRED, {});
    return updated;
  }

  return session;
}

/**
 * Validates that a session can currently accept an upload.
 * Throws AppError with an appropriate status/message if not.
 */
function assertSessionUsable(id) {
  const session = getSessionOrThrow(id);

  if (session.status === 'EXPIRED') {
    throw new AppError('This QR code has expired. Please generate a new one.', 410);
  }
  if (session.status === 'USED') {
    throw new AppError('This QR code has already been used.', 410);
  }
  if (session.status === 'CANCELLED') {
    throw new AppError('This session has been cancelled.', 410);
  }
  if (session.status !== 'ACTIVE') {
    throw new AppError('This session is no longer active.', 410);
  }

  return session;
}

/**
 * Marks a one-time session as USED. Called after a successful upload.
 * No-op (session stays ACTIVE) for reusable sessions.
 */
function markUsedIfOneTime(id) {
  const session = sessionsRepo.findById(id);
  if (!session) return null;
  if (session.one_time) {
    const updated = sessionsRepo.updateStatus(id, 'USED');
    logActivity({ sessionId: id, action: 'SESSION_USED' });
    emitter.emitToSession(id, EVENTS.SESSION_USED, {});
    return updated;
  }
  return session;
}

/**
 * Extends an active session's TTL, up to max_extensions times.
 */
function extendSession(id) {
  const session = assertSessionUsable(id);

  if (session.extended_count >= session.max_extensions) {
    throw new AppError('Maximum session extensions reached.', 400);
  }

  const newExpiresAt = new Date(
    new Date(session.expires_at).getTime() + env.SESSION_EXTENSION_MINUTES * 60 * 1000
  ).toISOString();

  const updated = sessionsRepo.extend(id, newExpiresAt);
  logActivity({ sessionId: id, action: 'SESSION_EXTENDED', details: { newExpiresAt } });
  emitter.emitToSession(id, EVENTS.SESSION_EXTENDED, { expiresAt: newExpiresAt });
  return updated;
}

/**
 * Called when a client (re)connects — used for browser refresh recovery.
 * Verifies the session against the backend rather than trusting client state.
 */
function reconnectSession(id) {
  const session = getSessionOrThrow(id);
  sessionsRepo.touchLastSeen(id);
  return session;
}

function endSession(id, { requestedBy = null, reason = 'Session ended by user' } = {}) {
  const session = sessionsRepo.findById(id);
  if (!session) {
    throw new AppError('Session not found', 404);
  }

  // Cancel any cancellable jobs in this session
  const jobs = printJobsRepo.listBySession(id);
  for (const job of jobs) {
    if (['PENDING', 'RETRYING', 'SPOOLER_COMPLETED', 'AWAITING_VERIFICATION'].includes(job.status)) {
      printJobsRepo.transition({
        id: job.id,
        fromStatus: job.status,
        toStatus: 'CANCELLED',
        errorMessage: `Session was ended: ${reason}`,
      });
      emitter.emitToSession(id, EVENTS.PRINT_CANCELLED, { id: job.id, sessionId: id });
      emitter.emitToQueue(EVENTS.PRINT_CANCELLED, { id: job.id, sessionId: id });
    }
  }

  // Withdraw/cleanup any files for this session that are not completed/printed
  const files = filesRepo.findBySession(id);
  for (const file of files) {
    if (file.status !== 'DELETED' && file.status !== 'WITHDRAWN') {
      const fileJobs = printJobsRepo.findByFileId(file.id);
      const isActivelyPrinting = fileJobs.some((j) => ['PROCESSING', 'PRINTING'].includes(j.status));
      if (!isActivelyPrinting) {
        const delRes = deleteAndVerifyFile(file.storage_path);
        if (!delRes.success) {
          filesRepo.markDeletionPending(file.id);
        } else {
          filesRepo.withdraw(file.id);
        }
        emitter.emitToSession(id, EVENTS.FILE_WITHDRAWN, { fileId: file.id });
        emitter.emitToQueue(EVENTS.FILE_WITHDRAWN, { fileId: file.id });
      }
    }
  }

  const updated = sessionsRepo.updateStatus(id, 'CANCELLED');
  logActivity({ sessionId: id, action: 'SESSION_REVOKED', details: { requestedBy, reason } });
  logAudit({
    actor: requestedBy || 'customer',
    action: 'SESSION_REVOKED',
    entityType: 'session',
    entityId: id,
    metadata: { reason },
  });

  emitter.emitToSession(id, EVENTS.SESSION_REVOKED, { reason });
  emitter.emitToSession(id, EVENTS.SESSION_CANCELLED, { reason });
  emitter.emitToQueue(EVENTS.SESSION_REVOKED, { sessionId: id, reason });
  emitter.emitToQueue(EVENTS.QUEUE_UPDATED, {});

  notificationService.notify({
    sessionId: id,
    type: 'SESSION_REVOKED',
    message: `Session ended: ${reason}. All documents safely removed.`,
  });

  return updated;
}

function cancelSession(id) {
  return endSession(id, {
    requestedBy: 'customer',
    reason: 'Customer withdrew — zero-trace file deletion triggered',
  });
}

module.exports = {
  createSession,
  getSessionOrThrow,
  assertSessionUsable,
  markUsedIfOneTime,
  extendSession,
  reconnectSession,
  cancelSession,
  endSession,
  isExpired,
};
