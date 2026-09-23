const printJobsRepo = require('../db/printJobs.repo');
const filesRepo = require('../db/files.repo');
const printersRepo = require('../db/printers.repo');
const printers = require('../printers');
const { generateSecureId } = require('../utils/id');
const { AppError } = require('../middleware/errorHandler');
const { logActivity, logAudit } = require('../db/logs.repo');
const notificationService = require('./notification.service');
const { serializePrintJob } = require('../utils/serializers');
const { deleteAndVerifyFile } = require('../security/storage');
const emitter = require('../sockets/emitter');
const EVENTS = require('../sockets/events');
const env = require('../config/env');

const VALID_PAGE_RANGE = /^(all|current|\d+(-\d+)?(,\d+(-\d+)?)*)$/;

// In-process lock set to prevent concurrent duplicate processing of the same job
const activeJobProcessingLocks = new Set();

/**
 * Calculates remaining page range for partial print recovery.
 * e.g. "1-10" completed 6 -> "7-10"
 * "all" with 10 total pages completed 4 -> "5-10"
 */
function computeRemainingPageRange(originalRange, completedPages, totalPages = null) {
  if (!completedPages || completedPages <= 0) return originalRange;

  if (originalRange === 'all') {
    const start = completedPages + 1;
    if (totalPages && start <= totalPages) {
      return start === totalPages ? `${start}` : `${start}-${totalPages}`;
    }
    return `${start}-`;
  }

  const pages = [];
  const parts = originalRange.split(',').map((p) => p.trim());
  for (const part of parts) {
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-');
      const s = parseInt(startStr, 10);
      const e = parseInt(endStr, 10);
      if (!isNaN(s) && !isNaN(e)) {
        for (let i = s; i <= e; i++) pages.push(i);
      }
    } else {
      const p = parseInt(part, 10);
      if (!isNaN(p)) pages.push(p);
    }
  }

  const remaining = pages.slice(completedPages);
  if (remaining.length === 0) return originalRange;

  const ranges = [];
  let rangeStart = remaining[0];
  let prev = remaining[0];

  for (let i = 1; i < remaining.length; i++) {
    const curr = remaining[i];
    if (curr === prev + 1) {
      prev = curr;
    } else {
      ranges.push(rangeStart === prev ? `${rangeStart}` : `${rangeStart}-${prev}`);
      rangeStart = curr;
      prev = curr;
    }
  }
  ranges.push(rangeStart === prev ? `${rangeStart}` : `${rangeStart}-${prev}`);
  return ranges.join(',');
}

/**
 * Validates requested print settings against what the selected
 * printer actually supports. Returns normalized settings object ready to store.
 */
function validateSettings(printer, raw = {}) {
  const maxCopies = printer.capabilities?.maxCopies || 99;
  const copiesProvided = raw.copies === undefined || raw.copies === null || raw.copies === '';
  const copies = copiesProvided ? 1 : parseInt(raw.copies, 10);
  if (!Number.isInteger(copies) || copies < 1 || copies > maxCopies) {
    throw new AppError(`Copies must be a whole number between 1 and ${maxCopies} for ${printer.name}.`, 400);
  }

  const pageRange = (raw.pageRange || 'all').trim();
  if (!VALID_PAGE_RANGE.test(pageRange)) {
    throw new AppError('Page range must be "all", "current", or e.g. "1-3,5".', 400);
  }

  const paperSize = raw.paperSize || printer.capabilities?.paperSizes?.[0] || 'A4';
  if (printer.capabilities?.paperSizes?.length && !printer.capabilities.paperSizes.includes(paperSize)) {
    throw new AppError(`${printer.name} does not support paper size "${paperSize}".`, 400);
  }

  const orientation = raw.orientation === 'landscape' ? 'landscape' : 'portrait';

  const colorMode = raw.colorMode === 'color' ? 'color' : 'bw';
  if (colorMode === 'color' && printer.capabilities?.color === false) {
    throw new AppError(`${printer.name} does not support color printing.`, 400);
  }

  const duplex = !!raw.duplex || raw.sides === 'duplex-long-edge' || raw.sides === 'duplex-short-edge';
  if (duplex && printer.capabilities?.duplex === false) {
    throw new AppError(`${printer.name} does not support double-sided printing.`, 400);
  }

  let sides = 'single';
  if (duplex) {
    sides = raw.sides === 'duplex-short-edge' ? 'duplex-short-edge' : 'duplex-long-edge';
  }

  const validPagesPerSheet = [1, 2, 4, 6, 9, 16];
  const pagesPerSheet = raw.pagesPerSheet ? parseInt(raw.pagesPerSheet, 10) : 1;
  if (!validPagesPerSheet.includes(pagesPerSheet)) {
    throw new AppError('Pages per sheet must be one of: 1, 2, 4, 6, 9, 16.', 400);
  }

  const rawScale = raw.scale !== undefined && raw.scale !== null ? String(raw.scale).trim() : 'fit';
  let scale = 'fit';
  if (['fit', 'actual', 'shrink'].includes(rawScale)) {
    scale = rawScale;
  } else if (/^\d{1,3}%?$/.test(rawScale)) {
    const num = parseInt(rawScale.replace('%', ''), 10);
    if (num < 10 || num > 400) {
      throw new AppError('Custom scale must be between 10% and 400%.', 400);
    }
    scale = `${num}%`;
  }

  return { copies, pageRange, paperSize, orientation, colorMode, duplex, sides, pagesPerSheet, scale };
}

