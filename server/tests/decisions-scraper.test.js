'use strict';

const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseListingEntries,
  parseDetailPage,
  extractDecisionNumbers,
  parseBgDateToIso,
} = require('../scraper/modules/decisions');

const FIXTURES_DIR = path.join(__dirname, '..', 'scraper', '__fixtures__');
const listingHtml = fs.readFileSync(
  path.join(FIXTURES_DIR, 'decisions-listing.html'),
  'utf8'
);
const detailHtml = fs.readFileSync(
  path.join(FIXTURES_DIR, 'decisions-detail-5225.html'),
  'utf8'
);

test('parseBgDateToIso converts DD.MM.YYYY to ISO', () => {
  assert.equal(parseBgDateToIso('06.07.2026'), '2026-07-06');
  assert.equal(
    parseBgDateToIso('...НА 06.07.2026 Г. - ТУК'),
    '2026-07-06'
  );
  assert.equal(parseBgDateToIso('not a date'), null);
  assert.equal(parseBgDateToIso(''), null);
});

test('parseListingEntries extracts session dates + detail links from the real saved listing fixture', () => {
  const entries = parseListingEntries(listingHtml);

  assert.ok(entries.length > 10, 'expected many session entries in the fixture');

  const first = entries[0];
  assert.equal(first.sessionDate, '2026-07-06');
  assert.equal(first.detailHref, 'currentNews-5225-newitem.html');

  // every entry must have a valid ISO date and a currentNews-*.html href
  for (const entry of entries) {
    assert.match(entry.sessionDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(entry.detailHref, /currentNews-\d+-newitem\.html/);
  }

  // no duplicate hrefs
  const hrefs = entries.map((e) => e.detailHref);
  assert.equal(new Set(hrefs).size, hrefs.length);
});

test('parseDetailPage extracts the session title and only .pdf attachments from the real saved detail fixture', () => {
  const result = parseDetailPage(
    detailHtml,
    'https://lom.bg/currentNews-5225-newitem.html'
  );

  assert.equal(
    result.title,
    'Дневен ред и материали за заседание на Общински съвет – Лом, което ще се проведе на 06.07.2026 г.'
  );

  assert.equal(result.attachments.length, 1);
  assert.match(result.attachments[0].filename, /\.pdf$/i);
  assert.match(
    result.attachments[0].url,
    /^https:\/\/lom\.bg\/inc\/service\/service-download-file\.php\?identifier=/
  );

  // the .docx agenda attachment on the same page must be filtered out
  assert.ok(
    !result.attachments.some((a) => /\.docx$/i.test(a.filename)),
    'docx attachments should be filtered out, only pdfs kept'
  );
});

test('extractDecisionNumbers finds "Решение №" style numbers, dedupes, and is case-insensitive', () => {
  const text =
    'Общински съвет – Лом прие следното РЕШЕНИЕ № 12 по точка първа. ' +
    'По точка втора се прие Решение №13. ' +
    'Решение № 12 се цитира повторно по-долу.';

  const numbers = extractDecisionNumbers(text);

  assert.deepEqual(numbers.sort(), ['12', '13']);
});

test('extractDecisionNumbers returns an empty array for empty/undefined/no-match text (the common real-world case)', () => {
  assert.deepEqual(extractDecisionNumbers(''), []);
  assert.deepEqual(extractDecisionNumbers(undefined), []);
  assert.deepEqual(extractDecisionNumbers('Никакъв релевантен текст тук.'), []);
});
