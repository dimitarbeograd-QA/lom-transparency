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
  `lom-procurement-test-${process.pid}-${Date.now()}.db`
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

test('POST/PUT/DELETE /api/procurements and GET /api/admin/procurements return 401 with no session cookie', async () => {
  const postRes = await request(app)
    .post('/api/procurements')
    .send({ title: 'Опит без сесия' });
  assert.equal(postRes.status, 401);

  const putRes = await request(app)
    .put('/api/procurements/1')
    .send({ title: 'Опит без сесия' });
  assert.equal(putRes.status, 401);

  const deleteRes = await request(app).delete('/api/procurements/1');
  assert.equal(deleteRes.status, 401);

  const adminListRes = await request(app).get('/api/admin/procurements');
  assert.equal(adminListRes.status, 401);
});

// ---------------------------------------------------------------------------
// CRUD correctness
// ---------------------------------------------------------------------------

test('admin can create, read, update, and delete a procurement', async () => {
  const cookie = await loginCookie();

  const createRes = await request(app)
    .post('/api/procurements')
    .set('Cookie', cookie)
    .send({
      title: 'Доставка на канцеларски материали',
      description: 'Периодична доставка за нуждите на общинска администрация',
      procedure_type: 'Публично състезание',
      estimated_value: 25000.5,
      publish_date: '2026-03-01',
      deadline_date: '2026-03-20',
      status: 'обявена',
    });

  assert.equal(createRes.status, 201);
  assert.ok(createRes.body.procurement.id);
  assert.equal(createRes.body.procurement.review_status, 'pending');
  assert.equal(createRes.body.procurement.status, 'обявена');
  const id = createRes.body.procurement.id;

  const updateRes = await request(app)
    .put(`/api/procurements/${id}`)
    .set('Cookie', cookie)
    .send({
      status: 'възложена',
      awarded_contractor: 'Пример ЕООД',
      contract_value: 24500,
      contract_date: '2026-04-01',
    });

  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.body.procurement.status, 'възложена');
  assert.equal(updateRes.body.procurement.awarded_contractor, 'Пример ЕООД');
  assert.equal(updateRes.body.procurement.contract_value, 24500);
  // fields not touched by the PUT must be preserved
  assert.equal(updateRes.body.procurement.title, 'Доставка на канцеларски материали');

  const deleteRes = await request(app)
    .delete(`/api/procurements/${id}`)
    .set('Cookie', cookie);
  assert.equal(deleteRes.status, 204);

  const afterDelete = db.prepare('SELECT * FROM procurements WHERE id = ?').get(id);
  assert.equal(afterDelete, undefined);
});

test('DELETE /api/procurements/:id also deletes its attachments (rows + files)', async () => {
  const cookie = await loginCookie();

  const createRes = await request(app)
    .post('/api/procurements')
    .set('Cookie', cookie)
    .send({ title: 'Поръчка с прикачени файлове' });
  const id = createRes.body.procurement.id;

  const attachRes = await request(app)
    .post('/api/attachments')
    .set('Cookie', cookie)
    .send({
      entity_type: 'procurement',
      entity_id: id,
      url: 'https://e-obp.eu/bp/Document/example',
      label: 'Обявление',
    });
  assert.equal(attachRes.status, 201);
  const attachmentId = attachRes.body.attachment.id;

  const deleteRes = await request(app)
    .delete(`/api/procurements/${id}`)
    .set('Cookie', cookie);
  assert.equal(deleteRes.status, 204);

  const remainingAttachment = db.prepare('SELECT * FROM attachments WHERE id = ?').get(attachmentId);
  assert.equal(remainingAttachment, undefined);
});

// ---------------------------------------------------------------------------
// Validation errors
// ---------------------------------------------------------------------------

test('POST /api/procurements without a title returns 400', async () => {
  const cookie = await loginCookie();

  const res = await request(app)
    .post('/api/procurements')
    .set('Cookie', cookie)
    .send({ procedure_type: 'Открита процедура' });

  assert.equal(res.status, 400);
});