/**
 * Pushes print-job state changes to session and global operator queue rooms.
 */
function broadcastJobEvent(job, specificEvent) {
  const payload = serializePrintJob(job);
  emitter.emitToSession(job.session_id, specificEvent, payload);
  emitter.emitToQueue(specificEvent, payload);
  emitter.emitToSession(job.session_id, EVENTS.QUEUE_UPDATED, payload);
  emitter.emitToQueue(EVENTS.QUEUE_UPDATED, payload);
}

/**
 * Queues a file for printing on a specific printer with specific settings.
 * Includes idempotency check, printer maintenance validation, and duplicate prevention.
 */
async function createPrintJob({
  fileId,
  printerId,
  settings = {},
  requestedBy = null,
  force = false,
  idempotencyKey = null,
}) {
  // 1. Check idempotency key if provided
  if (idempotencyKey) {
    const existingJob = printJobsRepo.findByIdempotencyKey(idempotencyKey);
    if (existingJob) {
      return existingJob;
    }
  }

  const file = filesRepo.findById(fileId);
  if (!file || file.status === 'DELETED') {
    throw new AppError('File not found', 404);
  }
  if (file.status === 'WITHDRAWN') {
    throw new AppError('This file was withdrawn and cannot be printed.', 400);
  }
  if (file.status !== 'VALIDATED') {
    throw new AppError(`File is not ready to print (status: ${file.status}).`, 400);
  }

  if (!printerId) {
    throw new AppError('A printer must be selected before printing.', 400);
  }
  const printer = await printers.findPrinter(printerId);
  if (!printer) {
    throw new AppError('Selected printer was not found.', 404);
  }

  // Check maintenance override
  const override = printersRepo.getPrinterStatus(printerId);
  if (override?.status === 'MAINTENANCE') {
    throw new AppError(`${printer.name} is currently in maintenance mode and cannot accept new jobs.`, 409);
  }
  if (printer.status === 'OFFLINE' || override?.status === 'OFFLINE') {
    throw new AppError(`${printer.name} is offline and cannot accept jobs right now.`, 409);
  }

  const normalizedSettings = validateSettings(printer, settings);

  if (!force) {
    const existingJob = printJobsRepo.findActiveJobForHash(file.sha256_hash);
    if (existingJob && existingJob.file_id !== fileId) {
      throw new AppError(
        'An identical document is already queued or has already been printed.',
        409,
        { duplicateJobId: existingJob.id, duplicateFileId: existingJob.file_id }
      );
    }
  }

  const id = generateSecureId(16);
  const job = printJobsRepo.create({
    id,
    file_id: fileId,
    session_id: file.session_id,
    max_attempts: env.PRINT_MAX_ATTEMPTS,
    requested_by: requestedBy,
    printer_id: printer.id,
    printer_name: printer.name,
    copies: normalizedSettings.copies,
    page_range: normalizedSettings.pageRange,
    paper_size: normalizedSettings.paperSize,
    orientation: normalizedSettings.orientation,
    color_mode: normalizedSettings.colorMode,
    duplex: normalizedSettings.duplex,
    sides: normalizedSettings.sides,
    pages_per_sheet: normalizedSettings.pagesPerSheet,
    scale: normalizedSettings.scale,
    progress: 0,
    completed_pages: 0,
    verification_status: 'UNVERIFIED',
    idempotency_key: idempotencyKey,
  });

  logActivity({
    sessionId: file.session_id,
    action: 'PRINT_JOB_CREATED',
    details: { jobId: id, fileId, printerId: printer.id, ...normalizedSettings },
  });
  logAudit({
    actor: requestedBy || 'system',
    action: 'PRINT_JOB_CREATED',
    entityType: 'print_job',
    entityId: id,
    metadata: { printerId: printer.id, idempotencyKey },
  });

  broadcastJobEvent(job, EVENTS.PRINT_JOB_CREATED);
  notificationService.notify({
    sessionId: file.session_id,
    type: 'PRINT_QUEUED',
    message: `"${file.original_name}" was added to the print queue on ${printer.name}.`,
  });

  processJob(id).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`Unexpected error processing print job ${id}:`, err);
  });

  return job;
}

