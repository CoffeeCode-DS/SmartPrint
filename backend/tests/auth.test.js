const request = require('supertest');
const app = require('../src/app');
const env = require('../src/config/env');
const { loginAsAdmin } = require('./helpers/auth');

let adminToken;

beforeAll(async () => {
  adminToken = await loginAsAdmin(app);
});

describe('Auth API', () => {
  test('seeded admin can log in and receives a token + user info', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: env.ADMIN_SEED_USERNAME, password: env.ADMIN_SEED_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.user.role).toBe('ADMIN');
    expect(res.body.data.user.username).toBe(env.ADMIN_SEED_USERNAME);
  });

  test('wrong password is rejected with 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: env.ADMIN_SEED_USERNAME, password: 'totally-wrong' });
    expect(res.status).toBe(401);
  });

  test('nonexistent username is rejected with 401 (not a distinguishable error)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'nobody-here', password: 'whatever123' });
    expect(res.status).toBe(401);
  });

  test('GET /api/auth/me requires a valid token', async () => {
    const noAuth = await request(app).get('/api/auth/me');
    expect(noAuth.status).toBe(401);

    const badToken = await request(app).get('/api/auth/me').set('Authorization', 'Bearer garbage');
    expect(badToken.status).toBe(401);

    const good = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${adminToken}`);
    expect(good.status).toBe(200);
    expect(good.body.data.user.role).toBe('ADMIN');
  });

  test('only an ADMIN can create new staff accounts', async () => {
    const unauth = await request(app)
      .post('/api/auth/users')
      .send({ username: 'operator1', password: 'operatorpass123', role: 'OPERATOR' });
    expect(unauth.status).toBe(401);

    const created = await request(app)
      .post('/api/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'operator1', password: 'operatorpass123', role: 'OPERATOR' });
    expect(created.status).toBe(201);
    expect(created.body.data.user.role).toBe('OPERATOR');
    expect(created.body.data.user.username).toBe('operator1');
  });

  test('an OPERATOR cannot create other accounts (ADMIN-only action)', async () => {
    const opLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'operator1', password: 'operatorpass123' });
    const operatorToken = opLogin.body.data.token;

    const res = await request(app)
      .post('/api/auth/users')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ username: 'operator2', password: 'somepassword123', role: 'OPERATOR' });
    expect(res.status).toBe(403);
  });

  test('an OPERATOR CAN access the print queue (both roles are queue-authorized)', async () => {
    const opLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'operator1', password: 'operatorpass123' });
    const operatorToken = opLogin.body.data.token;

    const res = await request(app)
      .get('/api/print-jobs')
      .set('Authorization', `Bearer ${operatorToken}`);
    expect(res.status).toBe(200);
  });

  test('duplicate usernames are rejected', async () => {
    const res = await request(app)
      .post('/api/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'operator1', password: 'anotherpassword123', role: 'OPERATOR' });
    expect(res.status).toBe(409);
  });

  test('weak passwords are rejected', async () => {
    const res = await request(app)
      .post('/api/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'someoneelse', password: 'short', role: 'OPERATOR' });
    expect(res.status).toBe(400);
  });

  test('invalid roles are rejected', async () => {
    const res = await request(app)
      .post('/api/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'someoneelse2', password: 'longenoughpassword', role: 'SUPERUSER' });
    expect(res.status).toBe(400);
  });

  test('POST /api/auth/register rejects registration when inviteCode is missing or wrong', async () => {
    const noCode = await request(app)
      .post('/api/auth/register')
      .send({ username: 'newbie_op', password: 'securepassword123' });
    expect(noCode.status).toBe(403);
    expect(noCode.body.error.message).toMatch(/invite code/i);

    const badCode = await request(app)
      .post('/api/auth/register')
      .send({ username: 'newbie_op', password: 'securepassword123', inviteCode: 'wrong-code-xyz' });
    expect(badCode.status).toBe(403);
  });

  test('POST /api/auth/register succeeds with valid inviteCode and creates OPERATOR', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'staff_operator',
        password: 'securepassword123',
        inviteCode: env.OPERATOR_SIGNUP_CODE,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.user.role).toBe('OPERATOR');
    expect(res.body.data.user.username).toBe('staff_operator');

    // Confirm that newly registered operator can login
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'staff_operator', password: 'securepassword123' });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.data.user.role).toBe('OPERATOR');
  });
});

