const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const usersRepo = require('../db/users.repo');
const { generateSecureId } = require('../utils/id');
const { AppError } = require('../middleware/errorHandler');
const { logAudit } = require('../db/logs.repo');
const env = require('../config/env');

const SALT_ROUNDS = 12;
const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{3,32}$/;

function issueToken(user) {
  return jwt.sign({ sub: user.id, username: user.username, role: user.role }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  });
}

function sanitizeUser(user) {
  return { id: user.id, username: user.username, role: user.role, createdAt: user.created_at };
}

/**
 * Creates the initial ADMIN account from env-configured seed credentials,
 * but only if no users exist yet. Safe to call on every server startup.
 */
function ensureAdminSeeded() {
  if (usersRepo.count() > 0) return;

  const passwordHash = bcrypt.hashSync(env.ADMIN_SEED_PASSWORD, SALT_ROUNDS);
  const user = usersRepo.create({
    id: generateSecureId(16),
    username: env.ADMIN_SEED_USERNAME,
    passwordHash,
    role: 'ADMIN',
  });
  logAudit({ actor: 'system', action: 'ADMIN_SEEDED', entityType: 'user', entityId: user.id });
  // eslint-disable-next-line no-console
  console.log(
    `Seeded initial ADMIN account "${user.username}". Set ADMIN_SEED_PASSWORD in .env before first run in any real deployment.`
  );
}

function login({ username, password }) {
  if (!username || !password) {
    throw new AppError('Username and password are required.', 400);
  }

  const user = usersRepo.findByUsername(username);
  // Constant-shape error whether the username exists or not, to avoid
  // leaking which usernames are registered.
  const passwordMatches = user ? bcrypt.compareSync(password, user.password_hash) : false;

  if (!user || !passwordMatches) {
    logAudit({ actor: username || 'unknown', action: 'LOGIN_FAILED', entityType: 'user' });
    throw new AppError('Invalid username or password.', 401);
  }

  usersRepo.touchLogin(user.id);
  logAudit({ actor: user.id, action: 'LOGIN_SUCCESS', entityType: 'user', entityId: user.id });

  return { token: issueToken(user), user: sanitizeUser(user) };
}

/**
 * Creates a new staff account. Only callable by an already-authenticated
 * ADMIN (enforced at the route level) — this is not public registration.
 */
function createUser({ username, password, role, createdBy }) {
  if (!USERNAME_PATTERN.test(username || '')) {
    throw new AppError(
      'Username must be 3-32 characters: letters, numbers, underscore, dot, or hyphen.',
      400
    );
  }
  if (!password || password.length < 8) {
    throw new AppError('Password must be at least 8 characters.', 400);
  }
  if (!['ADMIN', 'OPERATOR'].includes(role)) {
    throw new AppError('Role must be ADMIN or OPERATOR.', 400);
  }
  if (usersRepo.findByUsername(username)) {
    throw new AppError('That username is already taken.', 409);
  }

  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
  const user = usersRepo.create({
    id: generateSecureId(16),
    username,
    passwordHash,
    role,
  });

  logAudit({
    actor: createdBy || 'system',
    action: 'USER_CREATED',
    entityType: 'user',
    entityId: user.id,
    metadata: { role },
  });

  return sanitizeUser(user);
}

function register({ username, password, inviteCode }) {
  if (env.OPERATOR_SIGNUP_CODE) {
    if (!inviteCode || String(inviteCode).trim() !== env.OPERATOR_SIGNUP_CODE) {
      throw new AppError('Invalid or missing operator registration invite code.', 403);
    }
  }
  if (!username || !password) {
    throw new AppError('Username and password are required.', 400);
  }
  const cleanUsername = username.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(cleanUsername)) {
    throw new AppError(
      'Username must be 3–32 characters and contain only letters, numbers, hyphens, underscores, or dots.',
      400
    );
  }
  if (typeof password !== 'string' || password.length < 8) {
    throw new AppError('Password must be at least 8 characters long.', 400);
  }

  const existing = usersRepo.findByUsername(cleanUsername);
  if (existing) {
    throw new AppError('An account with this username already exists.', 409);
  }

  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
  const user = usersRepo.create({
    id: generateSecureId(16),
    username: cleanUsername,
    passwordHash,
    role: 'OPERATOR',
  });

  logAudit({ actor: user.id, action: 'USER_REGISTERED', entityType: 'user', entityId: user.id });
  const token = issueToken(user);
  return { token, user: sanitizeUser(user) };
}

function verifyToken(token) {
  try {
    return jwt.verify(token, env.JWT_SECRET);
  } catch {
    return null;
  }
}

function listUsers() {
  return usersRepo.listAll().map((u) => ({
    id: u.id,
    username: u.username,
    role: u.role,
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
  }));
}

module.exports = { ensureAdminSeeded, login, register, createUser, verifyToken, listUsers, sanitizeUser };
