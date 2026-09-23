const path = require('path');

/**
 * Checks a client-supplied filename for dangerous patterns:
 * path traversal (../), null bytes, absolute paths, and other
 * control characters. This filename is NEVER used to build a
 * filesystem path — this check exists so we can safely log/display
 * it and reject obviously malicious input early.
 */
function isFilenameSafeToDisplay(originalName) {
  if (!originalName || typeof originalName !== 'string') return false;
  if (originalName.includes('\0')) return false; // null byte injection
  if (originalName.includes('..')) return false; // traversal
  if (originalName.includes('/') || originalName.includes('\\')) return false;
  if (path.isAbsolute(originalName)) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(originalName)) return false;
  if (originalName.length > 255) return false;
  return true;
}

/**
 * Strips a filename down to something safe to store/display even if
 * isFilenameSafeToDisplay() failed — used only for logging purposes.
 */
function sanitizeForLogging(originalName) {
  if (!originalName) return '(unknown)';
  return String(originalName)
    .replace(/[\x00-\x1f]/g, '') // eslint-disable-line no-control-regex
    .replace(/[/\\]/g, '_')
    .slice(0, 255);
}

module.exports = { isFilenameSafeToDisplay, sanitizeForLogging };