/**
 * Drives a job through:
 * PENDING -> PROCESSING -> PRINTING -> SPOOLER COMPLETED -> SETTLEMENT -> AWAITING_VERIFICATION.
 * Document is NEVER deleted before physical confirmation.
 */
async function processJob(jobId) {
  if (activeJobProcessingLocks.has(jobId)) return;
  activeJobProcessingLocks.add(jobId);

  try {
    const job = printJobsRepo.findById(jobId);
    if (!job) return;

    const claimedProcessing = printJobsRepo.transition({
      id: jobId,
      fromStatus: job.status,
      toStatus: 'PROCESSING',
    });
    if (!claimedProcessing) return;

    broadcastJobEvent(printJobsRepo.findById(jobId), EVENTS.QUEUE_UPDATED);

    printJobsRepo.transition({
      id: jobId,
      fromStatus: 'PROCESSING',
      toStatus: 'PRINTING',
      progress: 40,
    });
    const printingJob = printJobsRepo.findById(jobId);
    broadcastJobEvent(printingJob, EVENTS.PRINT_STARTED);

    const file = filesRepo.findById(job.file_id);
    if (!file || file.status === 'WITHDRAWN' || file.status === 'DELETED') {
      throw new Error('Associated document is no longer available to print.');
    }

    // Step 1: Send print data to printer driver / spooler
    const result = await printers.print({
      printerId: job.printer_id,
      jobId,
      filePath: file.storage_path,
      copies: job.copies,
      pageRange: job.page_range,
      paperSize: job.paper_size,
      orientation: job.orientation,
      colorMode: job.color_mode,
      duplex: !!job.duplex,
      sides: job.sides || 'single',
      pagesPerSheet: job.pages_per_sheet || 1,
      scale: job.scale || 'fit',
    });

    // Step 2: Spooler completed
    const activeMode = printers.getBackend?.()?.mode || 'mock';
    const servedBy =
      job.printer_id === 'demo-smartprint-laserjet'
        ? 'demo'
        : activeMode === 'windows'
        ? 'windows'
        : activeMode === 'system'
        ? 'cups'
        : 'mock';

    logAudit({
      sessionId: job.session_id,
      action: 'PRINT_JOB_DISPATCHED',
      entityType: 'print_job',
      entityId: jobId,
      metadata: {
        printerId: job.printer_id,
        printerName: result.printerName,
        servedBy,
        copies: job.copies,
        pageRange: job.page_range,
      },
    });

    printJobsRepo.transition({
      id: jobId,
      fromStatus: 'PRINTING',
      toStatus: 'SPOOLER_COMPLETED',
      printerName: result.printerName,
      progress: 85,
    });
    const spooledJob = printJobsRepo.findById(jobId);
    broadcastJobEvent(spooledJob, EVENTS.PRINT_SPOOLER_COMPLETED);

    // Step 3: Short settlement period (allowing printer hardware buffer and paper feed to complete)
    const settlementMs = env.SETTLEMENT_PERIOD_MS || 1000;
    await new Promise((resolve) => setTimeout(resolve, settlementMs));

    // Step 4: Transition to AWAITING_VERIFICATION (or auto-verify if configured in test)
    printJobsRepo.transition({
      id: jobId,
      fromStatus: 'SPOOLER_COMPLETED',
      toStatus: 'AWAITING_VERIFICATION',
      progress: 95,
    });
    const awaitingJob = printJobsRepo.findById(jobId);
    broadcastJobEvent(awaitingJob, EVENTS.PRINT_AWAITING_VERIFICATION);

    notificationService.notify({
      sessionId: job.session_id,
      type: 'PRINT_AWAITING_VERIFICATION',
      message: `"${file.original_name}" printed on ${result.printerName}. Please verify physical print.`,
    });

    // If auto-verify is enabled (e.g. for legacy test mode where test expects immediate COMPLETED)
    if (env.AUTO_VERIFY_PHYSICAL_PRINT) {
      await verifyPrintJob(jobId, { verified: true, operatorId: 'auto-system' });
    }
  } catch (err) {
    const failureCode =
      err.failureCode ||
      (err.message?.toLowerCase().includes('jam')
        ? 'PAPER_JAM'
        : err.message?.toLowerCase().includes('paper')
        ? 'OUT_OF_PAPER'
        : err.message?.toLowerCase().includes('toner')
        ? 'LOW_TONER'
        : err.message?.toLowerCase().includes('cover') || err.message?.toLowerCase().includes('door')
        ? 'COVER_OPEN'
        : err.message?.toLowerCase().includes('offline')
        ? 'OFFLINE'
        : 'UNKNOWN_ERROR');

    printJobsRepo.incrementAttempt(jobId);
    printJobsRepo.transition({
      id: jobId,
      fromStatus: 'PRINTING',
      toStatus: 'FAILED',
      errorMessage: err.message,
      failureCode,
    });
    // Also handle if it threw during PROCESSING
    printJobsRepo.transition({
      id: jobId,
      fromStatus: 'PROCESSING',
      toStatus: 'FAILED',
      errorMessage: err.message,
      failureCode,
    });

    const failedJob = printJobsRepo.findById(jobId);
    logActivity({
      sessionId: failedJob?.session_id,
      action: 'PRINT_JOB_FAILED',
      details: { jobId, error: err.message, failureCode },
    });
    logAudit({
      action: 'PRINT_JOB_FAILED',
      entityType: 'print_job',
      entityId: jobId,
      metadata: { error: err.message, failureCode },
    });

    if (failedJob) {
      broadcastJobEvent(failedJob, EVENTS.PRINT_FAILED);
      const f = filesRepo.findById(failedJob.file_id);
      notificationService.notify({
        sessionId: failedJob.session_id,
        type: 'PRINT_FAILED',
        message: `Printing "${f ? f.original_name : 'document'}" failed: ${err.message}`,
      });
    }
  } finally {
    activeJobProcessingLocks.delete(jobId);
  }
}

