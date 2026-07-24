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
  `lom-decisions-test-${process.pid}-${Date.now()}.db`
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
        // with them (same pre-existing quirk as tests/auth.test.js) --
        // non-fatal, the OS temp dir gets swept eventually.
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

test('POST/PUT/DELETE /api/council-decisions and GET /api/admin/council-decisions return 401 with no session cookie', async () => {
  const postRes = await request(app)
    .post('/api/council-decisions')
    .send({ title: 'Опит без сесия' });
  assert.equal(postRes.status, 401);

  const putRes = await request(app)
    .put('/api/council-decisions/1')
    .send({ title: 'Опит без сесия' });
  assert.equal(putRes.status, 401);

  const deleteRes = await request(app).delete('/api/council-decisions/1');
  assert.equal(deleteRes.status, 401);

  const adminListRes = await request(app).get('/api/admin/council-decisions');
  assert.equal(adminListRes.status, 401);
});

// ---------------------------------------------------------------------------
// CRUD correctness
// ---------------------------------------------------------------------------

test('admin can create, read, update, and delete a council decision', async () => {
  const cookie = await loginCookie();

  const createRes = await request(app)
    .post('/api/council-decisions')
    .set('Cookie', cookie)
    .send({
      session_date: '2026-07-06',
      session_number: '2026-07-06',
      decision_number: '101',
      title: 'Решение за одобряване на бюджет',
      summary: 'Кратко резюме на решението.',
      category: 'Бюджет',
    });

  assert.equal(createRes.status, 201);
  assert.ok(createRes.body.decision.id);
  assert.equal(createRes.body.decision.review_status, 'pending');
  const id = createRes.body.decision.id;

  const updateRes = await request(app)
    .put(`/api/council-decisions/${id}`)
    .set('Cookie', cookie)
    .send({ title: 'Решение за одобряване на бюджет (изменено)' });

  assert.equal(updateRes.status, 200);
  assert.equal(
    updateRes.body.decision.title,
    'Решение за одобряване на бюджет (изменено)'
  );

  const deleteRes = await request(app)
    .delete(`/api/council-decisions/${id}`)
    .set('Cookie', cookie);
  assert.equal(deleteRes.status, 204);

  const afterDelete = db
    .prepare('SELECT * FROM council_decisions WHERE id = ?')
    .get(id);
  assert.equal(afterDelete, undefined);
});

test('DELETE /api/council-decisions/:id also deletes its attachments (rows + files)', async () => {
  const cookie = await loginCookie();

  const createRes = await request(app)
    .post('/api/council-decisions')
    .set('Cookie', cookie)
    .send({
      session_date: '2026-06-30',
      session_number: '2026-06-30',
      decision_number: '202',
      title: 'Решение с прикачени файлове',
    });
  const id = createRes.body.decision.id;

  const attachRes = await request(app)
    .post('/api/attachments')
    .set('Cookie', cookie)
    .send({
      entity_type: 'council_decision',
      entity_id: id,
      url: 'https://example.com/doc.pdf',
      label: 'Протокол',
    });
  assert.equal(attachRes.status, 201);
  const attachmentId = attachRes.body.attachment.id;

  const deleteRes = await request(app)
    .delete(`/api/council-decisions/${id}`)
    .set('Cookie', cookie);
  assert.equal(deleteRes.status, 204);

  const remainingAttachment = db
    .prepare('SELECT * FROM attachments WHERE id = ?')
    .get(attachmentId);
  assert.equal(remainingAttachment, undefined);
});

// ---------------------------------------------------------------------------
// Validation errors
// ---------------------------------------------------------------------------

test('POST /api/council-decisions without a title returns 400', async () => {
  const cookie = await loginCookie();

  const res = await request(app)
    .post('/api/council-decisions')
    .set('Cookie', cookie)
    .send({ session_date: '2026-01-01' });

  assert.equal(res.status, 400);
});

test('PUT /api/council-decisions/:id with an empty title returns 400', async () => {
  const cookie = await loginCookie();

  const createRes = await request(app)
    .post('/api/council-decisions')
    .set('Cookie', cookie)
    .send({ title: 'Решение за изменение на заглавие', decision_number: '303' });
  const id = createRes.body.decision.id;

  const res = await request(app)
    .put(`/api/council-decisions/${id}`)
    .set('Cookie', cookie)
    .send({ title: '' });

  assert.equal(res.status, 400);
});

