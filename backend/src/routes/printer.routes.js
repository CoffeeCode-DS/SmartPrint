const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { authenticate, requireRole } = require('../middleware/auth');
const controller = require('../controllers/printer.controller');

const router = express.Router();
router.use(authenticate, requireRole('ADMIN', 'OPERATOR'));

// GET /api/printers - list all printers known to the active backend (mock or system)
router.get('/', asyncHandler(controller.listPrinters));

// POST /api/printers/refresh - rescan hardware/network printers
router.post('/refresh', asyncHandler(controller.refreshPrinters));

// GET or POST /api/printers/compatible - evaluate printer compatibility
router.get('/compatible', asyncHandler(controller.findCompatiblePrinters));
router.post('/compatible', asyncHandler(controller.findCompatiblePrinters));

// POST /api/printers/:id/status - set printer status (AVAILABLE, MAINTENANCE, OFFLINE)
router.post('/:id/status', asyncHandler(controller.setPrinterStatus));

// POST /api/printers/:id/test-page - trigger native hardware test page
router.post('/:id/test-page', asyncHandler(controller.printTestPage));

// POST /api/printers/connect - connect USB/Network/IP printer
router.post('/connect', asyncHandler(controller.connectPrinter));

// DELETE /api/printers/:id - remove custom/network printer
router.delete('/:id', asyncHandler(controller.removePrinter));

// POST /api/printers/:id/default - set printer as default
router.post('/:id/default', asyncHandler(controller.setDefaultPrinter));

module.exports = router;
