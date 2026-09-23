const request = require('supertest');
const fs = require('fs');
const path = require('path');
const app = require('../src/app');
const db = require('../src/db');
const env = require('../src/config/env');
const filesRepo = require('../src/db/files.repo');
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
    DELETE FROM printer_maintenance;
    DELETE FROM custom_printers;
  `);

  const uploadDir = path.resolve(env.UPLOAD_DIR || './storage/uploads');
  if (fs.existsSync(uploadDir)) {
    for (const f of fs.readdirSync(uploadDir)) {
      try {
        fs.rmSync(path.join(uploadDir, f), { recursive: true, force: true });
      } catch (e) {
        // ignore
      }
    }
  }
});

function auth(req) {
  return req.set('Authorization', `Bearer ${token}`);
}

function pdfBuffer() {
  return Buffer.from('%PDF-1.4\n%%EOF');
}

async function createValidatedFile(nameSuffix = 'rel') {
  const sessionRes = await request(app).post('/api/sessions').send({});
  const session = sessionRes.body.data.session;
  const uploadRes = await request(app)
    .post(`/api/sessions/${session.id}/upload`)
    .attach('file', pdfBuffer(), `${nameSuffix}.pdf`);
  return { session, file: uploadRes.body.data.file };
}

async function waitForStatus(jobId, targetStatuses, timeoutMs = 4000) {
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
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('Reliability & Robustness Features', () => {
  describe('Physical Print Confirmation & File Retention', () => {
    test('physical confirmation YES transitions to COMPLETED and deletes file', async () => {
      // Temporarily disable auto-verify to test manual physical confirmation
      const originalAuto = env.AUTO_VERIFY_PHYSICAL_PRINT;
      env.AUTO_VERIFY_PHYSICAL_PRINT = false;

      try {
        const { file } = await createValidatedFile('confirm-yes');
        const dbFileBefore = filesRepo.findById(file.id);
        expect(fs.existsSync(dbFileBefore.storage_path)).toBe(true);

        const createRes = await auth(request(app).post('/api/print-jobs')).send({
          fileId: file.id,
          printerId: 'mock-hp-laserjet',
        });
        const jobId = createRes.body.data.printJob.id;

        // Wait until it reaches AWAITING_VERIFICATION (after spooler + settlement period)
        const awaitingJob = await waitForStatus(jobId, ['AWAITING_VERIFICATION', 'FAILED']);
        expect(awaitingJob.status).toBe('AWAITING_VERIFICATION');
        expect(awaitingJob.verificationStatus).toBe('UNVERIFIED');

        // Document MUST NOT be deleted yet!
        expect(fs.existsSync(dbFileBefore.storage_path)).toBe(true);

        // Operator confirms YES: Printed successfully
        const verifyRes = await auth(
          request(app).post(`/api/print-jobs/${jobId}/verify`).send({
            verified: true,
            notes: 'Inspected tray, 5 pages output clean',
          })
        );
        expect(verifyRes.status).toBe(200);
        expect(verifyRes.body.data.printJob.status).toBe('COMPLETED');
        expect(verifyRes.body.data.printJob.verificationStatus).toBe('CONFIRMED');

        // Now the document MUST be verified deleted from disk
        expect(fs.existsSync(dbFileBefore.storage_path)).toBe(false);
      } finally {
        env.AUTO_VERIFY_PHYSICAL_PRINT = originalAuto;
      }
    });

    test('physical confirmation NO retains document and marks FAILED for retry', async () => {
      const originalAuto = env.AUTO_VERIFY_PHYSICAL_PRINT;
      env.AUTO_VERIFY_PHYSICAL_PRINT = false;

      try {
        const { file } = await createValidatedFile('confirm-no');
        const dbFileBefore = filesRepo.findById(file.id);
        expect(fs.existsSync(dbFileBefore.storage_path)).toBe(true);

        const createRes = await auth(request(app).post('/api/print-jobs')).send({
          fileId: file.id,
          printerId: 'mock-hp-laserjet',
        });
        const jobId = createRes.body.data.printJob.id;

        await waitForStatus(jobId, ['AWAITING_VERIFICATION']);

        // Operator confirms NO: Print failed physically (e.g. paper jam in tray)
        const verifyRes = await auth(
          request(app).post(`/api/print-jobs/${jobId}/verify`).send({
            verified: false,
            failureCode: 'PAPER_JAM',
            notes: 'Paper caught in exit roller',
          })
        );
        expect(verifyRes.status).toBe(200);
        expect(verifyRes.body.data.printJob.status).toBe('FAILED');
        expect(verifyRes.body.data.printJob.verificationStatus).toBe('FAILED');
        expect(verifyRes.body.data.printJob.failureCode).toBe('PAPER_JAM');

        // Crucial security requirement: file MUST be retained so customer doesn't have to re-upload!
        expect(fs.existsSync(dbFileBefore.storage_path)).toBe(true);
      } finally {
        env.AUTO_VERIFY_PHYSICAL_PRINT = originalAuto;
      }
    });
  });

  describe('Partial Print & Remaining Range Recovery', () => {
    test('retry-remaining calculates compressed remaining page range', async () => {
      const originalAuto = env.AUTO_VERIFY_PHYSICAL_PRINT;
      env.AUTO_VERIFY_PHYSICAL_PRINT = false;

      try {
        const { file } = await createValidatedFile('partial-test');
        const createRes = await auth(request(app).post('/api/print-jobs')).send({
          fileId: file.id,
          printerId: 'mock-hp-laserjet',
          pageRange: '1-10',
        });
        const jobId = createRes.body.data.printJob.id;
        await waitForStatus(jobId, ['AWAITING_VERIFICATION']);

        // Mark failed after 4 pages
        await auth(
          request(app).post(`/api/print-jobs/${jobId}/verify`).send({
            verified: false,
            failureCode: 'OUT_OF_PAPER',
            notes: 'Ran out of paper on page 4',
          })
        );

        // Operator triggers retry-remaining with 4 completed pages
        const retryRes = await auth(
          request(app).post(`/api/print-jobs/${jobId}/retry-remaining`).send({
            completedPages: 4,
          })
        );
        expect([200, 201]).toContain(retryRes.status);
        const retriedJob = retryRes.body.data.printJob;
        expect(retriedJob.id).toBe(jobId);
        expect(retriedJob.pageRange).toBe('5-10');
      } finally {
        env.AUTO_VERIFY_PHYSICAL_PRINT = originalAuto;
      }
    });

    test('switch-printer redirects job to alternate printer on failure', async () => {
      const originalAuto = env.AUTO_VERIFY_PHYSICAL_PRINT;
      env.AUTO_VERIFY_PHYSICAL_PRINT = false;

      try {
        const { file } = await createValidatedFile('switch-printer');
        const createRes = await auth(request(app).post('/api/print-jobs')).send({
          fileId: file.id,
          printerId: 'mock-hp-laserjet',
        });
        const jobId = createRes.body.data.printJob.id;
        await waitForStatus(jobId, ['AWAITING_VERIFICATION']);

        await auth(
          request(app).post(`/api/print-jobs/${jobId}/verify`).send({
            verified: false,
            failureCode: 'LOW_TONER',
          })
        );

        // Switch to canon printer
        const switchRes = await auth(
          request(app).post(`/api/print-jobs/${jobId}/switch-printer`).send({
            newPrinterId: 'mock-canon-lbp2900',
          })
        );
        expect([200, 201]).toContain(switchRes.status);
        expect(switchRes.body.data.printJob.printerId).toBe('mock-canon-lbp2900');
      } finally {
        env.AUTO_VERIFY_PHYSICAL_PRINT = originalAuto;
      }
    });
  });

  describe('Customer File Withdrawal & Session Revocation', () => {
    test('customer can withdraw uploaded file before printing', async () => {
      const { session, file } = await createValidatedFile('withdraw-me');
      const dbFile = filesRepo.findById(file.id);
      expect(fs.existsSync(dbFile.storage_path)).toBe(true);

      // Customer withdraws
      const withdrawRes = await request(app).delete(`/api/sessions/${session.id}/files/${file.id}`);
      expect(withdrawRes.status).toBe(200);
      expect(withdrawRes.body.data.file.status).toBe('WITHDRAWN');

      // File must be securely purged from disk
      expect(fs.existsSync(dbFile.storage_path)).toBe(false);

      // Printing the withdrawn file must fail
      const printRes = await auth(request(app).post('/api/print-jobs')).send({
        fileId: file.id,
        printerId: 'mock-hp-laserjet',
      });
      expect(printRes.status).toBe(400);
    });

    test('ending session revokes session and purges remaining files', async () => {
      const { session, file } = await createValidatedFile('end-session-file');
      const dbFile = filesRepo.findById(file.id);
      expect(fs.existsSync(dbFile.storage_path)).toBe(true);

      const endRes = await request(app).post(`/api/sessions/${session.id}/end`).send({
        reason: 'Customer finished work',
      });
      expect(endRes.status).toBe(200);
      expect(endRes.body.data.session.status).toBe('CANCELLED');

      // Files in ended session must be removed
      expect(fs.existsSync(dbFile.storage_path)).toBe(false);
    });
  });

  describe('System Health & Consistency Monitoring', () => {
    test('GET /api/system/health returns healthy subsystem state', async () => {
      const res = await request(app).get('/api/system/health');
      expect(res.status).toBe(200);
      expect(res.body.data.status).toMatch(/HEALTHY|DEGRADED/);
      expect(res.body.data.database.status).toBe('OK');
      expect(res.body.data.storage.status).toBe('OK');
      expect(res.body.data.printers.devices.length).toBeGreaterThan(0);
      expect(res.body.data.cleanupWorker.active).toBe(true);
    });

    test('GET /api/system/consistency verifies database vs disk consistency', async () => {
      const res = await auth(request(app).get('/api/system/consistency'));
      expect(res.status).toBe(200);
      if (res.body.data.status !== 'CONSISTENT') {
        // eslint-disable-next-line no-console
        console.log('Consistency Report Mismatch Details:', res.body.data);
      }
      expect(res.body.data.status).toBe('CONSISTENT');
      expect(res.body.data.missingFilesCount).toBe(0);
      expect(res.body.data.auditChainIntegrity.valid).toBe(true);
    });
  });

  describe('Tamper-Evident SHA-256 Audit Hash Chain', () => {
    test('audit entries form a valid cryptographic SHA-256 chain', async () => {
      // Trigger a few audit actions
      await request(app).post('/api/sessions').send({});
      await request(app).post('/api/sessions').send({});

      const res = await auth(request(app).get('/api/audit-logs/verify'));
      expect(res.status).toBe(200);
      expect(res.body.data.valid).toBe(true);
      expect(res.body.data.totalRecords).toBeGreaterThan(0);
    });
  });

  describe('Printer Maintenance Mode', () => {
    test('operator can set maintenance mode and query compatible printers', async () => {
      // Set mock-hp-laserjet to MAINTENANCE
      const maintRes = await auth(
        request(app).post('/api/printers/mock-hp-laserjet/status').send({
          status: 'MAINTENANCE',
          notes: 'Routine roller replacement',
        })
      );
      expect(maintRes.status).toBe(200);
      expect(maintRes.body.data.printer.status).toBe('MAINTENANCE');

      // Attempting to print on maintenance printer fails settings validation
      const { file } = await createValidatedFile('maint-print');
      const printRes = await auth(request(app).post('/api/print-jobs')).send({
        fileId: file.id,
        printerId: 'mock-hp-laserjet',
      });
      expect([400, 409]).toContain(printRes.status);
      expect(printRes.body.error.message).toMatch(/maintenance/i);

      // Query compatible alternatives for A4
      const compatRes = await auth(
        request(app).get('/api/printers/compatible?paperSize=A4')
      );
      expect(compatRes.status).toBe(200);
      const alternatives = compatRes.body.data.compatiblePrinters;
      expect(alternatives.some((p) => p.id === 'mock-canon-lbp2900')).toBe(true);
    });
  });
});