test('PUT/DELETE on a non-existent decision returns 404', async () => {
  const cookie = await loginCookie();

  const putRes = await request(app)
    .put('/api/council-decisions/999999')
    .set('Cookie', cookie)
    .send({ title: 'Не съществува' });
  assert.equal(putRes.status, 404);

  const deleteRes = await request(app)
    .delete('/api/council-decisions/999999')
    .set('Cookie', cookie);
  assert.equal(deleteRes.status, 404);
});

// ---------------------------------------------------------------------------
// UNIQUE(session_number, decision_number) -> 409, not a raw 500
// ---------------------------------------------------------------------------

test('creating two decisions with the same session_number + decision_number returns 409 with a clear message', async () => {
  const cookie = await loginCookie();

  const first = await request(app)
    .post('/api/council-decisions')
    .set('Cookie', cookie)
    .send({
      session_number: 'SN-DUP',
      decision_number: '55',
      title: 'Първо решение',
    });
  assert.equal(first.status, 201);

  const second = await request(app)
    .post('/api/council-decisions')
    .set('Cookie', cookie)
    .send({
      session_number: 'SN-DUP',
      decision_number: '55',
      title: 'Дублиращо решение',
    });

  assert.equal(second.status, 409);
  assert.equal(second.body.error, 'duplicate_decision');
  assert.ok(second.body.message);
});

test('updating a decision to collide with another decision returns 409', async () => {
  const cookie = await loginCookie();

  await request(app)
    .post('/api/council-decisions')
    .set('Cookie', cookie)
    .send({ session_number: 'SN-A', decision_number: '1', title: 'Решение А' });

  const bRes = await request(app)
    .post('/api/council-decisions')
    .set('Cookie', cookie)
    .send({ session_number: 'SN-B', decision_number: '1', title: 'Решение Б' });
  const bId = bRes.body.decision.id;

  const updateRes = await request(app)
    .put(`/api/council-decisions/${bId}`)
    .set('Cookie', cookie)
    .send({ session_number: 'SN-A' });

  assert.equal(updateRes.status, 409);
  assert.equal(updateRes.body.error, 'duplicate_decision');
});

// ---------------------------------------------------------------------------
// Public GET only returns approved rows
//
// NOTE: as of this writing, the two tests below correctly fail against the
// current repo state -- NOT because of a bug in this module's own route
// code, but because of a routing bug in the shared, do-not-edit
// server/routes/review.js: it registers `router.use(requireAdmin)` with no
// path prefix, which (because that router itself is mounted at "/" in
// server/routes/index.js, ahead of every feature module) makes requireAdmin
// run for every /api/* request that reaches routes/modules/*, including
// public GET routes that were never supposed to require auth at all. This
// affects every module, not just decisions. See this module's final report
// for the one-line suggested fix
// (`router.use(requireAdmin)` -> `router.use('/review', requireAdmin)`).
// These tests are left intact (not weakened) so they start passing the
// moment that shared bug is fixed.
// ---------------------------------------------------------------------------

test('public GET /api/council-decisions only returns approved rows, pending/rejected are excluded', async () => {
  const cookie = await loginCookie();

  const pendingRes = await request(app)
    .post('/api/council-decisions')
    .set('Cookie', cookie)
    .send({
      session_number: 'PUB-1',
      decision_number: '1',
      title: 'Чакащо решение',
      session_date: '2026-05-01',
    });
  const pendingId = pendingRes.body.decision.id;

  const approvedRes = await request(app)
    .post('/api/council-decisions')
    .set('Cookie', cookie)
    .send({
      session_number: 'PUB-2',
      decision_number: '1',
      title: 'Одобрено решение',
      session_date: '2026-05-02',
    });
  const approvedId = approvedRes.body.decision.id;

  // Approve directly via the DB rather than the shared
  // POST /api/review/:table/:id/approve endpoint -- see the note in this
  // module's final report about a routing bug in server/routes/review.js
  // that currently makes that endpoint (and every other module's public GET
  // routes) return 401 unconditionally. Direct DB access to seed
  // pending/approved rows is an explicitly sanctioned pattern for this
  // exact purpose per the E2E test conventions.
  db.prepare(`UPDATE council_decisions SET review_status = 'approved' WHERE id = ?`).run(
    approvedId
  );

  const publicListRes = await request(app).get('/api/council-decisions');
  assert.equal(publicListRes.status, 200);
  const ids = publicListRes.body.decisions.map((d) => d.id);
  assert.ok(ids.includes(approvedId), 'approved decision should be public');
  assert.ok(!ids.includes(pendingId), 'pending decision should NOT be public');

  // public detail route: approved is visible, pending returns 404
  const approvedDetail = await request(app).get(`/api/council-decisions/${approvedId}`);
  assert.equal(approvedDetail.status, 200);

  const pendingDetail = await request(app).get(`/api/council-decisions/${pendingId}`);
  assert.equal(pendingDetail.status, 404);
});

