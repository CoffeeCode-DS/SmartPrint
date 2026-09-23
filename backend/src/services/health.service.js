const fs = require('fs');
const path = require('path');
const db = require('../db');
const filesRepo = require('../db/files.repo');
const logsRepo = require('../db/logs.repo');
const printJobsRepo = require('../db/printJobs.repo');
const printersRepo = require('../db/printers.repo');
const cleanupService = require('./cleanup.service');
const printerAdapter = require('../printers');
const emitter = require('../sockets/emitter');
const env = require('../config/env');

async function getSystemHealth() {
  const uptimeSeconds = Math.floor(process.uptime());
  const memUsage = process.memoryUsage();

  // 1. SQLite Health
  let sqliteStatus = 'OK';
  let sqliteError = null;
  let journalMode = 'UNKNOWN';
  try {
    const quickCheck = db.prepare('PRAGMA quick_check').get();
    if (quickCheck && Object.values(quickCheck)[0] !== 'ok') {
      sqliteStatus = 'DEGRADED';
      sqliteError = String(Object.values(quickCheck)[0]);
    }
    journalMode = db.pragma('journal_mode', { simple: true });
  } catch (err) {
    sqliteStatus = 'ERROR';
    sqliteError = err.message;
  }

  // 2. Storage Health
  let storageStatus = 'OK';
  let storageError = null;
  const storagePath = path.resolve(env.UPLOAD_DIR || './storage/uploads');
  try {
    if (!fs.existsSync(storagePath)) {
      fs.mkdirSync(storagePath, { recursive: true });
    }
    fs.accessSync(storagePath, fs.constants.R_OK | fs.constants.W_OK);
  } catch (err) {
    storageStatus = 'ERROR';
    storageError = err.message;
  }

  const pendingDeletions = filesRepo.findPendingDeletions().length;
  const activeFilesCount = filesRepo.listAllValidFiles().length;

  // 3. Sockets Health
  const socketStats = emitter.getSocketStats();

  // 4. Printers Health
  let printerStats = { total: 0, available: 0, maintenance: 0, offline: 0, error: 0 };
  let printersList = [];
  try {
    const rawPrinters = await printerAdapter.listPrinters();
    const overrides = printersRepo.listStatusOverrides();
    const overrideMap = new Map(overrides.map((o) => [o.printer_id, o]));
    printersList = rawPrinters.map((p) => {
      const rec = overrideMap.get(p.id);
      const effectiveStatus = rec ? rec.status : p.status;
      return {
        id: p.id,
        name: p.name,
        status: effectiveStatus,
        isDefault: p.isDefault,
      };
    });
    printerStats.total = printersList.length;
    printersList.forEach((p) => {
      const s = (p.status || '').toUpperCase();
      if (s === 'AVAILABLE' || s === 'READY' || s === 'ONLINE') printerStats.available++;
      else if (s === 'MAINTENANCE') printerStats.maintenance++;
      else if (s === 'OFFLINE') printerStats.offline++;
      else printerStats.error++;
    });
  } catch (err) {
    printerStats.error = 1;
  }

  // 5. Cleanup Worker
  const cleanupStats = cleanupService.getLastSweepStats();

  // 6. Overall system status
  let status = 'HEALTHY';
  if (sqliteStatus === 'ERROR' || storageStatus === 'ERROR') {
    status = 'UNHEALTHY';
  } else if (sqliteStatus === 'DEGRADED' || printerStats.available === 0 || pendingDeletions > 10) {
    status = 'DEGRADED';
  }

  return {
    status,
    timestamp: new Date().toISOString(),
    backend: {
      status: 'OK',
      uptimeSeconds,
      nodeVersion: process.version,
      pid: process.pid,
      memoryUsage: {
        rssBytes: memUsage.rss,
        heapTotalBytes: memUsage.heapTotal,
        heapUsedBytes: memUsage.heapUsed,
      },
    },
    database: {
      status: sqliteStatus,
      journalMode,
      error: sqliteError,
    },
    storage: {
      status: storageStatus,
      path: storagePath,
      error: storageError,
      activeFilesCount,
      pendingDeletionsCount: pendingDeletions,
    },
    sockets: socketStats,
    printers: {
      stats: printerStats,
      devices: printersList,
    },
    cleanupWorker: {
      active: true,
      lastSweepAt: cleanupStats?.timestamp || null,
      lastSweepStats: cleanupStats?.stats || null,
    },
  };
}

async function getConsistencyReport() {
  const storagePath = path.resolve(env.UPLOAD_DIR || './storage/uploads');
  const validDbFiles = filesRepo.listAllValidFiles();
  const knownStoragePaths = new Set(validDbFiles.map((f) => path.resolve(f.storage_path)));

  const diskFiles = [];
  if (fs.existsSync(storagePath)) {
    const entries = fs.readdirSync(storagePath, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory()) {
        const subPath = path.join(storagePath, ent.name);
        try {
          const subEntries = fs.readdirSync(subPath, { withFileTypes: true });
          for (const sub of subEntries) {
            if (sub.isFile()) {
              diskFiles.push(path.resolve(path.join(subPath, sub.name)));
            }
          }
        } catch {
          // ignore
        }
      } else if (ent.isFile()) {
        diskFiles.push(path.resolve(path.join(storagePath, ent.name)));
      }
    }
  }

  // Disk files not in valid DB files
  const orphanedOnDisk = diskFiles.filter((p) => !knownStoragePaths.has(p));

  // DB files missing from disk
  const diskFileSet = new Set(diskFiles);
  const missingFromDisk = validDbFiles
    .filter((f) => !diskFileSet.has(path.resolve(f.storage_path)))
    .map((f) => ({ id: f.id, originalName: f.original_name, storedName: f.stored_name }));

  // Pending deletions
  const pendingDeletions = filesRepo.findPendingDeletions().map((f) => ({
    id: f.id,
    storedName: f.stored_name,
    deletionAttempts: f.deletion_attempts,
    uploadedAt: f.uploaded_at,
  }));

  // Stale or stuck jobs (in PROCESSING or PRINTING for > 10 mins)
  const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const allJobs = printJobsRepo.listAll();
  const stuckJobs = allJobs
    .filter((j) => ['PROCESSING', 'PRINTING'].includes(j.status) && j.created_at < tenMinsAgo)
    .map((j) => ({ id: j.id, status: j.status, printerId: j.printer_id, createdAt: j.created_at }));

  // Audit log hash-chain verification
  const auditVerification = logsRepo.verifyAuditChain();

  const isConsistent =
    missingFromDisk.length === 0 &&
    orphanedOnDisk.length === 0 &&
    stuckJobs.length === 0 &&
    auditVerification.valid;

  return {
    status: isConsistent ? 'CONSISTENT' : 'INCONSISTENCIES_DETECTED',
    timestamp: new Date().toISOString(),
    orphanedFilesCount: orphanedOnDisk.length,
    orphanedFilesSample: orphanedOnDisk.slice(0, 20),
    missingFilesCount: missingFromDisk.length,
    missingFiles: missingFromDisk,
    pendingDeletionsCount: pendingDeletions.length,
    pendingDeletions,
    stuckJobsCount: stuckJobs.length,
    stuckJobs,
    auditChainIntegrity: auditVerification,
  };
}

module.exports = {
  getSystemHealth,
  getConsistencyReport,
};
