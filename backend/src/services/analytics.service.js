const db = require('../db');

function rowsToMap(rows, keyField, valueField = 'c') {
  const map = {};
  rows.forEach((r) => {
    map[r[keyField]] = r[valueField];
  });
  return map;
}

function getSummary() {
  const totalSessions = db.prepare('SELECT COUNT(*) c FROM sessions').get().c;
  const sessionsByStatus = rowsToMap(
    db.prepare('SELECT status, COUNT(*) c FROM sessions GROUP BY status').all(),
    'status'
  );

  const totalFiles = db.prepare(`SELECT COUNT(*) c FROM files WHERE status != 'WITHDRAWN'`).get().c;
  const duplicateFiles = db
    .prepare(`SELECT COUNT(*) c FROM files WHERE duplicate_of IS NOT NULL AND status != 'WITHDRAWN'`)
    .get().c;
  const filesByType = rowsToMap(
    db.prepare(`SELECT extension, COUNT(*) c FROM files WHERE status != 'WITHDRAWN' GROUP BY extension`).all(),
    'extension'
  );

  const totalPrintJobs = db.prepare('SELECT COUNT(*) c FROM print_jobs').get().c;
  const printJobsByStatus = rowsToMap(
    db.prepare('SELECT status, COUNT(*) c FROM print_jobs GROUP BY status').all(),
    'status'
  );
  const completedJobs = printJobsByStatus.COMPLETED || 0;
  const failedJobs = printJobsByStatus.FAILED || 0;
  const printSuccessRate =
    completedJobs + failedJobs > 0 ? completedJobs / (completedJobs + failedJobs) : null;

  const avgPrintSecondsRow = db
    .prepare(
      `SELECT AVG((julianday(completed_at) - julianday(created_at)) * 86400) AS avg_seconds
       FROM print_jobs WHERE status = 'COMPLETED' AND completed_at IS NOT NULL`
    )
    .get();

  // Continuous 14-day calendar timeline with zero-fill for smooth data-analysis time series
  const dateMap = {};
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dayStr = d.toISOString().slice(0, 10);
    dateMap[dayStr] = 0;
  }
  const rawUploads = db
    .prepare(
      `SELECT substr(uploaded_at, 1, 10) AS day, COUNT(*) c
       FROM files WHERE status != 'WITHDRAWN'
       GROUP BY day ORDER BY day DESC LIMIT 14`
    )
    .all();
  rawUploads.forEach((r) => {
    if (r.day) dateMap[r.day] = r.c;
  });
  const uploadsPerDay = Object.keys(dateMap)
    .sort()
    .map((day) => ({ day, count: dateMap[day] }));

  // Total data volume processed
  const fileBytesRow = db
    .prepare(`SELECT COALESCE(SUM(size_bytes), 0) AS total_bytes FROM files WHERE status != 'WITHDRAWN'`)
    .get();
  const totalBytes = fileBytesRow ? fileBytesRow.total_bytes : 0;

  // Total pages printed
  const sheetsRow = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN completed_pages > 0 THEN completed_pages ELSE COALESCE(total_pages, 1) * COALESCE(copies, 1) END), 0) AS total_pages
       FROM print_jobs WHERE status = 'COMPLETED'`
    )
    .get();
  const totalSheetsPrinted = sheetsRow ? sheetsRow.total_pages : 0;

  // Zero-trust secure cleanup count
  const deletedFilesCount = db
    .prepare(`SELECT COUNT(*) c FROM files WHERE status = 'DELETED'`)
    .get().c;

  // Color distribution
  const colorDistribution = rowsToMap(
    db.prepare(`SELECT COALESCE(color_mode, 'bw') AS color_mode, COUNT(*) c FROM print_jobs GROUP BY color_mode`).all(),
    'color_mode'
  );

  const failureRows = db
    .prepare(
      `SELECT failure_code, COUNT(*) c FROM print_jobs WHERE failure_code IS NOT NULL GROUP BY failure_code`
    )
    .all();
  const failuresByCode = rowsToMap(failureRows, 'failure_code');

  const verificationRows = db
    .prepare(
      `SELECT verification_status, COUNT(*) c FROM print_jobs GROUP BY verification_status`
    )
    .all();
  const verificationByStatus = rowsToMap(verificationRows, 'verification_status');

  const retryRow = db
    .prepare(
      `SELECT SUM(attempts) AS total_attempts, MAX(attempts) AS max_attempts FROM print_jobs`
    )
    .get();

  const printerUsage = db
    .prepare(
      `SELECT
         COALESCE(printer_id, 'unassigned') AS printer_id,
         COUNT(*) AS total_jobs,
         SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed_jobs,
         SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed_jobs
       FROM print_jobs
       GROUP BY printer_id`
    )
    .all();

  const activeQueueCount = db
    .prepare(
      `SELECT COUNT(*) c FROM print_jobs WHERE status IN ('PENDING', 'PROCESSING', 'PRINTING', 'SPOOLER_COMPLETED', 'AWAITING_VERIFICATION', 'RETRYING')`
    )
    .get().c;

  // Hourly density distribution (0-23)
  const hourlyMap = {};
  for (let h = 0; h < 24; h++) {
    hourlyMap[h] = 0;
  }
  const rawHourly = db
    .prepare(
      `SELECT cast(strftime('%H', uploaded_at) as integer) AS hour, COUNT(*) c
       FROM files WHERE status != 'WITHDRAWN' AND uploaded_at IS NOT NULL
       GROUP BY hour`
    )
    .all();
  rawHourly.forEach((r) => {
    if (r.hour >= 0 && r.hour < 24) {
      hourlyMap[r.hour] = r.c;
    }
  });
  const hourlyDistribution = Object.keys(hourlyMap)
    .map(Number)
    .sort((a, b) => a - b)
    .map((hour) => ({ hour, count: hourlyMap[hour] }));

  // Paper size distribution
  const paperSizeDistribution = rowsToMap(
    db.prepare(`SELECT COALESCE(paper_size, 'A4') AS paper_size, COUNT(*) c FROM print_jobs GROUP BY paper_size`).all(),
    'paper_size'
  );

  // Duplex statistics & environmental paper savings
  const duplexRow = db
    .prepare(
      `SELECT
         SUM(CASE WHEN duplex = 1 THEN 1 ELSE 0 END) AS duplex_jobs,
         SUM(CASE WHEN duplex = 0 OR duplex IS NULL THEN 1 ELSE 0 END) AS single_jobs,
         SUM(CASE WHEN duplex = 1 THEN CAST(COALESCE(total_pages, 2) / 2 AS INTEGER) * COALESCE(copies, 1) ELSE 0 END) AS sheets_saved
       FROM print_jobs WHERE status = 'COMPLETED'`
    )
    .get();

  const duplexJobs = duplexRow?.duplex_jobs || 0;
  const singleJobs = duplexRow?.single_jobs || 0;
  const sheetsSaved = duplexRow?.sheets_saved || 0;
  const totalCompletedJobs = duplexJobs + singleJobs;
  const duplexRatio = totalCompletedJobs > 0 ? duplexJobs / totalCompletedJobs : 0;

  // Recent job telemetry log
  const recentTelemetryLogs = db
    .prepare(
      `SELECT
         pj.id,
         pj.file_id,
         f.original_name AS file_name,
         pj.printer_name,
         pj.status,
         pj.copies,
         pj.color_mode,
         pj.paper_size,
         pj.duplex,
         pj.created_at,
         pj.completed_at,
         ROUND(MAX(0.5, (julianday(COALESCE(pj.completed_at, pj.created_at)) - julianday(pj.created_at)) * 86400), 1) AS latency_seconds
       FROM print_jobs pj
       LEFT JOIN files f ON pj.file_id = f.id
       ORDER BY pj.created_at DESC
       LIMIT 20`
    )
    .all();

  return {
    totalSessions,
    sessionsByStatus,
    totalFiles,
    totalBytes,
    totalSheetsPrinted,
    deletedFilesCount,
    duplicateFiles,
    duplicateRate: totalFiles > 0 ? duplicateFiles / totalFiles : 0,
    filesByType,
    colorDistribution,
    paperSizeDistribution,
    duplexStats: {
      duplexJobs,
      singleJobs,
      sheetsSaved,
      duplexRatio,
    },
    environmentalImpact: {
      sheetsSaved,
      co2SavedKg: Number((sheetsSaved * 0.0045).toFixed(2)),
      waterSavedLiters: Number((sheetsSaved * 0.26).toFixed(1)),
    },
    totalPrintJobs,
    printJobsByStatus,
    printSuccessRate,
    avgPrintSeconds: avgPrintSecondsRow ? avgPrintSecondsRow.avg_seconds : null,
    uploadsPerDay,
    hourlyDistribution,
    failuresByCode,
    verificationByStatus,
    retryStats: {
      totalAttempts: retryRow.total_attempts || 0,
      maxAttempts: retryRow.max_attempts || 0,
    },
    printerUsage,
    activeQueueCount,
    recentTelemetryLogs,
  };
}

module.exports = { getSummary };
