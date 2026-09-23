process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = ':memory:';
process.env.PORT = '5099';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.PUBLIC_URL = 'http://localhost:5173';
process.env.SESSION_TTL_MINUTES = '7';
process.env.SESSION_EXTENSION_MINUTES = '5';
process.env.SESSION_MAX_EXTENSIONS = '2';

const os = require('os');
const path = require('path');
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `printsafe-test-uploads-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.MAX_UPLOAD_SIZE_MB = '25';
process.env.ALLOWED_EXTENSIONS = 'pdf,jpg,jpeg,png,webp,heic,heif,avif,doc,docx';
process.env.ALLOWED_MIME_TYPES =
  'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

process.env.PRINTER_MODE = 'mock';
process.env.PRINT_MAX_ATTEMPTS = '3';
process.env.MOCK_PRINT_MIN_DELAY_MS = '5';
process.env.MOCK_PRINT_MAX_DELAY_MS = '15';
// Deterministic by default (no random failures). Tests that need to exercise
// the FAILED/RETRYING path explicitly mock '../src/printers/mockPrinter'.
process.env.MOCK_PRINT_FAILURE_RATE = '0';

process.env.JWT_SECRET = 'test-only-secret-do-not-use-in-real-deployments';
process.env.JWT_EXPIRES_IN = '1h';
process.env.ADMIN_SEED_USERNAME = 'admin';
process.env.ADMIN_SEED_PASSWORD = 'testpassword123';

// Generous limits so the test suite itself never trips rate limiting.
process.env.RATE_LIMIT_WINDOW_MINUTES = '15';
process.env.RATE_LIMIT_MAX = '100000';
process.env.AUTH_RATE_LIMIT_MAX = '100000';
process.env.UPLOAD_RATE_LIMIT_MAX = '100000';

process.env.CLEANUP_INTERVAL_SECONDS = '60';
process.env.FILE_RETENTION_MINUTES_AFTER_SESSION_END = '15';
process.env.STALE_JOB_TIMEOUT_MINUTES = '5';
