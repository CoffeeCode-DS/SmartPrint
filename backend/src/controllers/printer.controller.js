const printers = require('../printers');
const printersRepo = require('../db/printers.repo');
const { logAudit } = require('../db/logs.repo');
const { sendSuccess, AppError } = require('../middleware/errorHandler');
const emitter = require('../sockets/emitter');

async function getEnrichedPrinters() {
  const list = await printers.listPrinters();
  const customPrinters = printersRepo.listCustomPrinters();
  const overrides = printersRepo.listStatusOverrides();
  const overrideMap = new Map(overrides.map((o) => [o.printer_id, o]));

  const combined = [...list];
  const existingIds = new Set(list.map((p) => p.id));
  for (const cp of customPrinters) {
    if (!existingIds.has(cp.id)) {
      combined.push(cp);
      existingIds.add(cp.id);
    }
  }

  // Ensure demo printer is always present in any environment
  if (!existingIds.has('demo-smartprint-laserjet')) {
    combined.unshift({
      id: 'demo-smartprint-laserjet',
      name: 'SmartPrint Demo Printer (Connected)',
      isDefault: true,
      isDemo: true,
      status: 'READY',
      portName: 'DEMO_PORT',
      driverName: 'SmartPrint Virtual Spooler Driver',
      capabilities: {
        color: true,
        duplex: true,
        paperSizes: ['A4', 'Letter', 'Legal', 'A3'],
        maxCopies: 99,
        orientations: ['portrait', 'landscape'],
      },
    });
  }

  const customDefault = customPrinters.find((cp) => cp.isDefault);
  const hasAnyDefault = customDefault || combined.some((p) => p.isDefault);

  return combined.map((p) => {
    const override = overrideMap.get(p.id);
    let effectiveStatus = p.status;
    if (override) {
      if (override.status === 'MAINTENANCE') {
        effectiveStatus = 'MAINTENANCE';
      } else if (override.status === 'OFFLINE') {
        effectiveStatus = 'OFFLINE';
      } else if (override.status === 'AVAILABLE' && p.status !== 'OFFLINE') {
        effectiveStatus = 'READY';
      }
    }

    let isDefault = false;
    if (customDefault) {
      isDefault = p.id === customDefault.id;
    } else if (hasAnyDefault) {
      isDefault = Boolean(p.isDefault);
    } else {
      isDefault = p.id === 'demo-smartprint-laserjet';
    }

    return {
      ...p,
      status: effectiveStatus,
      rawStatus: p.status,
      isDefault,
      maintenanceNotes: override?.notes || null,
      isMaintenance: effectiveStatus === 'MAINTENANCE',
    };
  });
}

async function listPrinters(req, res) {
  const list = await getEnrichedPrinters();
  sendSuccess(res, { printers: list });
}

async function refreshPrinters(req, res) {
  const list = await getEnrichedPrinters();
  emitter.emitToQueue('printers:changed', { printers: list });
  sendSuccess(res, { printers: list, message: 'Printers refreshed successfully.' });
}

async function setPrinterStatus(req, res) {
  const printerId = req.params.id;
  const { status, notes } = req.body || {};

  const allowed = ['AVAILABLE', 'MAINTENANCE', 'OFFLINE'];
  if (!allowed.includes(status)) {
    throw new AppError(`Status must be one of: ${allowed.join(', ')}`, 400);
  }

  const updated = printersRepo.setPrinterStatus(printerId, { status, notes });
  logAudit({
    actor: req.user?.id || 'system',
    action: 'PRINTER_STATUS_CHANGED',
    entityType: 'printer',
    entityId: printerId,
    metadata: { status, notes },
  });

  const list = await getEnrichedPrinters();
  emitter.emitToQueue('printers:changed', { printers: list });
  sendSuccess(res, { printer: updated, printers: list, message: `Printer status set to ${status}.` });
}

