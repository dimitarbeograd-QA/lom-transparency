'use strict';

// Scraper module for "Обществени поръчки" (Public Procurement).
// Auto-run by server/scraper/runAll.js as part of `npm run sync`.
//
// ---------------------------------------------------------------------------
// Real-site investigation notes (2026-07-24)
// ---------------------------------------------------------------------------
// lom.bg's own "Профил на купувача" page (section-19-content.html) is NOT a
// usable scrape source -- confirmed by hand -- it is 3 staff contacts plus
// three outbound links:
//   1. https://app.eop.bg/today               -- ЦАИС ЕОП, the modern national
//      unified e-procurement platform.
//   2. https://e-obp.eu/bp/Lom                 -- an older, separate
//      buyer-profile platform ("е-Портал за обществени поръчки").
//   3. http://213.226.25.126/webreg/... (redirects to
//      e-uslugi.lom.bg:8443/webreg/...)        -- a third legacy register
//      link that currently 404s and could not be made to return usable
//      content by hand; not scraped.
//
// (1) ЦАИС ЕОП / app.eop.bg was investigated first, per the module brief,
// since it is the modern national register. Confirmed BY HAND (curl'ing the
// root document, several guessed API-shaped paths under /api/*, and
// inspecting the raw response) that it serves an Angular SPA shell
// (`<html data-critters-container>`, a spinner `.loader`, "Loading...") for
// every path -- there is no server-rendered HTML content and no discoverable
// unauthenticated JSON API reachable via a plain fetch. Getting real search
// results out of it would require a headless browser driving the Angular
// app, which is out of scope for this lightweight server-side scraper
// module per the module brief -- so (1) is NOT used as a scrape source.
//
// (2) e-obp.eu/bp/Lom, by contrast, turned out (also confirmed by hand) to
// be a real, server-rendered ASP.NET MVC site with an actual, currently
// live, filterable listing of Община Лом's procurement procedures --
// hundreds of real entries spanning 2014-2026, each a plain `<a href="/bp/
// Document/<guid>">` inside a `.order-block` with an `<h4>` holding an
// internal procedure number + publish date. This is a genuine, scrapable
// source (not a JS SPA), so THIS module scrapes it instead of merely doing
// an informational no-op. Five listing pages are fetched, one per the
// site's own `?type=` filter (these values, not file content, are what
// distinguish "Обществени поръчки" from "Архив" etc. -- the on-page <h4>
// prefix text is NOT a reliable type discriminator, since archived tenders
// still say "Обществена поръчка ..." same as active ones):
//   ?type=Preparing               -> "Предварителни обявления"
//   ?type=Tender                  -> "Обществени поръчки"
//   ?type=Archive                 -> "Архив"
//   ?type=MarketConsultancies     -> "Пазарни консултации"
//   ?type=DirectAssign_ZOP_20_4   -> "Директно възлагане /чл.20 ал.4 от ЗОП/"
//
// Deliberate scope limits (documented rather than silently guessed at):
//   - Only title, procedure_type, publish_date and source_url are populated
//     from the listing pages. estimated_value, deadline_date, status
//     (beyond the schema default 'обявена'), awarded_contractor,
//     contract_value and contract_date are NOT reliably extractable from
//     this site's plain HTML without deep per-procedure-page parsing of a
//     free-text chronological "published documents" list (confirmed by
//     hand against a real detail page -- it is a flat list of dated document
//     packets like "Договори за изпълнение № 13 / 14.8.2020 г." with no
//     structured status/value/deadline fields at all). Every scraped row
//     lands as review_status='pending' anyway, so an admin fills in those
//     fields (and corrects procedure_type/status) from the linked
//     source_url during review -- consistent with this app's
//     scrape-then-review model used by every other module.
//   - Every row is idempotent on UNIQUE(source_url), so re-running `npm run
//     sync` never duplicates a procedure already seen.
//   - A per-run cap (MAX_RECORDS_PER_RUN) limits how many NEW rows a single
//     run inserts, so a fresh install backfills gradually across a few
//     `npm run sync` runs rather than dumping ~250 pending rows into the
//     review queue at once.

