const healthService = require('../services/health.service');
const { sendSuccess } = require('../middleware/errorHandler');

async function getHealth(req, res) {
  const health = await healthService.getSystemHealth();
  sendSuccess(res, health);
}

async function getConsistency(req, res) {
  const report = await healthService.getConsistencyReport();
  sendSuccess(res, report);
}

module.exports = {
  getHealth,
  getConsistency,
};
