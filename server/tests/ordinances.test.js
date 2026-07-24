'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const test = require('node:test');
const assert = require('node:assert/strict');

// Use an isolated DB file for this test run, set BEFORE requiring server.js
// so the db singleton picks it up.
const TMP_DB_PATH = path.join(
  os.tmpdir(),
  `lom-ordinances-test-${process.pid}-${Date.now()}.db`
);
process.env.LOM_DB_PATH = TMP_DB_PATH;
process.env.LOM_ADMIN_USERNAME = process.env.LOM_ADMIN_USERNAME || 'admin';
process.env.LOM_ADMIN_PASSWORD = process.env.LOM_ADMIN_PASSWORD || 'admin123';

const request = require('supertest');
const { app } = require('../server');
const { db } = require('../db');

const ADMIN_USERNAME = process.env.LOM_ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.LOM_ADMIN_PASSWORD;

function cleanupDbFiles() {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TMP_DB_PATH + suffix;
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
      } catch (err) {
        // Windows can hold a brief file lock on the WAL/SHM sidecars via
        // better-sqlite3 even after the process would otherwise be done
        // with them -- non-fatal, the OS temp dir gets swept eventually.
      }
    }
  }
}

test.after(() => {
  cleanupDbFiles();
});

async function loginCookie() {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
  assert.equal(res.status, 200);
  return res.headers['set-cookie'];
}

// ---------------------------------------------------------------------------
// 401-without-cookie pen test (named per module conventions)
// ---------------------------------------------------------------------------

test('POST/PUT/DELETE /api/ordinances and GET /api/admin/ordinances return 401 with no session cookie', async () => {
  const postRes = await request(app)
    .post('/api/ordinances')
    .send({ title: 'Опит без сесия' });
  assert.equal(postRes.status, 401);

  const putRes = await request(app)
    .put('/api/ordinances/1')
    .send({ title: 'Опит без сесия' });
  assert.equal(putRes.status, 401);

  const deleteRes = await request(app).delete('/api/ordinances/1');
  assert.equal(deleteRes.status, 401);

  const adminListRes = await request(app).get('/api/admin/ordinances');
  assert.equal(adminListRes.status, 401);
});

// ---------------------------------------------------------------------------
// CRUD correctness
// ---------------------------------------------------------------------------

test('admin can create, read, update, and delete an ordinance', async () => {
  const cookie = await loginCookie();

  const createRes = await request(app)
    .post('/api/ordinances')
    .set('Cookie', cookie)
    .send({
      title: 'Наредба за реда и условията за търговска дейност',
      category: 'Търговия',
    });

  assert.equal(createRes.status, 201);
  assert.ok(createRes.body.ordinance.id);
  assert.equal(createRes.body.ordinance.review_status, 'pending');
  assert.equal(createRes.body.ordinance.status, 'active');
  assert.equal(createRes.body.ordinance.adoption_date, null);
  const id = createRes.body.ordinance.id;

  const updateRes = await request(app)
    .put(`/api/ordinances/${id}`)
    .set('Cookie', cookie)
    .send({ adoption_date: '2015-03-12', status: 'repealed' });

  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.body.ordinance.adoption_date, '2015-03-12');
  assert.equal(updateRes.body.ordinance.status, 'repealed');
  // untouched fields survive the partial update
  assert.equal(updateRes.body.ordinance.title, 'Наредба за реда и условията за търговска дейност');

  const deleteRes = await request(app).delete(`/api/ordinances/${id}`).set('Cookie', cookie);
  assert.equal(deleteRes.status, 204);

  const afterDelete = db.prepare('SELECT * FROM ordinances WHERE id = ?').get(id);
  assert.equal(afterDelete, undefined);
});

test('DELETE /api/ordinances/:id also deletes its attachments (rows + files)', async () => {
  const cookie = await loginCookie();

  const createRes = await request(app)
    .post('/api/ordinances')
    .set('Cookie', cookie)
    .send({ title: 'Наредба с прикачени файлове' });
  const id = createRes.body.ordinance.id;

  const attachRes = await request(app)
    .post('/api/attachments')
    .set('Cookie', cookie)
    .send({
      entity_type: 'ordinance',
      entity_id: id,
      url: 'https://example.com/naredba.pdf',
      label: 'Текст на наредбата',
    });
  assert.equal(attachRes.status, 201);
  const attachmentId = attachRes.body.attachment.id;

  const deleteRes = await request(app).delete(`/api/ordinances/${id}`).set('Cookie', cookie);
  assert.equal(deleteRes.status, 204);

  const remainingAttachment = db.prepare('SELECT * FROM attachments WHERE id = ?').get(attachmentId);
  assert.equal(remainingAttachment, undefined);
});

