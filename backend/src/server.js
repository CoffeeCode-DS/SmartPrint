const { createServer } = require('./createServer');
const env = require('./config/env');
const db = require('./db');
const { startCleanupScheduler, stopCleanupScheduler } = require('./scheduler');

const { httpServer, io } = createServer();
httpServer.requestTimeout = 300000; // 5 min request timeout for heavy mobile uploads
httpServer.headersTimeout = 310000;
httpServer.keepAliveTimeout = 65000;

const server = httpServer.listen(env.PORT, () => {
  console.log(`PrintSafe backend running on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  console.log('Socket.IO ready for real-time connections');
  console.log('');
  console.log(`  QR codes will point phones to: ${env.PUBLIC_URL}`);
  if (env.PUBLIC_URL === env.FRONTEND_URL && env.PUBLIC_URL.includes('localhost')) {
    console.log(
      '  ⚠ Could not auto-detect a LAN IP — a phone will NOT be able to reach this URL.'
    );
    console.log('  See "Scanning the QR code from a real phone" in README.md.');
  } else {
    console.log('  Make sure your phone is on the same Wi-Fi as this machine.');
  }
  console.log('');
  startCleanupScheduler();
});

function gracefulShutdown(signal) {
  console.log(`\nReceived ${signal}. Starting graceful shutdown...`);
  stopCleanupScheduler();

  if (io) {
    try {
      io.close();
    } catch (e) {
      // ignore
    }
  }

  server.close(() => {
    console.log('HTTP and WebSocket server stopped.');
    try {
      db.close();
      console.log('Database connections closed.');
    } catch (err) {
      console.error('Error closing database:', err);
    }
    process.exit(0);
  });

  setTimeout(() => {
    console.error('Forced shutdown after 5s timeout.');
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
