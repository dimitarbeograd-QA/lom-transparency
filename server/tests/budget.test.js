'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const test = require('node:test');
const assert = require('node:assert/strict');

const TMP_DB_PATH = path.join(
  os.tmpdir(),
  `lom-budget-test-${process.pid}-${Date.now()}.db`
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

// ---------------------------------------------------------------------------
// CRUD correctness
// ---------------------------------------------------------------------------

test('admin can create a project, which is immediately approved and visible publicly', async () => {
  const cookie = await loginCookie();

  const createRes = await request(app)
    .post('/api/projects')
    .set('Cookie', cookie)
    .send({ name: 'Ремонт на ул. Дунав', category: 'Инфраструктура', status: 'active' });

  assert.equal(createRes.status, 201);
  assert.equal(createRes.body.project.name, 'Ремонт на ул. Дунав');
  assert.equal(createRes.body.project.review_status, 'approved');
  assert.equal(createRes.body.project.allocated_total, 0);
  assert.equal(createRes.body.project.spent_total, 0);

  const projectId = createRes.body.project.id;

  const publicListRes = await request(app).get('/api/projects');
  assert.equal(publicListRes.status, 200);
  assert.ok(publicListRes.body.projects.some((p) => p.id === projectId));

  const publicDetailRes = await request(app).get(`/api/projects/${projectId}`);
  assert.equal(publicDetailRes.status, 200);
  assert.equal(publicDetailRes.body.project.id, projectId);
  assert.deepEqual(publicDetailRes.body.budget_lines, []);
  assert.deepEqual(publicDetailRes.body.expenditures, []);
});

test('admin can update and delete a project', async () => {
  const cookie = await loginCookie();

  const createRes = await request(app)
    .post('/api/projects')
    .set('Cookie', cookie)
    .send({ name: 'Обновяване на парк', category: 'Благоустройство' });
  const projectId = createRes.body.project.id;

  const updateRes = await request(app)
    .put(`/api/projects/${projectId}`)
    .set('Cookie', cookie)
    .send({ status: 'completed', description: 'Готово.' });

  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.body.project.status, 'completed');
  assert.equal(updateRes.body.project.description, 'Готово.');
  // review_status must not be disturbed by a plain edit
  assert.equal(updateRes.body.project.review_status, 'approved');

  const deleteRes = await request(app).delete(`/api/projects/${projectId}`).set('Cookie', cookie);
  assert.equal(deleteRes.status, 204);

  const afterDeleteRes = await request(app).get(`/api/projects/${projectId}`);
  assert.equal(afterDeleteRes.status, 404);
});

test('budget lines and expenditures CRUD, scoped to their parent project', async () => {
  const cookie = await loginCookie();

  const projectRes = await request(app)
    .post('/api/projects')
    .set('Cookie', cookie)
    .send({ name: 'Изграждане на детска площадка' });
  const projectId = projectRes.body.project.id;

  const blRes = await request(app)
    .post(`/api/projects/${projectId}/budget-lines`)
    .set('Cookie', cookie)
    .send({ year: 2025, funding_source: 'Общински бюджет', allocated_amount: 15000 });
  assert.equal(blRes.status, 201);
  assert.equal(blRes.body.budget_line.allocated_amount, 15000);
  const budgetLineId = blRes.body.budget_line.id;

  const blUpdateRes = await request(app)
    .put(`/api/budget-lines/${budgetLineId}`)
    .set('Cookie', cookie)
    .send({ allocated_amount: 18000 });
  assert.equal(blUpdateRes.status, 200);
  assert.equal(blUpdateRes.body.budget_line.allocated_amount, 18000);

  const expRes = await request(app)
    .post(`/api/projects/${projectId}/expenditures`)
    .set('Cookie', cookie)
    .send({ vendor_name: 'Строй ЕООД', amount: 5000, expenditure_date: '2025-03-01' });
  assert.equal(expRes.status, 201);
  const expenditureId = expRes.body.expenditure.id;

  const detailRes = await request(app).get(`/api/projects/${projectId}`);
  assert.equal(detailRes.body.budget_lines.length, 1);
  assert.equal(detailRes.body.expenditures.length, 1);
  assert.equal(detailRes.body.project.allocated_total, 18000);
  assert.equal(detailRes.body.project.spent_total, 5000);

  const blDeleteRes = await request(app)
    .delete(`/api/budget-lines/${budgetLineId}`)
    .set('Cookie', cookie);
  assert.equal(blDeleteRes.status, 204);

  const expDeleteRes = await request(app)
    .delete(`/api/expenditures/${expenditureId}`)
    .set('Cookie', cookie);
  assert.equal(expDeleteRes.status, 204);

  const detailAfterRes = await request(app).get(`/api/projects/${projectId}`);
  assert.equal(detailAfterRes.body.budget_lines.length, 0);
  assert.equal(detailAfterRes.body.expenditures.length, 0);
});

