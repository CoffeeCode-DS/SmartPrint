const fs = require('fs');
const path = require('path');
const filesRepo = require('../db/files.repo');
const sessionsRepo = require('../db/sessions.repo');
const printJobsRepo = require('../db/printJobs.repo');
const db = require('../db');
const { deleteAndVerifyFile, UPLOAD_ROOT } = require('../security/storage');
const { logActivity, logAudit } = require('../db/logs.repo');
const notificationService = require('./notification.service');
const emitter = require('../sockets/emitter');
const EVENTS = require('../sockets/events');
const env = require('../config/env');

function minutesAgoIso(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

/**
 * Proactively transitions any ACTIVE session whose TTL has passed to EXPIRED.
 */
function sweepExpiredSessions() {
  const now = new Date().toISOString();
  const expiredIds = sessionsRepo.findExpiredActiveIds(now);

  for (const id of expiredIds) {
    sessionsRepo.updateStatus(id, 'EXPIRED');
    logActivity({ sessionId: id, action: 'SESSION_EXPIRED' });
    emitter.emitToSession(id, EVENTS.SESSION_EXPIRED, {});
  }

  return expiredIds.length;
}

/**
 * Securely deletes files that are past their retention window and have
 * no active print jobs or awaiting confirmation jobs.
 * Uses deleteAndVerifyFile: never marks DELETED if filesystem deletion failed.
 */
function sweepOrphanedFiles() {
  const cutoff = minutesAgoIso(env.FILE_RETENTION_MINUTES_AFTER_SESSION_END);
  const candidates = filesRepo.findCleanupCandidates(cutoff);

  let deletedCount = 0;
  for (const file of candidates) {
    try {
      const delResult = deleteAndVerifyFile(file.storage_path);
      if (delResult.success) {
        filesRepo.markDeleted(file.id);
        logActivity({ sessionId: file.session_id, action: 'FILE_AUTO_DELETED', details: { fileId: file.id } });
        logAudit({ action: 'FILE_AUTO_DELETED', entityType: 'file', entityId: file.id });
        notificationService.notify({
          sessionId: file.session_id,
          type: 'FILE_DELETED',
          message: `"${file.original_name}" was automatically removed after its retention window.`,
        });
        emitter.emitToSession(file.session_id, EVENTS.FILE_DELETED, { fileId: file.id });
        emitter.emitToQueue(EVENTS.FILE_DELETED, { fileId: file.id });
        emitter.emitToQueue(EVENTS.QUEUE_UPDATED, {});
        deletedCount += 1;
      } else {
        filesRepo.markDeletionPending(file.id);
        logAudit({
          action: 'FILE_DELETION_FAILED_ON_SWEEP',
          entityType: 'file',
          entityId: file.id,
          metadata: { error: delResult.error },
        });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`Cleanup: error sweeping file ${file.id} (${file.storage_path}):`, err.message);
    }
  }

  return deletedCount;
}

/**
 * Retries failed file deletions for rows in DELETION_PENDING state.
 */
function retryPendingDeletions() {
  const pending = filesRepo.findPendingDeletions();
  let resolvedCount = 0;

  for (const file of pending) {
    try {
      const delResult = deleteAndVerifyFile(file.storage_path);
      if (delResult.success) {
        filesRepo.markDeleted(file.id);
        logAudit({
          action: 'FILE_DELETION_RETRY_SUCCESS',
          entityType: 'file',
          entityId: file.id,
          metadata: { attempts: file.deletion_attempts + 1 },
        });
        resolvedCount += 1;
      } else {
        filesRepo.incrementDeletionAttempts(file.id);
      }
    } catch (err) {
      filesRepo.incrementDeletionAttempts(file.id);
    }
  }

  return resolvedCount;
}

/**
 * Detects and safely cleans orphaned files existing on disk without database records.
 * Only cleans files older than graceMinutes to avoid racing with active uploads.
 */
function sweepOrphanFilesOnDisk(graceMinutes = 5) {
  if (!fs.existsSync(UPLOAD_ROOT)) return 0;

  const validFiles = filesRepo.listAllValidFiles();
  const knownStoragePaths = new Set(validFiles.map((f) => path.resolve(f.storage_path)));

  const cutoffTime = Date.now() - graceMinutes * 60 * 1000;
  let cleanedCount = 0;

  try {
    const sessionDirs = fs.readdirSync(UPLOAD_ROOT, { withFileTypes: true });

    for (const sDir of sessionDirs) {
      if (!sDir.isDirectory()) continue;
      const sessionPath = path.join(UPLOAD_ROOT, sDir.name);

      let fileEntries;
      try {
        fileEntries = fs.readdirSync(sessionPath, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const fe of fileEntries) {
        if (!fe.isFile()) continue;
        const filePath = path.resolve(path.join(sessionPath, fe.name));

        if (!knownStoragePaths.has(filePath)) {
          try {
            const stat = fs.statSync(filePath);
            if (stat.mtimeMs < cutoffTime) {
              fs.unlinkSync(filePath);
              cleanedCount += 1;
              logAudit({
                action: 'ORPHAN_DISK_FILE_DELETED',
                entityType: 'storage',
                entityId: fe.name,
                metadata: { sessionDir: sDir.name, ageMinutes: Math.round((Date.now() - stat.mtimeMs) / 60000) },
              });
            }
          } catch {
            // non-fatal
          }
        }
      }

      // If session folder is empty, clean it up
      try {
        const remaining = fs.readdirSync(sessionPath);
        if (remaining.length === 0) {
          fs.rmdirSync(sessionPath);
        }
      } catch {
        // non-fatal
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Cleanup: error scanning orphan files on disk:', err.message);
  }

  return cleanedCount;
}

/**
 * Server crash recovery for long-stuck jobs.
 */
function recoverStaleJobs() {
  const cutoff = minutesAgoIso(env.STALE_JOB_TIMEOUT_MINUTES);
  const staleJobs = db
    .prepare(`SELECT * FROM print_jobs WHERE status IN ('PROCESSING', 'PRINTING') AND updated_at < ?`)
    .all(cutoff);

  for (const job of staleJobs) {
    const claimed = printJobsRepo.transition({
      id: job.id,
      fromStatus: job.status,
      toStatus: 'FAILED',
      failureCode: 'SPOOLER_TIMEOUT',
      errorMessage: 'Job timed out without response (server restart or stalled printer). Please inspect printer and retry.',
    });
    if (claimed) {
      printJobsRepo.incrementAttempt(job.id);
      logActivity({ sessionId: job.session_id, action: 'PRINT_JOB_RECOVERED_STALE', details: { jobId: job.id } });
      logAudit({ action: 'PRINT_JOB_RECOVERED_STALE', entityType: 'print_job', entityId: job.id });
      const updated = printJobsRepo.findById(job.id);
      emitter.emitToSession(job.session_id, EVENTS.PRINT_FAILED, updated);
      emitter.emitToQueue(EVENTS.PRINT_FAILED, updated);

      const file = filesRepo.findById(job.file_id);
      notificationService.notify({
        sessionId: job.session_id,
        type: 'PRINT_FAILED',
        message: `Printing "${file ? file.original_name : 'document'}" timed out. It can be retried.`,
      });
    }
  }

  return staleJobs.length;
}

let lastSweepStats = null;

/**
 * Runs the comprehensive cleanup sweep.
 */
function runCleanupSweep() {
  const recovered = recoverStaleJobs();
  const expiredSessions = sweepExpiredSessions();
  const deletedFiles = sweepOrphanedFiles();
  const retriedDeletions = retryPendingDeletions();
  const orphanDiskFiles = sweepOrphanFilesOnDisk();

  lastSweepStats = {
    timestamp: new Date().toISOString(),
    recovered,
    expiredSessions,
    deletedFiles,
    retriedDeletions,
    orphanDiskFiles,
  };

  if (recovered || expiredSessions || deletedFiles || retriedDeletions || orphanDiskFiles) {
    logAudit({
      action: 'CLEANUP_SWEEP',
      entityType: 'system',
      metadata: lastSweepStats,
    });
  }

  return lastSweepStats;
}

function getLastSweepStats() {
  return lastSweepStats;
}

module.exports = {
  sweepExpiredSessions,
  sweepOrphanedFiles,
  retryPendingDeletions,
  sweepOrphanFilesOnDisk,
  recoverStaleJobs,
  runCleanupSweep,
  getLastSweepStats,
};