/**
 * Operator physical print verification:
 * - YES: marks COMPLETED / CONFIRMED -> deletes file from disk with verification -> marks DELETED (or DELETION_PENDING if disk delete failed).
 * - NO: marks FAILED -> retains document on disk for Retry / Change Printer.
 */
async function verifyPrintJob(jobId, { verified, failureCode, failureReason, notes, completedPages, operatorId = null }) {
  const job = printJobsRepo.findById(jobId);
  if (!job) throw new AppError('Print job not found', 404);

  const allowedStatuses = ['AWAITING_VERIFICATION', 'SPOOLER_COMPLETED', 'PRINTING'];
  if (!allowedStatuses.includes(job.status)) {
    throw new AppError(`Cannot verify job in status ${job.status}.`, 400);
  }

  if (verified) {
    printJobsRepo.transition({
      id: jobId,
      fromStatus: job.status,
      toStatus: 'COMPLETED',
      completedAt: new Date().toISOString(),
      progress: 100,
      verificationStatus: 'CONFIRMED',
      verifiedAt: new Date().toISOString(),
      verificationNotes: notes || 'Physical print verified by operator',
    });

    const completedJob = printJobsRepo.findById(jobId);
    logActivity({
      sessionId: job.session_id,
      action: 'PRINT_JOB_VERIFIED',
      details: { jobId, operatorId, notes },
    });
    logAudit({
      actor: operatorId || 'system',
      action: 'PRINT_JOB_VERIFIED',
      entityType: 'print_job',
      entityId: jobId,
      metadata: { notes },
    });

    broadcastJobEvent(completedJob, EVENTS.PRINT_VERIFIED);
    broadcastJobEvent(completedJob, EVENTS.PRINT_COMPLETED);

    const file = filesRepo.findById(job.file_id);
    if (file) {
      notificationService.notify({
        sessionId: job.session_id,
        type: 'PRINT_COMPLETED',
        message: `"${file.original_name}" printed and physically verified.`,
      });

      // Secure verified file deletion after physical confirmation
      const delResult = deleteAndVerifyFile(file.storage_path);
      if (delResult.success) {
        filesRepo.markDeleted(file.id);
        logActivity({
          sessionId: job.session_id,
          action: 'FILE_DELETED_POST_VERIFICATION',
          details: { fileId: file.id },
        });
        logAudit({
          actor: operatorId || 'system',
          action: 'FILE_DELETED_POST_VERIFICATION',
          entityType: 'file',
          entityId: file.id,
        });
        emitter.emitToSession(job.session_id, EVENTS.FILE_DELETED, { fileId: file.id });
      } else {
        filesRepo.markDeletionPending(file.id);
        logAudit({
          actor: operatorId || 'system',
          action: 'FILE_DELETION_FAILED',
          entityType: 'file',
          entityId: file.id,
          metadata: { error: delResult.error },
        });
      }
    }

    return completedJob;
  } else {
    // Physical print failed: retain document on disk
    printJobsRepo.incrementAttempt(jobId);
    printJobsRepo.transition({
      id: jobId,
      fromStatus: job.status,
      toStatus: 'FAILED',
      failureCode: failureCode || 'OPERATOR_REPORTED_FAILURE',
      errorMessage: failureReason || 'Operator indicated physical print failed.',
      verificationStatus: 'FAILED',
      verificationNotes: notes,
      completedPages: completedPages !== undefined ? parseInt(completedPages, 10) : job.completed_pages,
    });

    const failedJob = printJobsRepo.findById(jobId);
    logActivity({
      sessionId: job.session_id,
      action: 'PRINT_JOB_VERIFICATION_FAILED',
      details: { jobId, operatorId, failureCode, failureReason, completedPages },
    });
    logAudit({
      actor: operatorId || 'system',
      action: 'PRINT_JOB_VERIFICATION_FAILED',
      entityType: 'print_job',
      entityId: jobId,
      metadata: { failureCode, failureReason, completedPages },
    });

    broadcastJobEvent(failedJob, EVENTS.PRINT_FAILED);
    const file = filesRepo.findById(job.file_id);
    notificationService.notify({
      sessionId: job.session_id,
      type: 'PRINT_FAILED',
      message: `Physical print failed for "${file ? file.original_name : 'document'}": ${failureReason || 'Verification rejected'}`,
    });

    return failedJob;
  }
}

