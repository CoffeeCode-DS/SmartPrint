const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const env = require('./config/env');
const authService = require('./services/auth.service');
const healthRoutes = require('./routes/health.routes');
const authRoutes = require('./routes/auth.routes');
const sessionRoutes = require('./routes/session.routes');
const { sessionUploadRouter, fileRouter } = require('./routes/file.routes');
const notificationRoutes = require('./routes/notification.routes');
const printJobRoutes = require('./routes/printJob.routes');
const printerRoutes = require('./routes/printer.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const auditRoutes = require('./routes/audit.routes');
const { notFoundHandler, centralErrorHandler } = require('./middleware/errorHandler');

// Idempotent: only creates an ADMIN account if the users table is empty.
authService.ensureAdminSeeded();

const app = express();

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(
  cors({
    origin: (origin, callback) => callback(null, true),
    credentials: true,
  })
);
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));

// General API-wide rate limit; specific routes (login, upload) layer on
// stricter limits of their own.
app.use(
  '/api',
  rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
    max: env.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: { message: 'Too many requests. Please slow down.' } },
  })
);

app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/sessions', sessionUploadRouter);
app.use('/api/files', fileRouter);
app.use('/api/notifications', notificationRoutes);
app.use('/api/print-jobs', printJobRoutes);
app.use('/api/printers', printerRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/audit-logs', auditRoutes);

app.use(notFoundHandler);
app.use(centralErrorHandler);

module.exports = app;
