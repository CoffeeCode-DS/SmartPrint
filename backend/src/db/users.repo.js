const db = require('../db');

const insertStmt = db.prepare(`
  INSERT INTO users (id, username, password_hash, role, created_at)
  VALUES (@id, @username, @password_hash, @role, @created_at)
`);

const findByUsernameStmt = db.prepare(`SELECT * FROM users WHERE username = ?`);
const findByIdStmt = db.prepare(`SELECT * FROM users WHERE id = ?`);
const countStmt = db.prepare(`SELECT COUNT(*) AS count FROM users`);
const touchLoginStmt = db.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`);
const listAllStmt = db.prepare(`SELECT id, username, role, created_at, last_login_at FROM users ORDER BY created_at ASC`);

function create({ id, username, passwordHash, role }) {
  insertStmt.run({
    id,
    username,
    password_hash: passwordHash,
    role,
    created_at: new Date().toISOString(),
  });
  return findByIdStmt.get(id);
}

function findByUsername(username) {
  return findByUsernameStmt.get(username);
}

function findById(id) {
  return findByIdStmt.get(id);
}

function count() {
  return countStmt.get().count;
}

function touchLogin(id) {
  touchLoginStmt.run(new Date().toISOString(), id);
}

function listAll() {
  return listAllStmt.all();
}

module.exports = { create, findByUsername, findById, count, touchLogin, listAll };
