const fs = require('fs');
const path = require('path');
const os = require('os');
const { PDFDocument } = require('pdf-lib');

/**
 * Parses a page range string like "1-3,5,8" or "2" into an array of 0-based page indices.
 * @param {string} rangeStr - The human page range (1-indexed)
 * @param {number} totalPages - Total pages available in the document
 * @returns {number[]} 0-based unique sorted page indices
 */
function parsePageRange(rangeStr, totalPages) {
  if (!rangeStr || rangeStr.toLowerCase() === 'all') {
    return Array.from({ length: totalPages }, (_, i) => i);
  }

  const indices = new Set();
  const parts = rangeStr.split(',').map((p) => p.trim()).filter(Boolean);

  for (const part of parts) {
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-').map((s) => s.trim());
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);

      if (Number.isInteger(start) && Number.isInteger(end)) {
        const min = Math.max(1, Math.min(start, end));
        const max = Math.min(totalPages, Math.max(start, end));
        for (let p = min; p <= max; p++) {
          indices.add(p - 1);
        }
      }
    } else {
      const pageNum = parseInt(part, 10);
      if (Number.isInteger(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
        indices.add(pageNum - 1);
      }
    }
  }

  const result = Array.from(indices).sort((a, b) => a - b);
  return result.length > 0 ? result : Array.from({ length: totalPages }, (_, i) => i);
}

/**
 * Slices a PDF file to contain only the requested page range.
 * If file is not a PDF or range covers all pages, returns original file path.
 *
 * @param {string} inputPath - Absolute path to original file
 * @param {string} pageRange - Page range string, e.g. "1-3,5" or "all"
 * @returns {Promise<{ filePath: string, isTemporary: boolean, pageCount: number }>}
 */
async function slicePdfIfNeeded(inputPath, pageRange) {
  if (!pageRange || pageRange.toLowerCase() === 'all') {
    return { filePath: inputPath, isTemporary: false, pageCount: 0 };
  }

  // Check if file is actually a PDF
  const ext = path.extname(inputPath).toLowerCase();
  if (ext !== '.pdf') {
    return { filePath: inputPath, isTemporary: false, pageCount: 1 };
  }

  try {
    const existingPdfBytes = fs.readFileSync(inputPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes, { ignoreEncryption: true });
    const totalPages = pdfDoc.getPageCount();

    const targetIndices = parsePageRange(pageRange, totalPages);
    if (targetIndices.length === totalPages) {
      return { filePath: inputPath, isTemporary: false, pageCount: totalPages };
    }

    const subDoc = await PDFDocument.create();
    const copiedPages = await subDoc.copyPages(pdfDoc, targetIndices);
    copiedPages.forEach((page) => subDoc.addPage(page));

    const subPdfBytes = await subDoc.save();
    const tempFileName = `print-sliced-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`;
    const tempPath = path.join(os.tmpdir(), tempFileName);

    fs.writeFileSync(tempPath, subPdfBytes);
    return { filePath: tempPath, isTemporary: true, pageCount: targetIndices.length };
  } catch (err) {
    // If slicing fails, fallback gracefully to original file
    // eslint-disable-next-line no-console
    console.warn(`[pdfSlicer] Slicing error: ${err.message}. Falling back to original document.`);
    return { filePath: inputPath, isTemporary: false, pageCount: 0 };
  }
}

module.exports = {
  parsePageRange,
  slicePdfIfNeeded,
};
