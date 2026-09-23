const authService = require('../services/auth.service');
const { sendSuccess } = require('../middleware/errorHandler');

async function login(req, res) {
  const { username, password } = req.body || {};
  const { token, user } = authService.login({ username, password });
  sendSuccess(res, { token, user });
}

async function register(req, res) {
  const { username, password, inviteCode } = req.body || {};
  const { token, user } = authService.register({ username, password, inviteCode });
  sendSuccess(res, { token, user }, 201);
}

async function me(req, res) {
  sendSuccess(res, { user: req.user });
}

async function createUser(req, res) {
  const { username, password, role } = req.body || {};
  const user = authService.createUser({ username, password, role, createdBy: req.user.id });
  sendSuccess(res, { user }, 201);
}

async function listUsers(req, res) {
  sendSuccess(res, { users: authService.listUsers() });
}

module.exports = { login, register, me, createUser, listUsers };
