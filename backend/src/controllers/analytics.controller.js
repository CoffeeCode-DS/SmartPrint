const analyticsService = require('../services/analytics.service');
const { generateAnalyticsPdf } = require('../services/analyticsPdf.service');
const { sendSuccess } = require('../middleware/errorHandler');

async function getSummary(req, res) {
  sendSuccess(res, { analytics: analyticsService.getSummary() });
}

async function exportPdf(req, res) {
  const isBenchmark = req.query.benchmark === 'true';
  const pdfBytes = await generateAnalyticsPdf({ benchmark: isBenchmark });
  const filename = `smartprint_analytics_${new Date().toISOString().slice(0, 10)}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', pdfBytes.length);
  res.end(Buffer.from(pdfBytes));
}

module.exports = { getSummary, exportPdf };
