'use strict';

const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseListingPage,
  parseBgDateToIso,
  parseContractInfo,
  TYPE_FILTERS,
} = require('../scraper/modules/procurement');

const FIXTURES_DIR = path.join(__dirname, '..', 'scraper', '__fixtures__');

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8');
}

const tenderHtml = readFixture('procurement-listing-tender.html');
const archiveHtml = readFixture('procurement-listing-archive.html');
const marketConsultanciesHtml = readFixture('procurement-listing-marketconsultancies.html');
const emptyHtml = readFixture('procurement-listing-empty.html');

test('parseBgDateToIso converts trailing D.M.YYYY г. dates to ISO', () => {
  assert.equal(parseBgDateToIso('Обществена поръчка С-7 / 12.6.2020 г.'), '2020-06-12');
  assert.equal(parseBgDateToIso('Пазарни консултации ПК - 4 / 2.12.2019 г.'), '2019-12-02');
  assert.equal(parseBgDateToIso('not a date'), null);
  assert.equal(parseBgDateToIso(''), null);
  assert.equal(parseBgDateToIso(undefined), null);
});

test('parseListingPage extracts real procurement entries from the saved "Обществени поръчки" (Tender) fixture', () => {
  const entries = parseListingPage(
    tenderHtml,
    'https://e-obp.eu/bp/Lom?type=Tender',
    'Обществени поръчки'
  );

  assert.ok(entries.length > 100, 'expected a large number of real tender entries');

  const first = entries[0];
  assert.match(first.title, /РЕМОНТ НА ЧАСТ ОТ СУТЕРЕН/);
  assert.equal(first.procedureType, 'Обществени поръчки');
  assert.equal(first.publishDate, '2020-06-12');
  assert.match(first.sourceUrl, /^https:\/\/e-obp\.eu\/bp\/Document\/[0-9a-f-]{36}$/);

  // every entry must have a title and a well-formed absolute source URL
  for (const entry of entries) {
    assert.ok(entry.title && entry.title.length > 0);
    assert.match(entry.sourceUrl, /^https:\/\/e-obp\.eu\/bp\/Document\//);
  }

  // no duplicate source URLs within a single listing page
  const urls = entries.map((e) => e.sourceUrl);
  assert.equal(new Set(urls).size, urls.length);
});

test('parseListingPage extracts entries from the "Архив" (Archive) fixture, tagged with the Archive label', () => {
  const entries = parseListingPage(
    archiveHtml,
    'https://e-obp.eu/bp/Lom?type=Archive',
    'Архив'
  );

  assert.ok(entries.length > 0);
  assert.ok(entries.every((e) => e.procedureType === 'Архив'));
  assert.ok(entries.every((e) => e.publishDate === null || /^\d{4}-\d{2}-\d{2}$/.test(e.publishDate)));
});

test('parseListingPage extracts entries from the "Пазарни консултации" (MarketConsultancies) fixture', () => {
  const entries = parseListingPage(
    marketConsultanciesHtml,
    'https://e-obp.eu/bp/Lom?type=MarketConsultancies',
    'Пазарни консултации'
  );

  assert.ok(entries.length > 0);
  assert.ok(entries.every((e) => e.procedureType === 'Пазарни консултации'));
});

test('parseListingPage returns an empty array for a listing page with no entries (real "Предварителни обявления" fixture, currently empty on the live site)', () => {
  const entries = parseListingPage(
    emptyHtml,
    'https://e-obp.eu/bp/Lom?type=Preparing',
    'Предварителни обявления'
  );

  assert.deepEqual(entries, []);
});

test('parseContractInfo extracts the real contract number/date from the "Договори за изпълнение" block on a real detail-page fixture', () => {
  const detailHtml = readFixture('procurement-detail-with-contract.html');
  const info = parseContractInfo(detailHtml);
  assert.deepEqual(info, { contractNumber: '195', contractDate: '2020-08-13' });
});

test('parseContractInfo falls back to the document-block\'s own <h4> date when the "Коментар:" text has no number/date (real "Договор за ОП N" per-lot format)', () => {
  const detailHtml = readFixture('procurement-detail-contract-no-number.html');
  const info = parseContractInfo(detailHtml);
  // The fixture has 4 such blocks (one per lot); the parser takes the first.
  assert.deepEqual(info, { contractNumber: null, contractDate: '2020-07-14' });
});

test('parseContractInfo returns null when the page has no signed-contract block (no throw)', () => {
  assert.equal(parseContractInfo('<html><body>no document blocks here</body></html>'), null);
  assert.equal(
    parseContractInfo('<div class="document-block"><h4>Обявление № 1 / 1.1.2020 г.</h4></div>'),
    null
  );
});

test('parseContractInfo ignores a "проект на договор" block (draft template, not a signed contract)', () => {
  const html =
    '<div class="document-block"><h4>Проект на договор № 1 / 1.1.2020 г.</h4>' +
    '<span>Коментар: </span><span class="text-info">Договор №999 от 01.01.2020 г.</span></div>';
  assert.equal(parseContractInfo(html), null);
});

test('TYPE_FILTERS declares all 5 site filters with non-empty param and label', () => {
  assert.equal(TYPE_FILTERS.length, 5);
  for (const f of TYPE_FILTERS) {
    assert.ok(f.param);
    assert.ok(f.label);
  }
});
