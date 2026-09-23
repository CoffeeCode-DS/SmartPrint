const db = require('./index');

const getStatusStmt = db.prepare(`
  SELECT * FROM printer_maintenance WHERE printer_id = ?
`);

const setStatusStmt = db.prepare(`
  INSERT INTO printer_maintenance (printer_id, status, notes, updated_at)
  VALUES (@printer_id, @status, @notes, @updated_at)
  ON CONFLICT(printer_id) DO UPDATE SET
    status = excluded.status,
    notes = excluded.notes,
    updated_at = excluded.updated_at
`);

const listAllOverridesStmt = db.prepare(`
  SELECT * FROM printer_maintenance
`);

function getPrinterStatus(printerId) {
  return getStatusStmt.get(printerId) || null;
}

function setPrinterStatus(printerId, { status, notes = null }) {
  const updated_at = new Date().toISOString();
  setStatusStmt.run({
    printer_id: printerId,
    status,
    notes,
    updated_at,
  });
  return getStatusStmt.get(printerId);
}

function listStatusOverrides() {
  return listAllOverridesStmt.all();
}

// Ensure custom_printers table exists if not already migrated
db.exec(`
  CREATE TABLE IF NOT EXISTS custom_printers (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    type         TEXT NOT NULL DEFAULT 'network',
    ip           TEXT,
    port         INTEGER DEFAULT 9100,
    status       TEXT NOT NULL DEFAULT 'READY',
    is_default   INTEGER NOT NULL DEFAULT 0,
    capabilities TEXT,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`);

const listCustomStmt = db.prepare(`SELECT * FROM custom_printers ORDER BY created_at ASC`);
const getCustomStmt = db.prepare(`SELECT * FROM custom_printers WHERE id = ?`);
const insertCustomStmt = db.prepare(`
  INSERT INTO custom_printers (id, name, type, ip, port, status, is_default, capabilities, created_at)
  VALUES (@id, @name, @type, @ip, @port, @status, @is_default, @capabilities, @created_at)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    type = excluded.type,
    ip = excluded.ip,
    port = excluded.port,
    status = excluded.status,
    is_default = excluded.is_default,
    capabilities = excluded.capabilities
`);
const deleteCustomStmt = db.prepare(`DELETE FROM custom_printers WHERE id = ?`);
const clearDefaultsStmt = db.prepare(`UPDATE custom_printers SET is_default = 0`);
const setDefaultStmt = db.prepare(`UPDATE custom_printers SET is_default = 1 WHERE id = ?`);

function listCustomPrinters() {
  const rows = listCustomStmt.all();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    ip: r.ip,
    port: r.port,
    status: r.status,
    isDefault: Boolean(r.is_default),
    isDemo: false,
    capabilities: r.capabilities ? JSON.parse(r.capabilities) : {
      color: true,
      duplex: true,
      paperSizes: ['A4', 'Letter'],
      maxCopies: 99,
      orientations: ['portrait', 'landscape'],
    },
    createdAt: r.created_at,
  }));
}

function getCustomPrinter(id) {
  const r = getCustomStmt.get(id);
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    ip: r.ip,
    port: r.port,
    status: r.status,
    isDefault: Boolean(r.is_default),
    isDemo: false,
    capabilities: r.capabilities ? JSON.parse(r.capabilities) : {
      color: true,
      duplex: true,
      paperSizes: ['A4', 'Letter'],
      maxCopies: 99,
      orientations: ['portrait', 'landscape'],
    },
    createdAt: r.created_at,
  };
}

function addCustomPrinter({
  id,
  name,
  type = 'network',
  ip = null,
  port = 9100,
  status = 'READY',
  isDefault = false,
  capabilities = null,
}) {
  const printerId = id || `printer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const caps = capabilities || {
    color: true,
    duplex: true,
    paperSizes: ['A4', 'Letter'],
    maxCopies: 99,
    orientations: ['portrait', 'landscape'],
  };

  insertCustomStmt.run({
    id: printerId,
    name: name || `Printer ${ip || printerId}`,
    type,
    ip,
    port: parseInt(port, 10) || 9100,
    status,
    is_default: isDefault ? 1 : 0,
    capabilities: JSON.stringify(caps),
    created_at: new Date().toISOString(),
  });

  return getCustomPrinter(printerId);
}

function removeCustomPrinter(id) {
  deleteCustomStmt.run(id);
  return { success: true };
}

function setDefaultPrinter(id) {
  clearDefaultsStmt.run();
  setDefaultStmt.run(id);
  return getCustomPrinter(id);
}

module.exports = {
  getPrinterStatus,
  setPrinterStatus,
  listStatusOverrides,
  listCustomPrinters,
  getCustomPrinter,
  addCustomPrinter,
  removeCustomPrinter,
  setDefaultPrinter,
};
