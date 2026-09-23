const express = require('express');
const rateLimit = require('express-rate-limit');
const asyncHandler = require('../middleware/asyncHandler');
const { authenticate, requireRole } = require('../middleware/auth');
const controller = require('../controllers/auth.controller');
const env = require('../config/env');

const router = express.Router();

// Stricter limiter specifically on login, to slow down credential-guessing.
const loginLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  max: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many login attempts. Please try again later.' } },
});

// POST /api/auth/login
router.post('/login', loginLimiter, asyncHandler(controller.login));

// POST /api/auth/register & /api/auth/signup
router.post('/register', loginLimiter, asyncHandler(controller.register));
router.post('/signup', loginLimiter, asyncHandler(controller.register));

// GET /api/auth/me - whoami for the current token
router.get('/me', authenticate, asyncHandler(controller.me));

// POST /api/auth/users - ADMIN only: create a new staff account
router.post('/users', authenticate, requireRole('ADMIN'), asyncHandler(controller.createUser));

// GET /api/auth/users - ADMIN only: list staff accounts
router.get('/users', authenticate, requireRole('ADMIN'), asyncHandler(controller.listUsers));

module.exports = router;
