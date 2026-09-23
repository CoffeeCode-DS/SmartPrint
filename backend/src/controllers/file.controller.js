const fileService = require('../services/file.service');
const { sendSuccess, AppError } = require('../middleware/errorHandler');

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

function validateSessionIdParam(id) {
  if (!id || !SESSION_ID_PATTERN.test(id)) {
    throw new AppError('Invalid session ID format', 400);
  }
}

function validateFileIdParam(id) {
  if (!id || !FILE_ID_PATTERN.test(id)) {
    throw new AppError('Invalid file ID format', 400);
  }
}

async function uploadFile(req, res) {
  validateSessionIdParam(req.params.id);

  if (!req.file) {
    throw new AppError('No file was provided.', 400);
  }

  const { file, isDuplicate, duplicateOf } = fileService.handleUpload({
    sessionId: req.params.id,
    buffer: req.file.buffer,
    originalName: req.file.originalname,
    declaredMimeType: req.file.mimetype,
  });

  sendSuccess(
    res,
    {
      file: {
        id: file.id,
        originalName: file.original_name,
        extension: file.extension,
        mimeType: file.mime_type,
        sizeBytes: file.size_bytes,
        status: file.status,
        uploadedAt: file.uploaded_at,
      },
      isDuplicate,
      duplicateOf: duplicateOf
        ? { id: duplicateOf.id, uploadedAt: duplicateOf.uploaded_at }
        : null,
    },
    201
  );
}

async function getFile(req, res) {
  validateFileIdParam(req.params.id);
  const file = fileService.getFileOrThrow(req.params.id);
  sendSuccess(res, {
    file: {
      id: file.id,
      originalName: file.original_name,
      extension: file.extension,
      mimeType: file.mime_type,
      sizeBytes: file.size_bytes,
      status: file.status,
      uploadedAt: file.uploaded_at,
    },
  });
}

async function listFiles(req, res) {
  const rows = fileService.listRecentFiles(50);
  sendSuccess(res, {
    files: rows.map((f) => ({
      id: f.id,
      sessionId: f.session_id,
      originalName: f.original_name,
      extension: f.extension,
      mimeType: f.mime_type,
      sizeBytes: f.size_bytes,
      status: f.status,
      duplicateOf: f.duplicate_of,
      uploadedAt: f.uploaded_at,
      latestJobId: f.latest_job_id,
      latestJobStatus: f.latest_job_status,
    })),
  });
}

async function getFileContent(req, res) {
  validateFileIdParam(req.params.id);
  const { buffer, mimeType, originalName } = fileService.getFileContent(req.params.id);

  res.setHeader('Content-Type', mimeType);
  // 'inline' so the browser renders it (for preview) rather than force-downloading.
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(originalName)}"`);
  res.send(buffer);
}

async function getSessionFiles(req, res) {
  validateSessionIdParam(req.params.id);
  const rows = fileService.listFilesForSession(req.params.id);
  sendSuccess(res, {
    files: rows.map((f) => ({
      id: f.id,
      sessionId: f.session_id,
      originalName: f.original_name,
      extension: f.extension,
      mimeType: f.mime_type,
      sizeBytes: f.size_bytes,
      status: f.status,
      duplicateOf: f.duplicate_of,
      uploadedAt: f.uploaded_at,
      latestJobId: f.latest_job_id,
      latestJobStatus: f.latest_job_status,
    })),
  });
}

async function withdrawFile(req, res) {
  const sessionId = req.params.sessionId || req.params.id;
  const fileId = req.params.fileId;
  validateSessionIdParam(sessionId);
  validateFileIdParam(fileId);

  const requestedBy = req.user ? req.user.username : 'customer';
  const file = fileService.withdrawFile(sessionId, fileId, { requestedBy });

  sendSuccess(res, {
    message: 'File withdrawn successfully.',
    file: {
      id: file.id,
      status: file.status,
    },
  });
}

async function withdrawFileOperator(req, res) {
  const fileId = req.params.id;
  validateFileIdParam(fileId);

  const requestedBy = req.user ? req.user.username : 'operator';
  const file = fileService.withdrawFile(null, fileId, { requestedBy: 'operator' });

  sendSuccess(res, {
    message: 'File withdrawn successfully by operator.',
    file: {
      id: file.id,
      status: file.status || 'WITHDRAWN',
    },
  });
}

module.exports = {
  uploadFile,
  getFile,
  listFiles,
  getFileContent,
  getSessionFiles,
  withdrawFile,
  withdrawFileOperator,
};
