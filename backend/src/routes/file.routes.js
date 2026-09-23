const express = require('express');
const rateLimit = require('express-rate-limit');
const asyncHandler = require('../middleware/asyncHandler');
const upload = require('../middleware/upload');
const { authenticate, optionalAuthenticate, requireRole } = require('../middleware/auth');
const fileController = require('../controllers/file.controller');
const env = require('../config/env');

const uploadLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  max: env.UPLOAD_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many uploads from this device. Please slow down.' } },
});

const sessionUploadRouter = express.Router();
// POST /api/sessions/:id/upload - upload a file into a specific session.
// Deliberately stays PUBLIC (no auth) — this is the anonymous QR-scan flow.
sessionUploadRouter.post(
  '/:id/upload',
  uploadLimiter,
  upload.single('file'),
  asyncHandler(fileController.uploadFile)
);

// GET /api/sessions/:id/files - list all files uploaded into this session
sessionUploadRouter.get(
  '/:id/files',
  asyncHandler(fileController.getSessionFiles)
);

// DELETE /api/sessions/:id/files/:fileId - customer withdraws their uploaded file before printing
sessionUploadRouter.delete(
  '/:id/files/:fileId',
  asyncHandler(fileController.withdrawFile)
);

const fileRouter = express.Router();

// GET /api/files/:id/content - raw file bytes for preview (PDF/image)
// Accessible for kiosk/anonymous previews without requiring staff login
fileRouter.get('/:id/content', optionalAuthenticate, asyncHandler(fileController.getFileContent));

// Operator/admin tooling (queue listing, metadata inspection, withdrawal) requires auth
fileRouter.use(authenticate, requireRole('ADMIN', 'OPERATOR'));
// GET /api/files - recent files with their latest print-job status (operator queue view)
fileRouter.get('/', asyncHandler(fileController.listFiles));
// GET /api/files/:id - file metadata
fileRouter.get('/:id', asyncHandler(fileController.getFile));
// DELETE /api/files/:id - operator deletes / withdraws a file
fileRouter.delete('/:id', asyncHandler(fileController.withdrawFileOperator));
// POST /api/files/:id/withdraw - operator explicitly withdraws file
fileRouter.post('/:id/withdraw', asyncHandler(fileController.withdrawFileOperator));

module.exports = { sessionUploadRouter, fileRouter };
