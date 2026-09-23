const cron = require('node-cron');
const cleanupService = require('./services/cleanup.service');
const { reconcileJobsOnStartup } = require('./services/recovery.service');
const env = require('./config/env');

let activeTask = null;

/**
 * Starts the recurring TTL/cleanup sweep and reconciles crash recovery.
 */
function startCleanupScheduler() {
  try {
    // 1. Reconcile unfinished jobs from SQLite with printer state
    reconcileJobsOnStartup().then((rec) => {
      if (rec.reconciledCount > 0) {
        // eslint-disable-next-line no-console
        console.log(`Startup reconciliation: recovered ${rec.reconciledCount} job(s) from crash.`);
      }
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Startup printer reconciliation failed:', err);
    });

    // 2. Run initial cleanup sweep
    const result = cleanupService.runCleanupSweep();
    // eslint-disable-next-line no-console
    console.log(
      `Startup cleanup sweep: recovered ${result.recovered} stale job(s), ` +
        `expired ${result.expiredSessions} session(s), deleted ${result.deletedFiles} file(s).`
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Initial cleanup sweep failed:', err);
  }

  const seconds = Math.max(5, env.CLEANUP_INTERVAL_SECONDS);
  activeTask = cron.schedule(`*/${seconds} * * * * *`, () => {
    try {
      cleanupService.runCleanupSweep();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Scheduled cleanup sweep failed:', err);
    }
  });

  return activeTask;
}

function stopCleanupScheduler() {
  if (activeTask) {
    activeTask.stop();
    activeTask = null;
  }
}

module.exports = { startCleanupScheduler, stopCleanupScheduler };