// ---------------------------------------------------------------------------
// Validation errors (400)
// ---------------------------------------------------------------------------

test('POST /api/projects with no name returns 400', async () => {
  const cookie = await loginCookie();
  const res = await request(app).post('/api/projects').set('Cookie', cookie).send({});
  assert.equal(res.status, 400);
});

test('POST /api/projects with an invalid status returns 400', async () => {
  const cookie = await loginCookie();
  const res = await request(app)
    .post('/api/projects')
    .set('Cookie', cookie)
    .send({ name: 'Тест', status: 'not-a-real-status' });
  assert.equal(res.status, 400);
});

test('negative allocated_amount / amount are rejected with 400', async () => {
  const cookie = await loginCookie();
  const projectRes = await request(app)
    .post('/api/projects')
    .set('Cookie', cookie)
    .send({ name: 'Проект за валидация' });
  const projectId = projectRes.body.project.id;

  const blRes = await request(app)
    .post(`/api/projects/${projectId}/budget-lines`)
    .set('Cookie', cookie)
    .send({ allocated_amount: -100 });
  assert.equal(blRes.status, 400);

  const expRes = await request(app)
    .post(`/api/projects/${projectId}/expenditures`)
    .set('Cookie', cookie)
    .send({ vendor_name: 'Доставчик', amount: -50 });
  assert.equal(expRes.status, 400);
});

