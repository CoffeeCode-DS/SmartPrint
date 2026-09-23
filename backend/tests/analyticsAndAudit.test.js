const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');
const { loginAsAdmin } = require('./helpers/auth');

let adminToken;

beforeAll(async () => {
  adminToken = await loginAsAdmin(app);
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

function auth(req, token = adminToken) {
  return req.set('Authorization', `Bearer ${token}`);
}

function pdfBuffer() {
  return Buffer.from('%PDF-1.4\n%%EOF');
}

async function operatorToken() {
  await auth(request(app).post('/api/auth/users')).send({
    username: 'analyticsop',
    password: 'operatorpass123',
    role: 'OPERATOR',
  });
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username: 'analyticsop', password: 'operatorpass123' });
  return res.body.data.token;
}

describe('Analytics API', () => {
  test('requires authentication', async () => {
    const res = await request(app).get('/api/analytics/summary');
    expect(res.status).toBe(401);
  });

  test('is accessible to both ADMIN and OPERATOR roles', async () => {
    const opToken = await operatorToken();
    const res = await auth(request(app).get('/api/analytics/summary'), opToken);
    expect(res.status).toBe(200);
  });

  test('reflects real upload/print activity in aggregate counts', async () => {
    const sessionRes = await request(app).post('/api/sessions').send({});
    const uploadRes = await request(app)
      .post(`/api/sessions/${sessionRes.body.data.session.id}/upload`)
      .attach('file', pdfBuffer(), 'a.pdf');

    const jobRes = await auth(request(app).post('/api/print-jobs')).send({
      fileId: uploadRes.body.data.file.id,
      printerId: 'mock-hp-laserjet',
    });
    await new Promise((r) => setTimeout(r, 200));

    const res = await auth(request(app).get('/api/analytics/summary'));
    expect(res.status).toBe(200);
    const { analytics } = res.body.data;
    expect(analytics.totalFiles).toBeGreaterThanOrEqual(1);
    expect(analytics.totalPrintJobs).toBeGreaterThanOrEqual(1);
    expect(analytics.filesByType.pdf).toBeGreaterThanOrEqual(1);
    expect(jobRes.status).toBe(201);
  });
});

describe('Audit Log API', () => {
  test('requires authentication', async () => {
    const res = await request(app).get('/api/audit-logs');
    expect(res.status).toBe(401);
  });

  test('is ADMIN-only (OPERATOR is rejected)', async () => {
    const opToken = await operatorToken();
    const res = await auth(request(app).get('/api/audit-logs'), opToken);
    expect(res.status).toBe(403);
  });

  test('returns paginated audit entries, most recent first, without document content', async () => {
    const sessionRes = await request(app).post('/api/sessions').send({});
    await request(app)
      .post(`/api/sessions/${sessionRes.body.data.session.id}/upload`)
      .attach('file', pdfBuffer(), 'secret-report.pdf');

    const res = await auth(request(app).get('/api/audit-logs?limit=5'));
    expect(res.status).toBe(200);
    expect(res.body.data.auditLogs.length).toBeGreaterThan(0);
    expect(res.body.data.total).toBeGreaterThan(0);

    const serialized = JSON.stringify(res.body.data.auditLogs);
    expect(serialized).not.toContain('%PDF-1.4');
  });

  test('records PRINT_JOB_DISPATCHED with servedBy in audit log upon print dispatch', async () => {
    const sessionRes = await request(app).post('/api/sessions').send({});
    const uploadRes = await request(app)
      .post(`/api/sessions/${sessionRes.body.data.session.id}/upload`)
      .attach('file', pdfBuffer(), 'doc.pdf');

    await auth(request(app).post('/api/print-jobs')).send({
      fileId: uploadRes.body.data.file.id,
      printerId: 'demo-smartprint-laserjet',
    });

    await new Promise((r) => setTimeout(r, 200));

    const res = await auth(request(app).get('/api/audit-logs?limit=10'));
    expect(res.status).toBe(200);

    const dispatchLog = res.body.data.auditLogs.find(
      (log) => log.action === 'PRINT_JOB_DISPATCHED'
    );
    expect(dispatchLog).toBeTruthy();
    expect(dispatchLog.metadata?.servedBy).toBe('demo');
  });
});
