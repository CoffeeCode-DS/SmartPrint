const filesRepo = require('../db/files.repo');
const sessionService = require('./session.service');
const notificationService = require('./notification.service');
const { detectFileType } = require('../security/fileSignature');
const { isFilenameSafeToDisplay, sanitizeForLogging } = require('../security/filename');
const { sha256 } = require('../security/hash');
const { writeFileSafely, readFileSafely, deleteAndVerifyFile } = require('../security/storage');
const printJobsRepo = require('../db/printJobs.repo');
const { logActivity, logAudit } = require('../db/logs.repo');
const { AppError } = require('../middleware/errorHandler');
const { generateSecureId } = require('../utils/id');
const emitter = require('../sockets/emitter');
const EVENTS = require('../sockets/events');
const env = require('../config/env');

function rejectUpload(sessionId, { status, message, reason, metadata = {} }) {
  logAudit({
    action: 'FILE_REJECTED',
    entityType: 'session',
    entityId: sessionId,
    metadata: { reason, ...metadata },
  });
  emitter.emitToSession(sessionId, EVENTS.VALIDATION_FAILED, { reason, message });
  notificationService.notify({ sessionId, type: 'UPLOAD_REJECTED', message });
  throw new AppError(message, status);
}

/**
 * Validates and stores an uploaded file for a session.
 * Every rejection reason is specific so the frontend can show a clear
 * message — but note we NEVER write anything to disk until every check
 * has passed, and we never trust the browser-declared MIME type.
 */
function handleUpload({ sessionId, buffer, originalName, declaredMimeType }) {
  // 1. Session must currently be usable (active, not expired/used/cancelled).
  sessionService.assertSessionUsable(sessionId);

  const safeDisplayName = isFilenameSafeToDisplay(originalName)
    ? originalName
    : sanitizeForLogging(originalName);

  // 2. Reject empty uploads.
  if (!buffer || buffer.length === 0) {
    rejectUpload(sessionId, {
      status: 400,
      message: 'Uploaded file is empty.',
      reason: 'EMPTY_FILE',
      metadata: { originalName: safeDisplayName },
    });
  }

  // 3. Enforce max size (multer also enforces this, this is defense in depth).
  const maxBytes = env.MAX_UPLOAD_SIZE_MB * 1024 * 1024;
  if (buffer.length > maxBytes) {
    rejectUpload(sessionId, {
      status: 400,
      message: `File exceeds the maximum allowed size of ${env.MAX_UPLOAD_SIZE_MB}MB.`,
      reason: 'FILE_TOO_LARGE',
      metadata: { size: buffer.length },
    });
  }

  // 4. Detect the REAL file type from its binary content — never trust
  //    the browser-supplied MIME type or the filename extension alone.
  const detected = detectFileType(buffer);
  if (!detected) {
    rejectUpload(sessionId, {
      status: 415,
      message: 'File type could not be verified or is not supported.',
      reason: 'UNRECOGNIZED_FILE_TYPE',
      metadata: { declaredMimeType, originalName: safeDisplayName },
    });
  }

  // 5. Confirm the detected type is in the configured allowlist.
  if (
    !env.ALLOWED_EXTENSIONS.includes(detected.ext) ||
    !env.ALLOWED_MIME_TYPES.includes(detected.mime)
  ) {
    rejectUpload(sessionId, {
      status: 415,
      message: `File type ".${detected.ext}" is not allowed.`,
      reason: 'DISALLOWED_FILE_TYPE',
      metadata: { detected },
    });
  }

  // 6. Hash for integrity + duplicate detection.
  const hash = sha256(buffer);
  const existing = filesRepo.findByHash(hash);
  const isDuplicate = !!existing;

  // 7. Only now — after every check has passed — do we touch the filesystem.
  const { storedName, storagePath } = writeFileSafely(sessionId, detected.ext, buffer);

  const fileId = generateSecureId(16);
  const fileRow = filesRepo.create({
    id: fileId,
    session_id: sessionId,
    original_name: safeDisplayName,
    stored_name: storedName,
    storage_path: storagePath,
    mime_type: detected.mime,
    extension: detected.ext,
    size_bytes: buffer.length,
    sha256_hash: hash,
    status: 'VALIDATED',
    duplicate_of: isDuplicate ? existing.id : null,
    uploaded_at: new Date().toISOString(),
  });

  // 8. One-time QR codes become invalid after their first successful upload.
  sessionService.markUsedIfOneTime(sessionId);

  logActivity({
    sessionId,
    action: 'FILE_UPLOADED',
    details: { fileId, sizeBytes: buffer.length, mimeType: detected.mime, isDuplicate },
  });
  logAudit({
    action: 'FILE_UPLOADED',
    entityType: 'file',
    entityId: fileId,
    metadata: { sha256: hash, sizeBytes: buffer.length, isDuplicate },
  });

  const summary = {
    file: {
      id: fileRow.id,
      originalName: fileRow.original_name,
      extension: fileRow.extension,
      mimeType: fileRow.mime_type,
      sizeBytes: fileRow.size_bytes,
      status: fileRow.status,
      uploadedAt: fileRow.uploaded_at,
    },
    isDuplicate,
  };

  emitter.emitToSession(sessionId, EVENTS.UPLOAD_COMPLETED, summary);
  notificationService.notify({
    sessionId,
    type: isDuplicate ? 'UPLOAD_DUPLICATE' : 'UPLOAD_SUCCESS',
    message: isDuplicate
      ? `"${safeDisplayName}" was uploaded — matches a previously uploaded file.`
      : `"${safeDisplayName}" was uploaded successfully.`,
  });

  return { file: fileRow, isDuplicate, duplicateOf: isDuplicate ? existing : null };
}

