import { api } from './api';

export async function login(username, password) {
  const res = await api.post('/auth/login', { username, password });
  return res.data; // { token, user }
}

export async function register(username, password, inviteCode) {
  const res = await api.post('/auth/register', { username, password, inviteCode });
  return res.data; // { token, user }
}

export async function fetchMe() {
  const res = await api.get('/auth/me');
  return res.data.user;
}

export async function listStaffUsers() {
  const res = await api.get('/auth/users');
  return res.data.users;
}

export async function createStaffUser({ username, password, role }) {
  const res = await api.post('/auth/users', { username, password, role });
  return res.data.user;
}
