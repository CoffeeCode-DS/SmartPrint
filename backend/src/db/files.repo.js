const db = require('../db');

const insertStmt = db.prepare(`
  INSERT INTO files (
    id, session_id, original_name, stored_name, storage_path,
    mime_type, extension, size_bytes, sha256_hash, status,
    rejection_reason, duplicate_of, uploaded_at
  ) VALUES (
    @id, @session_id, @original_name, @stored_name, @storage_path,
    @mime_type, @extension, @size_bytes, @sha256_hash, @status,
    @rejection_reason, @duplicate_of, @uploaded_at
  )
`);

const findByIdStmt = db.prepare(`SELECT * FROM files WHERE id = ?`);

const findByHashStmt = db.prepare(`
  SELECT * FROM files
  WHERE sha256_hash = ? AND status != 'DELETED'
  ORDER BY uploaded_at ASC
  LIMIT 1
`);

const findBySessionStmt = db.prepare(`
  SELECT * FROM files WHERE session_id = ? ORDER BY uploaded_at DESC
`);

const findBySessionWithJobStatusStmt = db.prepare(`
  SELECT
    f.*,
    pj.id AS latest_job_id,
    pj.status AS latest_job_status
  FROM files f
  LEFT JOIN print_jobs pj ON pj.id = (
    SELECT id FROM print_jobs WHERE file_id = f.id ORDER BY created_at DESC LIMIT 1
  )
  WHERE f.session_id = ? AND f.status != 'WITHDRAWN'
  ORDER BY f.uploaded_at DESC
`);

const markDeletedStmt = db.prepare(`
  UPDATE files SET status = 'DELETED', deleted_at = ? WHERE id = ?
`);

const markDeletionPendingStmt = db.prepare(`
  UPDATE files SET status = 'DELETION_PENDING', deletion_attempts = deletion_attempts + 1 WHERE id = ?
`);

const incrementDeletionAttemptsStmt = db.prepare(`
  UPDATE files SET deletion_attempts = deletion_attempts + 1 WHERE id = ?
`);

const findPendingDeletionsStmt = db.prepare(`
  SELECT * FROM files WHERE status = 'DELETION_PENDING' ORDER BY uploaded_at ASC
`);

const withdrawStmt = db.prepare(`
  UPDATE files SET status = 'WITHDRAWN', deleted_at = ? WHERE id = ?
`);

// A file becomes eligible for automatic deletion once it's old enough
// (past the configured retention window from upload time) AND it has no
// print job that's still actively in flight or awaiting physical verification.
// We NEVER delete a file that's queued, processing, printing, settling, awaiting verification,
// or being retried.
const findCleanupCandidatesStmt = db.prepare(`
  SELECT f.* FROM files f
  WHERE f.status NOT IN ('DELETED', 'WITHDRAWN')
    AND f.uploaded_at < ?
    AND NOT EXISTS (
      SELECT 1 FROM print_jobs pj
      WHERE pj.file_id = f.id AND pj.status IN ('PENDING', 'PROCESSING', 'PRINTING', 'SPOOLER_COMPLETED', 'AWAITING_VERIFICATION', 'RETRYING')
    )
`);

// Recent, non-deleted files with their most recent print job status (if any)
// joined in — powers the operator "ready to print" queue view.
const listRecentWithJobStatusStmt = db.prepare(`
  SELECT
    f.*,
    pj.id AS latest_job_id,
    pj.status AS latest_job_status
  FROM files f
  LEFT JOIN print_jobs pj ON pj.id = (
    SELECT id FROM print_jobs WHERE file_id = f.id ORDER BY created_at DESC LIMIT 1
  )
  WHERE f.status != 'WITHDRAWN'
  ORDER BY f.uploaded_at DESC
  LIMIT ?
`);

const listAllValidFilesStmt = db.prepare(`
  SELECT * FROM files WHERE status != 'DELETED'
`);

function create(fields) {
  insertStmt.run({
    rejection_reason: null,
    duplicate_of: null,
    ...fields,
  });
  return findByIdStmt.get(fields.id);
}

function findById(id) {
  return findByIdStmt.get(id);
}

function findByHash(hash) {
  return findByHashStmt.get(hash);
}

function findBySession(sessionId) {
  return findBySessionStmt.all(sessionId);
}

function findBySessionWithJobStatus(sessionId) {
  return findBySessionWithJobStatusStmt.all(sessionId);
}

function markDeleted(id) {
  markDeletedStmt.run(new Date().toISOString(), id);
  return findByIdStmt.get(id);
}

function markDeletionPending(id) {
  markDeletionPendingStmt.run(id);
  return findByIdStmt.get(id);
}

function incrementDeletionAttempts(id) {
  incrementDeletionAttemptsStmt.run(id);
  return findByIdStmt.get(id);
}

function findPendingDeletions() {
  return findPendingDeletionsStmt.all();
}

function withdraw(id) {
  withdrawStmt.run(new Date().toISOString(), id);
  return findByIdStmt.get(id);
}

function findCleanupCandidates(cutoffIso) {
  return findCleanupCandidatesStmt.all(cutoffIso);
}

function listRecentWithJobStatus(limit = 50) {
  return listRecentWithJobStatusStmt.all(limit);
}

function listAllValidFiles() {
  return listAllValidFilesStmt.all();
}

module.exports = {
  create,
  findById,
  findByHash,
  findBySession,
  findBySessionWithJobStatus,
  markDeleted,
  markDeletionPending,
  incrementDeletionAttempts,
  findPendingDeletions,
  withdraw,
  findCleanupCandidates,
  listRecentWithJobStatus,
  listAllValidFiles,
};
