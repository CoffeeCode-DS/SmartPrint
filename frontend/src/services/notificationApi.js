import { api } from './api';

export async function listNotifications(sessionId) {
  const res = await api.get('/notifications', { params: { sessionId } });
  return res.data.notifications;
}