const { politeFetch, parseHtml, resolveUrl } = require('../lomBgClient');
const { db } = require('../../db');

const BASE_URL = 'https://e-obp.eu/bp/Lom';

const TYPE_FILTERS = [
  { param: 'Preparing', label: 'Предварителни обявления' },
  { param: 'Tender', label: 'Обществени поръчки' },
  { param: 'Archive', label: 'Архив' },
  { param: 'MarketConsultancies', label: 'Пазарни консултации' },
  { param: 'DirectAssign_ZOP_20_4', label: 'Директно възлагане /чл.20 ал.4 от ЗОП/' },
];

const MAX_RECORDS_PER_RUN = 60;

// Matches an <h4> like "Обществена поръчка С-7 / 12.6.2020 г." or
// "Пазарни консултации ПК - 4 / 2.12.2019 г." -- captures the trailing
// D(D).M(M).YYYY date.
const H4_DATE_RE = /(\d{1,2})\.(\d{1,2})\.(\d{4})\s*г\.?\s*$/u;

function parseBgDateToIso(dateStr) {
  const m = H4_DATE_RE.exec((dateStr || '').trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/**
 * Parse one e-obp.eu/bp/Lom listing page (already filtered to a single
 * `?type=`) into a list of procedure entries. Pure function of the HTML
 * string + the page's own URL (for resolving relative hrefs) + the
 * human-readable label for the type filter used to fetch this page -- safe
 * to unit test against a saved fixture without any network access.
 */
function parseListingPage(html, pageUrl, procedureTypeLabel) {
  const $ = parseHtml(html);
  const entries = [];

  $('.order-block').each((_, el) => {
    const link = $(el).find('a[href^="/bp/Document/"]').first();
    const href = link.attr('href');
    if (!href) return;

    const h4Text = $(el).find('h4').text().trim();
    const publishDate = parseBgDateToIso(h4Text);

    const title = link.text().trim().replace(/^[:\s"]+|["\s]+$/g, '') || h4Text || null;
    if (!title) return;

    entries.push({
      title,
      procedureType: procedureTypeLabel,
      publishDate,
      sourceUrl: resolveUrl(pageUrl, href),
    });
  });

  return entries;
}

function findExistingBySourceUrl(sourceUrl) {
  return db.prepare('SELECT id FROM procurements WHERE source_url = ?').get(sourceUrl);
}

function insertProcurement({ title, procedureType, publishDate, sourceUrl }) {
  const scrapedAt = new Date().toISOString();
  try {
    db.prepare(
      `INSERT INTO procurements
        (title, procedure_type, publish_date, source_url, scraped_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(title, procedureType, publishDate, sourceUrl, scrapedAt);
    return true;
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      // Already scraped in a previous run -- leave the existing row (and any
      // admin edits/approval already made to it) untouched.
      return false;
    }
    throw err;
  }
}

async function scrapeProcurement() {
  let upserted = 0;

  for (const { param, label } of TYPE_FILTERS) {
    if (upserted >= MAX_RECORDS_PER_RUN) break;

    const url = `${BASE_URL}?type=${param}`;
    let html;
    try {
      const res = await politeFetch(url);
      html = await res.text();
    } catch (err) {
      console.warn(`[procurement] failed to fetch listing ${url}:`, err.message);
      continue;
    }

    const entries = parseListingPage(html, url, label);

    for (const entry of entries) {
      if (upserted >= MAX_RECORDS_PER_RUN) break;
      if (findExistingBySourceUrl(entry.sourceUrl)) continue;

      const ok = insertProcurement({
        title: entry.title,
        procedureType: entry.procedureType,
        publishDate: entry.publishDate,
        sourceUrl: entry.sourceUrl,
      });
      if (ok) upserted += 1;
    }
  }

  return { upserted };
}

module.exports = scrapeProcurement;
module.exports.parseListingPage = parseListingPage;
module.exports.parseBgDateToIso = parseBgDateToIso;
module.exports.TYPE_FILTERS = TYPE_FILTERS;
