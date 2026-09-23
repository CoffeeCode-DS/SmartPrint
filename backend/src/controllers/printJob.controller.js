const printJobService = require('../services/printJob.service');
const { sendSuccess, AppError } = require('../middleware/errorHandler');
const { serializePrintJob } = require('../utils/serializers');

const ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

function validateIdParam(id, label) {
  if (!id || !ID_PATTERN.test(id)) {
    throw new AppError(`Invalid ${label} format`, 400);
  }
}

async function createPrintJob(req, res) {
  const {
    fileId,
    printerId,
    force,
    copies,
    pageRange,
    paperSize,
    orientation,
    colorMode,
    duplex,
    sides,
    pagesPerSheet,
    scale,
  } = req.body || {};
  const actualFileId = typeof fileId === 'object' && fileId !== null ? (fileId.fileId || fileId.id) : fileId;
  validateIdParam(actualFileId, 'file ID');
  if (!printerId || typeof printerId !== 'string') {
    throw new AppError('printerId is required.', 400);
  }

  const idempotencyKey =
    req.headers['idempotency-key'] || req.body?.idempotencyKey || null;

  const job = await printJobService.createPrintJob({
    fileId: actualFileId,
    printerId,
    force: !!force,
    settings: { copies, pageRange, paperSize, orientation, colorMode, duplex, sides, pagesPerSheet, scale },
    requestedBy: req.user?.id || null,
    idempotencyKey,
  });
  sendSuccess(res, { printJob: serializePrintJob(job) }, 201);
}

async function listQueue(req, res) {
  const { sessionId } = req.query;
  if (sessionId) validateIdParam(sessionId, 'session ID');
  const jobs = printJobService.listQueue({ sessionId });
  sendSuccess(res, { printJobs: jobs.map(serializePrintJob) });
}

async function getPrintJob(req, res) {
  validateIdParam(req.params.id, 'print job ID');
  const job = printJobService.getJobOrThrow(req.params.id);
  sendSuccess(res, { printJob: serializePrintJob(job) });
}

async function verifyPrintJob(req, res) {
  validateIdParam(req.params.id, 'print job ID');
  const { verified, failureCode, failureReason, notes, completedPages } = req.body || {};
  if (typeof verified !== 'boolean') {
    throw new AppError('"verified" (boolean) is required in request body.', 400);
  }

  const job = await printJobService.verifyPrintJob(req.params.id, {
    verified,
    failureCode,
    failureReason,
    notes,
    completedPages,
    operatorId: req.user?.id || null,
  });
  sendSuccess(res, { printJob: serializePrintJob(job) });
}

async function retryPrintJob(req, res) {
  validateIdParam(req.params.id, 'print job ID');
  const job = printJobService.retryPrintJob(req.params.id, { requestedBy: req.user?.id || null });
  sendSuccess(res, { printJob: serializePrintJob(job) });
}

async function retryRemainingJob(req, res) {
  validateIdParam(req.params.id, 'print job ID');
  const { completedPages, printerId } = req.body || {};
  const job = await printJobService.retryRemainingJob(req.params.id, {
    completedPages,
    printerId,
    operatorId: req.user?.id || null,
  });
  sendSuccess(res, { printJob: serializePrintJob(job) });
}

async function restartEntireJob(req, res) {
  validateIdParam(req.params.id, 'print job ID');
  const { printerId } = req.body || {};
  const job = await printJobService.restartEntireJob(req.params.id, {
    printerId,
    operatorId: req.user?.id || null,
  });
  sendSuccess(res, { printJob: serializePrintJob(job) });
}

async function switchPrinter(req, res) {
  validateIdParam(req.params.id, 'print job ID');
  const { newPrinterId, settings } = req.body || {};
  if (!newPrinterId) {
    throw new AppError('newPrinterId is required.', 400);
  }
  const job = await printJobService.switchPrinter(req.params.id, {
    newPrinterId,
    settings,
    operatorId: req.user?.id || null,
  });
  sendSuccess(res, { printJob: serializePrintJob(job) });
}

async function cancelPrintJob(req, res) {
  validateIdParam(req.params.id, 'print job ID');
  const job = await printJobService.cancelPrintJob(req.params.id, {
    operatorId: req.user?.id || null,
  });
  sendSuccess(res, { printJob: serializePrintJob(job) });
}

module.exports = {
  createPrintJob,
  listQueue,
  getPrintJob,
  verifyPrintJob,
  retryPrintJob,
  retryRemainingJob,
  restartEntireJob,
  switchPrinter,
  cancelPrintJob,
};
