const db = require('../db');

const insertStmt = db.prepare(`
  INSERT INTO print_jobs (
    id, file_id, session_id, status, attempts, max_attempts,
    printer_id, printer_name, copies, page_range, paper_size, orientation, color_mode, duplex,
    sides, pages_per_sheet, scale, progress, current_page, total_pages, completed_pages,
    failure_code, error_message, verified_at, verification_status, verification_notes, idempotency_key,
    requested_by, created_at, updated_at
  ) VALUES (
    @id, @file_id, @session_id, 'PENDING', 0, @max_attempts,
    @printer_id, @printer_name, @copies, @page_range, @paper_size, @orientation, @color_mode, @duplex,
    @sides, @pages_per_sheet, @scale, @progress, @current_page, @total_pages, @completed_pages,
    @failure_code, @error_message, @verified_at, @verification_status, @verification_notes, @idempotency_key,
    @requested_by, @created_at, @updated_at
  )
`);

const findByIdStmt = db.prepare(`SELECT * FROM print_jobs WHERE id = ?`);

const findByIdempotencyKeyStmt = db.prepare(
  `SELECT * FROM print_jobs WHERE idempotency_key = ?`
);

const findByFileIdStmt = db.prepare(
  `SELECT * FROM print_jobs WHERE file_id = ? ORDER BY created_at DESC`
);

const listAllStmt = db.prepare(`SELECT * FROM print_jobs ORDER BY created_at DESC`);

const listBySessionStmt = db.prepare(
  `SELECT * FROM print_jobs WHERE session_id = ? ORDER BY created_at DESC`
);

// Finds an existing job (queued, printing, awaiting confirmation, or already completed)
// for any file sharing the same content hash — used for duplicate-print prevention.
const findActiveJobForHashStmt = db.prepare(`
  SELECT pj.* FROM print_jobs pj
  JOIN files f ON pj.file_id = f.id
  WHERE f.sha256_hash = ?
    AND pj.status IN ('PENDING', 'PROCESSING', 'PRINTING', 'SPOOLER_COMPLETED', 'AWAITING_VERIFICATION', 'RETRYING', 'COMPLETED')
  ORDER BY pj.created_at ASC
  LIMIT 1
`);

const findUnfinishedJobsStmt = db.prepare(`
  SELECT * FROM print_jobs
  WHERE status IN ('PENDING', 'PROCESSING', 'PRINTING', 'SPOOLER_COMPLETED', 'AWAITING_VERIFICATION')
  ORDER BY created_at ASC
`);

// Compare-and-swap transition: only applies if the job is still in the
// expected `fromStatus`. Returns true iff THIS call made the transition —
// callers use that to guard against double-processing the same job.
const transitionStmt = db.prepare(`
  UPDATE print_jobs
  SET status = @toStatus,
      updated_at = @updatedAt,
      printer_name = COALESCE(@printerName, printer_name),
      error_message = @errorMessage,
      failure_code = COALESCE(@failureCode, failure_code),
      verified_at = COALESCE(@verifiedAt, verified_at),
      verification_status = COALESCE(@verificationStatus, verification_status),
      verification_notes = COALESCE(@verificationNotes, verification_notes),
      completed_pages = COALESCE(@completedPages, completed_pages),
      completed_at = COALESCE(@completedAt, completed_at),
      progress = COALESCE(@progress, progress),
      current_page = COALESCE(@currentPage, current_page),
      total_pages = COALESCE(@totalPages, total_pages)
  WHERE id = @id AND status = @fromStatus
`);

const updateProgressStmt = db.prepare(`
  UPDATE print_jobs
  SET progress = @progress,
      current_page = COALESCE(@currentPage, current_page),
      total_pages = COALESCE(@totalPages, total_pages),
      updated_at = @updatedAt
  WHERE id = @id
`);

const updatePrinterAndSettingsStmt = db.prepare(`
  UPDATE print_jobs
  SET printer_id = @printer_id,
      printer_name = @printer_name,
      copies = @copies,
      page_range = @page_range,
      paper_size = @paper_size,
      orientation = @orientation,
      color_mode = @color_mode,
      duplex = @duplex,
      sides = @sides,
      pages_per_sheet = @pages_per_sheet,
      scale = @scale,
      updated_at = @updated_at
  WHERE id = @id
`);

