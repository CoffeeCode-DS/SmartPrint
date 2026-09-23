const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');

describe('Sessions API', () => {
  test('POST /api/sessions creates a session with a secure random ID', async () => {
    const res = await request(app).post('/api/sessions').send({});
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const { session } = res.body.data;
    expect(session.id).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(session.status).toBe('ACTIVE');
    expect(session.oneTime).toBe(true);
  });

  test('two sessions never get the same ID (basic uniqueness sanity check)', async () => {
    const r1 = await request(app).post('/api/sessions').send({});
    const r2 = await request(app).post('/api/sessions').send({});
    expect(r1.body.data.session.id).not.toBe(r2.body.data.session.id);
  });

  test('GET /api/sessions/:id returns the session', async () => {
    const created = await request(app).post('/api/sessions').send({});
    const id = created.body.data.session.id;

    const res = await request(app).get(`/api/sessions/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.session.id).toBe(id);
  });

  test('GET /api/sessions/:id with invalid format returns 400', async () => {
    const res = await request(app).get('/api/sessions/abc');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('GET /api/sessions/:id for a well-formed but non-existent ID returns 404', async () => {
    const res = await request(app).get(`/api/sessions/${'a'.repeat(32)}`);
    expect(res.status).toBe(404);
  });

  test('GET /api/sessions/:id/qr returns a PNG data URL that encodes the upload URL', async () => {
    const created = await request(app).post('/api/sessions').send({});
    const id = created.body.data.session.id;

    const res = await request(app).get(`/api/sessions/${id}/qr`);
    expect(res.status).toBe(200);
    expect(res.body.data.qrDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  test('POST /api/sessions/:id/extend pushes expiry forward and increments extendedCount', async () => {
    const created = await request(app).post('/api/sessions').send({});
    const id = created.body.data.session.id;
    const originalExpiry = created.body.data.session.expiresAt;

    const res = await request(app).post(`/api/sessions/${id}/extend`);
    expect(res.status).toBe(200);
    expect(res.body.data.session.extendedCount).toBe(1);
    expect(new Date(res.body.data.session.expiresAt).getTime()).toBeGreaterThan(
      new Date(originalExpiry).getTime()
    );
  });

  test('extension is capped at SESSION_MAX_EXTENSIONS (set to 2 in test env)', async () => {
    const created = await request(app).post('/api/sessions').send({});
    const id = created.body.data.session.id;

    await request(app).post(`/api/sessions/${id}/extend`); // 1
    await request(app).post(`/api/sessions/${id}/extend`); // 2
    const res = await request(app).post(`/api/sessions/${id}/extend`); // 3 - should fail

    expect(res.status).toBe(400);
  });

  test('an expired session is lazily marked EXPIRED and rejects further use', async () => {
    const created = await request(app).post('/api/sessions').send({});
    const id = created.body.data.session.id;

    // Simulate time passing by directly backdating expires_at in the DB.
    db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(
      new Date(Date.now() - 60_000).toISOString(),
      id
    );

    const res = await request(app).get(`/api/sessions/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.session.status).toBe('EXPIRED');

    // Extending an expired session should fail.
    const extendRes = await request(app).post(`/api/sessions/${id}/extend`);
    expect(extendRes.status).toBe(410);
  });

  test('POST /api/sessions/:id/cancel marks an active session CANCELLED', async () => {
    const created = await request(app).post('/api/sessions').send({});
    const id = created.body.data.session.id;

    const res = await request(app).post(`/api/sessions/${id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.data.session.status).toBe('CANCELLED');
  });
});
