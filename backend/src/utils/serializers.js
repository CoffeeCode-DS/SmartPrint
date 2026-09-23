/**
 * Converts a raw sessions table row into the shape we expose over the API.
 * Keeps internal column naming (snake_case, created_by user id, etc.)
 * separate from what the frontend consumes.
 */
function serializeSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    oneTime: !!row.one_time,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    extendedCount: row.extended_count,
    maxExtensions: row.max_extensions,
    lastSeenAt: row.last_seen_at,
  };
}

function serializePrintJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    fileId: row.file_id,
    sessionId: row.session_id,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    printerId: row.printer_id,
    printerName: row.printer_name,
    copies: row.copies,
    pageRange: row.page_range,
    paperSize: row.paper_size,
    orientation: row.orientation,
    colorMode: row.color_mode,
    duplex: !!row.duplex,
    sides: row.sides || 'single',
    pagesPerSheet: row.pages_per_sheet || 1,
    scale: row.scale || 'fit',
    progress: row.progress || 0,
    currentPage: row.current_page || null,
    totalPages: row.total_pages || null,
    completedPages: row.completed_pages || 0,
    failureCode: row.failure_code || null,
    errorMessage: row.error_message,
    verifiedAt: row.verified_at || null,
    verificationStatus: row.verification_status || 'UNVERIFIED',
    verificationNotes: row.verification_notes || null,
    idempotencyKey: row.idempotency_key || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function serializeNotification(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    type: row.type,
    message: row.message,
    isRead: !!row.is_read,
    createdAt: row.created_at,
  };
}

module.exports = { serializeSession, serializePrintJob, serializeNotification };
