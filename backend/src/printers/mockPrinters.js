const env = require('../config/env');

/**
 * Static mock fleet for development/demo. Three devices with genuinely
 * different capabilities so the frontend's "hide unsupported options"
 * logic has something real to react to — not just one printer pretending
 * to be three.
 */
const DEVICES = [
  {
    id: 'demo-smartprint-laserjet',
    name: 'SmartPrint Demo Printer (Connected)',
    status: 'READY',
    isDefault: true,
    capabilities: {
      color: true,
      duplex: true,
      paperSizes: ['A4', 'Letter', 'Legal', 'A3'],
      maxCopies: 99,
    },
  },
  {
    id: 'mock-hp-laserjet',
    name: 'HP LaserJet Pro M404',
    status: 'READY',
    isDefault: false,
    capabilities: {
      color: false, // mono laser
      duplex: true,
      paperSizes: ['A4', 'Letter'],
      maxCopies: 50,
    },
  },
  {
    id: 'mock-canon-lbp2900',
    name: 'Canon LBP2900',
    status: 'READY',
    isDefault: false,
    capabilities: {
      color: false,
      duplex: false,
      paperSizes: ['A4'],
      maxCopies: 50,
    },
  },
  {
    id: 'mock-epson-ecotank',
    name: 'Epson EcoTank L3250',
    status: 'OFFLINE', // intentionally offline in the mock fleet, like the spec's example
    isDefault: false,
    capabilities: {
      color: true,
      duplex: false,
      paperSizes: ['A4', 'Letter', 'A3'],
      maxCopies: 50,
    },
  },
];

function randomDelayMs() {
  const { MOCK_PRINT_MIN_DELAY_MS: min, MOCK_PRINT_MAX_DELAY_MS: max } = env;
  return min + Math.random() * Math.max(0, max - min);
}

async function listPrinters() {
  return DEVICES;
}

function findDevice(printerId) {
  return DEVICES.find((d) => d.id === printerId) || null;
}

const FAILURE_REASONS = [
  { code: 'PAPER_JAM', message: 'Paper jam detected in tray. Please clear the paper path.' },
  { code: 'OUT_OF_PAPER', message: 'Printer is out of paper. Please reload paper tray.' },
  { code: 'LOW_TONER', message: 'Toner/ink level critically low. Replace cartridge to proceed.' },
  { code: 'COVER_OPEN', message: 'Printer access door or top cover is open.' },
  { code: 'COMMUNICATION_ERROR', message: 'Printer communication timeout. Check cable or network link.' },
];

let nextMockFailure = null;

function setNextMockFailure(codeOrObj) {
  nextMockFailure = codeOrObj;
}

/**
 * Simulates sending a job to a printer. NEVER claims to control real
 * hardware — every result is stamped with a printer name that makes clear
 * it's a mock device, and OFFLINE devices genuinely refuse jobs rather
 * than silently "succeeding".
 */
async function print({ printerId, jobId }) {
  const device = findDevice(printerId);
  if (!device) {
    const err = new Error(`Unknown printer "${printerId}".`);
    err.failureCode = 'UNKNOWN_ERROR';
    throw err;
  }
  if (device.status !== 'READY') {
    const err = new Error(`${device.name} is ${device.status.toLowerCase()} and cannot accept jobs right now.`);
    err.failureCode = device.status === 'OFFLINE' ? 'OFFLINE' : device.status === 'PAUSED' ? 'PAUSED' : 'UNKNOWN_ERROR';
    throw err;
  }

  await new Promise((resolve) => setTimeout(resolve, randomDelayMs()));

  // Dedicated connected demo printer is guaranteed 100% reliable for demonstration
  if (device.id === 'demo-smartprint-laserjet') {
    return {
      confirmedAt: new Date().toISOString(),
      printerId: device.id,
      printerName: device.name,
      spoolerCompleted: true,
    };
  }

  if (nextMockFailure) {
    const f = typeof nextMockFailure === 'string'
      ? FAILURE_REASONS.find((r) => r.code === nextMockFailure) || { code: nextMockFailure, message: nextMockFailure }
      : nextMockFailure;
    nextMockFailure = null;
    const err = new Error(`${device.name} error: ${f.message}`);
    err.failureCode = f.code || 'UNKNOWN_ERROR';
    err.jobId = jobId;
    throw err;
  }

  const shouldFail = Math.random() < env.MOCK_PRINT_FAILURE_RATE;
  if (shouldFail) {
    const selected = FAILURE_REASONS[Math.floor(Math.random() * FAILURE_REASONS.length)];
    const err = new Error(
      `${device.name} error: ${selected.message}`
    );
    err.failureCode = selected.code;
    err.jobId = jobId;
    throw err;
  }

  return {
    confirmedAt: new Date().toISOString(),
    printerId: device.id,
    printerName: device.name,
    spoolerCompleted: true,
  };
}

async function cancelJob(printerId, jobId) {
  const device = findDevice(printerId);
  if (!device) return { success: false, reason: 'Printer not found' };
  return {
    success: true,
    jobId,
    printerId,
    message: `Print job cancelled at spooler for ${device.name}.`,
  };
}

async function printTestPage(printerId) {
  const device = findDevice(printerId);
  if (!device) throw new Error(`Unknown printer "${printerId}".`);
  if (device.status !== 'READY') throw new Error(`${device.name} is ${device.status.toLowerCase()}.`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  return {
    success: true,
    printerId: device.id,
    printerName: device.name,
    message: `Test page printed on ${device.name}.`,
  };
}

async function connectPrinter({ type = 'network', ip, port = 9100, name }) {
  const newId = `mock-${name ? name.toLowerCase().replace(/\s+/g, '-') : 'net-' + ip.replace(/\./g, '-')}`;
  const newPrinter = {
    id: newId,
    name: name || `Network Printer (${ip}:${port})`,
    status: 'READY',
    isDefault: false,
    capabilities: {
      color: true,
      duplex: true,
      paperSizes: ['A4', 'Letter'],
      maxCopies: 99,
    },
  };
  DEVICES.push(newPrinter);
  return newPrinter;
}

module.exports = {
  listPrinters,
  findDevice,
  print,
  cancelJob,
  printTestPage,
  connectPrinter,
  setNextMockFailure,
  FAILURE_REASONS,
  mode: 'mock',
};
