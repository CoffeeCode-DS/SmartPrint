import { api } from './api';

export async function getAnalyticsSummary() {
  const res = await api.get('/analytics/summary');
  return res.data.analytics;
}

export async function exportAnalyticsPdf({ benchmark = false } = {}) {
  const res = await api.get('/analytics/export-pdf', {
    params: { benchmark },
    responseType: 'blob',
  });
  return res.data;
}

export async function listAuditLogs({ limit = 20, offset = 0 } = {}) {
  const res = await api.get('/audit-logs', { params: { limit, offset } });
  return res.data; // { auditLogs, total, limit, offset }
}

export async function verifyAuditChain() {
  const res = await api.get('/audit-logs/verify');
  return res.data; // { valid, totalRecords, checkedCount, brokenAtId, reason }
}
