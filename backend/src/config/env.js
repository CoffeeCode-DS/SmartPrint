const dotenv = require('dotenv');
dotenv.config({ quiet: true });
const { detectLanIp } = require('../utils/network');

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const DEFAULT_FRONTEND_URL = 'http://localhost:5173';
const FRONTEND_URL = required('FRONTEND_URL', DEFAULT_FRONTEND_URL);

/**
 * Figures out the URL that should actually be embedded in QR codes.
 * "localhost" in a QR code only ever resolves to the phone scanning it,
 * never the laptop that generated it — so if nobody has explicitly
 * configured anything, auto-detect this machine's LAN IP instead. This is
 * what makes "scan the QR from your phone" work out of the box for
 * anyone on the same Wi-Fi, with zero manual .env editing.
 *
 * Priority: explicit PUBLIC_URL (e.g. an ngrok HTTPS URL) > a
 * user-customized FRONTEND_URL > auto-detected LAN IP > localhost.
 */
function computePublicUrl() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL;
  if (FRONTEND_URL !== DEFAULT_FRONTEND_URL) return FRONTEND_URL;

  const lanIp = detectLanIp();
  if (!lanIp) return FRONTEND_URL;

  try {
    const parsed = new URL(FRONTEND_URL);
    return `${parsed.protocol}//${lanIp}:${parsed.port}`;
  } catch {
    return FRONTEND_URL;
  }
}

const PUBLIC_URL = computePublicUrl();

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(required('PORT', '5000'), 10),
  FRONTEND_URL,
  // The URL actually embedded in QR codes — see computePublicUrl() above.
  PUBLIC_URL,
  // Both origins are accepted by CORS/sockets: the laptop's own browser
  // usually hits the app via FRONTEND_URL (localhost), while a phone on
  // the same Wi-Fi hits it via PUBLIC_URL (the LAN IP) — both are
  // legitimate at the same time, not a fallback of one another.
  ALLOWED_ORIGINS: [...new Set([FRONTEND_URL, PUBLIC_URL])],
  DATABASE_PATH: required('DATABASE_PATH', './data/printsafe.db'),
  SESSION_TTL_MINUTES: parseInt(required('SESSION_TTL_MINUTES', '15'), 10),
  SESSION_EXTENSION_MINUTES: parseInt(required('SESSION_EXTENSION_MINUTES', '0'), 10),
  SESSION_MAX_EXTENSIONS: parseInt(required('SESSION_MAX_EXTENSIONS', '0'), 10),
  UPLOAD_DIR: required('UPLOAD_DIR', './storage/uploads'),
  MAX_UPLOAD_SIZE_MB: parseInt(required('MAX_UPLOAD_SIZE_MB', '200'), 10),
  ALLOWED_EXTENSIONS: required('ALLOWED_EXTENSIONS', 'pdf,jpg,jpeg,png,webp,heic,heif,avif,doc,docx')
    .split(',')
    .map((e) => e.trim().toLowerCase()),
  ALLOWED_MIME_TYPES: required(
    'ALLOWED_MIME_TYPES',
    'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
    .split(',')
    .map((m) => m.trim().toLowerCase()),
  PRINTER_MODE: required('PRINTER_MODE', 'mock'),
  PRINT_MAX_ATTEMPTS: parseInt(required('PRINT_MAX_ATTEMPTS', '3'), 10),
  MOCK_PRINT_MIN_DELAY_MS: parseInt(required('MOCK_PRINT_MIN_DELAY_MS', '300'), 10),
  MOCK_PRINT_MAX_DELAY_MS: parseInt(required('MOCK_PRINT_MAX_DELAY_MS', '900'), 10),
  MOCK_PRINT_FAILURE_RATE: parseFloat(required('MOCK_PRINT_FAILURE_RATE', '0.15')),

  // Auth
  JWT_SECRET: required('JWT_SECRET', 'dev-only-insecure-secret-change-me'),
  JWT_EXPIRES_IN: required('JWT_EXPIRES_IN', '8h'),
  ADMIN_SEED_USERNAME: required('ADMIN_SEED_USERNAME', 'admin'),
  ADMIN_SEED_PASSWORD: required('ADMIN_SEED_PASSWORD', 'changeme123'),
  OPERATOR_SIGNUP_CODE: process.env.OPERATOR_SIGNUP_CODE || 'smartprint-operator-key',

  // Rate limiting
  RATE_LIMIT_WINDOW_MINUTES: parseInt(required('RATE_LIMIT_WINDOW_MINUTES', '15'), 10),
  RATE_LIMIT_MAX: parseInt(required('RATE_LIMIT_MAX', '1000'), 10),
  AUTH_RATE_LIMIT_MAX: parseInt(required('AUTH_RATE_LIMIT_MAX', '20'), 10),
  UPLOAD_RATE_LIMIT_MAX: parseInt(required('UPLOAD_RATE_LIMIT_MAX', '500'), 10),

  // Physical print confirmation & settlement
  SETTLEMENT_PERIOD_MS: parseInt(
    process.env.SETTLEMENT_PERIOD_MS || (process.env.NODE_ENV === 'test' ? '50' : '3000'),
    10
  ),
  AUTO_VERIFY_PHYSICAL_PRINT:
    process.env.AUTO_VERIFY_PHYSICAL_PRINT !== undefined
      ? process.env.AUTO_VERIFY_PHYSICAL_PRINT === 'true'
      : process.env.NODE_ENV === 'test',

  // TTL cleanup / crash recovery
  CLEANUP_INTERVAL_SECONDS: parseInt(required('CLEANUP_INTERVAL_SECONDS', '60'), 10),
  FILE_RETENTION_MINUTES_AFTER_SESSION_END: parseInt(
    required('FILE_RETENTION_MINUTES_AFTER_SESSION_END', '7'),
    10
  ),
  STALE_JOB_TIMEOUT_MINUTES: parseInt(required('STALE_JOB_TIMEOUT_MINUTES', '5'), 10),
};

module.exports = env;
