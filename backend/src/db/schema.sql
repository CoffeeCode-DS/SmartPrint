-- PrintSafe Database Schema
-- SQLite. Applied automatically on server startup (see db/index.js).
-- All timestamps are stored as ISO 8601 strings (UTC).

PRAGMA foreign_keys = ON;

-- ============================================================
-- USERS — for RBAC (admin/operator). Regular walk-up users of
-- the QR flow do NOT need an account; only staff do.
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('ADMIN', 'OPERATOR')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_login_at TEXT
);

-- ============================================================
-- SESSIONS — one QR code maps to one session. Never stores the
-- document itself, only session metadata.
-- ============================================================
CREATE TABLE IF NOT EXISTS sessions (
  id                TEXT PRIMARY KEY,          -- cryptographically random, unguessable
  status            TEXT NOT NULL DEFAULT 'ACTIVE'
                      CHECK (status IN ('ACTIVE', 'USED', 'EXPIRED', 'CANCELLED')),
  one_time          INTEGER NOT NULL DEFAULT 1, -- 1 = QR invalid after first successful upload
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at        TEXT NOT NULL,
  extended_count    INTEGER NOT NULL DEFAULT 0,
  max_extensions    INTEGER NOT NULL DEFAULT 3,
  created_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  last_seen_at      TEXT                        -- updated on reconnect, used for refresh recovery
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- ============================================================
-- FILES — metadata + filesystem path only. No blobs in SQLite.
-- ============================================================
CREATE TABLE IF NOT EXISTS files (
  id                 TEXT PRIMARY KEY,
  session_id         TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  original_name      TEXT NOT NULL,               -- as uploaded by the client (never used as a path)
  stored_name        TEXT NOT NULL,                -- safe, random, server-generated filename on disk
  storage_path       TEXT NOT NULL,
  mime_type          TEXT NOT NULL,
  extension          TEXT NOT NULL,
  size_bytes         INTEGER NOT NULL,
  sha256_hash        TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'UPLOADED'
                        CHECK (status IN ('UPLOADED', 'VALIDATED', 'WITHDRAWN', 'DELETION_PENDING', 'DELETED', 'REJECTED')),
  rejection_reason   TEXT,
  duplicate_of       TEXT REFERENCES files(id) ON DELETE SET NULL,
  deletion_attempts  INTEGER NOT NULL DEFAULT 0,
  uploaded_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at         TEXT
);

CREATE INDEX IF NOT EXISTS idx_files_session_id ON files(session_id);
CREATE INDEX IF NOT EXISTS idx_files_hash ON files(sha256_hash);
CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);

-- ============================================================
-- PRINT JOBS
-- ============================================================
CREATE TABLE IF NOT EXISTS print_jobs (
  id                  TEXT PRIMARY KEY,
  file_id             TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  session_id          TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  status              TEXT NOT NULL DEFAULT 'PENDING'
                         CHECK (status IN ('PENDING', 'PROCESSING', 'PRINTING', 'SPOOLER_COMPLETED', 'AWAITING_VERIFICATION', 'COMPLETED', 'FAILED', 'RETRYING', 'CANCELLED')),
  attempts            INTEGER NOT NULL DEFAULT 0,
  max_attempts        INTEGER NOT NULL DEFAULT 3,
  printer_id          TEXT,                        -- id of the selected printer at request time
  printer_name        TEXT,                        -- denormalized display name (kept even if printer later removed)
  -- Print settings, chosen by the user before confirming the job:
  copies              INTEGER NOT NULL DEFAULT 1,
  page_range          TEXT NOT NULL DEFAULT 'all',  -- 'all' | 'current' | a custom range string e.g. '1-3,5'
  paper_size          TEXT NOT NULL DEFAULT 'A4',
  orientation         TEXT NOT NULL DEFAULT 'portrait' CHECK (orientation IN ('portrait', 'landscape')),
  color_mode          TEXT NOT NULL DEFAULT 'bw' CHECK (color_mode IN ('color', 'bw')),
  duplex              INTEGER NOT NULL DEFAULT 0,   -- 0/1, only honored if the printer supports it
  sides               TEXT NOT NULL DEFAULT 'single', -- 'single' | 'duplex-long-edge' | 'duplex-short-edge'
  pages_per_sheet     INTEGER NOT NULL DEFAULT 1,  -- 1, 2, 4, 6, 9, 16
  scale               TEXT NOT NULL DEFAULT 'fit',  -- 'fit' | 'actual' | 'shrink' | 'custom' or numeric percentage
  progress            INTEGER NOT NULL DEFAULT 0,
  current_page        INTEGER,
  total_pages         INTEGER,
  completed_pages     INTEGER NOT NULL DEFAULT 0,
  failure_code        TEXT,                        -- 'PAPER_JAM', 'OUT_OF_PAPER', 'LOW_TONER', 'OFFLINE', etc.
  error_message       TEXT,
  verified_at         TEXT,                        -- operator physical confirmation timestamp
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED'
                         CHECK (verification_status IN ('UNVERIFIED', 'CONFIRMED', 'FAILED')),
  verification_notes  TEXT,
  idempotency_key     TEXT UNIQUE,
  requested_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status);
CREATE INDEX IF NOT EXISTS idx_print_jobs_file_id ON print_jobs(file_id);
CREATE INDEX IF NOT EXISTS idx_print_jobs_printer_id ON print_jobs(printer_id);
CREATE INDEX IF NOT EXISTS idx_print_jobs_idempotency ON print_jobs(idempotency_key);

-- ============================================================
-- PRINTER MAINTENANCE OVERRIDES
-- ============================================================
CREATE TABLE IF NOT EXISTS printer_maintenance (
  printer_id   TEXT PRIMARY KEY,
  status       TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'MAINTENANCE', 'OFFLINE')),
  notes        TEXT,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ============================================================
-- CUSTOM / CONFIGURED PRINTERS (Manual IP, Wi-Fi, Presets)
-- ============================================================
CREATE TABLE IF NOT EXISTS custom_printers (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'network',
  ip           TEXT,
  port         INTEGER DEFAULT 9100,
  status       TEXT NOT NULL DEFAULT 'READY',
  is_default   INTEGER NOT NULL DEFAULT 0,
  capabilities TEXT, -- JSON string
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ============================================================
-- NOTIFICATIONS — surfaced on the real-time dashboard
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  session_id  TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  message     TEXT NOT NULL,
  is_read     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_session_id ON notifications(session_id);

-- ============================================================
-- ACTIVITY LOGS — user/session-facing history (lighter weight)
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_logs (
  id          TEXT PRIMARY KEY,
  session_id  TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  details     TEXT,                              -- JSON string, never raw document content
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_session_id ON activity_logs(session_id);

-- ============================================================
-- AUDIT LOGS — security/compliance-oriented, immutable hash chain
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id          TEXT PRIMARY KEY,
  actor       TEXT NOT NULL,                      -- user id or 'system'
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  metadata    TEXT,                                -- JSON string, never document content
  ip_address  TEXT,
  prev_hash   TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  log_hash    TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_log_hash ON audit_logs(log_hash);
