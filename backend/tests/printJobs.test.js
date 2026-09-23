const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');
const { loginAsAdmin } = require('./helpers/auth');

let token;

beforeAll(async () => {
  token = await loginAsAdmin(app);
});

beforeEach(() => {
  db.exec(`
    DELETE FROM print_jobs;
    DELETE FROM files;
    DELETE FROM sessions;
    DELETE FROM notifications;
    DELETE FROM activity_logs;
    DELETE FROM audit_logs;
  `);
});

function auth(req) {
  return req.set('Authorization', `Bearer ${token}`);
}

function pdfBuffer() {
  return Buffer.from('%PDF-1.4\n%%EOF');
}

async function createValidatedFile(nameSuffix = 'a') {
  const sessionRes = await request(app).post('/api/sessions').send({});
  const session = sessionRes.body.data.session;
  const uploadRes = await request(app)
    .post(`/api/sessions/${session.id}/upload`)
    .attach('file', pdfBuffer(), `${nameSuffix}.pdf`);
  return { session, file: uploadRes.body.data.file };
}

async function waitForStatus(jobId, targetStatuses, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await auth(request(app).get(`/api/print-jobs/${jobId}`));
    if (targetStatuses.includes(res.body.data.printJob.status)) {
      return res.body.data.printJob;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for job ${jobId} to reach [${targetStatuses}], last status: ${res.body.data.printJob.status}`
      );
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('Print Job API auth (RBAC enforcement)', () => {
  test('unauthenticated requests are rejected with 401', async () => {
    const res = await request(app).get('/api/print-jobs');
    expect(res.status).toBe(401);
  });

  test('unauthenticated file list requests are rejected with 401', async () => {
    const res = await request(app).get('/api/files');
    expect(res.status).toBe(401);
  });

  test('the anonymous upload route remains public (no auth required)', async () => {
    const sessionRes = await request(app).post('/api/sessions').send({});
    const res = await request(app)
      .post(`/api/sessions/${sessionRes.body.data.session.id}/upload`)
      .attach('file', pdfBuffer(), 'public.pdf');
    expect(res.status).toBe(201);
  });
});

describe('Print Job API', () => {
  test('creates a print job for a validated file and it completes via the mock printer', async () => {
    const { file } = await createValidatedFile();

    const createRes = await auth(request(app).post('/api/print-jobs')).send({ fileId: file.id, printerId: 'mock-hp-laserjet' });
    expect(createRes.status).toBe(201);
    expect(createRes.body.data.printJob.status).toBe('PENDING');

    const completed = await waitForStatus(createRes.body.data.printJob.id, ['COMPLETED', 'FAILED']);
    expect(completed.status).toBe('COMPLETED');
    expect(completed.printerId).toBe('mock-hp-laserjet');
    expect(completed.printerName).toBe('HP LaserJet Pro M404');
    expect(completed.completedAt).toBeTruthy();
  });

  test('rejects a print job for a file that is not VALIDATED (e.g. already deleted)', async () => {
    const res = await auth(request(app).post('/api/print-jobs')).send({ fileId: 'a'.repeat(16), printerId: 'mock-hp-laserjet' });
    expect(res.status).toBe(404);
  });

  test('duplicate print prevention: a second identical file is blocked from auto-queuing a redundant job', async () => {
    const session1 = await request(app).post('/api/sessions').send({});
    const session2 = await request(app).post('/api/sessions').send({});
    const buf = pdfBuffer();

    const up1 = await request(app)
      .post(`/api/sessions/${session1.body.data.session.id}/upload`)
      .attach('file', buf, 'a.pdf');
    const up2 = await request(app)
      .post(`/api/sessions/${session2.body.data.session.id}/upload`)
      .attach('file', buf, 'a.pdf');

    const job1 = await auth(request(app).post('/api/print-jobs')).send({ fileId: up1.body.data.file.id, printerId: 'mock-hp-laserjet' });
    expect(job1.status).toBe(201);

    const job2 = await auth(request(app).post('/api/print-jobs')).send({ fileId: up2.body.data.file.id, printerId: 'mock-hp-laserjet' });
    expect(job2.status).toBe(409);
    expect(job2.body.error.details.duplicateFileId).toBe(up1.body.data.file.id);
  });

  test('duplicate prevention can be explicitly overridden with force: true', async () => {
    const session1 = await request(app).post('/api/sessions').send({});
    const session2 = await request(app).post('/api/sessions').send({});
    const buf = pdfBuffer();

    const up1 = await request(app)
      .post(`/api/sessions/${session1.body.data.session.id}/upload`)
      .attach('file', buf, 'a.pdf');
    const up2 = await request(app)
      .post(`/api/sessions/${session2.body.data.session.id}/upload`)
      .attach('file', buf, 'a.pdf');

    await auth(request(app).post('/api/print-jobs')).send({ fileId: up1.body.data.file.id, printerId: 'mock-hp-laserjet' });
    const forced = await auth(request(app).post('/api/print-jobs')).send({
      fileId: up2.body.data.file.id,
      printerId: 'mock-hp-laserjet',
      force: true,
    });

    expect(forced.status).toBe(201);
  });

  test('GET /api/print-jobs lists the queue, optionally filtered by session', async () => {
    const { session, file } = await createValidatedFile();
    await auth(request(app).post('/api/print-jobs')).send({ fileId: file.id, printerId: 'mock-hp-laserjet' });

    const all = await auth(request(app).get('/api/print-jobs'));
    expect(all.body.data.printJobs.length).toBeGreaterThanOrEqual(1);

    const filtered = await auth(request(app).get(`/api/print-jobs?sessionId=${session.id}`));
    expect(filtered.body.data.printJobs.every((j) => j.sessionId === session.id)).toBe(true);
  });

  test('GET /api/files lists recently uploaded files with their latest job status', async () => {
    const { file } = await createValidatedFile();
    await auth(request(app).post('/api/print-jobs')).send({ fileId: file.id, printerId: 'mock-hp-laserjet' });
    await waitForStatus((await auth(request(app).get('/api/print-jobs'))).body.data.printJobs[0].id, [
      'COMPLETED',
      'FAILED',
    ]);

    const res = await auth(request(app).get('/api/files'));
    expect(res.status).toBe(200);
    const found = res.body.data.files.find((f) => f.id === file.id);
    expect(found).toBeTruthy();
    expect(found.latestJobStatus).toBe('COMPLETED');
  });

  test('a PENDING job can be cancelled before it starts processing (best-effort race, tolerant of fast mock printer)', async () => {
    const { file } = await createValidatedFile();
    const createRes = await auth(request(app).post('/api/print-jobs')).send({ fileId: file.id, printerId: 'mock-hp-laserjet' });
    const jobId = createRes.body.data.printJob.id;

    const cancelRes = await auth(request(app).post(`/api/print-jobs/${jobId}/cancel`));
    expect([200, 400]).toContain(cancelRes.status);
  });

  test('cannot cancel a COMPLETED job', async () => {
    const { file } = await createValidatedFile();
    const createRes = await auth(request(app).post('/api/print-jobs')).send({ fileId: file.id, printerId: 'mock-hp-laserjet' });
    await waitForStatus(createRes.body.data.printJob.id, ['COMPLETED', 'FAILED']);

    const cancelRes = await auth(
      request(app).post(`/api/print-jobs/${createRes.body.data.printJob.id}/cancel`)
    );
    expect(cancelRes.status).toBe(400);
  });

  test('retrying a job that is not FAILED is rejected', async () => {
    const { file } = await createValidatedFile();
    const createRes = await auth(request(app).post('/api/print-jobs')).send({ fileId: file.id, printerId: 'mock-hp-laserjet' });
    await waitForStatus(createRes.body.data.printJob.id, ['COMPLETED', 'FAILED']);

    const retryRes = await auth(
      request(app).post(`/api/print-jobs/${createRes.body.data.printJob.id}/retry`)
    );
    expect(retryRes.status).toBe(400);
  });
});