test('POST expenditures with no vendor_name returns 400', async () => {
  const cookie = await loginCookie();
  const projectRes = await request(app)
    .post('/api/projects')
    .set('Cookie', cookie)
    .send({ name: 'Проект без доставчик' });
  const projectId = projectRes.body.project.id;

  const res = await request(app)
    .post(`/api/projects/${projectId}/expenditures`)
    .set('Cookie', cookie)
    .send({ amount: 10 });
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// 401 without a session cookie
// ---------------------------------------------------------------------------

test('every mutating budget route returns 401 with no session cookie', async () => {
  const routes = [
    ['post', '/api/projects'],
    ['put', '/api/projects/1'],
    ['delete', '/api/projects/1'],
    ['post', '/api/projects/1/budget-lines'],
    ['put', '/api/budget-lines/1'],
    ['delete', '/api/budget-lines/1'],
    ['post', '/api/projects/1/expenditures'],
    ['put', '/api/expenditures/1'],
    ['delete', '/api/expenditures/1'],
    ['get', '/api/admin/projects'],
    ['get', '/api/admin/projects/1'],
  ];

  for (const [method, url] of routes) {
    const res = await request(app)[method](url).send({});
    assert.equal(res.status, 401, `${method.toUpperCase()} ${url} should be 401 without a cookie`);
  }
});

// ---------------------------------------------------------------------------
// Public GET only returns approved rows
// ---------------------------------------------------------------------------

test('public endpoints only ever return review_status=approved rows', async () => {
  const cookie = await loginCookie();

  // Directly seed a pending project (simulating scraped content) alongside
  // an approved one created through the admin API.
  const pendingInfo = db
    .prepare(
      `INSERT INTO projects (name, category, status, review_status) VALUES (?, ?, 'active', 'pending')`
    )
    .run('Чакащ преглед проект', 'Тест');
  const pendingId = pendingInfo.lastInsertRowid;

  const approvedRes = await request(app)
    .post('/api/projects')
    .set('Cookie', cookie)
    .send({ name: 'Одобрен проект', category: 'Тест' });
  const approvedId = approvedRes.body.project.id;

  const listRes = await request(app).get('/api/projects?category=Тест');
  const ids = listRes.body.projects.map((p) => p.id);
  assert.ok(ids.includes(approvedId));
  assert.ok(!ids.includes(pendingId));

  const pendingDetailRes = await request(app).get(`/api/projects/${pendingId}`);
  assert.equal(pendingDetailRes.status, 404);

  // A pending budget_line/expenditure under an otherwise-approved project
  // must not appear in the public detail view either.
  await db
    .prepare(
      `INSERT INTO budget_lines (project_id, year, allocated_amount, review_status) VALUES (?, 2025, 999, 'pending')`
    )
    .run(approvedId);

  const detailRes = await request(app).get(`/api/projects/${approvedId}`);
  assert.equal(detailRes.body.budget_lines.length, 0);
  assert.equal(detailRes.body.project.allocated_total, 0);
});

// ---------------------------------------------------------------------------
// Cascade delete
// ---------------------------------------------------------------------------

test('deleting a project cascades to its budget lines, expenditures, and attachments', async () => {
  const cookie = await loginCookie();

  const projectRes = await request(app)
    .post('/api/projects')
    .set('Cookie', cookie)
    .send({ name: 'Проект за изтриване' });
  const projectId = projectRes.body.project.id;

  await request(app)
    .post(`/api/projects/${projectId}/budget-lines`)
    .set('Cookie', cookie)
    .send({ year: 2025, allocated_amount: 100 });
  await request(app)
    .post(`/api/projects/${projectId}/expenditures`)
    .set('Cookie', cookie)
    .send({ vendor_name: 'Доставчик X', amount: 50 });
  await request(app)
    .post('/api/attachments')
    .set('Cookie', cookie)
    .send({ entity_type: 'project', entity_id: projectId, url: 'https://lom.bg/doc.pdf' });

  const beforeBl = db.prepare('SELECT COUNT(*) AS c FROM budget_lines WHERE project_id = ?').get(projectId).c;
  const beforeExp = db.prepare('SELECT COUNT(*) AS c FROM expenditures WHERE project_id = ?').get(projectId).c;
  const beforeAtt = db
    .prepare("SELECT COUNT(*) AS c FROM attachments WHERE entity_type = 'project' AND entity_id = ?")
    .get(projectId).c;
  assert.equal(beforeBl, 1);
  assert.equal(beforeExp, 1);
  assert.equal(beforeAtt, 1);

  const deleteRes = await request(app).delete(`/api/projects/${projectId}`).set('Cookie', cookie);
  assert.equal(deleteRes.status, 204);

  const afterBl = db.prepare('SELECT COUNT(*) AS c FROM budget_lines WHERE project_id = ?').get(projectId).c;
  const afterExp = db.prepare('SELECT COUNT(*) AS c FROM expenditures WHERE project_id = ?').get(projectId).c;
  const afterAtt = db
    .prepare("SELECT COUNT(*) AS c FROM attachments WHERE entity_type = 'project' AND entity_id = ?")
    .get(projectId).c;
  assert.equal(afterBl, 0, 'budget_lines should cascade-delete');
  assert.equal(afterExp, 0, 'expenditures should cascade-delete');
  assert.equal(afterAtt, 0, 'attachments should be cleaned up manually');
});

// ---------------------------------------------------------------------------
// Dashboard aggregation math, against known seeded numbers
// ---------------------------------------------------------------------------

test('GET /api/dashboard/budget aggregates allocated vs spent by category and year, approved-only', async () => {
  const cookie = await loginCookie();

  // Project A: category "Инфраструктура", budget lines in 2024 and 2025.
  const projA = (
    await request(app)
      .post('/api/projects')
      .set('Cookie', cookie)
      .send({ name: 'Дашборд проект А', category: 'Инфраструктура-ДБ' })
  ).body.project;

  await request(app)
    .post(`/api/projects/${projA.id}/budget-lines`)
    .set('Cookie', cookie)
    .send({ year: 2024, allocated_amount: 1000 });
  await request(app)
    .post(`/api/projects/${projA.id}/budget-lines`)
    .set('Cookie', cookie)
    .send({ year: 2025, allocated_amount: 2000 });
  await request(app)
    .post(`/api/projects/${projA.id}/expenditures`)
    .set('Cookie', cookie)
    .send({ vendor_name: 'V1', amount: 400, expenditure_date: '2024-05-01' });

  // Project B: category "Образование-ДБ", budget line in 2025 only.
  const projB = (
    await request(app)
      .post('/api/projects')
      .set('Cookie', cookie)
      .send({ name: 'Дашборд проект Б', category: 'Образование-ДБ' })
  ).body.project;

  await request(app)
    .post(`/api/projects/${projB.id}/budget-lines`)
    .set('Cookie', cookie)
    .send({ year: 2025, allocated_amount: 500 });
  await request(app)
    .post(`/api/projects/${projB.id}/expenditures`)
    .set('Cookie', cookie)
    .send({ vendor_name: 'V2', amount: 250, expenditure_date: '2025-01-15' });

  // Project C: a PENDING project -- must be entirely excluded from the
  // dashboard even though it has "approved" child rows.
  const projCInfo = db
    .prepare(`INSERT INTO projects (name, category, review_status) VALUES (?, ?, 'pending')`)
    .run('Дашборд проект В (чакащ)', 'Инфраструктура-ДБ');
  db.prepare(
    `INSERT INTO budget_lines (project_id, year, allocated_amount, review_status) VALUES (?, 2024, 99999, 'approved')`
  ).run(projCInfo.lastInsertRowid);

  // A pending budget_line under the otherwise-approved Project A -- must be
  // excluded too.
  await db
    .prepare(
      `INSERT INTO budget_lines (project_id, year, allocated_amount, review_status) VALUES (?, 2024, 77777, 'pending')`
    )
    .run(projA.id);

  const res = await request(app).get('/api/dashboard/budget');
  assert.equal(res.status, 200);

  const catA = res.body.by_category.find((c) => c.category === 'Инфраструктура-ДБ');
  const catB = res.body.by_category.find((c) => c.category === 'Образование-ДБ');
  assert.ok(catA, 'expected Инфраструктура-ДБ bucket');
  assert.ok(catB, 'expected Образование-ДБ bucket');
  assert.equal(catA.allocated_total, 3000); // 1000 + 2000, excludes pending 77777/99999
  assert.equal(catA.spent_total, 400);
  assert.equal(catB.allocated_total, 500);
  assert.equal(catB.spent_total, 250);

  const year2024 = res.body.by_year.find((y) => y.year === 2024);
  const year2025 = res.body.by_year.find((y) => y.year === 2025);
  assert.ok(year2024);
  assert.ok(year2025);
  assert.equal(year2024.allocated_total, 1000);
  assert.equal(year2024.spent_total, 400);
  assert.equal(year2025.allocated_total, 2500); // 2000 (A) + 500 (B)
  assert.equal(year2025.spent_total, 250);

  assert.ok(res.body.overall.allocated_total >= 3500);
  assert.ok(res.body.overall.spent_total >= 650);
});