test('POST /api/procurements with an invalid status returns 400', async () => {
  const cookie = await loginCookie();

  const res = await request(app)
    .post('/api/procurements')
    .set('Cookie', cookie)
    .send({ title: 'Невалиден статус', status: 'не-съществуващ' });

  assert.equal(res.status, 400);
});

test('PUT /api/procurements/:id with an empty title returns 400', async () => {
  const cookie = await loginCookie();

  const createRes = await request(app)
    .post('/api/procurements')
    .set('Cookie', cookie)
    .send({ title: 'Поръчка за изменение на заглавие' });
  const id = createRes.body.procurement.id;

  const res = await request(app)
    .put(`/api/procurements/${id}`)
    .set('Cookie', cookie)
    .send({ title: '' });

  assert.equal(res.status, 400);
});

test('PUT/DELETE on a non-existent procurement returns 404', async () => {
  const cookie = await loginCookie();

  const putRes = await request(app)
    .put('/api/procurements/999999')
    .set('Cookie', cookie)
    .send({ title: 'Не съществува' });
  assert.equal(putRes.status, 404);

  const deleteRes = await request(app)
    .delete('/api/procurements/999999')
    .set('Cookie', cookie);
  assert.equal(deleteRes.status, 404);
});

// ---------------------------------------------------------------------------
// UNIQUE(source_url) -> 409, not a raw 500
// ---------------------------------------------------------------------------

test('admin-created procurements (source_url always NULL) never collide on the UNIQUE(source_url) constraint', async () => {
  const cookie = await loginCookie();

  // POST /api/procurements intentionally has no source_url field in
  // serializeBody -- it is scraper-only (see server/scraper/modules/
  // procurement.js). SQLite treats every NULL in a UNIQUE index as
  // distinct, so two admin-created rows must both succeed here. The 409
  // path itself (duplicate non-NULL source_url) is only reachable from the
  // scraper's own insert helper, which is exercised by
  // procurement-scraper.test.js's idempotent-rerun behavior instead.
  const first = await request(app)
    .post('/api/procurements')
    .set('Cookie', cookie)
    .send({ title: 'Първа админ поръчка без източник' });
  assert.equal(first.status, 201);
  assert.equal(first.body.procurement.source_url, null);

  const second = await request(app)
    .post('/api/procurements')
    .set('Cookie', cookie)
    .send({ title: 'Втора админ поръчка без източник' });
  assert.equal(second.status, 201);
  assert.equal(second.body.procurement.source_url, null);
});

// ---------------------------------------------------------------------------
// Public GET only returns approved rows
// ---------------------------------------------------------------------------

test('public GET /api/procurements only returns approved rows, pending/rejected are excluded', async () => {
  const cookie = await loginCookie();

  const pendingRes = await request(app)
    .post('/api/procurements')
    .set('Cookie', cookie)
    .send({ title: 'Чакаща поръчка', publish_date: '2026-05-01' });
  const pendingId = pendingRes.body.procurement.id;

  const approvedRes = await request(app)
    .post('/api/procurements')
    .set('Cookie', cookie)
    .send({ title: 'Одобрена поръчка', publish_date: '2026-05-02' });
  const approvedId = approvedRes.body.procurement.id;

  const approveRes = await request(app)
    .post(`/api/review/procurements/${approvedId}/approve`)
    .set('Cookie', cookie);
  assert.equal(approveRes.status, 200);

  const publicListRes = await request(app).get('/api/procurements');
  assert.equal(publicListRes.status, 200);
  const ids = publicListRes.body.procurements.map((p) => p.id);
  assert.ok(ids.includes(approvedId), 'approved procurement should be public');
  assert.ok(!ids.includes(pendingId), 'pending procurement should NOT be public');

  // public detail route: approved is visible, pending returns 404
  const approvedDetail = await request(app).get(`/api/procurements/${approvedId}`);
  assert.equal(approvedDetail.status, 200);

  const pendingDetail = await request(app).get(`/api/procurements/${pendingId}`);
  assert.equal(pendingDetail.status, 404);
});