function getFileOrThrow(id) {
  const file = filesRepo.findById(id);
  if (!file || file.status === 'DELETED') {
    throw new AppError('File not found', 404);
  }
  return file;
}

function listFilesForSession(sessionId) {
  return filesRepo.findBySessionWithJobStatus(sessionId);
}

function listRecentFiles(limit = 50) {
  return filesRepo.listRecentWithJobStatus(limit);
}

/**
 * Returns the raw bytes of a stored file for preview/download purposes.
 * Only ever reads from inside the configured upload root (see
 * security/storage.js), regardless of what a DB row might claim.
 */
function getFileContent(id) {
  const file = getFileOrThrow(id);
  const buffer = readFileSafely(file.storage_path);
  return { buffer, mimeType: file.mime_type, originalName: file.original_name };
}

function withdrawFile(sessionId, fileId, { requestedBy = null } = {}) {
  const file = filesRepo.findById(fileId);
  if (!file || file.status === 'DELETED' || file.status === 'WITHDRAWN') {
    if (requestedBy === 'operator' || requestedBy) {
      if (file) {
        filesRepo.withdraw(file.id);
        try { deleteAndVerifyFile(file.storage_path); } catch {}
      }
      emitter.emitToQueue(EVENTS.FILE_WITHDRAWN, { fileId });
      emitter.emitToQueue(EVENTS.QUEUE_UPDATED, {});
      return file || { id: fileId, status: 'WITHDRAWN' };
    }
    throw new AppError('File not found or already removed.', 404);
  }
  if (sessionId && file.session_id !== sessionId && requestedBy !== 'operator') {
    throw new AppError('File does not belong to this session.', 403);
  }

  // Check active print jobs
  const jobs = printJobsRepo.findByFileId(fileId);
  const activeJob = jobs.find((j) => ['PROCESSING', 'PRINTING'].includes(j.status));
  if (activeJob) {
    throw new AppError('Cannot withdraw document while printing is actively in progress.', 409);
  }

  // Cancel any pending or queued jobs for this file
  const cancellableJobs = jobs.filter((j) =>
    ['PENDING', 'RETRYING', 'SPOOLER_COMPLETED', 'AWAITING_VERIFICATION'].includes(j.status)
  );
  for (const cj of cancellableJobs) {
    printJobsRepo.transition({
      id: cj.id,
      fromStatus: cj.status,
      toStatus: 'CANCELLED',
      errorMessage: 'File was withdrawn by customer before printing.',
    });
    emitter.emitToSession(sessionId, EVENTS.PRINT_CANCELLED, { id: cj.id, fileId });
    emitter.emitToQueue(EVENTS.PRINT_CANCELLED, { id: cj.id, fileId });
  }

  // Delete file from disk with verification
  deleteAndVerifyFile(file.storage_path);
  const updated = filesRepo.withdraw(file.id);

  logActivity({ sessionId, action: 'FILE_WITHDRAWN', details: { fileId, requestedBy } });
  logAudit({
    actor: requestedBy || 'customer',
    action: 'FILE_WITHDRAWN',
    entityType: 'file',
    entityId: file.id,
    metadata: { originalName: file.original_name },
  });

  emitter.emitToSession(sessionId, EVENTS.FILE_WITHDRAWN, { fileId: file.id });
  emitter.emitToQueue(EVENTS.FILE_WITHDRAWN, { fileId: file.id });
  emitter.emitToSession(sessionId, EVENTS.QUEUE_UPDATED, {});
  emitter.emitToQueue(EVENTS.QUEUE_UPDATED, {});

  notificationService.notify({
    sessionId,
    type: 'FILE_WITHDRAWN',
    message: `"${file.original_name}" was withdrawn and removed from the print station.`,
  });

  return updated;
}

module.exports = {
  handleUpload,
  getFileOrThrow,
  listFilesForSession,
  listRecentFiles,
  getFileContent,
  withdrawFile,
};
