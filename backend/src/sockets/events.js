/**
 * Central list of Socket.IO event names, so we never accidentally create
 * duplicate/inconsistent event names across the codebase.
 *
 * Naming convention: 'domain:action', all emitted TO clients unless noted.
 */
module.exports = {
  // --- Client -> Server (listened to in sockets/index.js) ---
  SESSION_JOIN: 'session:join', // { sessionId, role: 'viewer' | 'uploader' }
  QUEUE_JOIN: 'queue:join', // {} - joins the global print-queue room (operator view)
  UPLOAD_STARTED: 'upload:started', // { sessionId } - relayed to room
  UPLOAD_PROGRESS: 'upload:progress', // { sessionId, percent } - relayed to room

  // --- Server -> Client ---
  SESSION_JOINED: 'session:joined', // ack to the joining socket
  CLIENT_CONNECTED: 'client:connected', // another participant joined this session's room
  CLIENT_DISCONNECTED: 'client:disconnected',
  UPLOAD_COMPLETED: 'upload:completed', // { file, isDuplicate }
  VALIDATION_FAILED: 'validation:failed', // { reason, message } - emitted when an upload is rejected
  SESSION_EXPIRED: 'session:expired',
  SESSION_USED: 'session:used',
  SESSION_EXTENDED: 'session:extended',
  SESSION_CANCELLED: 'session:cancelled',
  NOTIFICATION_CREATED: 'notification:created', // { id, type, message, createdAt }
  ERROR_NOTIFICATION: 'error:notification',

  // --- Print queue ---
  PRINT_JOB_CREATED: 'print:created',
  PRINT_STARTED: 'print:started',
  PRINT_SPOOLER_COMPLETED: 'print:spooler_completed',
  PRINT_SETTLING: 'print:settling',
  PRINT_AWAITING_VERIFICATION: 'print:awaiting_verification',
  PRINT_COMPLETED: 'print:completed',
  PRINT_VERIFIED: 'print:verified',
  PRINT_FAILED: 'print:failed',
  PRINT_RETRY: 'print:retry',
  PRINT_CANCELLED: 'print:cancelled',
  QUEUE_UPDATED: 'queue:updated', // generic "the queue changed" signal for operator views
  PRINTERS_CHANGED: 'printers:changed',
  FILE_WITHDRAWN: 'file:withdrawn',
  FILE_DELETED: 'file:deleted',
  SESSION_REVOKED: 'session:revoked',
};
