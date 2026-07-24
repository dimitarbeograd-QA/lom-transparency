'use strict';

// Tests for the budget scraper's HTML parsing logic. Runs entirely against a
// saved fixture (server/scraper/__fixtures__/budget-section56.html), fetched
// once from the real https://lom.bg/section-56-content.html page -- no live
// network calls here, so this stays fast/deterministic/independent of
// lom.bg staying up or unchanged.

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseBudgetSection, statusForYear } = require('../scraper/modules/budget');

const FIXTURE_PATH = path.join(__dirname, '..', 'scraper', '__fixtures__', 'budget-section56.html');
const SOURCE_URL = 'https://lom.bg/section-56-content.html';

function loadFixture() {
  return fs.readFileSync(FIXTURE_PATH, 'utf8');
}

test('parseBudgetSection groups documents by the budget year they are actually about', () => {
  const html = loadFixture();
  const byYear = parseBudgetSection(html, SOURCE_URL);

  assert.ok(byYear.size > 5, 'expected documents spanning multiple years');
  assert.ok(byYear.has(2024), 'expected a 2024 group');

  const entries2024 = byYear.get(2024);
  assert.ok(entries2024.length > 0);

  // The confirmed example entry from the module brief: a decision adopting
  // the 2024 municipal budget.
  const decision = entries2024.find((e) => e.url.includes('currentNews-4172-newitem.html'));
  assert.ok(decision, 'expected to find the Решение № 34 / бюджет 2024 entry');
  assert.equal(decision.date, '2024-02-21');
  assert.match(decision.label, /бюджета на Община Лом.*2024/);
});

test('parseBudgetSection resolves relative hrefs to absolute URLs', () => {
  const html = loadFixture();
  const byYear = parseBudgetSection(html, SOURCE_URL);

  for (const entries of byYear.values()) {
    for (const entry of entries) {
      assert.match(entry.url, /^https:\/\/lom\.bg\//);
    }
  }
});

test('parseBudgetSection does not attribute page-chrome text (e.g. the publish-date banner) to a fake entry', () => {
  const html = loadFixture();
  const byYear = parseBudgetSection(html, SOURCE_URL);

  for (const entries of byYear.values()) {
    for (const entry of entries) {
      assert.doesNotMatch(entry.label, /Дата на публикуване/);
    }
  }
});

test('parseBudgetSection deduplicates the same document URL within a year', () => {
  const html = loadFixture();
  const byYear = parseBudgetSection(html, SOURCE_URL);

  for (const [year, entries] of byYear.entries()) {
    const urls = entries.map((e) => e.url);
    const uniqueUrls = new Set(urls);
    assert.equal(urls.length, uniqueUrls.size, `duplicate URL within year ${year}`);
  }
});

test('parseBudgetSection returns an empty map when the expected container is missing', () => {
  const byYear = parseBudgetSection('<html><body><p>nothing here</p></body></html>', SOURCE_URL);
  assert.equal(byYear.size, 0);
});

test('statusForYear classifies past/current/future years relative to today', () => {
  const currentYear = new Date().getFullYear();
  assert.equal(statusForYear(currentYear - 1), 'completed');
  assert.equal(statusForYear(currentYear), 'active');
  assert.equal(statusForYear(currentYear + 1), 'planned');
});
