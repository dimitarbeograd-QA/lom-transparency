'use strict';

// Scraper module for "Финансови показатели на общините" (Ministry of
// Finance quarterly municipal finance indicators), specifically for
// Община Лом.
//
// ---------------------------------------------------------------------------
// Real-site investigation notes (2026-07-27)
// ---------------------------------------------------------------------------
// https://www.minfin.bg/bg/810 is a real, official page that publishes one
// xlsx file per quarter (filename pattern
// "quarterly-reports-Q<a><yearA>-Q<b><yearB>-Q<c><yearC>-website.xlsx"),
// each with one row per Bulgarian municipality (274 rows) covering THREE
// period columns per indicator: the current quarter, the same quarter a
// year prior, and the previous quarter -- confirmed by hand by downloading
// and parsing a real file. Община Лом is present at municipality code 6207.
//
// Columns confirmed present (row 1 = indicator group headers spanning 3
// merged columns each, row 2 = the three actual period labels e.g.
// "2025 Q3", row 3+ = one row per municipality, column A = numeric
// municipality code, column B = municipality name): eight indicator groups
// carry RAW LEVA AMOUNTS (own revenue, expenditure, budget balance,
// available cash, municipal debt, arrears, obligations for expenditure,
// committed appropriations) -- these are what this module extracts. The
// file also has several ratio/percentage indicator groups (revenue share,
// expenditure coverage, debt-to-revenue ratio, staff/population ratios, tax
// collection rates, etc.) that this module deliberately does NOT extract:
// their column grouping is less consistent across quarters (some indicator
// groups reuse "(по план)"/"(по отчет)" labels inconsistently across their
// three sub-columns) and mapping them with confidence would mean guessing
// at semantics rather than reading a clearly-labeled raw figure -- honest
// scope limit, consistent with every other module in this project.
//
// Deliberate scope limits (documented rather than silently guessed at):
//   - Cloudflare: minfin.bg sits behind a Cloudflare "managed challenge"
//     that a plain HTTP fetch (and even a stock Playwright browser, headed
//     or headless, real Chrome channel or not) never gets past -- confirmed
//     by hand, the challenge page's own "Verifying..." spinner simply never
//     resolves for a CDP-automated browser. `patchright` (a Playwright fork
//     that patches the specific CDP leaks Cloudflare fingerprints) DOES get
//     through, but only in HEADED mode with its own bundled Chromium build
//     (not headless, not the `channel: 'chrome'` option) -- also confirmed
//     by hand. That means this module can only run somewhere with an
//     interactive desktop session (e.g. a scheduled task configured "Run
//     only when user is logged on"), not on a headless CI runner. This is
//     the one module in the project that cannot run in GitHub Actions.
//   - Only the eight raw-amount indicator groups are captured (see above);
//     the percentage/ratio indicator groups are left out entirely rather
//     than mis-mapped.
//   - Every row is idempotent-but-refreshable on UNIQUE(period_year,
//     period_quarter): re-running `npm run sync` upserts (never
//     duplicates), because minfin.bg's own files revise prior periods'
//     figures as later, more complete data comes in -- unlike the other
//     modules' scraped content, there's no free-text admin-fill-in field
//     here to protect, so an upsert is safe and correct, not destructive.
//     The `review_status`/`reviewed_by`/`reviewed_at` of an already-
//     approved row is left untouched on refresh (only a first-ever insert
//     starts as 'pending').

const path = require('path');
const os = require('os');
const fs = require('fs');
const XLSX = require('xlsx');
const { db } = require('../../db');

const LISTING_URL = 'https://www.minfin.bg/bg/810';
const LOM_MUNICIPALITY_CODE = 6207;

// Column groups confirmed by hand against a real downloaded file (1-based
// spreadsheet column numbers, each spanning 3 period sub-columns):
const RAW_AMOUNT_COLUMN_GROUPS = [
  { field: 'own_revenue', startCol: 30 },
  { field: 'expenditure', startCol: 33 },
  { field: 'budget_balance', startCol: 36 },
  { field: 'available_cash', startCol: 39 },
  { field: 'municipal_debt', startCol: 42 },
  { field: 'arrears', startCol: 45 },
  { field: 'obligations_for_expenditure', startCol: 48 },
  { field: 'committed_appropriations', startCol: 51 },
];

const QUARTERLY_FILE_RE = /quarterly-reports.*\.xlsx$/i;
// Matches a "YYYY Qn" period label, e.g. "2025 Q3".
const PERIOD_LABEL_RE = /^(\d{4})\s*Q([1-4])$/;

/**
 * Parse an already-loaded xlsx workbook's first sheet into per-period
 * indicator rows for a single municipality code. Pure function of the
 * parsed workbook -- safe to unit test against a saved fixture without any
 * network access.
 */
