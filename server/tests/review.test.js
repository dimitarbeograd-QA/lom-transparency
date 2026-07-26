'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const test = require('node:test');
const assert = require('node:assert/strict');

const TMP_DB_PATH = path.join(
  os.tmpdir(),
  `lom-review-test-${process.pid}-${Date.now()}.db`
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
    try {
      fs.unlinkSync(p);
    } catch (err) {
      if (err.code !== 'ENOENT' && err.code !== 'EBUSY') throw err;
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

function seedOrdinance(title, status = 'pending') {
  const info = db
    .prepare(
      `INSERT INTO ordinances (title, status, review_status)
       VALUES (?, 'active', ?)`
    )
    .run(title, status);
  return info.lastInsertRowid;
}

test('bulk approve/reject routes return 401 with no session cookie', async () => {
  const approveRes = await request(app).post('/api/review/ordinances/approve-all');
  assert.equal(approveRes.status, 401);

  const rejectRes = await request(app).post('/api/review/ordinances/reject-all');
  assert.equal(rejectRes.status, 401);
});

test('bulk approve/reject on an unregistered table name returns 403, not a raw SQL error', async () => {
  const cookie = await loginCookie();
  const res = await request(app)
    .post('/api/review/sqlite_master/approve-all')
    .set('Cookie', cookie);
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'unknown_reviewable_table');
});

test('POST /api/review/:table/approve-all approves every pending row and leaves already-approved/rejected rows untouched', async () => {
  const cookie = await loginCookie();

  const pendingA = seedOrdinance('Наредба А (чакаща)', 'pending');
  const pendingB = seedOrdinance('Наредба Б (чакаща)', 'pending');
  const alreadyApproved = seedOrdinance('Наредба В (вече одобрена)', 'approved');
  const alreadyRejected = seedOrdinance('Наредба Г (вече отхвърлена)', 'rejected');

  const res = await request(app)
    .post('/api/review/ordinances/approve-all')
    .set('Cookie', cookie);

  assert.equal(res.status, 200);
  assert.equal(res.body.updated, 2, 'only the 2 pending rows should be updated');

  const rows = db
    .prepare('SELECT id, review_status FROM ordinances WHERE id IN (?, ?, ?, ?)')
    .all(pendingA, pendingB, alreadyApproved, alreadyRejected);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r.review_status]));

  assert.equal(byId[pendingA], 'approved');
  assert.equal(byId[pendingB], 'approved');
  assert.equal(byId[alreadyApproved], 'approved');
  assert.equal(byId[alreadyRejected], 'rejected');
});

test('POST /api/review/:table/approve-all is idempotent -- calling it again with nothing pending updates 0 rows', async () => {
  const cookie = await loginCookie();
  const res = await request(app)
    .post('/api/review/ordinances/approve-all')
    .set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.equal(res.body.updated, 0);
});

test('POST /api/review/:table/reject-all only affects pending rows', async () => {
  const cookie = await loginCookie();
  const pending = seedOrdinance('Наредба Д (чакаща за отхвърляне)', 'pending');

  const res = await request(app)
    .post('/api/review/ordinances/reject-all')
    .set('Cookie', cookie);

  assert.equal(res.status, 200);
  assert.equal(res.body.updated, 1);

  const row = db.prepare('SELECT review_status FROM ordinances WHERE id = ?').get(pending);
  assert.equal(row.review_status, 'rejected');
});

test('bulk-approved rows are then visible on the public GET endpoint', async () => {
  const cookie = await loginCookie();
  seedOrdinance('Наредба Е (публична проверка)', 'pending');

  await request(app).post('/api/review/ordinances/approve-all').set('Cookie', cookie);

  const publicRes = await request(app).get('/api/ordinances');
  assert.equal(publicRes.status, 200);
  const titles = publicRes.body.ordinances.map((o) => o.title);
  assert.ok(titles.includes('Наредба Е (публична проверка)'));
});
