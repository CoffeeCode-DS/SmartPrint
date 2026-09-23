const fs = require('fs');
const path = require('path');
const windowsPrinters = require('../src/printers/windowsPrinters');
const printersRepo = require('../src/db/printers.repo');

describe('Windows Printer Driver — Demo vs Real Printer execution', () => {
  let executedScripts = [];
  const dummyPdfPath = path.join(__dirname, 'test-dummy.pdf');

  beforeAll(() => {
    fs.writeFileSync(dummyPdfPath, '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
  });

  afterAll(() => {
    try {
      fs.unlinkSync(dummyPdfPath);
    } catch {}
  });

  beforeEach(() => {
    executedScripts = [];
    windowsPrinters.setPowerShellRunner(async (script, timeout) => {
      executedScripts.push({ script, timeout });
      return { stdout: '', stderr: '' };
    });
  });

  afterEach(() => {
    windowsPrinters.resetPowerShellRunner();
  });

  test('demo printer skips PowerShell and completes cleanly', async () => {
    const result = await windowsPrinters.print({
      printerId: 'demo-smartprint-laserjet',
      filePath: dummyPdfPath,
      copies: 1,
      pageRange: 'all',
    });

    expect(result.spoolerCompleted).toBe(true);
    expect(result.printerId).toBe('demo-smartprint-laserjet');
    expect(executedScripts).toHaveLength(0);
  });

  test('connected printer (isDemo = false) actually calls PowerShell runner', async () => {
    const connected = await windowsPrinters.connectPrinter({
      type: 'network',
      ip: '192.168.1.180',
      port: 9100,
      name: 'Brother HL-L2350DW',
    });

    expect(connected.isDemo).toBe(false);
    expect(connected.id).toMatch(/^printer-/);

    // Reset captured scripts from port creation
    executedScripts = [];

    const result = await windowsPrinters.print({
      printerId: connected.id,
      filePath: dummyPdfPath,
      copies: 2,
      pageRange: 'all',
      paperSize: 'A4',
      orientation: 'portrait',
      colorMode: 'bw',
      duplex: true,
      sides: 'duplex-long-edge',
    });

    expect(result.spoolerCompleted).toBe(true);
    expect(executedScripts.length).toBeGreaterThan(0);
    const powershellCommand = executedScripts[0].script;
    expect(powershellCommand).toContain('Brother HL-L2350DW');
    expect(powershellCommand).toContain('$copies = 2');
    expect(powershellCommand).toContain('TwoSidedLongEdge');
  });

  test('printTestPage on connected printer calls PowerShell CIM method', async () => {
    const connected = await windowsPrinters.connectPrinter({
      type: 'network',
      ip: '192.168.1.181',
      port: 9100,
      name: 'Epson WorkForce Pro',
    });

    executedScripts = [];

    const testRes = await windowsPrinters.printTestPage(connected.id);
    expect(testRes.success).toBe(true);
    expect(executedScripts.length).toBe(1);
    expect(executedScripts[0].script).toContain('PrintTestPage');
    expect(executedScripts[0].script).toContain('Epson WorkForce Pro');
  });
});
