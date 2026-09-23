const db = require('../db');

const insertStmt = db.prepare(`
  INSERT INTO notifications (id, session_id, user_id, type, message, is_read, created_at)
  VALUES (@id, @session_id, @user_id, @type, @message, 0, @created_at)
`);

const findBySessionStmt = db.prepare(`
  SELECT * FROM notifications WHERE session_id = ? ORDER BY created_at DESC
`);

const findByIdStmt = db.prepare(`SELECT * FROM notifications WHERE id = ?`);

function create({ id, sessionId = null, userId = null, type, message }) {
  const createdAt = new Date().toISOString();
  insertStmt.run({
    id,
    session_id: sessionId,
    user_id: userId,
    type,
    message,
    created_at: createdAt,
  });
  return findByIdStmt.get(id);
}

function findBySession(sessionId) {
  return findBySessionStmt.all(sessionId);
}

module.exports = { create, findBySession };
