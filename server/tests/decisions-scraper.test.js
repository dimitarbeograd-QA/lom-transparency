'use strict';

const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseListingEntries,
  parseProtocolLine,
  WHOLE_PROTOCOL_MARKER,
} = require('../scraper/modules/decisions');

const FIXTURES_DIR = path.join(__dirname, '..', 'scraper', '__fixtures__');
const listingHtml = fs.readFileSync(
  path.join(FIXTURES_DIR, 'decisions-listing-section254.html'),
  'utf8'
);

test('parseProtocolLine extracts a real protocol number + ISO date from the real "Решения от Протокол №N/DD.MM.YYYY" text, with the year folded into sessionNumber (protocol numbering resets every year on the real site, so the bare number alone is not unique)', () => {
  assert.deepEqual(parseProtocolLine('297. Решения от Протокол №53/27.05.2026 г. тук'), {
    sessionNumber: '53/2026',
    sessionDate: '2026-05-27',
  });
  assert.deepEqual(parseProtocolLine('276.Решения от Протокол №32/30.05.2025 г.'), {
    sessionNumber: '32/2025',
    sessionDate: '2025-05-30',
  });
});

test('parseProtocolLine returns null for text that is not a "Протокол №.../date" line (e.g. an agenda announcement)', () => {
  assert.equal(
    parseProtocolLine('Дневен ред и материали за заседание на Общински съвет – Лом'),
    null
  );
  assert.equal(parseProtocolLine(''), null);
  assert.equal(parseProtocolLine(undefined), null);
});

test('parseListingEntries extracts real protocol/session entries from the real saved section-254 fixture', () => {
  const entries = parseListingEntries(listingHtml);

  assert.ok(entries.length > 20, 'expected many real protocol entries in the fixture');

  const first = entries[0];
  assert.equal(first.sessionNumber, '56/2026');
  assert.equal(first.sessionDate, '2026-07-06');
  assert.equal(first.detailHref, 'currentNews-5231-newitem.html');
  assert.match(first.title, /Протокол №56\/06\.07\.2026/);

  // every entry must have a well-formed session number ("N/YYYY"), ISO date, and detail href
  for (const entry of entries) {
    assert.match(entry.sessionNumber, /^\d+\/\d{4}$/);
    assert.match(entry.sessionDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(entry.detailHref, /currentNews-\d+-newitem\.html/);
  }

  // no duplicate detail links, and no duplicate protocol numbers either
  const hrefs = entries.map((e) => e.detailHref);
  assert.equal(new Set(hrefs).size, hrefs.length);
  const sessionNumbers = entries.map((e) => e.sessionNumber);
  assert.equal(new Set(sessionNumbers).size, sessionNumbers.length);
});

test('parseListingEntries ignores non-matching links rather than guessing at a date/number', () => {
  const html =
    '<p><a href="currentNews-1-newitem.html">just a link with no protocol text around it</a></p>';
  assert.deepEqual(parseListingEntries(html), []);
});

test('WHOLE_PROTOCOL_MARKER is a non-empty constant used as the decision_number placeholder', () => {
  assert.ok(typeof WHOLE_PROTOCOL_MARKER === 'string' && WHOLE_PROTOCOL_MARKER.length > 0);
});
