const request = require('supertest');
const env = require('../../src/config/env');

async function loginAsAdmin(app) {
  const res = await request(app).post('/api/auth/login').send({
    username: env.ADMIN_SEED_USERNAME,
    password: env.ADMIN_SEED_PASSWORD,
  });
  if (res.status !== 200) {
    throw new Error(`Test admin login failed: ${JSON.stringify(res.body)}`);
  }
  return res.body.data.token;
}

module.exports = { loginAsAdmin };
