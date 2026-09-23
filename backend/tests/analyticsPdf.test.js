const { generateAnalyticsPdf } = require('../src/services/analyticsPdf.service');
const { PDFDocument } = require('pdf-lib');
const db = require('../src/db');

describe('Analytics PDF Export Service (analyticsPdf.service.js)', () => {
  beforeEach(() => {
    db.exec(`
      DELETE FROM print_jobs;
      DELETE FROM files;
      DELETE FROM sessions;
    `);
  });

  test('generateAnalyticsPdf with benchmark: true returns a valid PDF buffer', async () => {
    const pdfBuffer = await generateAnalyticsPdf({ benchmark: true });

    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    expect(pdfBuffer.length).toBeGreaterThan(1000);

    // Assert standard PDF header %PDF-
    const header = pdfBuffer.subarray(0, 5).toString('ascii');
    expect(header).toBe('%PDF-');

    // Parse with pdf-lib to assert structure validity
    const doc = await PDFDocument.load(pdfBuffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  test('generateAnalyticsPdf with live database summary returns a valid PDF buffer', async () => {
    const pdfBuffer = await generateAnalyticsPdf({ benchmark: false });

    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    expect(pdfBuffer.length).toBeGreaterThan(1000);

    const header = pdfBuffer.subarray(0, 5).toString('ascii');
    expect(header).toBe('%PDF-');

    const doc = await PDFDocument.load(pdfBuffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});
