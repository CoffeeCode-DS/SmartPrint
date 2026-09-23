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
    DELETE FROM custom_printers;
  `);
});

function auth(req) {
  return req.set('Authorization', `Bearer ${token}`);
}

function pdfBuffer() {
  return Buffer.from('%PDF-1.4\n%%EOF');
}

async function createValidatedFile() {
  const sessionRes = await request(app).post('/api/sessions').send({});
  const uploadRes = await request(app)
    .post(`/api/sessions/${sessionRes.body.data.session.id}/upload`)
    .attach('file', pdfBuffer(), 'a.pdf');
  return uploadRes.body.data.file;
}

describe('Printer registry (GET /api/printers)', () => {
  test('requires authentication', async () => {
    const res = await request(app).get('/api/printers');
    expect(res.status).toBe(401);
  });

  test('lists the mock fleet with distinct, real capabilities', async () => {
    const res = await auth(request(app).get('/api/printers'));
    expect(res.status).toBe(200);
    const printers = res.body.data.printers;
    expect(printers).toHaveLength(4);

    const demo = printers.find((p) => p.id === 'demo-smartprint-laserjet');
    const hp = printers.find((p) => p.id === 'mock-hp-laserjet');
    const canon = printers.find((p) => p.id === 'mock-canon-lbp2900');
    const epson = printers.find((p) => p.id === 'mock-epson-ecotank');

    expect(demo.status).toBe('READY');
    expect(demo.capabilities.color).toBe(true);
    expect(demo.capabilities.duplex).toBe(true);
    expect(hp.status).toBe('READY');
    expect(hp.capabilities.duplex).toBe(true);
    expect(canon.status).toBe('READY');
    expect(canon.capabilities.duplex).toBe(false);
    expect(canon.capabilities.color).toBe(false);
    expect(epson.status).toBe('OFFLINE');
    expect(epson.capabilities.color).toBe(true);
  });
});

describe('Print job creation with printer + settings', () => {
  test('printerId is required', async () => {
    const file = await createValidatedFile();
    const res = await auth(request(app).post('/api/print-jobs')).send({ fileId: file.id });
    expect(res.status).toBe(400);
  });

  test('rejects an unknown printer', async () => {
    const file = await createValidatedFile();
    const res = await auth(request(app).post('/api/print-jobs')).send({
      fileId: file.id,
      printerId: 'does-not-exist',
    });
    expect(res.status).toBe(404);
  });

  test('rejects printing to an OFFLINE printer', async () => {
    const file = await createValidatedFile();
    const res = await auth(request(app).post('/api/print-jobs')).send({
      fileId: file.id,
      printerId: 'mock-epson-ecotank',
    });
    expect(res.status).toBe(409);
  });

  test('rejects duplex on a printer that does not support it', async () => {
    const file = await createValidatedFile();
    const res = await auth(request(app).post('/api/print-jobs')).send({
      fileId: file.id,
      printerId: 'mock-canon-lbp2900',
      duplex: true,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/double-sided/i);
  });

  test('rejects color mode on a mono-only printer', async () => {
    const file = await createValidatedFile();
    const res = await auth(request(app).post('/api/print-jobs')).send({
      fileId: file.id,
      printerId: 'mock-canon-lbp2900',
      colorMode: 'color',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/color/i);
  });

  test('rejects an unsupported paper size for the selected printer', async () => {
    const file = await createValidatedFile();
    const res = await auth(request(app).post('/api/print-jobs')).send({
      fileId: file.id,
      printerId: 'mock-canon-lbp2900',
      paperSize: 'A3',
    });
    expect(res.status).toBe(400);
  });

  test('rejects copies outside the printer-supported range', async () => {
    const file = await createValidatedFile();
    const res = await auth(request(app).post('/api/print-jobs')).send({
      fileId: file.id,
      printerId: 'mock-hp-laserjet',
      copies: 0,
    });
    expect(res.status).toBe(400);
  });

  test('rejects a malformed custom page range', async () => {
    const file = await createValidatedFile();
    const res = await auth(request(app).post('/api/print-jobs')).send({
      fileId: file.id,
      printerId: 'mock-hp-laserjet',
      pageRange: 'not-a-range',
    });
    expect(res.status).toBe(400);
  });

  test('accepts valid duplex settings on a duplex-capable printer and stores them exactly', async () => {
    const file = await createValidatedFile();
    const res = await auth(request(app).post('/api/print-jobs')).send({
      fileId: file.id,
      printerId: 'mock-hp-laserjet',
      copies: 3,
      pageRange: '1-2,4',
      paperSize: 'Letter',
      orientation: 'landscape',
      colorMode: 'bw',
      duplex: true,
    });

    expect(res.status).toBe(201);
    const job = res.body.data.printJob;
    expect(job.printerId).toBe('mock-hp-laserjet');
    expect(job.printerName).toBe('HP LaserJet Pro M404');
    expect(job.copies).toBe(3);
    expect(job.pageRange).toBe('1-2,4');
    expect(job.paperSize).toBe('Letter');
    expect(job.orientation).toBe('landscape');
    expect(job.duplex).toBe(true);
  });

  test('offline takes precedence even over a capability the printer would otherwise support', async () => {
    const file = await createValidatedFile();
    const res = await auth(request(app).post('/api/print-jobs')).send({
      fileId: file.id,
      printerId: 'mock-epson-ecotank', // supports color, but is offline
      colorMode: 'color',
      force: true,
    });
    expect(res.status).toBe(409);
  });

  test('stores sides, pagesPerSheet, and scale accurately', async () => {
    const file = await createValidatedFile();
    const res = await auth(request(app).post('/api/print-jobs')).send({
      fileId: file.id,
      printerId: 'mock-hp-laserjet',
      sides: 'duplex-long-edge',
      pagesPerSheet: 2,
      scale: 'shrink',
    });

    expect(res.status).toBe(201);
    const job = res.body.data.printJob;
    expect(job.sides).toBe('duplex-long-edge');
    expect(job.pagesPerSheet).toBe(2);
    expect(job.scale).toBe('shrink');
  });
});

describe('Printer management actions', () => {
  test('POST /api/printers/refresh returns printer list', async () => {
    const res = await auth(request(app).post('/api/printers/refresh')).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.printers.length).toBeGreaterThan(0);
  });

  test('POST /api/printers/:id/test-page triggers test page', async () => {
    const res = await auth(request(app).post('/api/printers/mock-hp-laserjet/test-page')).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.success).toBe(true);
    expect(res.body.data.printerId).toBe('mock-hp-laserjet');
  });

  test('POST /api/printers/connect registers a new network printer', async () => {
    const res = await auth(request(app).post('/api/printers/connect')).send({
      type: 'network',
      ip: '192.168.1.150',
      port: 9100,
      name: 'Office LaserJet',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.printer.name).toBe('Office LaserJet');
  });
});

describe('CUPS / Linux Printer Driver argument assembly', () => {
  const systemPrinters = require('../src/printers/systemPrinters');

  test('buildLpArgs includes native CUPS -o page-ranges when custom range is passed', () => {
    const args = systemPrinters.buildLpArgs({
      printerId: 'HP_LaserJet',
      filePath: '/storage/sample.pdf',
      copies: 2,
      pageRange: '1-3,5',
      paperSize: 'A4',
      orientation: 'portrait',
      colorMode: 'bw',
      duplex: true,
      sides: 'duplex-long-edge',
    });

    expect(args).toContain('-d');
    expect(args).toContain('HP_LaserJet');
    expect(args).toContain('-n');
    expect(args).toContain('2');
    expect(args).toContain('-o');
    expect(args).toContain('page-ranges=1-3,5');
    expect(args).toContain('sides=two-sided-long-edge');
    expect(args[args.length - 1]).toBe('/storage/sample.pdf');
  });

  test('buildLpArgs omits page-ranges when pageRange is all', () => {
    const args = systemPrinters.buildLpArgs({
      printerId: 'HP_LaserJet',
      filePath: '/storage/sample.pdf',
      copies: 1,
      pageRange: 'all',
    });

    expect(args.some((a) => a.startsWith('page-ranges='))).toBe(false);
  });
});

