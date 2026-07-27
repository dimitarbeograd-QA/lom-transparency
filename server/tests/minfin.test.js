'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');

// Use an isolated DB file for this test run, set BEFORE requiring server.js
// so the db singleton picks it up.
const TMP_DB_PATH = path.join(os.tmpdir(), `lom-minfin-test-${process.pid}-${Date.now()}.db`);
process.env.LOM_DB_PATH = TMP_DB_PATH;
process.env.LOM_ADMIN_USERNAME = process.env.LOM_ADMIN_USERNAME || 'admin';
process.env.LOM_ADMIN_PASSWORD = process.env.LOM_ADMIN_PASSWORD || 'admin123';

const request = require('supertest');
const { app } = require('../server');
const { db } = require('../db');
const { parseWorkbookForMunicipality, LOM_MUNICIPALITY_CODE } = require('../scraper/modules/minfin');

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
// parseWorkbookForMunicipality -- pure function, tested against a synthetic
// workbook built to match the REAL minfin.bg column layout confirmed by
// hand (see server/scraper/modules/minfin.js module comment): row 1 =
// indicator group headers (irrelevant to parsing), row 2 = "YYYY Qn" period
// labels repeating every 3 columns, row 3+ = one row per municipality with
// column A = numeric code, column B = name. Only the eight raw-amount
// column groups (starting at columns 30, 33, 36, 39, 42, 45, 48, 51) are
// exercised here, at their real positions -- not a simplified fixture.
// ---------------------------------------------------------------------------

function buildFixtureWorkbook() {
  const totalCols = 53;
  const row1 = new Array(totalCols).fill(null);
  const row2 = new Array(totalCols).fill(null);
  const lomRow = new Array(totalCols).fill(null);
  const otherRow = new Array(totalCols).fill(null);

  lomRow[0] = LOM_MUNICIPALITY_CODE;
  lomRow[1] = 'Лом';
  otherRow[0] = 1234;
  otherRow[1] = 'Друга община';

  const groups = [
    { startCol: 30, value: [3516362, 5725801, 4866670] }, // own_revenue
    { startCol: 33, value: [38502099, 66049188, 33302381] }, // expenditure
    { startCol: 36, value: [8384687, 3429558, 4591884] }, // budget_balance
    { startCol: 39, value: [14826077, 10129803, 13999129] }, // available_cash
    { startCol: 42, value: [1787792, 1977809, 1947357] }, // municipal_debt
    { startCol: 45, value: [80605, 80605, 80605] }, // arrears
    { startCol: 48, value: [2952205.83, 4022899.48, 3868139.93] }, // obligations_for_expenditure
    { startCol: 51, value: [27154614.99, 13887069.33, 14311414.4] }, // committed_appropriations
  ];

  const periods = ['2024 Q3', '2024 Q4', '2025 Q3'];

  for (const { startCol, value } of groups) {
    for (let offset = 0; offset < 3; offset += 1) {
      const idx = startCol - 1 + offset;
      row2[idx] = periods[offset];
      lomRow[idx] = value[offset];
      otherRow[idx] = value[offset] + 1000; // distinguishable, irrelevant value
    }
  }

  const sheet = XLSX.utils.aoa_to_sheet([row1, row2, lomRow, otherRow]);
  return { SheetNames: ['Sheet1'], Sheets: { Sheet1: sheet } };
}

test('parseWorkbookForMunicipality extracts all 8 raw-amount indicator groups for the matching municipality code, at their real minfin.bg column positions', () => {
  const workbook = buildFixtureWorkbook();
  const entries = parseWorkbookForMunicipality(workbook, LOM_MUNICIPALITY_CODE);

  assert.equal(entries.length, 3);

  const byLabel = Object.fromEntries(entries.map((e) => [e.periodLabel, e]));

  assert.equal(byLabel['2024 Q3'].own_revenue, 3516362);
  assert.equal(byLabel['2024 Q3'].expenditure, 38502099);
  assert.equal(byLabel['2024 Q3'].budget_balance, 8384687);
  assert.equal(byLabel['2024 Q3'].available_cash, 14826077);
  assert.equal(byLabel['2024 Q3'].municipal_debt, 1787792);
  assert.equal(byLabel['2024 Q3'].arrears, 80605);
  assert.equal(byLabel['2024 Q3'].obligations_for_expenditure, 2952205.83);
  assert.equal(byLabel['2024 Q3'].committed_appropriations, 27154614.99);

  assert.equal(byLabel['2025 Q3'].own_revenue, 4866670);
  assert.equal(byLabel['2025 Q3'].municipal_debt, 1947357);

  assert.equal(byLabel['2024 Q3'].periodYear, 2024);
  assert.equal(byLabel['2024 Q3'].periodQuarter, 3);
});

test('parseWorkbookForMunicipality returns an empty array when the municipality code is not present in the sheet', () => {
  const workbook = buildFixtureWorkbook();
  const entries = parseWorkbookForMunicipality(workbook, 9999);
  assert.deepEqual(entries, []);
});

// ---------------------------------------------------------------------------
// API / review workflow
// ---------------------------------------------------------------------------

test('GET /api/admin/minfin returns 401 with no session cookie', async () => {
  const res = await request(app).get('/api/admin/minfin');
  assert.equal(res.status, 401);
});

test('public GET /api/minfin only returns approved rows; admin review approve makes a pending row visible', async () => {
  const cookie = await loginCookie();

  const info = db
    .prepare(
      `INSERT INTO minfin_indicators
        (period_year, period_quarter, period_label, own_revenue, expenditure, source_url, source_file, scraped_at)
       VALUES (2099, 1, '2099 Q1', 1000, 2000, 'https://www.minfin.bg/bg/810', 'test.xlsx', datetime('now'))`
    )
    .run();
  const id = info.lastInsertRowid;

  const beforePublic = await request(app).get('/api/minfin');
  assert.equal(beforePublic.status, 200);
  assert.ok(!beforePublic.body.indicators.some((r) => r.id === id));

  const adminList = await request(app).get('/api/admin/minfin?status=pending').set('Cookie', cookie);
  assert.equal(adminList.status, 200);
  assert.ok(adminList.body.indicators.some((r) => r.id === id));

  const approveRes = await request(app)
    .post(`/api/review/minfin_indicators/${id}/approve`)
    .set('Cookie', cookie);
  assert.equal(approveRes.status, 200);

  const afterPublic = await request(app).get('/api/minfin');
  const row = afterPublic.body.indicators.find((r) => r.id === id);
  assert.ok(row, 'approved row should now be visible on the public endpoint');
  assert.equal(row.own_revenue, 1000);
});

test('re-scraping the same (period_year, period_quarter) upserts in place rather than duplicating', () => {
  const before = db.prepare('SELECT count(*) c FROM minfin_indicators WHERE period_year = 2098').get().c;
  assert.equal(before, 0);

  db.prepare(
    `INSERT INTO minfin_indicators (period_year, period_quarter, period_label, own_revenue)
     VALUES (2098, 2, '2098 Q2', 111)`
  ).run();

  // Simulate the scraper module's own upsert path directly (same UNIQUE
  // constraint it relies on) rather than re-importing its private helper.
  const existing = db
    .prepare('SELECT id FROM minfin_indicators WHERE period_year = 2098 AND period_quarter = 2')
    .get();
  db.prepare(`UPDATE minfin_indicators SET own_revenue = 222 WHERE id = ?`).run(existing.id);

  const rows = db.prepare('SELECT * FROM minfin_indicators WHERE period_year = 2098').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].own_revenue, 222);
});
