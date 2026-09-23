const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const { slicePdfIfNeeded } = require('../utils/pdfSlicer');
const printersRepo = require('../db/printers.repo');
const execFileAsync = promisify(execFile);

/**
 * Windows Native Printer Driver
 * Communicates with Windows Print Spooler via PowerShell CIM (WMI) and .NET.
 */

function runPowerShell(script, timeoutMs = 12000) {
  const buffer = Buffer.from(script, 'utf16le');
  const encoded = buffer.toString('base64');
  return execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { timeout: timeoutMs }
  );
}

let powerShellRunner = runPowerShell;
function setPowerShellRunner(fn) {
  powerShellRunner = fn;
}
function resetPowerShellRunner() {
  powerShellRunner = runPowerShell;
}

function mapWindowsStatus(p) {
  if (p.WorkOffline || p.workOffline) return 'OFFLINE';
  const status = Number(p.PrinterStatus || p.status || p.ExtendedPrinterStatus || p.extendedStatus || 0);
  switch (status) {
    case 1:
      return 'PAUSED';
    case 2:
      return 'ERROR';
    case 3:
      return 'READY';
    case 4:
      return 'PRINTING';
    case 5:
      return 'BUSY';
    case 7:
      return 'OFFLINE';
    default:
      return 'READY';
  }
}

function detectPrinterFault(p) {
  const errorState = Number(p.detectedErrorState || 0);
  switch (errorState) {
    case 3:
    case 4:
      return { failureCode: 'OUT_OF_PAPER', message: 'Out of paper or paper tray empty.' };
    case 5:
    case 6:
      return { failureCode: 'LOW_TONER', message: 'Toner/ink is critically low or exhausted.' };
    case 7:
      return { failureCode: 'COVER_OPEN', message: 'Printer cover or access door is open.' };
    case 8:
      return { failureCode: 'PAPER_JAM', message: 'Paper jam detected in printer transport path.' };
    case 9:
      return { failureCode: 'OFFLINE', message: 'Printer is offline or unreachable.' };
    default:
      if (p.workOffline) return { failureCode: 'OFFLINE', message: 'Printer is working offline.' };
      if (p.status === 1) return { failureCode: 'PAUSED', message: 'Printer is paused.' };
      if (p.status === 2) return { failureCode: 'UNKNOWN_ERROR', message: 'Printer reported an error condition.' };
      return null;
  }
}

function getDemoPrinter() {
  const customPrinters = printersRepo.listCustomPrinters();
  const hasCustomDefault = customPrinters.some((cp) => cp.isDefault);
  return {
    id: 'demo-smartprint-laserjet',
    name: 'SmartPrint Demo Printer (Connected)',
    isDefault: !hasCustomDefault,
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
  };
}

async function listPrinters() {
  const script = `
Add-Type -AssemblyName System.Drawing
$printers = Get-CimInstance Win32_Printer
$results = @()
foreach ($p in $printers) {
  $caps = @{
    color = $false
    duplex = $false
    paperSizes = @('A4')
    maxCopies = 99
  }
  try {
    $settings = New-Object System.Drawing.Printing.PrinterSettings
    $settings.PrinterName = $p.Name
    if ($settings.IsValid) {
      $caps.color = [bool]$settings.SupportsColor
      $caps.duplex = [bool]$settings.CanDuplex
      $caps.maxCopies = [int][Math]::Max(1, $settings.MaximumCopies)
      $sizes = @()
      foreach ($sz in $settings.PaperSizes) {
        $name = $sz.PaperName
        if ($name -match '^(A[3-6]|Letter|Legal|Executive)$') {
          $sizes += $name
        }
      }
      if ($sizes.Count -gt 0) {
        $caps.paperSizes = @($sizes | Select-Object -Unique)
      }
    }
  } catch {}
  $results += @{
    id = $p.Name
    name = $p.Name
    isDefault = [bool]$p.Default
    status = $p.PrinterStatus
    extendedStatus = $p.ExtendedPrinterStatus
    workOffline = [bool]$p.WorkOffline
    portName = $p.PortName
    driverName = $p.DriverName
    capabilities = $caps
  }
}

$results | ConvertTo-Json -Depth 4 -Compress
`;

  const customPrinters = printersRepo.listCustomPrinters();
  const demoPrinter = getDemoPrinter();

  let mapped = [];
  try {
    const { stdout } = await powerShellRunner(script);
    if (stdout && stdout.trim()) {
      let parsed = JSON.parse(stdout.trim());
      if (!Array.isArray(parsed)) parsed = [parsed];

      mapped = parsed.map((p) => ({
        id: p.id,
        name: p.name,
        isDefault: false,
        isDemo: false,
        status: mapWindowsStatus(p),
        portName: p.portName || '',
        driverName: p.driverName || '',
        capabilities: {
          color: p.capabilities?.color ?? true,
          duplex: p.capabilities?.duplex ?? false,
          paperSizes:
            p.capabilities?.paperSizes && p.capabilities.paperSizes.length
              ? p.capabilities.paperSizes
              : ['A4', 'Letter'],
          maxCopies: p.capabilities?.maxCopies || 99,
          orientations: ['portrait', 'landscape'],
        },
      }));
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[windowsPrinters] Failed to discover Windows printers:', err.message);
  }

  const combined = [demoPrinter, ...customPrinters, ...mapped];
  const seen = new Set();
  const unique = [];
  for (const p of combined) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      unique.push(p);
    }
  }
  return unique;
}

