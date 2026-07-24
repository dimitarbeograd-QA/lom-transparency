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
  `lom-administration-test-${process.pid}-${Date.now()}.db`
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

function approve(table, id) {
  db.prepare(`UPDATE ${table} SET review_status = 'approved' WHERE id = ?`).run(id);
}

// ---------------------------------------------------------------------------
// 401-without-cookie pen test (named per module conventions)
// ---------------------------------------------------------------------------

test('every administration mutation route returns 401 with no session cookie', async () => {
  const cases = [
    ['post', '/api/departments'],
    ['put', '/api/departments/1'],
    ['delete', '/api/departments/1'],
    ['get', '/api/admin/departments'],
    ['post', '/api/officials'],
    ['put', '/api/officials/1'],
    ['delete', '/api/officials/1'],
    ['get', '/api/admin/officials'],
    ['post', '/api/council-members'],
    ['put', '/api/council-members/1'],
    ['delete', '/api/council-members/1'],
    ['get', '/api/admin/council-members'],
    ['post', '/api/committees'],
    ['put', '/api/committees/1'],
    ['delete', '/api/committees/1'],
    ['get', '/api/admin/committees'],
    ['post', '/api/committee-memberships'],
    ['delete', '/api/committee-memberships/1'],
  ];

  for (const [method, url] of cases) {
    const res = await request(app)[method](url).send({});
    assert.equal(res.status, 401, `${method.toUpperCase()} ${url} should be 401 with no cookie`);
  }
});

// ---------------------------------------------------------------------------
// Departments CRUD
// ---------------------------------------------------------------------------

test('admin can create, read, update, and delete a department', async () => {
  const cookie = await loginCookie();

  const createRes = await request(app)
    .post('/api/departments')
    .set('Cookie', cookie)
    .send({ name: 'Отдел „Тест“', description: 'Описание' });
  assert.equal(createRes.status, 201);
  assert.equal(createRes.body.department.review_status, 'pending');
  const id = createRes.body.department.id;

  const updateRes = await request(app)
    .put(`/api/departments/${id}`)
    .set('Cookie', cookie)
    .send({ description: 'Ново описание' });
  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.body.department.description, 'Ново описание');

  const deleteRes = await request(app).delete(`/api/departments/${id}`).set('Cookie', cookie);
  assert.equal(deleteRes.status, 204);

  const afterDelete = db.prepare('SELECT * FROM departments WHERE id = ?').get(id);
  assert.equal(afterDelete, undefined);
});

test('POST /api/departments without a name returns 400', async () => {
  const cookie = await loginCookie();
  const res = await request(app).post('/api/departments').set('Cookie', cookie).send({});
  assert.equal(res.status, 400);
});

test('deleting a department SETs officials.department_id to NULL rather than deleting the official', async () => {
  const cookie = await loginCookie();

  const deptRes = await request(app)
    .post('/api/departments')
    .set('Cookie', cookie)
    .send({ name: 'Отдел за изтриване' });
  const deptId = deptRes.body.department.id;

  const offRes = await request(app)
    .post('/api/officials')
    .set('Cookie', cookie)
    .send({ name: 'Служител Х', department_id: deptId });
  const offId = offRes.body.official.id;

  const deleteRes = await request(app).delete(`/api/departments/${deptId}`).set('Cookie', cookie);
  assert.equal(deleteRes.status, 204);

  const official = db.prepare('SELECT * FROM officials WHERE id = ?').get(offId);
  assert.ok(official, 'official row should still exist');
  assert.equal(official.department_id, null);
});

// ---------------------------------------------------------------------------
// Officials CRUD + public filtering
// ---------------------------------------------------------------------------

test('admin can create, update, and delete an official; public GET only returns approved and supports department_id filter', async () => {
  const cookie = await loginCookie();

  const deptRes = await request(app)
    .post('/api/departments')
    .set('Cookie', cookie)
    .send({ name: 'Отдел за служители' });
  const deptId = deptRes.body.department.id;

  const pendingRes = await request(app)
    .post('/api/officials')
    .set('Cookie', cookie)
    .send({ name: 'Чакащ служител', department_id: deptId, position: 'Специалист' });
  const pendingId = pendingRes.body.official.id;

  const approvedRes = await request(app)
    .post('/api/officials')
    .set('Cookie', cookie)
    .send({ name: 'Одобрен служител', department_id: deptId, email: 'a@example.com' });
  const approvedId = approvedRes.body.official.id;
  approve('officials', approvedId);

  const publicRes = await request(app).get(`/api/officials?department_id=${deptId}`);
  assert.equal(publicRes.status, 200);
  const ids = publicRes.body.officials.map((o) => o.id);
  assert.ok(ids.includes(approvedId));
  assert.ok(!ids.includes(pendingId));

  const updateRes = await request(app)
    .put(`/api/officials/${approvedId}`)
    .set('Cookie', cookie)
    .send({ phone: '0971/00 000' });
  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.body.official.phone, '0971/00 000');

  const deleteRes = await request(app)
    .delete(`/api/officials/${approvedId}`)
    .set('Cookie', cookie);
  assert.equal(deleteRes.status, 204);
});

