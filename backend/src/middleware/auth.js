const authService = require('../services/auth.service');
const { AppError } = require('./errorHandler');

/**
 * Verifies the Bearer token and attaches { id, username, role } to req.user.
 * Rejects with 401 if missing/invalid — this is REAL server-side
 * enforcement, not just hiding a button on the frontend.
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw new AppError('Authentication required.', 401);
  }

  const payload = authService.verifyToken(token);
  if (!payload) {
    throw new AppError('Invalid or expired session. Please log in again.', 401);
  }

  req.user = { id: payload.sub, username: payload.username, role: payload.role };
  next();
}

/**
 * Restricts a route to specific roles. Must run after `authenticate`.
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      throw new AppError('Authentication required.', 401);
    }
    if (!allowedRoles.includes(req.user.role)) {
      throw new AppError('You do not have permission to perform this action.', 403);
    }
    next();
  };
}

/**
 * Optionally verifies Bearer token if present, attaching req.user without rejecting
 * unauthenticated requests. Used for kiosk workflows (file preview, job creation).
 */
function optionalAuthenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme === 'Bearer' && token) {
    const payload = authService.verifyToken(token);
    if (payload) {
      req.user = { id: payload.sub, username: payload.username, role: payload.role };
    }
  }
  next();
}

module.exports = { authenticate, optionalAuthenticate, requireRole };
