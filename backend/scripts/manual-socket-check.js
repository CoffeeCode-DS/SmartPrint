/* eslint-disable no-console */
const { io } = require('socket.io-client');

const BASE = 'http://localhost:5000';

async function main() {
  // 1. Create a session over REST, like the Dashboard would.
  const createRes = await fetch(`${BASE}/api/sessions`, { method: 'POST' });
  const { data } = await createRes.json();
  const sessionId = data.session.id;
  console.log('Session created:', sessionId);

  // 2. Two socket clients: one plays the Dashboard ("viewer"), one plays
  //    the phone that scanned the QR ("uploader").
  const viewer = io(BASE, { transports: ['websocket'] });
  const uploader = io(BASE, { transports: ['websocket'] });

  // IMPORTANT: capture the connect promise immediately, since 'connect' can
  // fire before we get around to attaching a listener later in the script.
  const viewerConnected = new Promise((resolve) => {
    if (viewer.connected) resolve();
    else viewer.once('connect', resolve);
  });
  const uploaderConnected = new Promise((resolve) => {
    if (uploader.connected) resolve();
    else uploader.once('connect', resolve);
  });

  const viewerEvents = [];
  const uploaderEvents = [];

  ['session:joined', 'client:connected', 'client:disconnected', 'upload:started',
   'upload:progress', 'upload:completed', 'validation:failed', 'notification:created',
   'session:used'].forEach((evt) => {
    viewer.on(evt, (payload) => viewerEvents.push({ evt, payload }));
  });

  console.log('waiting for viewer connect...');
  await viewerConnected;
  console.log('viewer connected');
  viewer.emit('session:join', { sessionId, role: 'viewer' });
  await new Promise((r) => setTimeout(r, 200));

  console.log('waiting for uploader connect...');
  await uploaderConnected;
  console.log('uploader connected');
  uploader.emit('session:join', { sessionId, role: 'uploader' });
  await new Promise((r) => setTimeout(r, 300));

  console.log('\n--- After both clients joined ---');
  console.log('Viewer saw client:connected?', viewerEvents.some((e) => e.evt === 'client:connected'));

  // 3. Simulate the uploader signaling upload progress via socket.
  uploader.emit('upload:started', { sessionId });
  uploader.emit('upload:progress', { sessionId, percent: 40 });
  uploader.emit('upload:progress', { sessionId, percent: 90 });
  await new Promise((r) => setTimeout(r, 200));

  console.log('Viewer saw upload:started?', viewerEvents.some((e) => e.evt === 'upload:started'));
  const progressEvents = viewerEvents.filter((e) => e.evt === 'upload:progress');
  console.log('Viewer progress events:', progressEvents.map((e) => e.payload.percent));

  // 4. Actually upload a real file via REST, and confirm the backend pushes
  //    upload:completed + notification:created to the viewer in real time.
  const form = new FormData();
  const blob = new Blob([Buffer.from('%PDF-1.4\n%%EOF')], { type: 'application/pdf' });
  form.append('file', blob, 'test.pdf');

  const uploadRes = await fetch(`${BASE}/api/sessions/${sessionId}/upload`, {
    method: 'POST',
    body: form,
  });
  const uploadJson = await uploadRes.json();
  console.log('\nREST upload response ok?', uploadJson.success);

  await new Promise((r) => setTimeout(r, 300));

  console.log('Viewer saw upload:completed?', viewerEvents.some((e) => e.evt === 'upload:completed'));
  console.log('Viewer saw notification:created?', viewerEvents.some((e) => e.evt === 'notification:created'));
  console.log('Viewer saw session:used (one-time QR consumed)?', viewerEvents.some((e) => e.evt === 'session:used'));

  // 5. Disconnect the uploader, confirm the viewer is told.
  uploader.disconnect();
  await new Promise((r) => setTimeout(r, 300));
  console.log('Viewer saw client:disconnected?', viewerEvents.some((e) => e.evt === 'client:disconnected'));

  viewer.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('TEST SCRIPT FAILED:', err);
  process.exit(1);
});
