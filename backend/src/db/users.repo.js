const db = require('../db');

const insertStmt = db.prepare(`
  INSERT INTO users (id, username, email, password_hash, role, created_at)
  VALUES (@id, @username, @email, @password_hash, @role, @created_at)
`);

const findByUsernameStmt = db.prepare(`SELECT * FROM users WHERE username = ?`);
const findByEmailStmt = db.prepare(`SELECT * FROM users WHERE email = ?`);
const findByIdStmt = db.prepare(`SELECT * FROM users WHERE id = ?`);
const countStmt = db.prepare(`SELECT COUNT(*) AS count FROM users`);
const touchLoginStmt = db.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`);
const listAllStmt = db.prepare(`SELECT id, username, email, role, created_at, last_login_at FROM users ORDER BY created_at ASC`);
const findFirstAdminStmt = db.prepare(`SELECT * FROM users WHERE role = 'ADMIN' ORDER BY created_at ASC LIMIT 1`);
const updateAdminCredentialsStmt = db.prepare(`
  UPDATE users 
  SET email = @email, password_hash = @password_hash, role = @role 
  WHERE id = @id
`);

function create({ id, username, email = null, passwordHash, role }) {
  insertStmt.run({
    id,
    username,
    email: email ? email.toLowerCase().trim() : null,
    password_hash: passwordHash,
    role,
    created_at: new Date().toISOString(),
  });
  return findByIdStmt.get(id);
}

function findByUsername(username) {
  return findByUsernameStmt.get(username);
}

function findByEmail(email) {
  if (!email) return null;
  return findByEmailStmt.get(email.toLowerCase().trim());
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

function findFirstAdmin() {
  return findFirstAdminStmt.get();
}

function updateAdminCredentials({ id, email, passwordHash, role = 'ADMIN' }) {
  updateAdminCredentialsStmt.run({
    id,
    email: email ? email.toLowerCase().trim() : null,
    password_hash: passwordHash,
    role,
  });
  return findByIdStmt.get(id);
}

module.exports = {
  create,
  findByUsername,
  findByEmail,
  findById,
  count,
  touchLogin,
  listAll,
  findFirstAdmin,
  updateAdminCredentials,
};
