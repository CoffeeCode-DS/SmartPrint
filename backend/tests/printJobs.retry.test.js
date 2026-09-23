jest.mock('../src/printers/mockPrinters', () => {
  const actual = jest.requireActual('../src/printers/mockPrinters');
  return {
    ...actual,
    print: jest.fn(),
  };
});

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');
const mockPrinters = require('../src/printers/mockPrinters');
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
  mockPrinters.print.mockReset();
});

function auth(req) {
  return req.set('Authorization', `Bearer ${token}`);
}

function pdfBuffer() {
  return Buffer.from('%PDF-1.4\n%%EOF');
}

async function createValidatedFile() {
  const sessionRes = await request(app).post('/api/sessions').send({});
  const session = sessionRes.body.data.session;
  const uploadRes = await request(app)
    .post(`/api/sessions/${session.id}/upload`)
    .attach('file', pdfBuffer(), 'a.pdf');
  return { session, file: uploadRes.body.data.file };
}

async function waitForStatus(jobId, targetStatuses, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await auth(request(app).get(`/api/print-jobs/${jobId}`));
    if (targetStatuses.includes(res.body.data.printJob.status)) {
      return res.body.data.printJob;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for [${targetStatuses}], got ${res.body.data.printJob.status}`);
    }
    await new Promise((r) => setTimeout(r, 15));
  }
}

describe('Print Job retry workflow (deterministic mock printer)', () => {
  test('a failed job can be retried and succeeds on the second attempt', async () => {
    mockPrinters.print
      .mockRejectedValueOnce(new Error('Simulated paper jam'))
      .mockResolvedValueOnce({ confirmedAt: new Date().toISOString(), printerName: 'MOCK_PRINTER_DEV' });

    const { file } = await createValidatedFile();
    const createRes = await auth(request(app).post('/api/print-jobs')).send({ fileId: file.id, printerId: 'mock-hp-laserjet' });
    const jobId = createRes.body.data.printJob.id;

    const failed = await waitForStatus(jobId, ['FAILED']);
    expect(failed.status).toBe('FAILED');
    expect(failed.attempts).toBe(1);
    expect(failed.errorMessage).toContain('Simulated paper jam');

    const retryRes = await auth(request(app).post(`/api/print-jobs/${jobId}/retry`));
    expect(retryRes.status).toBe(200);

    const completed = await waitForStatus(jobId, ['COMPLETED']);
    expect(completed.status).toBe('COMPLETED');
  });

  test('retries are capped at max_attempts (PRINT_MAX_ATTEMPTS=3 in test env)', async () => {
    mockPrinters.print.mockRejectedValue(new Error('Always fails'));

    const { file } = await createValidatedFile();
    const createRes = await auth(request(app).post('/api/print-jobs')).send({ fileId: file.id, printerId: 'mock-hp-laserjet' });
    const jobId = createRes.body.data.printJob.id;

    let job = await waitForStatus(jobId, ['FAILED']);
    expect(job.attempts).toBe(1);

    await auth(request(app).post(`/api/print-jobs/${jobId}/retry`));
    job = await waitForStatus(jobId, ['FAILED']);
    expect(job.attempts).toBe(2);

    await auth(request(app).post(`/api/print-jobs/${jobId}/retry`));
    job = await waitForStatus(jobId, ['FAILED']);
    expect(job.attempts).toBe(3);

    const blockedRetry = await auth(request(app).post(`/api/print-jobs/${jobId}/retry`));
    expect(blockedRetry.status).toBe(400);
  });

  test('a duplicate print is still blocked even after the original job completed', async () => {
    mockPrinters.print.mockResolvedValue({
      confirmedAt: new Date().toISOString(),
      printerName: 'MOCK_PRINTER_DEV',
    });

    const session1 = await request(app).post('/api/sessions').send({});
    const session2 = await request(app).post('/api/sessions').send({});
    const buf = pdfBuffer();

    const up1 = await request(app)
      .post(`/api/sessions/${session1.body.data.session.id}/upload`)
      .attach('file', buf, 'a.pdf');
    const job1 = await auth(request(app).post('/api/print-jobs')).send({ fileId: up1.body.data.file.id, printerId: 'mock-hp-laserjet' });
    await waitForStatus(job1.body.data.printJob.id, ['COMPLETED']);

    const up2 = await request(app)
      .post(`/api/sessions/${session2.body.data.session.id}/upload`)
      .attach('file', buf, 'a.pdf');
    const job2 = await auth(request(app).post('/api/print-jobs')).send({ fileId: up2.body.data.file.id, printerId: 'mock-hp-laserjet' });

    expect(job2.status).toBe(409);
  });
});
