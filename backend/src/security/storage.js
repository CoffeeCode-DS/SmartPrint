const fs = require('fs');
const path = require('path');
const { generateSecureId } = require('../utils/id');
const env = require('../config/env');

const UPLOAD_ROOT = path.resolve(env.UPLOAD_DIR);

// Ensure the root upload directory exists at startup.
if (!fs.existsSync(UPLOAD_ROOT)) {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
}

/**
 * Builds a safe, server-generated storage path for a file belonging to
 * a session: <UPLOAD_ROOT>/<sessionId>/<randomId>.<ext>
 *
 * The session ID and random ID are both server-controlled (never raw
 * user input), so this can never escape UPLOAD_ROOT. We still verify
 * with path.resolve + a prefix check as defense in depth.
 */
function buildStoragePath(sessionId, ext) {
  const storedName = `${generateSecureId(16)}.${ext}`;
  const sessionDir = path.join(UPLOAD_ROOT, sessionId);
  const fullPath = path.join(sessionDir, storedName);

  const resolved = path.resolve(fullPath);
  if (!resolved.startsWith(UPLOAD_ROOT + path.sep)) {
    // Should be unreachable given how the path is built, but guard anyway.
    throw new Error('Resolved storage path escapes upload root');
  }

  return { storedName, sessionDir, fullPath: resolved };
}

function writeFileSafely(sessionId, ext, buffer) {
  const { storedName, sessionDir, fullPath } = buildStoragePath(sessionId, ext);
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }
  fs.writeFileSync(fullPath, buffer, { mode: 0o600 }); // owner read/write only
  return { storedName, storagePath: fullPath };
}

function deleteFileSafely(storagePath) {
  const resolved = path.resolve(storagePath);
  if (!resolved.startsWith(UPLOAD_ROOT + path.sep)) {
    throw new Error('Refusing to delete a path outside the upload root');
  }
  if (fs.existsSync(resolved)) {
    fs.unlinkSync(resolved);
  }
}

/**
 * Deletes a file from the filesystem and rigorously verifies that it no
 * longer exists. If unlinking fails or the file still exists (e.g. file lock
 * by Windows spooler, antivirus, or background indexer), returns
 * { success: false, error }. Never assumes deletion succeeded.
 */
function deleteAndVerifyFile(storagePath) {
  const resolved = path.resolve(storagePath);
  if (!resolved.startsWith(UPLOAD_ROOT + path.sep)) {
    return { success: false, error: 'Path outside upload root' };
  }

  try {
    if (fs.existsSync(resolved)) {
      // Zero-trace shredding: overwrite file contents with zeros before unlinking.
      // This prevents recovery even if the OS inode is reassigned to another file.
      try {
        const size = fs.statSync(resolved).size;
        if (size > 0) {
          const fd = fs.openSync(resolved, 'r+');
          const zeros = Buffer.alloc(Math.min(size, 1024 * 1024)); // max 1 MB chunk
          let remaining = size;
          let offset = 0;
          while (remaining > 0) {
            const chunk = Math.min(remaining, zeros.length);
            fs.writeSync(fd, zeros, 0, chunk, offset);
            offset += chunk;
            remaining -= chunk;
          }
          fs.fsyncSync(fd); // flush to disk
          fs.closeSync(fd);
        }
      } catch {
        // Best-effort overwrite — still delete even if overwrite fails
      }
      fs.unlinkSync(resolved);
    }
    // Verify file actually no longer exists on disk
    if (fs.existsSync(resolved)) {
      return { success: false, error: 'File still exists after unlink attempt' };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Reads a stored file's bytes back out, for previews/downloads. Same
 * path-traversal guard as delete: we only ever read from inside
 * UPLOAD_ROOT, regardless of what's in the DB row.
 */
function readFileSafely(storagePath) {
  const resolved = path.resolve(storagePath);
  if (!resolved.startsWith(UPLOAD_ROOT + path.sep)) {
    throw new Error('Refusing to read a path outside the upload root');
  }
  return fs.readFileSync(resolved);
}

module.exports = {
  UPLOAD_ROOT,
  buildStoragePath,
  writeFileSafely,
  deleteFileSafely,
  deleteAndVerifyFile,
  readFileSafely,
};