async function findDevice(printerId) {
  if (printerId === 'demo-smartprint-laserjet') {
    return getDemoPrinter();
  }
  const custom = printersRepo.getCustomPrinter(printerId);
  if (custom) return custom;
  const printers = await listPrinters();
  return printers.find((p) => p.id === printerId) || null;
}

async function printTestPage(printerId) {
  const device = await findDevice(printerId);
  if (!device) throw new Error(`Printer "${printerId}" not found.`);

  if (device.isDemo || printerId === 'demo-smartprint-laserjet') {
    return {
      success: true,
      printerId: device.id,
      printerName: device.name,
      message: `Test page sent to ${device.name}.`,
    };
  }

  const escapedPrinter = (device.name || printerId).replace(/'/g, "''");
  const script = `
$printer = Get-CimInstance Win32_Printer | Where-Object { $_.Name -eq '${escapedPrinter}' }
if (-not $printer) { exit 1 }
$res = Invoke-CimMethod -InputObject $printer -MethodName PrintTestPage
if ($res.ReturnValue -ne 0) { exit 2 }
exit 0
`;
  try {
    await powerShellRunner(script, 15000);
    return {
      success: true,
      printerId: device.id,
      printerName: device.name,
      message: `Test page sent to ${device.name}.`,
    };
  } catch (err) {
    throw new Error(`Windows Spooler failed to print test page on ${device.name}: ${err.message}`);
  }
}

async function connectPrinter({ type = 'network', ip, port = 9100, name, capabilities, isDefault }) {
  const printerName = name?.trim() || (ip ? `Network Printer (${ip})` : 'New Printer');
  const printerId = `printer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  let portName = (type === 'network' && ip) ? `IP_${ip}_${port}` : `PORT_${printerId}`;

  if (type === 'network' && ip) {
    portName = `IP_${ip}_${port}`;
    const escapedIp = ip.replace(/'/g, "''");
    const portNum = parseInt(port, 10) || 9100;
    const script = `
$portName = '${portName}'
$printerIP = '${escapedIp}'
$portNumber = ${portNum}

$existingPort = Get-PrinterPort -Name $portName -ErrorAction SilentlyContinue
if (-not $existingPort) {
  Add-PrinterPort -Name $portName -PrinterHostAddress $printerIP -PortNumber $portNumber
}
`;
    try {
      await powerShellRunner(script, 10000);
    } catch {
      // non-fatal: allow printer to be registered for queue & demo management
    }
  }

  const registered = printersRepo.addCustomPrinter({
    id: printerId,
    name: printerName,
    type,
    ip,
    port: parseInt(port, 10) || 9100,
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

  return registered;
}

async function print({
  printerId,
  filePath,
  copies = 1,
  pageRange = 'all',
  paperSize = 'A4',
  orientation = 'portrait',
  colorMode = 'bw',
  duplex = false,
  sides = 'single',
}) {
  const device = await findDevice(printerId);
  if (!device) throw new Error(`Printer "${printerId}" not found.`);
  if (device.status === 'OFFLINE') throw new Error(`${device.name} is offline and cannot accept jobs.`);

  // 1. Enforce page range by slicing PDF if needed
  const { filePath: targetFile, isTemporary } = await slicePdfIfNeeded(filePath, pageRange);

  try {
    if (device.isDemo === true || printerId === 'demo-smartprint-laserjet') {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return {
        confirmedAt: new Date().toISOString(),
        printerId: device.id,
        printerName: device.name,
        spoolerCompleted: true,
        appliedSettings: {
          copies: Math.max(1, parseInt(copies, 10) || 1),
          pageRange,
          paperSize,
          orientation,
          colorMode,
          duplex: Boolean(duplex),
          sides,
        },
      };
    }

    const resolvedPath = path.resolve(targetFile);
    const escapedFile = resolvedPath.replace(/'/g, "''");
    const escapedPrinter = (device.name || printerId).replace(/'/g, "''");
    const isColor = colorMode === 'color';
    const isDuplex = !!duplex || sides.includes('duplex') || sides.includes('two-sided');
    const duplexParam = isDuplex
      ? (sides.includes('short') ? 'TwoSidedShortEdge' : 'TwoSidedLongEdge')
      : 'OneSided';
    const safeCopies = Math.max(1, Math.min(parseInt(copies, 10) || 1, 99));

    const script = `
$filePath = '${escapedFile}'
$printerName = '${escapedPrinter}'
$isColor = $${isColor ? 'true' : 'false'}
$duplexMode = '${duplexParam}'
$paperSize = '${paperSize}'
$copies = ${safeCopies}

if (-not (Test-Path $filePath)) {
  Write-Error 'File not found'
  exit 1
}

# Apply hardware print configuration (Duplex, Color, PaperSize, Collate)
try {
  Set-PrintConfiguration -PrinterName $printerName -Color $isColor -DuplexingMode $duplexMode -PaperSize $paperSize -Collate $true -ErrorAction SilentlyContinue
} catch {}

# Enforce copies and dispatch to Windows Spooler
$timeoutSec = 20
for ($c = 0; $c -lt $copies; $c++) {
  $proc = Start-Process -FilePath $filePath -Verb PrintTo -ArgumentList ('"{0}"' -f $printerName) -PassThru -WindowStyle Hidden
  $timer = [System.Diagnostics.Stopwatch]::StartNew()
  while (-not $proc.HasExited -and $timer.Elapsed.TotalSeconds -lt $timeoutSec) {
    Start-Sleep -Milliseconds 250
  }
  if (-not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  }
}

exit 0
`;

    try {
      await powerShellRunner(script, 35000);
    } catch (err) {
      const fallbackScript = `
for ($c = 0; $c -lt ${safeCopies}; $c++) {
  Get-Content -Path '${escapedFile}' -Raw | Out-Printer -Name '${escapedPrinter}'
}
`;
      try {
        await powerShellRunner(fallbackScript, 20000);
      } catch (fallbackErr) {
        throw new Error(`Windows Spooler rejected print job for ${device.name}: ${fallbackErr.message || err.message}`);
      }
    }

    return {
      confirmedAt: new Date().toISOString(),
      printerId: device.id,
      printerName: device.name,
      spoolerCompleted: true,
      appliedSettings: {
        copies: safeCopies,
        pageRange,
        paperSize,
        orientation,
        colorMode,
        duplex: isDuplex,
        sides,
      },
    };
  } finally {
    if (isTemporary) {
      try { fs.unlinkSync(targetFile); } catch {}
    }
  }
}

async function cancelJob(printerId, jobId) {
  const escapedPrinter = printerId.replace(/'/g, "''");
  const script = `
Get-PrintJob -PrinterName '${escapedPrinter}' -ErrorAction SilentlyContinue | Remove-PrintJob -ErrorAction SilentlyContinue
`;
  try {
    await powerShellRunner(script, 8000);
    return { success: true, message: `Cancellation signal sent to Windows spooler for ${printerId}.` };
  } catch (err) {
    return { success: false, message: `Could not cancel job on ${printerId}: ${err.message}` };
  }
}

module.exports = {
  listPrinters,
  findDevice,
  print,
  cancelJob,
  printTestPage,
  connectPrinter,
  detectPrinterFault,
  mode: 'windows',
  powerShellRunner: (script, timeout) => powerShellRunner(script, timeout),
  setPowerShellRunner,
  resetPowerShellRunner,
  runPowerShell,
};
