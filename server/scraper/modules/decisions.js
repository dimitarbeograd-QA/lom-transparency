'use strict';

// Scraper module for "Решения на Общински съвет" (Council Decisions).
// Auto-run by server/scraper/runAll.js as part of `npm run sync`.
//
// Real site structure confirmed by hand (2026-07-24) against
// https://lom.bg/section-263-content.html and several detail pages -- see
// server/scraper/__fixtures__/decisions-listing.html and
// server/scraper/__fixtures__/decisions-detail-5225.html for saved copies:
//
//   - The listing page is a flat list of <p> paragraphs, each containing
//     free text "ДНЕВЕН РЕД И МАТЕРИАЛИ ЗА ЗАСЕДАНИЕТО НА ОБЩИНСКИ
//     СЪВЕТ-ЛОМ, КОЕТО ЩЕ СЕ ПРОВЕДЕ НА DD.MM.YYYY Г. - <a href="currentNews-XXXX-newitem.html">ТУК</a>"
//     with no wrapping classes -- we match on the "ТУК" link's href pattern
//     (currentNews-<id>-newitem.html) and pull the date out of the
//     paragraph's own text via regex.
//   - Each detail page has an "Прикачени документи" (attached documents)
//     table; each row is a link to
//     inc/service/service-download-file.php?identifier=...&date=...
//     wrapping an <i class="fa fa-download" aria-label="Изтегли документ
//     с име &quot;<filename>&quot;">. We only care about the .pdf ones.
//   - Downloading those PDF links requires a same-origin Referer header (a
//     bare request without one returns an HTML "redirecting..." shell
//     instead of the file) -- confirmed by hand with curl/node fetch, hence
//     the dedicated downloadPdf() helper below instead of lomBgClient's
//     politeFetch (which does not accept custom headers).
//   - In practice, real "materials" PDFs on this site are pre-meeting
//     agenda packets (scanned documents), not post-meeting protocols, so
//     pdf-parse commonly returns an EMPTY text body for them (confirmed
//     against two real downloaded PDFs during development). Decision
//     numbers are therefore frequently NOT extractable, by design of the
//     underlying source data -- this module leans on the documented
//     placeholder fallback for exactly that reason.

const { politeFetch, parseHtml, extractPdfText, resolveUrl } = require('../lomBgClient');
const { db } = require('../../db');

const LISTING_URL = 'https://lom.bg/section-263-content.html';

// Sensible cap so a single `npm run sync` run doesn't try to walk the
// site's entire multi-year archive (and download dozens of multi-MB PDFs)
// every time. Re-running the scraper is idempotent (see upsert logic below)
// so raising this later just backfills more history.
const MAX_SESSIONS_PER_RUN = 25;

const MONTHS_RE = /(\d{2})\.(\d{2})\.(\d{4})/;

// Matches "Решение № 12", "РЕШЕНИЕ №12", "решение N 5", etc. Bulgarian
// council decisions are conventionally labeled this way.
const DECISION_NUMBER_RE = /РЕШЕНИЕ\s*№?\s*(\d+)/giu;

function parseBgDateToIso(dateStr) {
  const m = MONTHS_RE.exec(dateStr || '');
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Parse the section-263 listing page into a list of session entries.
 * Pure function of the HTML string -- safe to unit test against a saved
 * fixture without any network access.
 */
function parseListingEntries(html) {
  const $ = parseHtml(html);
  const entries = [];
  const seenUrls = new Set();

  $('a[href*="-newitem.html"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || !/currentNews-\d+-newitem\.html/.test(href)) return;

    const paragraphText = $(el).closest('p').text() || $(el).parent().text() || '';
    const sessionDateIso = parseBgDateToIso(paragraphText);

    if (!sessionDateIso) return; // can't do anything useful without a date

    if (seenUrls.has(href)) return;
    seenUrls.add(href);

    entries.push({ sessionDate: sessionDateIso, detailHref: href });
  });

  return entries;
}

/**
 * Parse a session detail page into a title + list of PDF attachment links.
 * Pure function of the HTML string + its own URL (for resolving relative
 * hrefs) -- safe to unit test against a saved fixture.
 */
function parseDetailPage(html, pageUrl) {
  const $ = parseHtml(html);

  const title =
    $('#main-content .card-header h3').first().text().trim() || null;

  const attachments = [];
  $('table a[href*="service-download-file.php"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    const label =
      $(el).find('i').attr('aria-label') || $(el).text() || '';
    const nameMatch = /„?&?quot;?"?([^"„”]+\.pdf)/i.exec(label) || /([^"]+\.pdf)/i.exec(label);
    const filename = (nameMatch && nameMatch[1]) || label.trim();

    if (!/\.pdf$/i.test(filename)) return; // only care about PDFs

    attachments.push({
      url: resolveUrl(pageUrl, href),
      filename,
    });
  });

  return { title, attachments };
}

