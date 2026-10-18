import { api } from './api';

export async function login(emailOrUsername, password) {
  const payload = typeof emailOrUsername === 'object' && emailOrUsername !== null
    ? emailOrUsername
    : { email: emailOrUsername, username: emailOrUsername, password };
  const res = await api.post('/auth/login', payload);
  return res.data; // { token, user }
}

export async function register(usernameOrObj, maybeEmail, maybePassword, maybeInviteCode) {
  let payload;
  if (typeof usernameOrObj === 'object' && usernameOrObj !== null) {
    payload = { inviteCode: 'smartprint-operator-key', ...usernameOrObj };
  } else if (typeof maybeInviteCode !== 'undefined') {
    payload = { username: usernameOrObj, email: maybeEmail, password: maybePassword, inviteCode: maybeInviteCode };
  } else {
    payload = { username: usernameOrObj, email: maybeEmail, password: maybePassword, inviteCode: 'smartprint-operator-key' };
  }
  const res = await api.post('/auth/register', payload);
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

export async function createStaffUser({ username, email, password, role }) {
  const res = await api.post('/auth/users', { username, email, password, role });
  return res.data.user;
}