function parseWorkbookForMunicipality(workbook, municipalityCode) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });

  const periodHeaderRow = rows[1] || [];
  const municipalityRow = rows.slice(2).find((r) => Number(r[0]) === municipalityCode);
  if (!municipalityRow) return [];

  // Each raw-amount group spans 3 columns; read the period label from row 2
  // at the same column so we don't assume a fixed period order across files.
  const results = [];
  for (const { field, startCol } of RAW_AMOUNT_COLUMN_GROUPS) {
    for (let offset = 0; offset < 3; offset += 1) {
      const colIndex = startCol - 1 + offset; // 0-based for array access
      const label = String(periodHeaderRow[colIndex] || '').trim();
      const m = PERIOD_LABEL_RE.exec(label);
      if (!m) continue;

      const periodYear = Number(m[1]);
      const periodQuarter = Number(m[2]);
      const value = municipalityRow[colIndex];
      if (value === null || value === undefined || value === '') continue;

      let entry = results.find((r) => r.periodYear === periodYear && r.periodQuarter === periodQuarter);
      if (!entry) {
        entry = {
          periodYear,
          periodQuarter,
          periodLabel: `${periodYear} Q${periodQuarter}`,
        };
        results.push(entry);
      }
      entry[field] = Number(value);
    }
  }

  return results;
}

function upsertIndicatorRow(entry, sourceUrl, sourceFile) {
  const scrapedAt = new Date().toISOString();
  const existing = db
    .prepare('SELECT id FROM minfin_indicators WHERE period_year = ? AND period_quarter = ?')
    .get(entry.periodYear, entry.periodQuarter);

  if (existing) {
    db.prepare(
      `UPDATE minfin_indicators SET
         period_label = ?, own_revenue = ?, expenditure = ?, budget_balance = ?,
         available_cash = ?, municipal_debt = ?, arrears = ?,
         obligations_for_expenditure = ?, committed_appropriations = ?,
         source_url = ?, source_file = ?, scraped_at = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      entry.periodLabel,
      entry.own_revenue ?? null,
      entry.expenditure ?? null,
      entry.budget_balance ?? null,
      entry.available_cash ?? null,
      entry.municipal_debt ?? null,
      entry.arrears ?? null,
      entry.obligations_for_expenditure ?? null,
      entry.committed_appropriations ?? null,
      sourceUrl,
      sourceFile,
      scrapedAt,
      existing.id
    );
    return 'updated';
  }

  db.prepare(
    `INSERT INTO minfin_indicators
      (period_year, period_quarter, period_label, own_revenue, expenditure,
       budget_balance, available_cash, municipal_debt, arrears,
       obligations_for_expenditure, committed_appropriations,
       source_url, source_file, scraped_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.periodYear,
    entry.periodQuarter,
    entry.periodLabel,
    entry.own_revenue ?? null,
    entry.expenditure ?? null,
    entry.budget_balance ?? null,
    entry.available_cash ?? null,
    entry.municipal_debt ?? null,
    entry.arrears ?? null,
    entry.obligations_for_expenditure ?? null,
    entry.committed_appropriations ?? null,
    sourceUrl,
    sourceFile,
    scrapedAt
  );
  return 'inserted';
}

/**
 * Fetch the most recent quarterly xlsx via a headed, patched-Chromium
 * browser (see module notes above for why). Returns the local temp file
 * path plus the real page URL the file was found on.
 */
async function downloadLatestQuarterlyFile() {
  const { chromium } = require('patchright');
  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(LISTING_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // The Cloudflare "Verifying..." interstitial resolves asynchronously
    // (title passes through an intermediate "Loading <url>" state before the
    // real page renders) -- wait for an actual xlsx link to show up in the
    // DOM rather than sniffing the title, which is more robust to that
    // intermediate state.
    await page.waitForSelector('a[href$=".xlsx"], a[href*=".xlsx"]', { timeout: 25000 });

    const href = await page.evaluate((pattern) => {
      const re = new RegExp(pattern, 'i');
      const link = Array.from(document.querySelectorAll('a')).find((a) =>
        re.test(a.getAttribute('href') || '')
      );
      return link ? link.getAttribute('href') : null;
    }, QUARTERLY_FILE_RE.source);

    if (!href) {
      throw new Error('no quarterly xlsx link found on listing page');
    }

    const fileUrl = new URL(href, LISTING_URL).toString();

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.evaluate((url) => {
        const a = document.createElement('a');
        a.href = url;
        a.download = '';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, fileUrl),
    ]);

    const tempPath = path.join(os.tmpdir(), `minfin-${Date.now()}.xlsx`);
    await download.saveAs(tempPath);

    return { tempPath, fileUrl };
  } finally {
    await browser.close();
  }
}

async function scrapeMinfin() {
  let tempPath;
  let fileUrl;
  try {
    ({ tempPath, fileUrl } = await downloadLatestQuarterlyFile());
  } catch (err) {
    console.warn('[minfin] failed to fetch quarterly file:', err.message);
    return { upserted: 0 };
  }

  let upserted = 0;
  try {
    const workbook = XLSX.readFile(tempPath);
    const entries = parseWorkbookForMunicipality(workbook, LOM_MUNICIPALITY_CODE);
    const sourceFile = path.basename(new URL(fileUrl).pathname);

    for (const entry of entries) {
      const result = upsertIndicatorRow(entry, fileUrl, sourceFile);
      if (result === 'inserted') upserted += 1;
    }
  } finally {
    fs.unlink(tempPath, () => {});
  }

  return { upserted };
}

module.exports = scrapeMinfin;
module.exports.parseWorkbookForMunicipality = parseWorkbookForMunicipality;
module.exports.LOM_MUNICIPALITY_CODE = LOM_MUNICIPALITY_CODE;
module.exports.RAW_AMOUNT_COLUMN_GROUPS = RAW_AMOUNT_COLUMN_GROUPS;