const incrementAttemptStmt = db.prepare(
  `UPDATE print_jobs SET attempts = attempts + 1, updated_at = ? WHERE id = ?`
);

function create({
  id,
  file_id,
  session_id,
  max_attempts,
  requested_by,
  printer_id,
  printer_name = null,
  copies = 1,
  page_range = 'all',
  paper_size = 'A4',
  orientation = 'portrait',
  color_mode = 'bw',
  duplex = false,
  sides = 'single',
  pages_per_sheet = 1,
  scale = 'fit',
  progress = 0,
  current_page = null,
  total_pages = null,
  completed_pages = 0,
  failure_code = null,
  error_message = null,
  verified_at = null,
  verification_status = 'UNVERIFIED',
  verification_notes = null,
  idempotency_key = null,
}) {
  const now = new Date().toISOString();
  insertStmt.run({
    id,
    file_id,
    session_id,
    max_attempts,
    printer_id,
    printer_name,
    copies,
    page_range,
    paper_size,
    orientation,
    color_mode,
    duplex: duplex ? 1 : 0,
    sides: sides || 'single',
    pages_per_sheet: pages_per_sheet || 1,
    scale: scale || 'fit',
    progress: progress || 0,
    current_page: current_page || null,
    total_pages: total_pages || null,
    completed_pages: completed_pages || 0,
    failure_code: failure_code || null,
    error_message: error_message || null,
    verified_at: verified_at || null,
    verification_status: verification_status || 'UNVERIFIED',
    verification_notes: verification_notes || null,
    idempotency_key: idempotency_key || null,
    requested_by: requested_by || null,
    created_at: now,
    updated_at: now,
  });
  return findByIdStmt.get(id);
}

function findById(id) {
  return findByIdStmt.get(id);
}

function findByIdempotencyKey(key) {
  if (!key) return null;
  return findByIdempotencyKeyStmt.get(key) || null;
}

function findByFileId(fileId) {
  return findByFileIdStmt.all(fileId);
}

function listAll() {
  return listAllStmt.all();
}

function listBySession(sessionId) {
  return listBySessionStmt.all(sessionId);
}

function findActiveJobForHash(hash) {
  return findActiveJobForHashStmt.get(hash);
}

function findUnfinishedJobs() {
  return findUnfinishedJobsStmt.all();
}

function transition({
  id,
  fromStatus,
  toStatus,
  printerName = null,
  errorMessage = null,
  failureCode = null,
  verifiedAt = null,
  verificationStatus = null,
  verificationNotes = null,
  completedPages = null,
  completedAt = null,
  progress = null,
  currentPage = null,
  totalPages = null,
}) {
  const info = transitionStmt.run({
    id,
    fromStatus,
    toStatus,
    updatedAt: new Date().toISOString(),
    printerName,
    errorMessage,
    failureCode,
    verifiedAt,
    verificationStatus,
    verificationNotes,
    completedPages,
    completedAt,
    progress,
    currentPage,
    totalPages,
  });
  return info.changes === 1;
}

function updateProgress(id, { progress, currentPage = null, totalPages = null }) {
  updateProgressStmt.run({
    id,
    progress,
    currentPage,
    totalPages,
    updatedAt: new Date().toISOString(),
  });
  return findByIdStmt.get(id);
}

function updatePrinterAndSettings(id, fields) {
  updatePrinterAndSettingsStmt.run({
    id,
    printer_id: fields.printerId,
    printer_name: fields.printerName,
    copies: fields.copies || 1,
    page_range: fields.pageRange || 'all',
    paper_size: fields.paperSize || 'A4',
    orientation: fields.orientation || 'portrait',
    color_mode: fields.colorMode || 'bw',
    duplex: fields.duplex ? 1 : 0,
    sides: fields.sides || 'single',
    pages_per_sheet: fields.pagesPerSheet || 1,
    scale: fields.scale || 'fit',
    updated_at: new Date().toISOString(),
  });
  return findByIdStmt.get(id);
}

function incrementAttempt(id) {
  incrementAttemptStmt.run(new Date().toISOString(), id);
}

module.exports = {
  create,
  findById,
  findByIdempotencyKey,
  findByFileId,
  listAll,
  listBySession,
  findActiveJobForHash,
  findUnfinishedJobs,
  transition,
  updateProgress,
  updatePrinterAndSettings,
  incrementAttempt,
};
