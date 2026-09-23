const fs = require('fs');
const path = require('path');
const os = require('os');
const { PDFDocument } = require('pdf-lib');
const { parsePageRange, slicePdfIfNeeded } = require('../src/utils/pdfSlicer');

describe('PDF Slicer Utility (pdfSlicer.js)', () => {
  let samplePdfPath;

  beforeAll(async () => {
    // Generate a multi-page test PDF (5 pages)
    const doc = await PDFDocument.create();
    for (let i = 1; i <= 5; i++) {
      const page = doc.addPage([400, 400]);
      page.drawText(`Page ${i}`, { x: 50, y: 350 });
    }
    const pdfBytes = await doc.save();
    samplePdfPath = path.join(os.tmpdir(), `test-slicer-${Date.now()}.pdf`);
    fs.writeFileSync(samplePdfPath, pdfBytes);
  });

  afterAll(() => {
    try {
      if (fs.existsSync(samplePdfPath)) fs.unlinkSync(samplePdfPath);
    } catch {}
  });

  describe('parsePageRange', () => {
    test('returns all indices when range is "all" or empty', () => {
      expect(parsePageRange('all', 5)).toEqual([0, 1, 2, 3, 4]);
      expect(parsePageRange('', 5)).toEqual([0, 1, 2, 3, 4]);
      expect(parsePageRange(null, 3)).toEqual([0, 1, 2]);
    });

    test('parses single page string', () => {
      expect(parsePageRange('3', 5)).toEqual([2]);
      expect(parsePageRange('1', 5)).toEqual([0]);
    });

    test('parses contiguous page range', () => {
      expect(parsePageRange('2-4', 5)).toEqual([1, 2, 3]);
      expect(parsePageRange('1-2', 5)).toEqual([0, 1]);
    });

    test('parses inverted range gracefully (e.g. 4-2 -> 2-4)', () => {
      expect(parsePageRange('4-2', 5)).toEqual([1, 2, 3]);
    });

    test('parses mixed ranges and discrete pages', () => {
      expect(parsePageRange('1,3-5', 5)).toEqual([0, 2, 3, 4]);
      expect(parsePageRange('1, 3, 5', 5)).toEqual([0, 2, 4]);
    });

    test('ignores out-of-bounds page numbers and clamps properly', () => {
      expect(parsePageRange('1, 99', 5)).toEqual([0]);
      expect(parsePageRange('3-10', 5)).toEqual([2, 3, 4]);
    });
  });

  describe('slicePdfIfNeeded', () => {
    test('returns original path when range covers all pages or is "all"', async () => {
      const resAll = await slicePdfIfNeeded(samplePdfPath, 'all');
      expect(resAll.isTemporary).toBe(false);
      expect(resAll.filePath).toBe(samplePdfPath);

      const resFull = await slicePdfIfNeeded(samplePdfPath, '1-5');
      expect(resFull.isTemporary).toBe(false);
      expect(resFull.filePath).toBe(samplePdfPath);
    });

    test('returns original path when target file is not a PDF', async () => {
      const txtPath = path.join(os.tmpdir(), `test-sample-${Date.now()}.txt`);
      fs.writeFileSync(txtPath, 'plain text content');
      try {
        const res = await slicePdfIfNeeded(txtPath, '1-2');
        expect(res.isTemporary).toBe(false);
        expect(res.filePath).toBe(txtPath);
      } finally {
        fs.unlinkSync(txtPath);
      }
    });

    test('creates a sliced PDF when a subset of pages is requested', async () => {
      const res = await slicePdfIfNeeded(samplePdfPath, '2-3');
      expect(res.isTemporary).toBe(true);
      expect(res.pageCount).toBe(2);
      expect(fs.existsSync(res.filePath)).toBe(true);

      const slicedBytes = fs.readFileSync(res.filePath);
      const slicedDoc = await PDFDocument.load(slicedBytes);
      expect(slicedDoc.getPageCount()).toBe(2);

      // Clean up temporary file
      fs.unlinkSync(res.filePath);
    });
  });
});
