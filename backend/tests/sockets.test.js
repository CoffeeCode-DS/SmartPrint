const { createServer } = require('../src/createServer');
const { io: ioClient } = require('socket.io-client');
const request = require('supertest');

let httpServer;
let app;
let baseUrl;

function connectClient() {
  const socket = ioClient(baseUrl, { transports: ['websocket'], forceNew: true });
  const connected = new Promise((resolve) => {
    if (socket.connected) resolve();
    else socket.once('connect', resolve);
  });
  return { socket, connected };
}

function waitForEvent(socket, event, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${event}"`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

beforeAll((done) => {
  const built = createServer();
  httpServer = built.httpServer;
  app = require('../src/app');
  httpServer.listen(0, () => {
    const { port } = httpServer.address();
    baseUrl = `http://localhost:${port}`;
    done();
  });
});

afterAll((done) => {
  httpServer.close(done);
});

async function createSession() {
  const res = await request(app).post('/api/sessions').send({});
  return res.body.data.session;
}

describe('Socket.IO real-time events', () => {
  test('a client joining a session room receives a session:joined ack', async () => {
    const session = await createSession();
    const { socket, connected } = connectClient();
    await connected;

    const ackPromise = waitForEvent(socket, 'session:joined');
    socket.emit('session:join', { sessionId: session.id, role: 'viewer' });
    const ack = await ackPromise;

    expect(ack.sessionId).toBe(session.id);
    socket.disconnect();
  });

  test('a second client joining the same session notifies the first (presence)', async () => {
    const session = await createSession();
    const a = connectClient();
    const b = connectClient();
    await a.connected;
    await b.connected;

    a.socket.emit('session:join', { sessionId: session.id, role: 'viewer' });
    await waitForEvent(a.socket, 'session:joined');

    const presencePromise = waitForEvent(a.socket, 'client:connected');
    b.socket.emit('session:join', { sessionId: session.id, role: 'uploader' });
    const presence = await presencePromise;

    expect(presence.role).toBe('uploader');
    a.socket.disconnect();
    b.socket.disconnect();
  });

  test('a real file upload triggers upload:completed and notification:created for listeners', async () => {
    const session = await createSession();
    const { socket, connected } = connectClient();
    await connected;
    socket.emit('session:join', { sessionId: session.id, role: 'viewer' });
    await waitForEvent(socket, 'session:joined');

    const completedPromise = waitForEvent(socket, 'upload:completed');
    const notifiedPromise = waitForEvent(socket, 'notification:created');

    await request(app)
      .post(`/api/sessions/${session.id}/upload`)
      .attach('file', Buffer.from('%PDF-1.4\n%%EOF'), 'a.pdf');

    const completed = await completedPromise;
    const notified = await notifiedPromise;

    expect(completed.file.originalName).toBe('a.pdf');
    expect(notified.type).toBe('UPLOAD_SUCCESS');
    socket.disconnect();
  });

  test('an invalid upload triggers validation:failed over the socket, not upload:completed', async () => {
    const session = await createSession();
    const { socket, connected } = connectClient();
    await connected;
    socket.emit('session:join', { sessionId: session.id, role: 'viewer' });
    await waitForEvent(socket, 'session:joined');

    const failedPromise = waitForEvent(socket, 'validation:failed');

    await request(app)
      .post(`/api/sessions/${session.id}/upload`)
      .attach('file', Buffer.from('not a real pdf'), 'fake.pdf');

    const failed = await failedPromise;
    expect(failed.reason).toBe('UNRECOGNIZED_FILE_TYPE');
    socket.disconnect();
  });

  test('disconnecting a joined client notifies the remaining room member', async () => {
    const session = await createSession();
    const a = connectClient();
    const b = connectClient();
    await a.connected;
    await b.connected;

    a.socket.emit('session:join', { sessionId: session.id, role: 'viewer' });
    await waitForEvent(a.socket, 'session:joined');
    b.socket.emit('session:join', { sessionId: session.id, role: 'uploader' });
    await waitForEvent(a.socket, 'client:connected');

    const disconnectPromise = waitForEvent(a.socket, 'client:disconnected');
    b.socket.disconnect();
    const payload = await disconnectPromise;

    expect(payload.role).toBe('uploader');
    a.socket.disconnect();
  });

  test('after a client disconnects and reconnects, re-joining the room still receives live events', async () => {
    const session = await createSession();
    const socket = ioClient(baseUrl, { transports: ['websocket'], forceNew: true, reconnection: false });

    // Mirrors the frontend's useSessionSocket hook: re-join on every 'connect'
    // event, which fires both for the initial connection AND any reconnect.
    socket.on('connect', () => {
      socket.emit('session:join', { sessionId: session.id, role: 'viewer' });
    });

    await new Promise((resolve) => {
      if (socket.connected) resolve();
      else socket.once('connect', resolve);
    });
    await waitForEvent(socket, 'session:joined');

    // Simulate a dropped connection (e.g. phone briefly losing signal) and
    // a manual reconnect (this test client has reconnection disabled above
    // so the timing is deterministic).
    socket.disconnect();
    await new Promise((r) => setTimeout(r, 100));
    expect(socket.connected).toBe(false);

    const rejoinedPromise = waitForEvent(socket, 'session:joined');
    socket.connect();
    await rejoinedPromise; // proves the reconnect + re-join round-trip works

    // Prove room membership is real, not just the ack: a genuine upload
    // event must still reach this socket after reconnecting.
    const completedPromise = waitForEvent(socket, 'upload:completed');
    await request(app)
      .post(`/api/sessions/${session.id}/upload`)
      .attach('file', Buffer.from('%PDF-1.4\n%%EOF'), 'reconnect-test.pdf');
    const completed = await completedPromise;

    expect(completed.file.originalName).toBe('reconnect-test.pdf');
    socket.disconnect();
  });
});