/**
 * Retries a failed print job.
 */
function retryPrintJob(jobId, { requestedBy = null } = {}) {
  const job = printJobsRepo.findById(jobId);
  if (!job) throw new AppError('Print job not found', 404);
  if (job.status !== 'FAILED') {
    throw new AppError(`Only FAILED jobs can be retried (current status: ${job.status}).`, 400);
  }
  if (job.attempts >= job.max_attempts) {
    throw new AppError('Maximum retry attempts reached for this print job.', 400);
  }

  const claimed = printJobsRepo.transition({ id: jobId, fromStatus: 'FAILED', toStatus: 'RETRYING' });
  if (!claimed) {
    throw new AppError('This job is already being retried or has changed state.', 409);
  }

  const updated = printJobsRepo.findById(jobId);
  logActivity({ sessionId: job.session_id, action: 'PRINT_JOB_RETRY', details: { jobId, requestedBy } });
  broadcastJobEvent(updated, EVENTS.PRINT_RETRY);

  processJob(jobId).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`Unexpected error retrying print job ${jobId}:`, err);
  });

  return updated;
}

/**
 * Partial Print Recovery: Retries remaining uncompleted pages.
 */
async function retryRemainingJob(jobId, { completedPages, printerId = null, operatorId = null }) {
  const job = printJobsRepo.findById(jobId);
  if (!job) throw new AppError('Print job not found', 404);

  const donePages = completedPages !== undefined ? parseInt(completedPages, 10) : job.completed_pages;
  const remainingRange = computeRemainingPageRange(job.page_range, donePages, job.total_pages);

  let targetPrinter = null;
  if (printerId) {
    targetPrinter = await printers.findPrinter(printerId);
    if (!targetPrinter) throw new AppError('Selected target printer not found.', 404);
  }

  printJobsRepo.updatePrinterAndSettings(jobId, {
    printerId: targetPrinter ? targetPrinter.id : job.printer_id,
    printerName: targetPrinter ? targetPrinter.name : job.printer_name,
    copies: job.copies,
    pageRange: remainingRange,
    paperSize: job.paper_size,
    orientation: job.orientation,
    colorMode: job.color_mode,
    duplex: job.duplex,
    sides: job.sides,
    pagesPerSheet: job.pages_per_sheet,
    scale: job.scale,
  });

  const claimed = printJobsRepo.transition({
    id: jobId,
    fromStatus: job.status,
    toStatus: 'RETRYING',
    progress: 0,
    errorMessage: null,
  });

  if (!claimed) {
    throw new AppError('Could not retry remaining pages: job state has changed.', 409);
  }

  const updated = printJobsRepo.findById(jobId);
  logActivity({
    sessionId: job.session_id,
    action: 'PRINT_JOB_RETRY_REMAINING',
    details: { jobId, remainingRange, donePages, operatorId },
  });
  logAudit({
    actor: operatorId || 'system',
    action: 'PRINT_JOB_RETRY_REMAINING',
    entityType: 'print_job',
    entityId: jobId,
    metadata: { remainingRange, donePages },
  });

  broadcastJobEvent(updated, EVENTS.PRINT_RETRY);

  processJob(jobId).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`Unexpected error executing retry-remaining for job ${jobId}:`, err);
  });

  return updated;
}