test('DELETE /api/officials/:id also deletes its attachments (rows + files)', async () => {
  const cookie = await loginCookie();

  const offRes = await request(app)
    .post('/api/officials')
    .set('Cookie', cookie)
    .send({ name: 'Служител с прикачени файлове' });
  const offId = offRes.body.official.id;

  const attachRes = await request(app)
    .post('/api/attachments')
    .set('Cookie', cookie)
    .send({ entity_type: 'official', entity_id: offId, url: 'https://example.com/cv.pdf' });
  assert.equal(attachRes.status, 201);
  const attachmentId = attachRes.body.attachment.id;

  const deleteRes = await request(app).delete(`/api/officials/${offId}`).set('Cookie', cookie);
  assert.equal(deleteRes.status, 204);

  const remaining = db.prepare('SELECT * FROM attachments WHERE id = ?').get(attachmentId);
  assert.equal(remaining, undefined);
});

test('POST /api/officials without a name returns 400', async () => {
  const cookie = await loginCookie();
  const res = await request(app).post('/api/officials').set('Cookie', cookie).send({});
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// Council members CRUD + embedded memberships
// ---------------------------------------------------------------------------

test('admin can create, update, and delete a council member; public GET only returns approved', async () => {
  const cookie = await loginCookie();

  const pendingRes = await request(app)
    .post('/api/council-members')
    .set('Cookie', cookie)
    .send({ name: 'Чакащ съветник', party: 'Тест партия' });
  const pendingId = pendingRes.body.council_member.id;

  const approvedRes = await request(app)
    .post('/api/council-members')
    .set('Cookie', cookie)
    .send({ name: 'Одобрен съветник', party: 'Тест партия' });
  const approvedId = approvedRes.body.council_member.id;
  approve('council_members', approvedId);

  const publicRes = await request(app).get('/api/council-members');
  assert.equal(publicRes.status, 200);
  const ids = publicRes.body.council_members.map((m) => m.id);
  assert.ok(ids.includes(approvedId));
  assert.ok(!ids.includes(pendingId));

  const updateRes = await request(app)
    .put(`/api/council-members/${approvedId}`)
    .set('Cookie', cookie)
    .send({ party: 'Нова партия' });
  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.body.council_member.party, 'Нова партия');

  const deleteRes = await request(app)
    .delete(`/api/council-members/${pendingId}`)
    .set('Cookie', cookie);
  assert.equal(deleteRes.status, 204);
});

test('POST /api/council-members without a name returns 400', async () => {
  const cookie = await loginCookie();
  const res = await request(app).post('/api/council-members').set('Cookie', cookie).send({});
  assert.equal(res.status, 400);
});

test('GET /api/council-members embeds committee memberships, and only for approved committees', async () => {
  const cookie = await loginCookie();

  const memberRes = await request(app)
    .post('/api/council-members')
    .set('Cookie', cookie)
    .send({ name: 'Съветник С Комисии' });
  const memberId = memberRes.body.council_member.id;
  approve('council_members', memberId);

  const approvedCommitteeRes = await request(app)
    .post('/api/committees')
    .set('Cookie', cookie)
    .send({ name: 'Одобрена комисия' });
  const approvedCommitteeId = approvedCommitteeRes.body.committee.id;
  approve('committees', approvedCommitteeId);

  const pendingCommitteeRes = await request(app)
    .post('/api/committees')
    .set('Cookie', cookie)
    .send({ name: 'Чакаща комисия' });
  const pendingCommitteeId = pendingCommitteeRes.body.committee.id;
  // left pending on purpose

  await request(app)
    .post('/api/committee-memberships')
    .set('Cookie', cookie)
    .send({ council_member_id: memberId, committee_id: approvedCommitteeId, role: 'Председател' });
  await request(app)
    .post('/api/committee-memberships')
    .set('Cookie', cookie)
    .send({ council_member_id: memberId, committee_id: pendingCommitteeId });

  const publicRes = await request(app).get('/api/council-members');
  const publicMember = publicRes.body.council_members.find((m) => m.id === memberId);
  assert.ok(publicMember);
  assert.equal(publicMember.committee_memberships.length, 1);
  assert.equal(publicMember.committee_memberships[0].committee_name, 'Одобрена комисия');
  assert.equal(publicMember.committee_memberships[0].role, 'Председател');

  const adminRes = await request(app)
    .get('/api/admin/council-members?status=approved')
    .set('Cookie', cookie);
  const adminMember = adminRes.body.council_members.find((m) => m.id === memberId);
  assert.ok(adminMember);
  assert.equal(
    adminMember.committee_memberships.length,
    2,
    'admin view should include memberships in unapproved committees too'
  );
});

// ---------------------------------------------------------------------------
// Committees CRUD + UNIQUE(name) -> 409
// ---------------------------------------------------------------------------

test('creating two committees with the same name returns 409 with a clear message', async () => {
  const cookie = await loginCookie();

  const first = await request(app)
    .post('/api/committees')
    .set('Cookie', cookie)
    .send({ name: 'Дублираща комисия' });
  assert.equal(first.status, 201);

  const second = await request(app)
    .post('/api/committees')
    .set('Cookie', cookie)
    .send({ name: 'Дублираща комисия' });
  assert.equal(second.status, 409);
  assert.equal(second.body.error, 'duplicate_committee');
  assert.ok(second.body.message);
});

test('PUT/DELETE on a non-existent committee returns 404', async () => {
  const cookie = await loginCookie();

  const putRes = await request(app)
    .put('/api/committees/999999')
    .set('Cookie', cookie)
    .send({ name: 'Не съществува' });
  assert.equal(putRes.status, 404);

  const deleteRes = await request(app).delete('/api/committees/999999').set('Cookie', cookie);
  assert.equal(deleteRes.status, 404);
});

// ---------------------------------------------------------------------------
// Committee memberships: UNIQUE constraint -> 409, and cascade delete
// ---------------------------------------------------------------------------

test('committee_memberships UNIQUE(council_member_id, committee_id) violation returns 409', async () => {
  const cookie = await loginCookie();

  const memberRes = await request(app)
    .post('/api/council-members')
    .set('Cookie', cookie)
    .send({ name: 'Съветник За Уникалност' });
  const memberId = memberRes.body.council_member.id;

  const committeeRes = await request(app)
    .post('/api/committees')
    .set('Cookie', cookie)
    .send({ name: 'Комисия За Уникалност' });
  const committeeId = committeeRes.body.committee.id;

  const first = await request(app)
    .post('/api/committee-memberships')
    .set('Cookie', cookie)
    .send({ council_member_id: memberId, committee_id: committeeId, role: 'Член' });
  assert.equal(first.status, 201);

  const second = await request(app)
    .post('/api/committee-memberships')
    .set('Cookie', cookie)
    .send({ council_member_id: memberId, committee_id: committeeId, role: 'Друга роля' });
  assert.equal(second.status, 409);
  assert.equal(second.body.error, 'duplicate_membership');
});

test('POST /api/committee-memberships with an invalid council_member_id or committee_id returns 400', async () => {
  const cookie = await loginCookie();

  const committeeRes = await request(app)
    .post('/api/committees')
    .set('Cookie', cookie)
    .send({ name: 'Комисия За Валидация' });
  const committeeId = committeeRes.body.committee.id;

  const badMember = await request(app)
    .post('/api/committee-memberships')
    .set('Cookie', cookie)
    .send({ council_member_id: 999999, committee_id: committeeId });
  assert.equal(badMember.status, 400);

  const memberRes = await request(app)
    .post('/api/council-members')
    .set('Cookie', cookie)
    .send({ name: 'Съветник За Валидация' });
  const memberId = memberRes.body.council_member.id;

  const badCommittee = await request(app)
    .post('/api/committee-memberships')
    .set('Cookie', cookie)
    .send({ council_member_id: memberId, committee_id: 999999 });
  assert.equal(badCommittee.status, 400);

  const missingFields = await request(app)
    .post('/api/committee-memberships')
    .set('Cookie', cookie)
    .send({});
  assert.equal(missingFields.status, 400);
});

test('deleting a council_member cascades and removes their committee memberships', async () => {
  const cookie = await loginCookie();

  const memberRes = await request(app)
    .post('/api/council-members')
    .set('Cookie', cookie)
    .send({ name: 'Съветник За Каскадно Изтриване' });
  const memberId = memberRes.body.council_member.id;

  const committeeRes = await request(app)
    .post('/api/committees')
    .set('Cookie', cookie)
    .send({ name: 'Комисия За Каскадно Изтриване' });
  const committeeId = committeeRes.body.committee.id;

  const membershipRes = await request(app)
    .post('/api/committee-memberships')
    .set('Cookie', cookie)
    .send({ council_member_id: memberId, committee_id: committeeId });
  const membershipId = membershipRes.body.membership.id;

  const deleteRes = await request(app)
    .delete(`/api/council-members/${memberId}`)
    .set('Cookie', cookie);
  assert.equal(deleteRes.status, 204);

  const remainingMembership = db
    .prepare('SELECT * FROM committee_memberships WHERE id = ?')
    .get(membershipId);
  assert.equal(remainingMembership, undefined, 'membership should be cascade-deleted');
});

test('deleting a committee cascades and removes its committee memberships', async () => {
  const cookie = await loginCookie();

  const memberRes = await request(app)
    .post('/api/council-members')
    .set('Cookie', cookie)
    .send({ name: 'Съветник Б За Каскада' });
  const memberId = memberRes.body.council_member.id;

  const committeeRes = await request(app)
    .post('/api/committees')
    .set('Cookie', cookie)
    .send({ name: 'Комисия За Изтриване Каскадно' });
  const committeeId = committeeRes.body.committee.id;

  const membershipRes = await request(app)
    .post('/api/committee-memberships')
    .set('Cookie', cookie)
    .send({ council_member_id: memberId, committee_id: committeeId });
  const membershipId = membershipRes.body.membership.id;

  const deleteRes = await request(app)
    .delete(`/api/committees/${committeeId}`)
    .set('Cookie', cookie);
  assert.equal(deleteRes.status, 204);

  const remainingMembership = db
    .prepare('SELECT * FROM committee_memberships WHERE id = ?')
    .get(membershipId);
  assert.equal(remainingMembership, undefined, 'membership should be cascade-deleted');
});

test('DELETE /api/committee-memberships/:id removes a single membership without touching the council member or committee', async () => {
  const cookie = await loginCookie();

  const memberRes = await request(app)
    .post('/api/council-members')
    .set('Cookie', cookie)
    .send({ name: 'Съветник За Единично Премахване' });
  const memberId = memberRes.body.council_member.id;

  const committeeRes = await request(app)
    .post('/api/committees')
    .set('Cookie', cookie)
    .send({ name: 'Комисия За Единично Премахване' });
  const committeeId = committeeRes.body.committee.id;

  const membershipRes = await request(app)
    .post('/api/committee-memberships')
    .set('Cookie', cookie)
    .send({ council_member_id: memberId, committee_id: committeeId });
  const membershipId = membershipRes.body.membership.id;

  const deleteRes = await request(app)
    .delete(`/api/committee-memberships/${membershipId}`)
    .set('Cookie', cookie);
  assert.equal(deleteRes.status, 204);

  assert.ok(db.prepare('SELECT * FROM council_members WHERE id = ?').get(memberId));
  assert.ok(db.prepare('SELECT * FROM committees WHERE id = ?').get(committeeId));

  const notFoundRes = await request(app)
    .delete(`/api/committee-memberships/${membershipId}`)
    .set('Cookie', cookie);
  assert.equal(notFoundRes.status, 404);
});

// ---------------------------------------------------------------------------
// review workflow (approve/reject via the shared registry)
// ---------------------------------------------------------------------------

test('a pending department can be approved via POST /api/review/departments/:id/approve and then appears publicly', async () => {
  const cookie = await loginCookie();

  const createRes = await request(app)
    .post('/api/departments')
    .set('Cookie', cookie)
    .send({ name: 'Отдел За Преглед' });
  const id = createRes.body.department.id;

  const beforeRes = await request(app).get('/api/departments');
  assert.ok(!beforeRes.body.departments.some((d) => d.id === id));

  const approveRes = await request(app)
    .post(`/api/review/departments/${id}/approve`)
    .set('Cookie', cookie);
  assert.equal(approveRes.status, 200);
  assert.equal(approveRes.body.item.review_status, 'approved');

  const afterRes = await request(app).get('/api/departments');
  assert.ok(afterRes.body.departments.some((d) => d.id === id));
});
