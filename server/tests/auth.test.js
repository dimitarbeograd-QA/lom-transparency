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
  `lom-auth-test-${process.pid}-${Date.now()}.db`
);
process.env.LOM_DB_PATH = TMP_DB_PATH;
process.env.LOM_ADMIN_USERNAME = process.env.LOM_ADMIN_USERNAME || 'admin';
process.env.LOM_ADMIN_PASSWORD = process.env.LOM_ADMIN_PASSWORD || 'admin123';

const request = require('supertest');
const { app } = require('../server');

const ADMIN_USERNAME = process.env.LOM_ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.LOM_ADMIN_PASSWORD;

function cleanupDbFiles() {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TMP_DB_PATH + suffix;
    try {
      fs.unlinkSync(p);
    } catch (err) {
      // ENOENT: file never existed (fine). EBUSY: Windows sometimes holds a
      // brief lock on a just-closed sqlite file/handle -- it's a scratch
      // temp file, harmless to leave behind, not worth failing the suite.
      if (err.code !== 'ENOENT' && err.code !== 'EBUSY') throw err;
    }
  }
}

test.after(() => {
  cleanupDbFiles();
});

test('login with correct seeded admin credentials succeeds and sets cookie', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

  assert.equal(res.status, 200);
  assert.equal(res.body.user.username, ADMIN_USERNAME);
  assert.ok(res.headers['set-cookie'], 'expected a Set-Cookie header');
  assert.ok(
    res.headers['set-cookie'].some((c) => c.startsWith('lt_sid=')),
    'expected lt_sid cookie to be set'
  );
});

test('login with wrong password returns 401', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username: ADMIN_USERNAME, password: 'wrong-password' });

  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'invalid_credentials');
});

test('GET /api/auth/me with no cookie returns 401', async () => {
  const res = await request(app).get('/api/auth/me');
  assert.equal(res.status, 401);
});

test('GET /api/auth/me with a valid cookie returns the username, then logout invalidates it', async () => {
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

  const cookie = loginRes.headers['set-cookie'];
  assert.ok(cookie);

  const meRes = await request(app).get('/api/auth/me').set('Cookie', cookie);
  assert.equal(meRes.status, 200);
  assert.equal(meRes.body.user.username, ADMIN_USERNAME);

  const logoutRes = await request(app)
    .post('/api/auth/logout')
    .set('Cookie', cookie);
  assert.equal(logoutRes.status, 204);

  const meAfterLogoutRes = await request(app)
    .get('/api/auth/me')
    .set('Cookie', cookie);
  assert.equal(meAfterLogoutRes.status, 401);
});

test('a garbage/forged cookie value returns 401, not a crash', async () => {
  const res = await request(app)
    .get('/api/auth/me')
    .set('Cookie', 'lt_sid=totally-made-up-token-value');

  assert.equal(res.status, 401);
});
