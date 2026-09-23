const db = require('../db');

const insertStmt = db.prepare(`
  INSERT INTO sessions (id, status, one_time, created_at, expires_at, extended_count, max_extensions, created_by)
  VALUES (@id, 'ACTIVE', @one_time, @created_at, @expires_at, 0, @max_extensions, @created_by)
`);

const findByIdStmt = db.prepare(`SELECT * FROM sessions WHERE id = ?`);

const updateStatusStmt = db.prepare(`UPDATE sessions SET status = ? WHERE id = ?`);

const touchLastSeenStmt = db.prepare(
  `UPDATE sessions SET last_seen_at = ? WHERE id = ?`
);

const extendStmt = db.prepare(`
  UPDATE sessions
  SET expires_at = ?, extended_count = extended_count + 1
  WHERE id = ?
`);

const findExpiredActiveStmt = db.prepare(`
  SELECT id FROM sessions WHERE status = 'ACTIVE' AND expires_at < ?
`);

function create({ id, expiresAt, oneTime, maxExtensions, createdBy }) {
  insertStmt.run({
    id,
    one_time: oneTime ? 1 : 0,
    created_at: new Date().toISOString(),
    expires_at: expiresAt,
    max_extensions: maxExtensions,
    created_by: createdBy || null,
  });
  return findByIdStmt.get(id);
}

function findById(id) {
  return findByIdStmt.get(id);
}

function updateStatus(id, status) {
  updateStatusStmt.run(status, id);
  return findByIdStmt.get(id);
}

function touchLastSeen(id) {
  touchLastSeenStmt.run(new Date().toISOString(), id);
}

function extend(id, newExpiresAt) {
  extendStmt.run(newExpiresAt, id);
  return findByIdStmt.get(id);
}

function findExpiredActiveIds(nowIso) {
  return findExpiredActiveStmt.all(nowIso).map((row) => row.id);
}

module.exports = {
  create,
  findById,
  updateStatus,
  touchLastSeen,
  extend,
  findExpiredActiveIds,
};
