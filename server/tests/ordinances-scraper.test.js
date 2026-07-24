'use strict';

const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseListingEntries } = require('../scraper/modules/ordinances');

const FIXTURES_DIR = path.join(__dirname, '..', 'scraper', '__fixtures__');
const listingHtml = fs.readFileSync(path.join(FIXTURES_DIR, 'ordinances-list.html'), 'utf8');
const PAGE_URL = 'https://lom.bg/section-277-content.html';

test('parseListingEntries extracts all ordinance titles + links from the real saved listing fixture', () => {
  const entries = parseListingEntries(listingHtml, PAGE_URL);

  assert.equal(entries.length, 28, 'expected 28 real ordinance entries in the fixture');

  const first = entries[0];
  assert.equal(first.title, 'Наредба за определяне на местните данъци на територията на Община Лом');
  assert.equal(first.sourceUrl, 'https://lom.bg/currentNews-4602-newitem.html');

  // every entry has a non-empty title and a resolved absolute source URL
  for (const entry of entries) {
    assert.ok(entry.title.length > 0, 'title should not be empty');
    assert.match(entry.sourceUrl, /^https:\/\/lom\.bg\//);
  }
});

test('parseListingEntries resolves both content-page and direct-download hrefs to absolute URLs', () => {
  const entries = parseListingEntries(listingHtml, PAGE_URL);

  const contentPageEntry = entries.find((e) => e.sourceUrl.includes('currentNews-'));
  assert.ok(contentPageEntry, 'expected at least one currentNews-*.html entry');

  const downloadEntry = entries.find((e) => e.sourceUrl.includes('service-download-file.php'));
  assert.ok(downloadEntry, 'expected at least one direct-download entry');
  assert.match(downloadEntry.sourceUrl, /fid=\d+/);
});

test('parseListingEntries does not emit a blank-title entry for a supplementary/duplicate download link', () => {
  const entries = parseListingEntries(listingHtml, PAGE_URL);

  // The first ordinance in the fixture has TWO back-to-back links (a
  // currentNews page and a service-download-file.php one with no title
  // text in between) -- only the first should produce an entry.
  const dataxTaxOrdinance = entries.filter((e) =>
    e.title.startsWith('Наредба за определяне на местните данъци')
  );
  assert.equal(dataxTaxOrdinance.length, 1);

  assert.ok(
    entries.every((e) => e.title.trim().length > 0),
    'no entry should have an empty/whitespace-only title'
  );
});

test('parseListingEntries strips trailing " - " style separators from titles', () => {
  const entries = parseListingEntries(listingHtml, PAGE_URL);
  for (const entry of entries) {
    assert.doesNotMatch(entry.title, /[-–—:]\s*$/);
  }
});

test('parseListingEntries returns an empty array for HTML with no matching container/links', () => {
  const entries = parseListingEntries('<html><body><p>Няма нищо тук.</p></body></html>', PAGE_URL);
  assert.deepEqual(entries, []);
});