// ---------------------------------------------------------------------------
// Validation errors
// ---------------------------------------------------------------------------

test('POST /api/ordinances without a title returns 400', async () => {
  const cookie = await loginCookie();

  const res = await request(app)
    .post('/api/ordinances')
    .set('Cookie', cookie)
    .send({ category: 'Без заглавие' });

  assert.equal(res.status, 400);
});

test('POST /api/ordinances with an invalid status returns 400', async () => {
  const cookie = await loginCookie();

  const res = await request(app)
    .post('/api/ordinances')
    .set('Cookie', cookie)
    .send({ title: 'Наредба с невалиден статус', status: 'not_a_status' });

  assert.equal(res.status, 400);
});

test('PUT /api/ordinances/:id with an empty title returns 400', async () => {
  const cookie = await loginCookie();

  const createRes = await request(app)
    .post('/api/ordinances')
    .set('Cookie', cookie)
    .send({ title: 'Наредба за изменение на заглавие' });
  const id = createRes.body.ordinance.id;

  const res = await request(app).put(`/api/ordinances/${id}`).set('Cookie', cookie).send({ title: '' });

  assert.equal(res.status, 400);
});

test('PUT/DELETE on a non-existent ordinance returns 404', async () => {
  const cookie = await loginCookie();

  const putRes = await request(app)
    .put('/api/ordinances/999999')
    .set('Cookie', cookie)
    .send({ title: 'Не съществува' });
  assert.equal(putRes.status, 404);

  const deleteRes = await request(app).delete('/api/ordinances/999999').set('Cookie', cookie);
  assert.equal(deleteRes.status, 404);
});

// ---------------------------------------------------------------------------
// NULL adoption_date is handled correctly end-to-end (this is the expected
// common case for freshly-scraped ordinances, per the source site never
// showing dates in its listing).
// ---------------------------------------------------------------------------

test('an ordinance with NULL adoption_date round-trips correctly through create, public GET, and update', async () => {
  const cookie = await loginCookie();

  const createRes = await request(app)
    .post('/api/ordinances')
    .set('Cookie', cookie)
    .send({ title: 'Наредба без известна дата на приемане' });
  assert.equal(createRes.status, 201);
  assert.equal(createRes.body.ordinance.adoption_date, null);
  const id = createRes.body.ordinance.id;

  db.prepare(`UPDATE ordinances SET review_status = 'approved' WHERE id = ?`).run(id);

  const publicRes = await request(app).get(`/api/ordinances/${id}`);
  assert.equal(publicRes.status, 200);
  assert.equal(publicRes.body.ordinance.adoption_date, null);

  const listRes = await request(app).get('/api/ordinances');
  const listed = listRes.body.ordinances.find((o) => o.id === id);
  assert.ok(listed, 'ordinance with NULL adoption_date should still be listed publicly');
  assert.equal(listed.adoption_date, null);
});

// ---------------------------------------------------------------------------
// Public GET only returns approved rows
// ---------------------------------------------------------------------------

test('public GET /api/ordinances only returns approved rows, pending/rejected are excluded', async () => {
  const cookie = await loginCookie();

  const pendingRes = await request(app)
    .post('/api/ordinances')
    .set('Cookie', cookie)
    .send({ title: 'Чакаща наредба' });
  const pendingId = pendingRes.body.ordinance.id;

  const approvedRes = await request(app)
    .post('/api/ordinances')
    .set('Cookie', cookie)
    .send({ title: 'Одобрена наредба' });
  const approvedId = approvedRes.body.ordinance.id;
  db.prepare(`UPDATE ordinances SET review_status = 'approved' WHERE id = ?`).run(approvedId);

  const publicListRes = await request(app).get('/api/ordinances');
  assert.equal(publicListRes.status, 200);
  const ids = publicListRes.body.ordinances.map((o) => o.id);
  assert.ok(ids.includes(approvedId), 'approved ordinance should be public');
  assert.ok(!ids.includes(pendingId), 'pending ordinance should NOT be public');

  const approvedDetail = await request(app).get(`/api/ordinances/${approvedId}`);
  assert.equal(approvedDetail.status, 200);

  const pendingDetail = await request(app).get(`/api/ordinances/${pendingId}`);
  assert.equal(pendingDetail.status, 404);
});

