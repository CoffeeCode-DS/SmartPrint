const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const env = require('../config/env');

// Ensure the directory for the DB file exists.
const dbDir = path.dirname(env.DATABASE_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(env.DATABASE_PATH);
db.pragma('journal_mode = WAL'); // better concurrency for read-heavy dashboard + writes
db.pragma('foreign_keys = ON');

function applySchema() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);
}

/**
 * `CREATE TABLE IF NOT EXISTS` (in schema.sql) only helps fresh installs —
 * it silently does nothing on a database that already has the table from
 * an earlier version of the app. These are additive, idempotent column
 * migrations for people upgrading an existing PrintSafe database (e.g.
 * adding multi-printer support to a DB created before it existed).
 *
 * Must run BEFORE applySchema(): schema.sql's CREATE INDEX statements
 * reference these columns, and on a fresh install the table doesn't exist
 * yet at all — so this safely no-ops until schema.sql creates it.
 */
function applyMigrations() {
  const tableExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'print_jobs'`)
    .get();
  if (!tableExists) return; // fresh install — schema.sql creates the table with every column already

  const printJobColumns = db.prepare(`PRAGMA table_info(print_jobs)`).all().map((c) => c.name);
  const addColumnIfMissing = (table, columns, name, definition) => {
    if (!columns.includes(name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
  };

  addColumnIfMissing('print_jobs', printJobColumns, 'printer_id', 'TEXT');
  addColumnIfMissing('print_jobs', printJobColumns, 'copies', `INTEGER NOT NULL DEFAULT 1`);
  addColumnIfMissing('print_jobs', printJobColumns, 'page_range', `TEXT NOT NULL DEFAULT 'all'`);
  addColumnIfMissing('print_jobs', printJobColumns, 'paper_size', `TEXT NOT NULL DEFAULT 'A4'`);
  addColumnIfMissing('print_jobs', printJobColumns, 'orientation', `TEXT NOT NULL DEFAULT 'portrait'`);
  addColumnIfMissing('print_jobs', printJobColumns, 'color_mode', `TEXT NOT NULL DEFAULT 'bw'`);
  addColumnIfMissing('print_jobs', printJobColumns, 'duplex', `INTEGER NOT NULL DEFAULT 0`);
  addColumnIfMissing('print_jobs', printJobColumns, 'sides', `TEXT NOT NULL DEFAULT 'single'`);
  addColumnIfMissing('print_jobs', printJobColumns, 'pages_per_sheet', `INTEGER NOT NULL DEFAULT 1`);
  addColumnIfMissing('print_jobs', printJobColumns, 'scale', `TEXT NOT NULL DEFAULT 'fit'`);
  addColumnIfMissing('print_jobs', printJobColumns, 'progress', `INTEGER NOT NULL DEFAULT 0`);
  addColumnIfMissing('print_jobs', printJobColumns, 'current_page', `INTEGER`);
  addColumnIfMissing('print_jobs', printJobColumns, 'total_pages', `INTEGER`);
  addColumnIfMissing('print_jobs', printJobColumns, 'completed_pages', `INTEGER NOT NULL DEFAULT 0`);
  addColumnIfMissing('print_jobs', printJobColumns, 'failure_code', `TEXT`);
  addColumnIfMissing('print_jobs', printJobColumns, 'verified_at', `TEXT`);
  addColumnIfMissing('print_jobs', printJobColumns, 'verification_status', `TEXT NOT NULL DEFAULT 'UNVERIFIED'`);
  addColumnIfMissing('print_jobs', printJobColumns, 'verification_notes', `TEXT`);
  addColumnIfMissing('print_jobs', printJobColumns, 'idempotency_key', `TEXT`);

  const filesColumns = db.prepare(`PRAGMA table_info(files)`).all().map((c) => c.name);
  addColumnIfMissing('files', filesColumns, 'deletion_attempts', `INTEGER NOT NULL DEFAULT 0`);

  const auditColumns = db.prepare(`PRAGMA table_info(audit_logs)`).all().map((c) => c.name);
  addColumnIfMissing('audit_logs', auditColumns, 'prev_hash', `TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000'`);
  addColumnIfMissing('audit_logs', auditColumns, 'log_hash', `TEXT NOT NULL DEFAULT ''`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS printer_maintenance (
      printer_id   TEXT PRIMARY KEY,
      status       TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'MAINTENANCE', 'OFFLINE')),
      notes        TEXT,
      updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);
}

applyMigrations();
applySchema();

module.exports = db;
