'use strict';

// Scraper for the "Бюджет и разходи по проекти" module.
//
// Target: https://lom.bg/section-56-content.html -- a chronological,
// year-by-year list of budget-related decisions and reports. It is NOT a
// clean "one row per project" breakdown (there's no municipal project
// register on lom.bg), so the realistic and honest thing to scrape here is:
// group every linked document by the budget year it is actually about, and
// upsert ONE project per year (e.g. "Общински бюджет 2024") with those
// documents attached. We do not invent project-level financial granularity
// that isn't present in the source -- allocated/spent amounts for these
// year-projects are left for an admin to fill in from the linked documents
// (budget_lines / expenditures are intentionally NOT created by this
// scraper).
//
// Parsing approach (see server/tests/budget-scraper.test.js for the fixture
// this was developed against): the source markup is old-school and messy
// (mismatched tags, no consistent per-item container), but every entry's
// surrounding text reliably mentions the year it's about (e.g. "относно
// приемането на бюджета на Община Лом за 2024 г."), which is far more
// reliable than trying to detect bold "20XX г." section headers -- those
// exist too, but items are sometimes about a different year than the
// section they visually sit under (e.g. an audit report for FY2025 filed
// under the "2026" header). So: walk the container's text/links in document
// order, and for each link, look at the text immediately preceding it (plus
// its own link text) for the last "YYYY"-shaped number in a sane range --
// that's the year the linked document is about.

const { db } = require('../../db');
const { politeFetch, parseHtml, resolveUrl } = require('../lomBgClient');

const SOURCE_URL = 'https://lom.bg/section-56-content.html';
const CONTAINER_SELECTOR = '.new-item-content';
const MIN_YEAR = 2000;
const MAX_YEAR = 2035;

function normalizeWhitespace(text) {
  return (text || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

function extractYear(text) {
  const matches = [...text.matchAll(/\b(19|20)\d{2}\b/g)];
  if (matches.length === 0) return null;
  const year = parseInt(matches[matches.length - 1][0], 10);
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  return year;
}

function extractDateIso(text) {
  const match = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  const iso = `${yyyy}-${mm}-${dd}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return iso;
}

/**
 * Parses the raw HTML of the section-56 page into a Map<year, entries[]>,
 * where each entry is { year, date, label, url }. Exported for testing.
 */
function parseBudgetSection(html, baseUrl) {
  const $ = parseHtml(html);
  const container = $(CONTAINER_SELECTOR).first();
  if (container.length === 0) {
    return new Map();
  }

  // Strip page chrome that isn't part of the actual document list (e.g. the
  // "Дата на публикуване" banner), so it can't be mistaken for entry text.
  container.find('.section-publishdate').remove();
  container.find('script').remove();

  const links = [];
  container.find('a[href]').each((i, el) => {
    const $el = $(el);
    const href = $el.attr('href');
    if (!href || href.trim().startsWith('#')) return;
    const marker = `@@LINK${links.length}@@`;
    links.push({ href: href.trim(), text: normalizeWhitespace($el.text()) });
    $el.replaceWith(marker);
  });

  const fullText = container.text();
  const parts = fullText.split(/@@LINK\d+@@/);
  // parts[0] = text before link 0, parts[1] = text between link 0 and 1, ...

  const byYear = new Map();
  const seenPerYearHref = new Set();

  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const precedingChunk = normalizeWhitespace(parts[i] || '');

    const year = extractYear(precedingChunk) || extractYear(link.text);
    if (!year) continue; // can't confidently attribute this document to a year

    const date = extractDateIso(precedingChunk) || extractDateIso(link.text);
    const label = normalizeWhitespace(`${precedingChunk} ${link.text}`).slice(-300);
    const url = resolveUrl(baseUrl, link.href);

    const dedupeKey = `${year}::${url}`;
    if (seenPerYearHref.has(dedupeKey)) continue;
    seenPerYearHref.add(dedupeKey);

    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push({ year, date, label, url });
  }

  return byYear;
}

function statusForYear(year) {
  const currentYear = new Date().getFullYear();
  if (year < currentYear) return 'completed';
  if (year === currentYear) return 'active';
  return 'planned';
}

function buildDescription(year, entries) {
  const sorted = [...entries].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const lines = sorted.map((e) => `- ${e.date ? e.date + ': ' : ''}${e.label}`);
  return (
    `Автоматично събрани документи и решения на Общинския съвет, свързани с бюджета на Община Лом за ${year} г. ` +
    `Източник: раздел "Бюджет и финанси" на сайта на общината.\n\n${lines.join('\n')}`
  );
}

function upsertProjectForYear(year, entries) {
  const name = `Общински бюджет ${year}`;
  const nowIso = new Date().toISOString();
  const description = buildDescription(year, entries);
  const status = statusForYear(year);

  const existing = db.prepare('SELECT id FROM projects WHERE name = ?').get(name);

  let projectId;
  if (existing) {
    projectId = existing.id;
    db.prepare(
      `UPDATE projects
       SET description = ?, category = ?, status = ?, source_url = ?, scraped_at = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(description, 'Бюджет', status, SOURCE_URL, nowIso, projectId);
  } else {
    const info = db
      .prepare(
        `INSERT INTO projects (name, description, category, status, review_status, source_url, scraped_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?)`
      )
      .run(name, description, 'Бюджет', status, SOURCE_URL, nowIso);
    projectId = info.lastInsertRowid;
  }

  let attachmentsUpserted = 0;
  const existingAttachmentUrls = new Set(
    db
      .prepare("SELECT url FROM attachments WHERE entity_type = 'project' AND entity_id = ?")
      .all(projectId)
      .map((r) => r.url)
  );

  const insertAttachment = db.prepare(
    `INSERT INTO attachments (entity_type, entity_id, label, url, uploaded_at) VALUES ('project', ?, ?, ?, ?)`
  );

  for (const entry of entries) {
    if (existingAttachmentUrls.has(entry.url)) continue;
    insertAttachment.run(projectId, entry.label, entry.url, nowIso);
    attachmentsUpserted += 1;
  }

  return { projectId, isNew: !existing, attachmentsUpserted };
}

async function run() {
  const response = await politeFetch(SOURCE_URL);
  const html = await response.text();

  const byYear = parseBudgetSection(html, SOURCE_URL);

  let upserted = 0;
  for (const [year, entries] of byYear.entries()) {
    upsertProjectForYear(year, entries);
    upserted += 1;
  }

  return { upserted };
}

module.exports = run;
module.exports.parseBudgetSection = parseBudgetSection;
module.exports.statusForYear = statusForYear;
