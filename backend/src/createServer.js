const http = require('http');
const { Server } = require('socket.io');
const app = require('./app');
const env = require('./config/env');
const { initSockets } = require('./sockets');

/**
 * Builds (but does not start listening on) the HTTP + Socket.IO server.
 * Separated from server.js so tests can spin up an ephemeral instance
 * on a random port instead of the configured one.
 */
function createServer() {
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
  });
  initSockets(io);
  return { httpServer, io };
}

module.exports = { createServer };
