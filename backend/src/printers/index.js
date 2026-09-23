const env = require('../config/env');
const mockPrinters = require('./mockPrinters');
const systemPrinters = require('./systemPrinters');
const windowsPrinters = require('./windowsPrinters');

const isWindows = process.platform === 'win32';

const BACKENDS = {
  mock: mockPrinters,
  system: isWindows ? windowsPrinters : systemPrinters,
  windows: windowsPrinters,
  cups: systemPrinters,
};

function getBackend() {
  const backend = BACKENDS[env.PRINTER_MODE];
  if (!backend) {
    throw new Error(
      `Unknown PRINTER_MODE "${env.PRINTER_MODE}". Supported values: ${Object.keys(BACKENDS).join(', ')}.`
    );
  }
  return backend;
}

/** Lists all printers currently known to the active backend. */
async function listPrinters() {
  return getBackend().listPrinters();
}

/** Looks up a single printer by id from the active backend. */
async function findPrinter(printerId) {
  return getBackend().findDevice(printerId);
}

/** Sends a job to the active backend for the given printer. */
async function print(params) {
  return getBackend().print(params);
}

/** Sends a native test page to the selected printer. */
async function printTestPage(printerId) {
  const backend = getBackend();
  if (typeof backend.printTestPage !== 'function') {
    throw new Error(`The active printer driver (${backend.mode}) does not support test pages.`);
  }
  return backend.printTestPage(printerId);
}

/** Cancels an in-flight print job at the hardware/spooler layer. */
async function cancelJob(printerId, jobId) {
  const backend = getBackend();
  if (typeof backend.cancelJob === 'function') {
    return backend.cancelJob(printerId, jobId);
  }
  return { success: false, reason: 'Cancellation not supported by active printer driver' };
}

/** Connects to a network or USB printer dynamically. */
async function connectPrinter(params) {
  const backend = getBackend();
  if (typeof backend.connectPrinter === 'function') {
    return backend.connectPrinter(params);
  }
  return { success: false, reason: 'Network printer connection not supported by active backend' };
}

module.exports = {
  listPrinters,
  findPrinter,
  print,
  cancelJob,
  printTestPage,
  connectPrinter,
  getBackend,
};