test('public GET /api/council-decisions supports session_number, category, and date range filters', async () => {
  const cookie = await loginCookie();

  const rows = [
    { session_number: 'FILT-1', decision_number: '1', title: 'A', category: 'Бюджет', session_date: '2026-01-10' },
    { session_number: 'FILT-2', decision_number: '1', title: 'B', category: 'Устройство', session_date: '2026-02-10' },
    { session_number: 'FILT-3', decision_number: '1', title: 'C', category: 'Бюджет', session_date: '2026-03-10' },
  ];

  const ids = [];
  for (const row of rows) {
    const res = await request(app)
      .post('/api/council-decisions')
      .set('Cookie', cookie)
      .send(row);
    ids.push(res.body.decision.id);
    db.prepare(`UPDATE council_decisions SET review_status = 'approved' WHERE id = ?`).run(
      res.body.decision.id
    );
  }

  const bySession = await request(app).get('/api/council-decisions?session_number=FILT-2');
  assert.equal(bySession.body.decisions.length, 1);
  assert.equal(bySession.body.decisions[0].session_number, 'FILT-2');

  const byCategory = await request(app).get('/api/council-decisions?category=Бюджет');
  const categoryIds = byCategory.body.decisions.map((d) => d.id);
  assert.ok(categoryIds.includes(ids[0]));
  assert.ok(categoryIds.includes(ids[2]));
  assert.ok(!categoryIds.includes(ids[1]));

  const byRange = await request(app).get(
    '/api/council-decisions?from=2026-02-01&to=2026-02-28'
  );
  const rangeIds = byRange.body.decisions.map((d) => d.id);
  assert.ok(rangeIds.includes(ids[1]));
  assert.ok(!rangeIds.includes(ids[0]));
  assert.ok(!rangeIds.includes(ids[2]));
});

// ---------------------------------------------------------------------------
// Admin listing endpoint (used by the admin triage table) -- all statuses
// ---------------------------------------------------------------------------

test('GET /api/admin/council-decisions returns rows of every review status, optionally filtered by ?status=', async () => {
  const cookie = await loginCookie();

  const pendingRes = await request(app)
    .post('/api/council-decisions')
    .set('Cookie', cookie)
    .send({ session_number: 'ADM-1', decision_number: '1', title: 'Чакащо' });

  const approvedRes = await request(app)
    .post('/api/council-decisions')
    .set('Cookie', cookie)
    .send({ session_number: 'ADM-2', decision_number: '1', title: 'Одобрено' });
  db.prepare(`UPDATE council_decisions SET review_status = 'approved' WHERE id = ?`).run(
    approvedRes.body.decision.id
  );

  const rejectedRes = await request(app)
    .post('/api/council-decisions')
    .set('Cookie', cookie)
    .send({ session_number: 'ADM-3', decision_number: '1', title: 'Отхвърлено' });
  db.prepare(`UPDATE council_decisions SET review_status = 'rejected' WHERE id = ?`).run(
    rejectedRes.body.decision.id
  );

  const allRes = await request(app)
    .get('/api/admin/council-decisions')
    .set('Cookie', cookie);
  assert.equal(allRes.status, 200);
  const allIds = allRes.body.decisions.map((d) => d.id);
  assert.ok(allIds.includes(pendingRes.body.decision.id));
  assert.ok(allIds.includes(approvedRes.body.decision.id));
  assert.ok(allIds.includes(rejectedRes.body.decision.id));

  const pendingOnlyRes = await request(app)
    .get('/api/admin/council-decisions?status=pending')
    .set('Cookie', cookie);
  assert.equal(pendingOnlyRes.status, 200);
  assert.ok(
    pendingOnlyRes.body.decisions.every((d) => d.review_status === 'pending')
  );
  assert.ok(
    pendingOnlyRes.body.decisions.some((d) => d.id === pendingRes.body.decision.id)
  );
});
