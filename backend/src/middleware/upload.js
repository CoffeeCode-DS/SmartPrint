const multer = require('multer');
const env = require('../config/env');

// Memory storage: the file buffer is validated (magic bytes, size, etc.)
// BEFORE we ever write anything to disk with our own safe filename.
// The original client filename is never used as a filesystem path.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
    files: 1,
  },
});

module.exports = upload;
