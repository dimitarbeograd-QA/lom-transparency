'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const test = require('node:test');
const assert = require('node:assert/strict');

const TMP_DB_PATH = path.join(os.tmpdir(), `lom-search-test-${process.pid}-${Date.now()}.db`);
process.env.LOM_DB_PATH = TMP_DB_PATH;
process.env.LOM_ADMIN_USERNAME = process.env.LOM_ADMIN_USERNAME || 'admin';
process.env.LOM_ADMIN_PASSWORD = process.env.LOM_ADMIN_PASSWORD || 'admin123';

const request = require('supertest');
const { app } = require('../server');
const { db } = require('../db');

function cleanupDbFiles() {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TMP_DB_PATH + suffix;
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
      } catch (err) {
        // Windows sidecar file lock -- non-fatal.
      }
    }
  }
}

test.after(() => {
  cleanupDbFiles();
});

test('GET /api/search with a query under 2 chars returns an empty groups array without querying', async () => {
  const res = await request(app).get('/api/search?q=a');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.groups, []);
});

test('GET /api/search finds an approved project by title and only approved rows', async () => {
  db.prepare(
    `INSERT INTO projects (name, category, status, review_status) VALUES (?, 'Бюджет', 'completed', 'approved')`
  ).run('Тестов проект за търсене XYZ');
  db.prepare(
    `INSERT INTO projects (name, category, status, review_status) VALUES (?, 'Бюджет', 'completed', 'pending')`
  ).run('Тестов проект за търсене XYZ чакащ');

  const res = await request(app).get('/api/search?q=' + encodeURIComponent('търсене XYZ'));
  assert.equal(res.status, 200);

  const budgetGroup = res.body.groups.find((g) => g.label === 'Бюджет');
  assert.ok(budgetGroup, 'expected a Бюджет group in the results');
  assert.equal(budgetGroup.items.length, 1);
  assert.equal(budgetGroup.items[0].title, 'Тестов проект за търсене XYZ');
  assert.ok(budgetGroup.items[0].href.includes('/budget/project.html?id='));
});

test('GET /api/search groups results from multiple sources under the request', async () => {
  db.prepare(
    `INSERT INTO ordinances (title, status, review_status) VALUES (?, 'active', 'approved')`
  ).run('Наредба за търсене XYZ');
  db.prepare(
    `INSERT INTO procurements (title, review_status) VALUES (?, 'approved')`
  ).run('Поръчка за търсене XYZ');

  const res = await request(app).get('/api/search?q=' + encodeURIComponent('търсене XYZ'));
  const labels = res.body.groups.map((g) => g.label).sort();
  assert.deepEqual(labels, ['Бюджет', 'Наредби', 'Обществени поръчки']);
});
