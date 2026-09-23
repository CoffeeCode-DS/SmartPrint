const fs = require('fs');
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');
const cleanupService = require('../src/services/cleanup.service');
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

describe('Cleanup service', () => {
  test('sweepExpiredSessions proactively marks past-TTL ACTIVE sessions as EXPIRED', async () => {
    const res = await request(app).post('/api/sessions').send({});
    const id = res.body.data.session.id;

    db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(
      new Date(Date.now() - 60_000).toISOString(),
      id
    );

    const count = cleanupService.sweepExpiredSessions();
    expect(count).toBeGreaterThanOrEqual(1);

    const row = db.prepare('SELECT status FROM sessions WHERE id = ?').get(id);
    expect(row.status).toBe('EXPIRED');
  });

  test('sweepOrphanedFiles deletes files past the retention window from disk and marks them DELETED', async () => {
    const sessionRes = await request(app).post('/api/sessions').send({});
    const uploadRes = await request(app)
      .post(`/api/sessions/${sessionRes.body.data.session.id}/upload`)
      .attach('file', pdfBuffer(), 'old.pdf');
    const fileId = uploadRes.body.data.file.id;
    const fileRow = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);

    expect(fs.existsSync(fileRow.storage_path)).toBe(true);

    // Backdate the upload time past the retention window so it's eligible.
    db.prepare('UPDATE files SET uploaded_at = ? WHERE id = ?').run(
      new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      fileId
    );

    const deletedCount = cleanupService.sweepOrphanedFiles();
    expect(deletedCount).toBeGreaterThanOrEqual(1);

    const updated = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
    expect(updated.status).toBe('DELETED');
    expect(fs.existsSync(fileRow.storage_path)).toBe(false);
  });

  test('sweepOrphanedFiles never deletes a file with an active print job, even past retention', async () => {
    const sessionRes = await request(app).post('/api/sessions').send({});
    const uploadRes = await request(app)
      .post(`/api/sessions/${sessionRes.body.data.session.id}/upload`)
      .attach('file', pdfBuffer(), 'protected.pdf');
    const fileId = uploadRes.body.data.file.id;

    // Manually insert a PENDING print job for this file (bypassing the
    // service's own auto-processing so it stays PENDING for the test).
    db.prepare(
      `INSERT INTO print_jobs (id, file_id, session_id, status, attempts, max_attempts, created_at, updated_at)
       VALUES ('protectedjob1234', ?, ?, 'PENDING', 0, 3, ?, ?)`
    ).run(fileId, sessionRes.body.data.session.id, new Date().toISOString(), new Date().toISOString());

    db.prepare('UPDATE files SET uploaded_at = ? WHERE id = ?').run(
      new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      fileId
    );

    cleanupService.sweepOrphanedFiles();

    const stillThere = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
    expect(stillThere.status).not.toBe('DELETED');
  });

  test('recoverStaleJobs marks long-stuck PROCESSING/PRINTING jobs as FAILED (simulated crash)', async () => {
    const sessionRes = await request(app).post('/api/sessions').send({});
    const uploadRes = await request(app)
      .post(`/api/sessions/${sessionRes.body.data.session.id}/upload`)
      .attach('file', pdfBuffer(), 'stuck.pdf');
    const fileId = uploadRes.body.data.file.id;

    db.prepare(
      `INSERT INTO print_jobs (id, file_id, session_id, status, attempts, max_attempts, created_at, updated_at)
       VALUES ('stuckjob12345678', ?, ?, 'PRINTING', 0, 3, ?, ?)`
    ).run(
      fileId,
      sessionRes.body.data.session.id,
      new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      new Date(Date.now() - 60 * 60 * 1000).toISOString() // updated_at also old -> stale
    );

    const recoveredCount = cleanupService.recoverStaleJobs();
    expect(recoveredCount).toBeGreaterThanOrEqual(1);

    const job = await auth(request(app).get('/api/print-jobs/stuckjob12345678'));
    expect(job.body.data.printJob.status).toBe('FAILED');
    expect(job.body.data.printJob.errorMessage).toMatch(/restart/i);
  });

  test('runCleanupSweep runs all three sweeps without throwing on an empty DB', () => {
    expect(() => cleanupService.runCleanupSweep()).not.toThrow();
  });
});