test('public GET /api/ordinances supports status and category filters', async () => {
  const cookie = await loginCookie();

  const rows = [
    { title: 'A', status: 'active', category: 'Данъци' },
    { title: 'B', status: 'repealed', category: 'Данъци' },
    { title: 'C', status: 'active', category: 'Отпадъци' },
  ];

  const ids = [];
  for (const row of rows) {
    const res = await request(app).post('/api/ordinances').set('Cookie', cookie).send(row);
    ids.push(res.body.ordinance.id);
    db.prepare(`UPDATE ordinances SET review_status = 'approved' WHERE id = ?`).run(
      res.body.ordinance.id
    );
  }

  const byStatus = await request(app).get('/api/ordinances?status=repealed');
  const statusIds = byStatus.body.ordinances.map((o) => o.id);
  assert.ok(statusIds.includes(ids[1]));
  assert.ok(!statusIds.includes(ids[0]));

  const byCategory = await request(app).get('/api/ordinances?category=Данъци');
  const categoryIds = byCategory.body.ordinances.map((o) => o.id);
  assert.ok(categoryIds.includes(ids[0]));
  assert.ok(categoryIds.includes(ids[1]));
  assert.ok(!categoryIds.includes(ids[2]));
});

// ---------------------------------------------------------------------------
// Admin listing endpoint (used by the admin triage table) -- all statuses
// ---------------------------------------------------------------------------

test('GET /api/admin/ordinances returns rows of every review status, optionally filtered by ?status=', async () => {
  const cookie = await loginCookie();

  const pendingRes = await request(app)
    .post('/api/ordinances')
    .set('Cookie', cookie)
    .send({ title: 'Админ чакаща' });

  const approvedRes = await request(app)
    .post('/api/ordinances')
    .set('Cookie', cookie)
    .send({ title: 'Админ одобрена' });
  db.prepare(`UPDATE ordinances SET review_status = 'approved' WHERE id = ?`).run(
    approvedRes.body.ordinance.id
  );

  const rejectedRes = await request(app)
    .post('/api/ordinances')
    .set('Cookie', cookie)
    .send({ title: 'Админ отхвърлена' });
  db.prepare(`UPDATE ordinances SET review_status = 'rejected' WHERE id = ?`).run(
    rejectedRes.body.ordinance.id
  );

  const allRes = await request(app).get('/api/admin/ordinances').set('Cookie', cookie);
  assert.equal(allRes.status, 200);
  const allIds = allRes.body.ordinances.map((o) => o.id);
  assert.ok(allIds.includes(pendingRes.body.ordinance.id));
  assert.ok(allIds.includes(approvedRes.body.ordinance.id));
  assert.ok(allIds.includes(rejectedRes.body.ordinance.id));

  const pendingOnlyRes = await request(app)
    .get('/api/admin/ordinances?status=pending')
    .set('Cookie', cookie);
  assert.equal(pendingOnlyRes.status, 200);
  assert.ok(pendingOnlyRes.body.ordinances.every((o) => o.review_status === 'pending'));
  assert.ok(
    pendingOnlyRes.body.ordinances.some((o) => o.id === pendingRes.body.ordinance.id)
  );
});

// ---------------------------------------------------------------------------
// Review approve/reject round-trip via the shared review endpoint
// ---------------------------------------------------------------------------

test('POST /api/review/ordinances/:id/approve flips review_status and makes the row public', async () => {
  const cookie = await loginCookie();

  const createRes = await request(app)
    .post('/api/ordinances')
    .set('Cookie', cookie)
    .send({ title: 'Наредба за одобряване през review endpoint' });
  const id = createRes.body.ordinance.id;

  const approveRes = await request(app)
    .post(`/api/review/ordinances/${id}/approve`)
    .set('Cookie', cookie);
  assert.equal(approveRes.status, 200);
  assert.equal(approveRes.body.item.review_status, 'approved');

  const publicRes = await request(app).get(`/api/ordinances/${id}`);
  assert.equal(publicRes.status, 200);
});