/**
 * Restarts an entire job from the beginning.
 */
async function restartEntireJob(jobId, { printerId = null, operatorId = null }) {
  const job = printJobsRepo.findById(jobId);
  if (!job) throw new AppError('Print job not found', 404);

  let targetPrinter = null;
  if (printerId) {
    targetPrinter = await printers.findPrinter(printerId);
    if (!targetPrinter) throw new AppError('Selected target printer not found.', 404);
  }

  if (targetPrinter) {
    printJobsRepo.updatePrinterAndSettings(jobId, {
      printerId: targetPrinter.id,
      printerName: targetPrinter.name,
      copies: job.copies,
      pageRange: job.page_range,
      paperSize: job.paper_size,
      orientation: job.orientation,
      colorMode: job.color_mode,
      duplex: job.duplex,
      sides: job.sides,
      pagesPerSheet: job.pages_per_sheet,
      scale: job.scale,
    });
  }

  const claimed = printJobsRepo.transition({
    id: jobId,
    fromStatus: job.status,
    toStatus: 'RETRYING',
    progress: 0,
    errorMessage: null,
    completedPages: 0,
  });

  if (!claimed) {
    throw new AppError('Could not restart job: job state has changed.', 409);
  }

  const updated = printJobsRepo.findById(jobId);
  logActivity({ sessionId: job.session_id, action: 'PRINT_JOB_RESTARTED', details: { jobId, operatorId } });
  broadcastJobEvent(updated, EVENTS.PRINT_RETRY);

  processJob(jobId).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`Unexpected error restarting job ${jobId}:`, err);
  });

  return updated;
}

/**
 * Switches a failed/waiting job to a different printer after revalidating capabilities.
 */
