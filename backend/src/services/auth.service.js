const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const usersRepo = require('../db/users.repo');
const { generateSecureId } = require('../utils/id');
const { AppError } = require('../middleware/errorHandler');
const { logAudit } = require('../db/logs.repo');
const env = require('../config/env');

const SALT_ROUNDS = 12;
const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{3,32}$/;
const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function issueToken(user) {
  return jwt.sign({ sub: user.id, username: user.username, role: user.role }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  });
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    createdAt: user.created_at,
  };
}

/**
 * Ensures an ADMIN account with the seed credentials exists.
 * If an admin already exists (by email, username, or role), ensures its email
 * matches ADMIN_SEED_EMAIL (default 'admin@gmail.com') and password matches
 * ADMIN_SEED_PASSWORD (default 'changeme123') so that login with admin@gmail.com
 * is guaranteed to work even on existing deployments with pre-created databases.
 * Safe to call on every server startup.
 */
function ensureAdminSeeded() {
  const targetUsername = env.ADMIN_SEED_USERNAME || 'admin';
  const targetEmail = (env.ADMIN_SEED_EMAIL || 'admin@gmail.com').toLowerCase().trim();
  const passwordHash = bcrypt.hashSync(env.ADMIN_SEED_PASSWORD || 'changeme123', SALT_ROUNDS);

  // 1. Check if user already exists by email, username, or role: ADMIN
  let existingUser = usersRepo.findByEmail(targetEmail);
  if (!existingUser) {
    existingUser = usersRepo.findByUsername(targetUsername) || usersRepo.findFirstAdmin();
  }

  if (existingUser) {
    usersRepo.updateAdminCredentials({
      id: existingUser.id,
      email: targetEmail,
      passwordHash,
      role: 'ADMIN',
    });
    return;
  }

  // 2. If no user exists at all, create fresh admin
  const user = usersRepo.create({
    id: generateSecureId(16),
    username: targetUsername,
    email: targetEmail,
    passwordHash,
    role: 'ADMIN',
  });
  logAudit({ actor: 'system', action: 'ADMIN_SEEDED', entityType: 'user', entityId: user.id });
  // eslint-disable-next-line no-console
  console.log(
    `Seeded initial ADMIN account "${user.username}" (${targetEmail}). Set ADMIN_SEED_PASSWORD in .env before first run in any real deployment.`
  );
}

function login({ username, email, password }) {
  const identifier = String(email || username || '').trim();
  if (!identifier || !password) {
    throw new AppError('Email address and password are required.', 400);
  }

  const user = identifier.includes('@')
    ? usersRepo.findByEmail(identifier.toLowerCase())
    : usersRepo.findByUsername(identifier);

  // Constant-shape error whether the identifier exists or not, to avoid
  // leaking registered accounts.
  const passwordMatches = user ? bcrypt.compareSync(password, user.password_hash) : false;

  if (!user || !passwordMatches) {
    logAudit({ actor: identifier || 'unknown', action: 'LOGIN_FAILED', entityType: 'user' });
    throw new AppError('Invalid email or password.', 401);
  }

  usersRepo.touchLogin(user.id);
  logAudit({ actor: user.id, action: 'LOGIN_SUCCESS', entityType: 'user', entityId: user.id });

  return { token: issueToken(user), user: sanitizeUser(user) };
}

/**
 * Creates a new staff account. Only callable by an already-authenticated
 * ADMIN (enforced at the route level) — this is not public registration.
 */