test('public GET /api/procurements supports status, procedure_type, and year filters', async () => {
  const cookie = await loginCookie();

  const rows = [
    { title: 'A', procedure_type: 'Открита процедура', status: 'обявена', publish_date: '2025-01-10' },
    { title: 'B', procedure_type: 'Публично състезание', status: 'възложена', publish_date: '2025-06-10' },
    { title: 'C', procedure_type: 'Открита процедура', status: 'приключена', publish_date: '2026-01-10' },
  ];

  const ids = [];
  for (const row of rows) {
    const res = await request(app).post('/api/procurements').set('Cookie', cookie).send(row);
    ids.push(res.body.procurement.id);
    await request(app)
      .post(`/api/review/procurements/${res.body.procurement.id}/approve`)
      .set('Cookie', cookie);
  }

  const byStatus = await request(app).get('/api/procurements?status=' + encodeURIComponent('възложена'));
  const statusIds = byStatus.body.procurements.map((p) => p.id);
  assert.ok(statusIds.includes(ids[1]));
  assert.ok(!statusIds.includes(ids[0]));

  const byType = await request(app).get(
    '/api/procurements?procedure_type=' + encodeURIComponent('Открита процедура')
  );
  const typeIds = byType.body.procurements.map((p) => p.id);
  assert.ok(typeIds.includes(ids[0]));
  assert.ok(typeIds.includes(ids[2]));
  assert.ok(!typeIds.includes(ids[1]));

  const byYear = await request(app).get('/api/procurements?year=2025');
  const yearIds = byYear.body.procurements.map((p) => p.id);
  assert.ok(yearIds.includes(ids[0]));
  assert.ok(yearIds.includes(ids[1]));
  assert.ok(!yearIds.includes(ids[2]));
});

// ---------------------------------------------------------------------------
// Admin listing endpoint (used by the admin triage table) -- all statuses
// ---------------------------------------------------------------------------

test('GET /api/admin/procurements returns rows of every review status, optionally filtered by ?status=', async () => {
  const cookie = await loginCookie();

  const pendingRes = await request(app)
    .post('/api/procurements')
    .set('Cookie', cookie)
    .send({ title: 'Чакащо (админ списък)' });

  const approvedRes = await request(app)
    .post('/api/procurements')
    .set('Cookie', cookie)
    .send({ title: 'Одобрено (админ списък)' });
  await request(app)
    .post(`/api/review/procurements/${approvedRes.body.procurement.id}/approve`)
    .set('Cookie', cookie);

  const rejectedRes = await request(app)
    .post('/api/procurements')
    .set('Cookie', cookie)
    .send({ title: 'Отхвърлено (админ списък)' });
  await request(app)
    .post(`/api/review/procurements/${rejectedRes.body.procurement.id}/reject`)
    .set('Cookie', cookie);

  const allRes = await request(app).get('/api/admin/procurements').set('Cookie', cookie);
  assert.equal(allRes.status, 200);
  const allIds = allRes.body.procurements.map((p) => p.id);
  assert.ok(allIds.includes(pendingRes.body.procurement.id));
  assert.ok(allIds.includes(approvedRes.body.procurement.id));
  assert.ok(allIds.includes(rejectedRes.body.procurement.id));

  const pendingOnlyRes = await request(app)
    .get('/api/admin/procurements?status=pending')
    .set('Cookie', cookie);
  assert.equal(pendingOnlyRes.status, 200);
  assert.ok(pendingOnlyRes.body.procurements.every((p) => p.review_status === 'pending'));
  assert.ok(
    pendingOnlyRes.body.procurements.some((p) => p.id === pendingRes.body.procurement.id)
  );
});
