const crypto = require('crypto');

/**
 * Generates a cryptographically secure, URL-safe random ID.
 * Used for session IDs, file IDs, job IDs, etc. — NEVER predictable
 * values like counters, timestamps, or userId+timestamp combos.
 *
 * 32 bytes -> 43-char base64url string. Effectively unguessable.
 */
function generateSecureId(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * Generates a shorter secure token suitable for embedding in a QR-coded URL
 * where extreme length isn't ideal for scanning, while still keeping
 * enough entropy to be unguessable (24 bytes = 192 bits).
 */
function generateSessionId() {
  return generateSecureId(24);
}

module.exports = { generateSecureId, generateSessionId };