function createUser({ username, email, password, role, createdBy }) {
  if (username && !username.includes('@')) {
    if (!USERNAME_PATTERN.test(username)) {
      throw new AppError(
        'Username must be 3-32 characters: letters, numbers, underscore, dot, or hyphen.',
        400
      );
    }
    if (usersRepo.findByUsername(username)) {
      throw new AppError('That username is already taken.', 409);
    }
  }

  let cleanEmail = null;
  if (email) {
    cleanEmail = String(email).trim().toLowerCase();
    if (!EMAIL_PATTERN.test(cleanEmail)) {
      throw new AppError('Please provide a valid email address (e.g. staff@example.com).', 400);
    }
    if (usersRepo.findByEmail(cleanEmail)) {
      throw new AppError('That email address is already taken.', 409);
    }
  } else if (username && username.includes('@')) {
    cleanEmail = username.trim().toLowerCase();
    if (usersRepo.findByEmail(cleanEmail)) {
      throw new AppError('That email address is already taken.', 409);
    }
  } else {
    cleanEmail = `${(username || 'staff').toLowerCase()}@printsafe.local`;
  }

  let cleanUsername = username ? username.trim().toLowerCase() : cleanEmail.split('@')[0].replace(/[^a-zA-Z0-9_.-]/g, '_');
  if (cleanUsername.length < 3) cleanUsername = `${cleanUsername}_op`;
  if (cleanUsername.length > 32) cleanUsername = cleanUsername.substring(0, 32);

  if (!username && usersRepo.findByUsername(cleanUsername)) {
    cleanUsername = `${cleanUsername.substring(0, 27)}_${Math.floor(1000 + Math.random() * 9000)}`;
  }

  if (!password || password.length < 8) {
    throw new AppError('Password must be at least 8 characters.', 400);
  }
  if (!['ADMIN', 'OPERATOR'].includes(role)) {
    throw new AppError('Role must be ADMIN or OPERATOR.', 400);
  }

  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
  const user = usersRepo.create({
    id: generateSecureId(16),
    username: cleanUsername,
    email: cleanEmail,
    passwordHash,
    role,
  });

  logAudit({
    actor: createdBy || 'system',
    action: 'USER_CREATED',
    entityType: 'user',
    entityId: user.id,
    metadata: { role, email: cleanEmail },
  });

  return sanitizeUser(user);
}

function register({ username, email, password, inviteCode }) {
  if (env.OPERATOR_SIGNUP_CODE) {
    if (!inviteCode || String(inviteCode).trim() !== env.OPERATOR_SIGNUP_CODE) {
      throw new AppError('Invalid or missing operator registration invite code.', 403);
    }
  }

  const rawEmail = String(
    email || (username && username.includes('@') ? username : '') || (username ? `${username.toLowerCase()}@printsafe.local` : '')
  ).trim();

  if (!rawEmail) {
    throw new AppError('Email address is required.', 400);
  }
  const cleanEmail = rawEmail.toLowerCase();
  if (!EMAIL_PATTERN.test(cleanEmail)) {
    throw new AppError('Please provide a valid email address (e.g. operator@domain.com).', 400);
  }
  if (usersRepo.findByEmail(cleanEmail)) {
    throw new AppError('An account with this email address already exists.', 409);
  }

  if (typeof password !== 'string' || password.length < 8) {
    throw new AppError('Password must be at least 8 characters long.', 400);
  }

  let cleanUsername = null;
  if (username && !username.includes('@')) {
    cleanUsername = username.trim().toLowerCase();
    if (!USERNAME_PATTERN.test(cleanUsername)) {
      throw new AppError(
        'Username must be 3–32 characters and contain only letters, numbers, hyphens, underscores, or dots.',
        400
      );
    }
    if (usersRepo.findByUsername(cleanUsername)) {
      throw new AppError('An account with this username already exists.', 409);
    }
  } else {
    cleanUsername = cleanEmail.split('@')[0].replace(/[^a-zA-Z0-9_.-]/g, '_');
    if (cleanUsername.length < 3) cleanUsername = `${cleanUsername}_op`;
    if (cleanUsername.length > 32) cleanUsername = cleanUsername.substring(0, 32);

    let candidateUsername = cleanUsername;
    let counter = 1;
    while (usersRepo.findByUsername(candidateUsername)) {
      const suffix = `_${Math.floor(100 + Math.random() * 900)}`;
      candidateUsername = cleanUsername.substring(0, 32 - suffix.length) + suffix;
      counter++;
      if (counter > 10) break;
    }
    cleanUsername = candidateUsername;
  }

  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
  const user = usersRepo.create({
    id: generateSecureId(16),
    username: cleanUsername,
    email: cleanEmail,
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