async function findCompatiblePrinters(req, res) {
  const {
    color = false,
    duplex = false,
    paperSize = 'A4',
    copies = 1,
  } = { ...req.query, ...req.body };

  const needColor = color === true || color === 'true' || color === 'color';
  const needDuplex = duplex === true || duplex === 'true' || duplex === 1 || duplex === '1';
  const requestedCopies = parseInt(copies, 10) || 1;

  const allPrinters = await getEnrichedPrinters();

  const evaluated = allPrinters.map((p) => {
    const reasons = [];
    const caps = p.capabilities || {};

    if (p.status === 'MAINTENANCE') {
      reasons.push('Printer is currently in maintenance mode.');
    }
    if (p.status === 'OFFLINE') {
      reasons.push('Printer is offline.');
    }
    if (needColor && caps.color === false) {
      reasons.push('Printer does not support color printing.');
    }
    if (needDuplex && caps.duplex === false) {
      reasons.push('Printer does not support double-sided printing.');
    }
    if (paperSize && caps.paperSizes?.length && !caps.paperSizes.includes(paperSize)) {
      reasons.push(`Printer does not support ${paperSize} paper.`);
    }
    if (requestedCopies > (caps.maxCopies || 99)) {
      reasons.push(`Requested copies (${requestedCopies}) exceed printer maximum (${caps.maxCopies || 99}).`);
    }

    const isCompatible = reasons.length === 0;
    return {
      printer: p,
      isCompatible,
      ineligibilityReasons: reasons,
    };
  });

  const compatible = evaluated.filter((e) => e.isCompatible).map((e) => e.printer);

  sendSuccess(res, {
    compatiblePrinters: compatible,
    evaluatedPrinters: evaluated,
  });
}

async function printTestPage(req, res) {
  const printerId = req.params.id;
  const result = await printers.printTestPage(printerId);
  sendSuccess(res, result);
}

async function connectPrinter(req, res) {
  const { type = 'network', ip, port = 9100, name, capabilities, isDefault } = req.body || {};
  let result;
  try {
    result = await printers.connectPrinter({ type, ip, port, name, capabilities, isDefault });
  } catch {
    result = null;
  }

  // Ensure printer is saved in custom printers registry
  if (!result || !result.id) {
    result = printersRepo.addCustomPrinter({
      name: name || (ip ? `Network Printer (${ip})` : 'New Station Printer'),
      type,
      ip,
      port,
      status: 'READY',
      isDefault: Boolean(isDefault),
      capabilities: capabilities || {
        color: true,
        duplex: true,
        paperSizes: ['A4', 'Letter'],
        maxCopies: 99,
        orientations: ['portrait', 'landscape'],
      },
    });
  } else if (!printersRepo.getCustomPrinter(result.id)) {
    printersRepo.addCustomPrinter({
      id: result.id,
      name: result.name || name || 'Printer',
      type,
      ip,
      port,
      status: result.status || 'READY',
      isDefault: Boolean(isDefault),
      capabilities: result.capabilities || capabilities,
    });
  }

  if (isDefault && result?.id) {
    printersRepo.setDefaultPrinter(result.id);
  }

  logAudit({
    actor: req.user?.id || 'operator',
    action: 'PRINTER_ADDED',
    entityType: 'printer',
    entityId: result.id,
    metadata: { name: result.name, ip, type },
  });

  const list = await getEnrichedPrinters();
  emitter.emitToQueue('printers:changed', { printers: list });
  sendSuccess(res, { printer: result, printers: list, message: `Printer "${result.name}" added successfully.` });
}

async function removePrinter(req, res) {
  const printerId = req.params.id;
  printersRepo.removeCustomPrinter(printerId);

  logAudit({
    actor: req.user?.id || 'operator',
    action: 'PRINTER_REMOVED',
    entityType: 'printer',
    entityId: printerId,
  });

  const list = await getEnrichedPrinters();
  emitter.emitToQueue('printers:changed', { printers: list });
  sendSuccess(res, { printers: list, message: 'Printer removed successfully.' });
}

async function setDefaultPrinter(req, res) {
  const printerId = req.params.id;
  printersRepo.setDefaultPrinter(printerId);

  logAudit({
    actor: req.user?.id || 'operator',
    action: 'PRINTER_DEFAULT_CHANGED',
    entityType: 'printer',
    entityId: printerId,
  });

  const list = await getEnrichedPrinters();
  emitter.emitToQueue('printers:changed', { printers: list });
  sendSuccess(res, { printers: list, message: 'Default printer set successfully.' });
}

module.exports = {
  listPrinters,
  refreshPrinters,
  setPrinterStatus,
  findCompatiblePrinters,
  printTestPage,
  connectPrinter,
  removePrinter,
  setDefaultPrinter,
  getEnrichedPrinters,
};