/**
 * Pure regex extraction of decision numbers from already-extracted PDF
 * text. Kept separate from the PDF-fetching/parsing IO so it can be unit
 * tested directly against hardcoded strings.
 */
function extractDecisionNumbers(text) {
  if (!text) return [];
  const numbers = new Set();
  let match;
  DECISION_NUMBER_RE.lastIndex = 0;
  while ((match = DECISION_NUMBER_RE.exec(text)) !== null) {
    numbers.add(match[1]);
  }
  return Array.from(numbers);
}

/**
 * Download a PDF attachment. Unlike general HTML pages, this site's file
 * download endpoint gates on the Referer header (bare requests get served
 * an HTML "redirecting..." interstitial instead of the actual file), so we
 * can't reuse lomBgClient.politeFetch here -- it doesn't expose a way to
 * set custom headers. Confirmed against the live site during development.
 */
async function downloadPdf(url, refererUrl) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 LomTransparencyBot/1.0',
      Referer: refererUrl,
    },
  });
  if (!res.ok) {
    throw new Error(`Non-2xx response downloading ${url}: ${res.status}`);
  }
  const contentType = res.headers.get('content-type') || '';
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!contentType.includes('pdf') && buffer.slice(0, 4).toString('utf8') !== '%PDF') {
    // Site served the "redirecting..." interstitial or something else --
    // treat as no usable text rather than throwing.
    return null;
  }
  return buffer;
}

function findExistingByAttachment(sourceUrl, decisionNumber) {
  return db
    .prepare(
      'SELECT id FROM council_decisions WHERE source_url = ? AND decision_number = ?'
    )
    .get(sourceUrl, decisionNumber);
}

function insertDecision({ sessionDate, sessionNumber, decisionNumber, title, sourceUrl }) {
  const scrapedAt = new Date().toISOString();
  try {
    db.prepare(
      `INSERT INTO council_decisions
        (session_date, session_number, decision_number, title, summary, category, source_url, scraped_at)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)`
    ).run(sessionDate, sessionNumber, decisionNumber, title, sourceUrl, scrapedAt);
    return true;
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      // Another row already claims this (session_number, decision_number)
      // pair -- leave it alone rather than erroring the whole run out.
      return false;
    }
    throw err;
  }
}

async function scrapeDecisions() {
  let upserted = 0;

  const listingRes = await politeFetch(LISTING_URL);
  const listingHtml = await listingRes.text();
  const entries = parseListingEntries(listingHtml).slice(0, MAX_SESSIONS_PER_RUN);

  for (const entry of entries) {
    const detailUrl = resolveUrl(LISTING_URL, entry.detailHref);

    let detailHtml;
    try {
      const detailRes = await politeFetch(detailUrl);
      detailHtml = await detailRes.text();
    } catch (err) {
      console.warn(`[decisions] failed to fetch detail page ${detailUrl}:`, err.message);
      continue;
    }

    const { title, attachments } = parseDetailPage(detailHtml, detailUrl);

    let combinedText = '';
    for (const att of attachments) {
      try {
        const buffer = await downloadPdf(att.url, detailUrl);
        if (buffer) {
          combinedText += '\n' + (await extractPdfText(buffer));
        }
      } catch (err) {
        console.warn(`[decisions] failed to download/parse ${att.url}:`, err.message);
      }
    }

    const decisionNumbers = extractDecisionNumbers(combinedText);
    // Session number is not exposed anywhere on this site's listing/detail
    // pages -- fall back to the session date itself so the
    // (session_number, decision_number) pair stays meaningfully unique per
    // session; an admin can correct it later via the review UI.
    const sessionNumber = entry.sessionDate;

    if (decisionNumbers.length === 0) {
      const placeholderNumber = `НЕИЗВЕСТНО-${entry.sessionDate}`;
      if (!findExistingByAttachment(detailUrl, placeholderNumber)) {
        const ok = insertDecision({
          sessionDate: entry.sessionDate,
          sessionNumber,
          decisionNumber: placeholderNumber,
          title: title || `Заседание на Общински съвет – Лом, ${entry.sessionDate}`,
          sourceUrl: detailUrl,
        });
        if (ok) upserted += 1;
      }
      continue;
    }

    for (const decisionNumber of decisionNumbers) {
      if (findExistingByAttachment(detailUrl, decisionNumber)) continue;
      const ok = insertDecision({
        sessionDate: entry.sessionDate,
        sessionNumber,
        decisionNumber,
        title: title || `Решение № ${decisionNumber}`,
        sourceUrl: detailUrl,
      });
      if (ok) upserted += 1;
    }
  }

  return { upserted };
}

module.exports = scrapeDecisions;
module.exports.parseListingEntries = parseListingEntries;
module.exports.parseDetailPage = parseDetailPage;
module.exports.extractDecisionNumbers = extractDecisionNumbers;
module.exports.parseBgDateToIso = parseBgDateToIso;
