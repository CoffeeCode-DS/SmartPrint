const logsRepo = require('../db/logs.repo');
const { sendSuccess } = require('../middleware/errorHandler');

async function listAuditLogs(req, res) {
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

  const rows = logsRepo.listAuditLogs({ limit, offset });
  const total = logsRepo.countAuditLogs();

  sendSuccess(res, {
    auditLogs: rows.map((r) => ({
      id: r.id,
      actor: r.actor,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      metadata: r.metadata ? JSON.parse(r.metadata) : null,
      prevHash: r.prev_hash,
      logHash: r.log_hash,
      createdAt: r.created_at,
    })),
    total,
    limit,
    offset,
  });
}

async function verifyAuditChain(req, res) {
  const result = logsRepo.verifyAuditChain();
  sendSuccess(res, result);
}

module.exports = { listAuditLogs, verifyAuditChain };
