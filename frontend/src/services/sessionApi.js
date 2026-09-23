import { api } from './api';

export async function createSession(options = { oneTime: false }) {
  const res = await api.post('/sessions', options);
  return res.data.session;
}

export async function getSession(sessionId) {
  const res = await api.get(`/sessions/${sessionId}`);
  return res.data.session;
}

export async function getSessionQr(sessionId) {
  const res = await api.get(`/sessions/${sessionId}/qr`);
  return res.data; // { qrDataUrl, session }
}

export async function extendSession(sessionId) {
  const res = await api.post(`/sessions/${sessionId}/extend`);
  return res.data.session;
}

export async function cancelSession(sessionId) {
  const res = await api.post(`/sessions/${sessionId}/cancel`);
  return res.data.session;
}

export async function endSession(sessionId, reason = 'User ended session') {
  const res = await api.post(`/sessions/${sessionId}/end`, { reason });
  return res.data.session;
}
