const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

/**
 * IMPORTANT — read before trusting this file:
 *
 * This talks to the operating system's CUPS print subsystem (Linux/macOS)
 * via the standard `lpstat` / `lpoptions` / `lp` command-line tools. It has
 * NOT been exercised against real hardware in this development environment
 * — there is no CUPS installation or physical/virtual printer available
 * here to test against. The mock printer fleet (mockPrinters.js) is what's
 * actually been tested end-to-end.
 *
 * To verify this on a real machine:
 *   1. Set PRINTER_MODE=system in .env
 *   2. Make sure CUPS is installed and at least one printer is added
 *      (`lpstat -p -d` should list it from a terminal)
 *   3. Restart the backend and check GET /api/printers
 *   4. Send a real print job and confirm it physically prints
 *
 * Windows is not supported by this module (CUPS command-line tools aren't
 * present by default) — PRINTER_MODE=system will simply return an empty
 * printer list rather than crash.
 */

async function runCommand(cmd, args) {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: 5000 });
    return stdout;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[systemPrinters] "${cmd} ${args.join(' ')}" failed: ${err.message}`);
    return null;
  }
}

/**
 * Parses `lpstat -p -d` output, e.g.:
 *   printer HP_LaserJet_Pro is idle.  enabled since Mon 01 Sep 2026...
 *   printer Canon_LBP2900 is disabled since Mon 01 Sep 2026 - unplugged.
 *   system default destination: HP_LaserJet_Pro
 */
function parseLpstat(output) {
  const printers = [];
  let defaultName = null;

  const lines = output.split('\n');
  for (const line of lines) {
    const printerMatch = line.match(/^printer\s+(\S+)\s+is\s+(idle|printing|disabled)/i);
    if (printerMatch) {
      const [, name, state] = printerMatch;
      const busy = /printing/i.test(state);
      const offline = /disabled/i.test(state);
      printers.push({
        id: name,
        name: name.replace(/_/g, ' '),
        status: offline ? 'OFFLINE' : busy ? 'BUSY' : 'READY',
        isDefault: false,
        capabilities: { color: null, duplex: null, paperSizes: [], maxCopies: 99 },
      });
      continue;
    }
    const defaultMatch = line.match(/^system default destination:\s*(\S+)/i);
    if (defaultMatch) {
      defaultName = defaultMatch[1];
    }
  }

  return printers.map((p) => ({ ...p, isDefault: p.id === defaultName }));
}

/**
 * Best-effort capability lookup via `lpoptions -p <name> -l`. Output format
 * varies a lot by driver, so this is intentionally conservative: if a
 * capability can't be confidently detected, it's left disabled rather than
 * guessed.
 */
function parseCapabilities(output) {
  if (!output) return { color: null, duplex: null, paperSizes: [], maxCopies: 99 };

  const duplexLine = output.split('\n').find((l) => /^Duplex\//i.test(l));
  const colorLine = output.split('\n').find((l) => /^ColorModel\//i.test(l) || /^print-color-mode/i.test(l));
  const pageSizeLine = output.split('\n').find((l) => /^PageSize\/|^media\//i.test(l));

  const duplex = duplexLine ? /DuplexNoTumble|DuplexTumble/i.test(duplexLine) : null;
  const color = colorLine ? /RGB|Color|CMYK/i.test(colorLine) : null;

  let paperSizes = [];
  if (pageSizeLine) {
    const optionsPart = pageSizeLine.split(':')[1] || '';
    paperSizes = optionsPart
      .split(' ')
      .map((s) => s.replace('*', '').trim())
      .filter(Boolean)
      .filter((s) => /A4|A3|Letter|Legal/i.test(s));
  }

  return { color, duplex, paperSizes: paperSizes.length ? paperSizes : ['A4'], maxCopies: 99 };
}

async function listPrinters() {
  const lpstatOut = await runCommand('lpstat', ['-p', '-d']);
  if (!lpstatOut) return [];

  const printers = parseLpstat(lpstatOut);

  await Promise.all(
    printers.map(async (p) => {
      const optsOut = await runCommand('lpoptions', ['-p', p.id, '-l']);
      p.capabilities = parseCapabilities(optsOut);
    })
  );

  return printers;
}

async function findDevice(printerId) {
  const printers = await listPrinters();
  return printers.find((p) => p.id === printerId) || null;
}

let commandRunner = execFileAsync;
function setCommandRunner(fn) {
  commandRunner = fn;
}
function resetCommandRunner() {
  commandRunner = execFileAsync;
}

function buildLpArgs({
  printerId,
  filePath,
  copies = 1,
  pageRange = 'all',
  paperSize,
  orientation,
  colorMode,
  duplex,
  sides,
}) {
  const args = ['-d', printerId, '-n', String(copies)];
  if (paperSize) args.push('-o', `media=${paperSize}`);
  if (orientation === 'landscape') args.push('-o', 'landscape');
  if (colorMode) args.push('-o', `print-color-mode=${colorMode === 'color' ? 'color' : 'monochrome'}`);
  const isDuplex = !!duplex || (sides && (sides.includes('duplex') || sides.includes('two-sided')));
  if (isDuplex) {
    const duplexSide = sides && sides.includes('short') ? 'two-sided-short-edge' : 'two-sided-long-edge';
    args.push('-o', `sides=${duplexSide}`);
  }
  if (pageRange && pageRange !== 'all') {
    args.push('-o', `page-ranges=${pageRange}`);
  }
  args.push(filePath);
  return args;
}

/**
 * Sends a job to CUPS via `lp`. The confirmation boundary here is "CUPS
 * accepted the job" (the `lp` command exits successfully) — from that
 * point, physical printing is owned by CUPS/the OS and can't be
 * synchronously verified. That is NOT the same as confirming physical
 * output, and is documented as such.
 */
async function print({
  printerId,
  filePath,
  copies = 1,
  pageRange = 'all',
  paperSize,
  orientation,
  colorMode,
  duplex,
  sides,
}) {
  const device = await findDevice(printerId);
  if (!device) {
    throw new Error(`Unknown or unavailable system printer "${printerId}".`);
  }
  if (device.status === 'OFFLINE') {
    throw new Error(`${device.name} is offline and cannot accept jobs right now.`);
  }

  const args = buildLpArgs({
    printerId,
    filePath,
    copies,
    pageRange,
    paperSize,
    orientation,
    colorMode,
    duplex,
    sides,
  });

  try {
    await commandRunner('lp', args, { timeout: 15000 });
  } catch (err) {
    throw new Error(`CUPS rejected the print job for ${device.name}: ${err.message}`);
  }

  return {
    confirmedAt: new Date().toISOString(),
    printerId: device.id,
    printerName: device.name,
  };
}

module.exports = {
  listPrinters,
  findDevice,
  print,
  buildLpArgs,
  setCommandRunner,
  resetCommandRunner,
  mode: 'system',
};
