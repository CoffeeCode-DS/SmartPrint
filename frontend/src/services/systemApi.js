import { api } from './api';

export async function getSystemHealth() {
  const res = await api.get('/system/health');
  return res.data;
}

export async function getConsistencyReport() {
  const res = await api.get('/system/consistency');
  return res.data;
}
