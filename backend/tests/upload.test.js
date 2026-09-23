const request = require('supertest');
const fs = require('fs');
const path = require('path');
const app = require('../src/app');
const db = require('../src/db');
const { loginAsAdmin } = require('./helpers/auth');

let token;

beforeAll(async () => {
  token = await loginAsAdmin(app);
});

beforeEach(() => {
  // Isolate each test: the in-memory DB is shared across all tests in this
  // file, so without this, content-hash-based tests (duplicate detection)
  // could collide with data left over from a previous test.
  db.exec(`
    DELETE FROM files;
    DELETE FROM sessions;
    DELETE FROM activity_logs;
    DELETE FROM audit_logs;
  `);
});

function makeMinimalPdfBuffer() {
  return Buffer.from('%PDF-1.4\n%%EOF');
}

function makeMinimalPngBuffer() {
  // Valid PNG signature followed by arbitrary bytes - enough for our signature check.
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
}

async function createSession() {
  const res = await request(app).post('/api/sessions').send({});
  return res.body.data.session;
}

describe('File Upload API', () => {
  test('accepts a valid PDF and returns metadata', async () => {
    const session = await createSession();
    const res = await request(app)
      .post(`/api/sessions/${session.id}/upload`)
      .attach('file', makeMinimalPdfBuffer(), 'document.pdf');

    expect(res.status).toBe(201);
    expect(res.body.data.file.mimeType).toBe('application/pdf');
    expect(res.body.data.isDuplicate).toBe(false);
  });

  test('accepts a valid PNG image', async () => {
    const session = await createSession();
    const res = await request(app)
      .post(`/api/sessions/${session.id}/upload`)
      .attach('file', makeMinimalPngBuffer(), 'photo.png');

    expect(res.status).toBe(201);
    expect(res.body.data.file.mimeType).toBe('image/png');
  });

  test('accepts a valid JPEG and WebP image', async () => {
    const session1 = await createSession();
    const jpegBuf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const resJpeg = await request(app)
      .post(`/api/sessions/${session1.id}/upload`)
      .attach('file', jpegBuf, 'photo.jpg');
    expect(resJpeg.status).toBe(201);
    expect(resJpeg.body.data.file.mimeType).toBe('image/jpeg');

    const session2 = await createSession();
    const webpBuf = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.alloc(4),
      Buffer.from('WEBPVP8 '),
      Buffer.alloc(8),
    ]);
    const resWebp = await request(app)
      .post(`/api/sessions/${session2.id}/upload`)
      .attach('file', webpBuf, 'image.webp');
    expect(resWebp.status).toBe(201);
    expect(resWebp.body.data.file.mimeType).toBe('image/webp');
  });

  test('rejects a file whose content does not match a supported signature (fake PDF)', async () => {
    const session = await createSession();
    const res = await request(app)
      .post(`/api/sessions/${session.id}/upload`)
      .attach('file', Buffer.from('just plain text, not a real pdf'), 'document.pdf');

    expect(res.status).toBe(415);
    expect(res.body.success).toBe(false);
  });

  test('rejects a file even if it claims a fake PDF extension with a .png-like name trick', async () => {
    const session = await createSession();
    const res = await request(app)
      .post(`/api/sessions/${session.id}/upload`)
      .attach('file', Buffer.from('malicious payload, not an image'), 'totally-safe.png');

    expect(res.status).toBe(415);
  });

  test('a one-time session becomes USED after a successful upload and rejects further uploads', async () => {
    const session = await createSession();
    await request(app)
      .post(`/api/sessions/${session.id}/upload`)
      .attach('file', makeMinimalPdfBuffer(), 'a.pdf');

    const sessionCheck = await request(app).get(`/api/sessions/${session.id}`);
    expect(sessionCheck.body.data.session.status).toBe('USED');

    const secondUpload = await request(app)
      .post(`/api/sessions/${session.id}/upload`)
      .attach('file', makeMinimalPdfBuffer(), 'b.pdf');
    expect(secondUpload.status).toBe(410);
  });

  test('a rejected upload does NOT consume the one-time session', async () => {
    const session = await createSession();
    await request(app)
      .post(`/api/sessions/${session.id}/upload`)
      .attach('file', Buffer.from('not a real file type'), 'fake.pdf');

    const sessionCheck = await request(app).get(`/api/sessions/${session.id}`);
    expect(sessionCheck.body.data.session.status).toBe('ACTIVE');
  });

  test('uploading the same file content to two different sessions is flagged as a duplicate', async () => {
    const session1 = await createSession();
    const session2 = await createSession();
    const buf = makeMinimalPdfBuffer();

    const first = await request(app)
      .post(`/api/sessions/${session1.id}/upload`)
      .attach('file', buf, 'a.pdf');
    expect(first.body.data.isDuplicate).toBe(false);

    const second = await request(app)
      .post(`/api/sessions/${session2.id}/upload`)
      .attach('file', buf, 'a.pdf');
    expect(second.body.data.isDuplicate).toBe(true);
    expect(second.body.data.duplicateOf.id).toBe(first.body.data.file.id);
  });

  test('rejects upload to a non-existent session', async () => {
    const res = await request(app)
      .post(`/api/sessions/${'a'.repeat(32)}/upload`)
      .attach('file', makeMinimalPdfBuffer(), 'a.pdf');
    expect(res.status).toBe(404);
  });

  test('rejects a file larger than MAX_UPLOAD_SIZE_MB', async () => {
    const session = await createSession();
    // Test env sets MAX_UPLOAD_SIZE_MB=25; build a file just over that limit.
    const oversized = Buffer.concat([
      Buffer.from('%PDF-1.4\n'),
      Buffer.alloc(26 * 1024 * 1024, 0x41), // 26MB of filler bytes
    ]);

    const res = await request(app)
      .post(`/api/sessions/${session.id}/upload`)
      .attach('file', oversized, 'huge.pdf');

    expect([400, 413]).toContain(res.status); // multer's own limit (413) or our defense-in-depth check (400)
  });

  test('the stored SHA-256 hash exactly matches an independently computed hash of the uploaded bytes', async () => {
    const crypto = require('crypto');
    const session = await createSession();
    const bytes = makeMinimalPdfBuffer();
    const expectedHash = crypto.createHash('sha256').update(bytes).digest('hex');

    const uploadRes = await request(app)
      .post(`/api/sessions/${session.id}/upload`)
      .attach('file', bytes, 'a.pdf');

    const row = db.prepare('SELECT sha256_hash FROM files WHERE id = ?').get(uploadRes.body.data.file.id);
    expect(row.sha256_hash).toBe(expectedHash);
  });

  test('GET /api/files/:id requires operator/admin auth', async () => {
    const session = await createSession();
    const uploadRes = await request(app)
      .post(`/api/sessions/${session.id}/upload`)
      .attach('file', makeMinimalPdfBuffer(), 'a.pdf');
    const fileId = uploadRes.body.data.file.id;

    const unauth = await request(app).get(`/api/files/${fileId}`);
    expect(unauth.status).toBe(401);
  });

  test('GET /api/files/:id returns metadata for an uploaded file (authenticated)', async () => {
    const session = await createSession();
    const uploadRes = await request(app)
      .post(`/api/sessions/${session.id}/upload`)
      .attach('file', makeMinimalPdfBuffer(), 'a.pdf');
    const fileId = uploadRes.body.data.file.id;

    const res = await request(app)
      .get(`/api/files/${fileId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.file.id).toBe(fileId);
  });

  test('GET /api/files/:id/content returns the raw bytes with correct content-type (authenticated)', async () => {
    const session = await createSession();
    const pdfBytes = makeMinimalPdfBuffer();
    const uploadRes = await request(app)
      .post(`/api/sessions/${session.id}/upload`)
      .attach('file', pdfBytes, 'a.pdf');
    const fileId = uploadRes.body.data.file.id;

    const res = await request(app)
      .get(`/api/files/${fileId}/content`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(Buffer.compare(res.body, pdfBytes)).toBe(0);
  });

  test('GET /api/files/:id/content allows document preview without requiring staff auth', async () => {
    const session = await createSession();
    const uploadRes = await request(app)
      .post(`/api/sessions/${session.id}/upload`)
      .attach('file', makeMinimalPdfBuffer(), 'a.pdf');

    const res = await request(app).get(`/api/files/${uploadRes.body.data.file.id}/content`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
  });

  test('files are actually written to disk with a safe, random name (never the original filename)', async () => {
    const session = await createSession();
    await request(app)
      .post(`/api/sessions/${session.id}/upload`)
      .attach('file', makeMinimalPdfBuffer(), '../../etc/passwd.pdf');

    const sessionDir = path.join(process.env.UPLOAD_DIR, session.id);
    const filesOnDisk = fs.readdirSync(sessionDir);
    expect(filesOnDisk.length).toBe(1);
    expect(filesOnDisk[0]).not.toContain('passwd');
    expect(filesOnDisk[0]).not.toContain('..');
  });

  test('allows multiple uploads when session oneTime is false, and GET /api/sessions/:id/files lists them', async () => {
    const sessRes = await request(app).post('/api/sessions').send({ oneTime: false });
    const session = sessRes.body.data.session;
    expect(session.oneTime).toBe(false);

    // First upload
    const res1 = await request(app)
      .post(`/api/sessions/${session.id}/upload`)
      .attach('file', makeMinimalPdfBuffer(), 'first.pdf');
    expect(res1.status).toBe(201);

    // Second upload should succeed because oneTime is false
    const res2 = await request(app)
      .post(`/api/sessions/${session.id}/upload`)
      .attach('file', makeMinimalPngBuffer(), 'second.png');
    expect(res2.status).toBe(201);

    // Public session files list endpoint
    const listRes = await request(app).get(`/api/sessions/${session.id}/files`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.files.length).toBe(2);
    expect(listRes.body.data.files.map((f) => f.originalName)).toEqual(
      expect.arrayContaining(['first.pdf', 'second.png'])
    );
  });

  test('successfully accepts Word documents (.docx and .doc)', async () => {
    const session = await createSession();

    // DOCX buffer starting with PK\x03\x04
    const docxBuf = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
    const resDocx = await request(app)
      .post(`/api/sessions/${session.id}/upload`)
      .attach('file', docxBuf, 'report.docx');
    expect(resDocx.status).toBe(201);
    expect(resDocx.body.data.file.extension).toBe('docx');
    expect(resDocx.body.data.file.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );

    const session2 = await createSession();
    // DOC buffer starting with \xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1
    const docBuf = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const resDoc = await request(app)
      .post(`/api/sessions/${session2.id}/upload`)
      .attach('file', docBuf, 'resume.doc');
    expect(resDoc.status).toBe(201);
    expect(resDoc.body.data.file.extension).toBe('doc');
    expect(resDoc.body.data.file.mimeType).toBe('application/msword');
  });
});

afterAll(() => {
  // Clean up the isolated temp upload directory created for this test run.
  try {
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});