async function switchPrinter(jobId, { newPrinterId, settings = {}, operatorId = null }) {
  const job = printJobsRepo.findById(jobId);
  if (!job) throw new AppError('Print job not found', 404);

  if (!['FAILED', 'AWAITING_VERIFICATION', 'PENDING'].includes(job.status)) {
    throw new AppError(`Cannot switch printer for a job in status ${job.status}.`, 400);
  }

  const newPrinter = await printers.findPrinter(newPrinterId);
  if (!newPrinter) throw new AppError('New printer not found.', 404);

  const override = printersRepo.getPrinterStatus(newPrinterId);
  if (override?.status === 'MAINTENANCE' || newPrinter.status === 'OFFLINE') {
    throw new AppError(`${newPrinter.name} is not available right now.`, 409);
  }

  // Merge current settings with any requested adjustments
  const mergedRaw = {
    copies: settings.copies !== undefined ? settings.copies : job.copies,
    pageRange: settings.pageRange !== undefined ? settings.pageRange : job.page_range,
    paperSize: settings.paperSize !== undefined ? settings.paperSize : job.paper_size,
    orientation: settings.orientation !== undefined ? settings.orientation : job.orientation,
    colorMode: settings.colorMode !== undefined ? settings.colorMode : job.color_mode,
    duplex: settings.duplex !== undefined ? settings.duplex : !!job.duplex,
    sides: settings.sides !== undefined ? settings.sides : job.sides,
    pagesPerSheet: settings.pagesPerSheet !== undefined ? settings.pagesPerSheet : job.pages_per_sheet,
    scale: settings.scale !== undefined ? settings.scale : job.scale,
  };

  const validated = validateSettings(newPrinter, mergedRaw);

  printJobsRepo.updatePrinterAndSettings(jobId, {
    printerId: newPrinter.id,
    printerName: newPrinter.name,
    ...validated,
  });

  const claimed = printJobsRepo.transition({
    id: jobId,
    fromStatus: job.status,
    toStatus: 'RETRYING',
    progress: 0,
    errorMessage: null,
  });

  if (!claimed) {
    throw new AppError('Could not switch printer: job state changed.', 409);
  }

  const updated = printJobsRepo.findById(jobId);
  logActivity({
    sessionId: job.session_id,
    action: 'PRINT_JOB_PRINTER_SWITCHED',
    details: { jobId, oldPrinterId: job.printer_id, newPrinterId: newPrinter.id },
  });
  logAudit({
    actor: operatorId || 'system',
    action: 'PRINT_JOB_PRINTER_SWITCHED',
    entityType: 'print_job',
    entityId: jobId,
    metadata: { oldPrinterId: job.printer_id, newPrinterId: newPrinter.id },
  });

  broadcastJobEvent(updated, EVENTS.PRINT_RETRY);

  processJob(jobId).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`Unexpected error executing switched job ${jobId}:`, err);
  });

  return updated;
}

/**
 * Safe print job cancellation.
 */
async function cancelPrintJob(jobId, { operatorId = null } = {}) {
  const job = printJobsRepo.findById(jobId);
  if (!job) throw new AppError('Print job not found', 404);

  if (job.status === 'COMPLETED') {
    throw new AppError('Cannot cancel a job that has already completed.', 400);
  }

  // If in-flight printing, attempt spooler cancellation
  if (job.status === 'PRINTING') {
    try {
      await printers.cancelJob(job.printer_id, jobId);
    } catch {
      // Best-effort spooler cancellation
    }
  }

  const claimed = printJobsRepo.transition({ id: jobId, fromStatus: job.status, toStatus: 'CANCELLED' });
  if (!claimed) {
    throw new AppError('This job has already changed state.', 409);
  }

  const updated = printJobsRepo.findById(jobId);
  logActivity({ sessionId: job.session_id, action: 'PRINT_JOB_CANCELLED', details: { jobId, operatorId } });
  logAudit({
    actor: operatorId || 'system',
    action: 'PRINT_JOB_CANCELLED',
    entityType: 'print_job',
    entityId: jobId,
  });
  broadcastJobEvent(updated, EVENTS.PRINT_CANCELLED);
  return updated;
}

function getJobOrThrow(id) {
  const job = printJobsRepo.findById(id);
  if (!job) throw new AppError('Print job not found', 404);
  return job;
}

function listQueue({ sessionId } = {}) {
  return sessionId ? printJobsRepo.listBySession(sessionId) : printJobsRepo.listAll();
}

module.exports = {
  createPrintJob,
  processJob,
  verifyPrintJob,
  retryPrintJob,
  retryRemainingJob,
  restartEntireJob,
  switchPrinter,
  cancelPrintJob,
  getJobOrThrow,
  listQueue,
  computeRemainingPageRange,
};
