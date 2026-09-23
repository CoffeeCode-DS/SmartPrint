const env = require('../config/env');

/**
 * Standard shape for all API responses.
 */
function sendSuccess(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

function sendError(res, status, message, details) {
  return res.status(status).json({
    success: false,
    error: { message, ...(details ? { details } : {}) },
  });
}

/**
 * Custom error class so controllers can throw errors with a known HTTP status.
 */
class AppError extends Error {
  constructor(message, status = 500, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/**
 * 404 handler - must be registered after all routes.
 */
function notFoundHandler(req, res) {
  return sendError(res, 404, `Route not found: ${req.method} ${req.originalUrl}`);
}

/**
 * Centralized error handler - must be registered last (4 args = Express error middleware).
 */
// eslint-disable-next-line no-unused-vars
function centralErrorHandler(err, req, res, next) {
  // Multer throws its own error type for upload-limit violations.
  if (err.name === 'MulterError') {
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'File exceeds the maximum allowed upload size.'
        : `Upload error: ${err.message}`;
    return sendError(res, 400, message);
  }

  const status = err.status || 500;
  const message = err.message || 'Internal server error';

  // Never leak stack traces or internal details to clients outside development.
  if (env.NODE_ENV !== 'production') {
    console.error(err);
  } else {
    console.error(`[ERROR] ${status} ${message}`);
  }

  // Business-level details set intentionally on AppError (e.g. which file a
  // duplicate print conflicts with) should always reach the client — only
  // the internal stack trace is dev-only.
  const details = {
    ...(err.details || {}),
    ...(env.NODE_ENV !== 'production' ? { stack: err.stack } : {}),
  };
  const hasDetails = Object.keys(details).length > 0;

  return sendError(res, status, message, hasDetails ? details : undefined);
}

module.exports = { AppError, sendSuccess, sendError, notFoundHandler, centralErrorHandler };
