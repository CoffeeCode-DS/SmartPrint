const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const controller = require('../controllers/notification.controller');

const router = express.Router();

// GET /api/notifications?sessionId=... - notification history for a session
router.get('/', asyncHandler(controller.listNotifications));

module.exports = router;
