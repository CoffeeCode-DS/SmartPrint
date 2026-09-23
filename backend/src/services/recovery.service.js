const printJobsRepo = require('../db/printJobs.repo');
const filesRepo = require('../db/files.repo');
const printers = require('../printers');
const { logActivity, logAudit } = require('../db/logs.repo');
const notificationService = require('./notification.service');
const emitter = require('../sockets/emitter');
const EVENTS = require('../sockets/events');

/**
 * Startup Reconciliation & Crash/Power Failure Recovery:
 * Reads unfinished print jobs from SQLite and reconciles database state
 * with the printer subsystem.
 *
 * CRITICAL RULE: NEVER blindly create another physical print job or auto-retry
 * a job that was in-flight when the server crashed, as that would cause
 * duplicate physical prints on the customer's paper.
 */
async function reconcileJobsOnStartup() {
  const unfinishedJobs = printJobsRepo.findUnfinishedJobs();
  if (!unfinishedJobs || unfinishedJobs.length === 0) {
    return { reconciledCount: 0, jobs: [] };
  }

  const reconciled = [];

  for (const job of unfinishedJobs) {
    const file = filesRepo.findById(job.file_id);
    const printer = await printers.findPrinter(job.printer_id).catch(() => null);

    if (job.status === 'PRINTING' || job.status === 'SPOOLER_COMPLETED') {
      // In-flight print when crash/power failure happened.
      // Must require physical operator confirmation before anything else.
      printJobsRepo.transition({
        id: job.id,
        fromStatus: job.status,
        toStatus: 'AWAITING_VERIFICATION',
        progress: 95,
        verificationStatus: 'UNVERIFIED',
        verificationNotes: 'Server restarted during job. Physical inspection required to verify if pages printed or need retry.',
        errorMessage: 'System recovered after sudden termination. Please check printer tray.',
      });

      logActivity({
        sessionId: job.session_id,
        action: 'PRINT_JOB_RECOVERED_RECONCILED',
        details: { jobId: job.id, previousStatus: job.status },
      });
      logAudit({
        action: 'PRINT_JOB_RECOVERED_RECONCILED',
        entityType: 'print_job',
        entityId: job.id,
        metadata: { previousStatus: job.status, printerId: job.printer_id },
      });

      const updated = printJobsRepo.findById(job.id);
      emitter.emitToSession(job.session_id, EVENTS.PRINT_AWAITING_VERIFICATION, updated);
      emitter.emitToQueue(EVENTS.PRINT_AWAITING_VERIFICATION, updated);

      notificationService.notify({
        sessionId: job.session_id,
        type: 'PRINT_AWAITING_VERIFICATION',
        message: `Print for "${file ? file.original_name : 'document'}" was interrupted by a system restart. Please check printer tray and verify.`,
      });

      reconciled.push({ id: job.id, action: 'MOVED_TO_AWAITING_VERIFICATION' });
    } else if (job.status === 'PROCESSING') {
      // Was in processing queue before printing started.
      if (!printer || printer.status === 'OFFLINE') {
        printJobsRepo.transition({
          id: job.id,
          fromStatus: 'PROCESSING',
          toStatus: 'FAILED',
          failureCode: 'OFFLINE',
          errorMessage: 'Server restarted and printer is offline. Please retry when printer is online.',
        });
        reconciled.push({ id: job.id, action: 'MARKED_FAILED_OFFLINE' });
      } else {
        // Reset to PENDING so operator can proceed cleanly
        printJobsRepo.transition({
          id: job.id,
          fromStatus: 'PROCESSING',
          toStatus: 'PENDING',
          progress: 0,
        });
        reconciled.push({ id: job.id, action: 'RESET_TO_PENDING' });
      }
    }
  }

  return { reconciledCount: reconciled.length, jobs: reconciled };
}

module.exports = { reconcileJobsOnStartup };
