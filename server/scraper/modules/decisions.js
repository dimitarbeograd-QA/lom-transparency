'use strict';

// Scraper module for "Решения на Общински съвет" (Council Decisions).
// Auto-run by server/scraper/runAll.js as part of `npm run sync`.
//
// ---------------------------------------------------------------------------
// Real-site correction (2026-07-25)
// ---------------------------------------------------------------------------
// The module originally targeted https://lom.bg/section-263-content.html,
// which turned out (confirmed by hand, after this had already shipped and
// been scraped for real) to be a listing of pre-meeting AGENDAS ("ДНЕВЕН РЕД
// И МАТЕРИАЛИ ЗА ЗАСЕДАНИЕТО...", i.e. "agenda and materials for the
// upcoming session"), not post-meeting decisions -- which is exactly why
// every single scraped row landed on the placeholder decision_number path:
// agenda PDFs published before a vote genuinely don't contain decision
// numbers yet.
//
// The correct source, found via a plain web search, is
// https://lom.bg/section-254-content.html ("Решения на ОбС" in the site's
// own navigation) -- a clean, numbered, chronological list going back
// hundreds of entries, each literally titled
// "NNN.Решения от Протокол №NN/DD.MM.YYYY г. <a href="...">тук</a>", e.g.
// "297. Решения от Протокол №53/27.05.2026 г. тук". This gives a REAL
// protocol number and REAL session date directly from the listing text --
// no per-page document fetch needed for those two fields at all.
//
// What this page's detail link (currentNews-XXXX-newitem.html) leads to is
// a SINGLE downloadable .docx transcript of the entire protocol (e.g.
// "ПРЕПИС ПРОТОКОЛ №33 ОТ 11.06.2025 Г..docx") -- not one PDF per decision.
// Splitting that transcript into individual numbered decisions would need
// .docx parsing (a new dependency, e.g. mammoth -- this app currently only
// depends on pdf-parse) plus text-segmentation logic to find each
// "Решение № N" inside one combined document. That's a real, scoped
// follow-up, not something to half-attempt here: this module instead
// stores ONE row per protocol/session (real session_number + real
// session_date, honestly-labeled title, link to the transcript page as
// source_url) rather than fabricating a decision-level breakdown the
// current dependencies can't actually produce. decision_number is a
// constant per row ('ЦЯЛ ПРОТОКОЛ' -- "whole protocol") purely so the
// existing UNIQUE(session_number, decision_number) schema constraint stays
// meaningful; it is not a claim that this represents a single decision.

const { politeFetch, parseHtml, resolveUrl } = require('../lomBgClient');
const { db } = require('../../db');

const LISTING_URL = 'https://lom.bg/section-254-content.html';

// Sensible cap so a single `npm run sync` run doesn't try to insert the
// site's entire multi-year archive (hundreds of protocols) at once.
// Re-running the scraper is idempotent (UNIQUE(session_number,
// decision_number), skip-if-exists) so raising this later, or just running
// `npm run sync` a few more times, backfills further history gradually --
// same pattern as the procurement module.
const MAX_SESSIONS_PER_RUN = 60;

const WHOLE_PROTOCOL_MARKER = 'ЦЯЛ ПРОТОКОЛ';

// Matches "Решения от Протокол №53/27.05.2026 г." (leading list-item number
// and trailing "тук" link are outside this regex's concern -- it's applied
// to each list item's own text, not the whole page).
const PROTOCOL_LINE_RE = /Протокол\s*№\s*(\d+)\s*\/\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\s*г\.?/u;

/**
 * Parse one line of listing text (e.g. "297.Решения от Протокол
 * №53/27.05.2026 г.") into { sessionNumber, sessionDate } or null if it
 * doesn't match the expected "Протокол №N/DD.MM.YYYY" shape. Exported
 * separately from parseListingEntries so both the real parser and its
 * tests can exercise it directly against plain strings.
 *
 * sessionNumber is returned as "N/YYYY" (e.g. "53/2025"), not the bare
 * protocol number -- confirmed against the real fixture that Lom's council
 * resets protocol numbering to 1 every calendar year, so the bare number
 * alone collides across years (Протокол №53 in 2025 is a different, real
 * session from Протокол №53 in some other year) and would silently drop
 * real rows under this table's UNIQUE(session_number, decision_number)
 * constraint. The year suffix keeps it both genuinely unique and still
 * human-readable as "which protocol, which year".
 */
function parseProtocolLine(text) {
  const m = PROTOCOL_LINE_RE.exec(text || '');
  if (!m) return null;
  const [, protocolNumber, dd, mm, yyyy] = m;
  return {
    sessionNumber: `${protocolNumber}/${yyyy}`,
    sessionDate: `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`,
  };
}

/**
 * Walk backward from a node's immediately preceding siblings, collecting
 * text, and stop at the first non-text sibling (a <br>, another <a>, or
 * running out of siblings). This is deliberately NOT `.closest('p').text()`
 * -- confirmed by hand against the real page that roughly the older third
 * of this listing has ~85 entries hand-authored inside a SINGLE <p>,
 * separated only by <br> tags rather than one <p> per entry. Under that
 * markup, `.closest('p').text()` returns the text of ALL ~85 entries
 * concatenated, and a non-global regex exec against that blob always
 * matches the FIRST protocol number in it -- which is how an earlier
 * version of this function silently mis-attributed every one of those 85
 * real, distinct sessions to the same single protocol number. Walking each
 * link's own immediately-preceding siblings up to the nearest markup
 * boundary correctly isolates just the text that belongs to THAT entry,
 * regardless of how many entries got merged into one <p> around it.
 */
function extractPrecedingText(el) {
  let text = '';
  let node = el.prev;
  while (node) {
    if (node.type === 'text') {
      text = node.data + text;
    } else {
      break; // hit a <br>, a previous <a>, or some other tag -- boundary
    }
    node = node.prev;
  }
  return text.trim();
}

/**
 * Parse the section-254 listing page into a list of protocol/session
 * entries. Pure function of the HTML string -- safe to unit test against a
 * saved fixture without any network access.
 */
function parseListingEntries(html) {
  const $ = parseHtml(html);
  const entries = [];
  const seenUrls = new Set();

  $('a[href*="-newitem.html"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || !/currentNews-\d+-newitem\.html/.test(href)) return;
    if (seenUrls.has(href)) return;

    const linkText = extractPrecedingText(el);
    const parsed = parseProtocolLine(linkText);
    if (!parsed) return; // not a real "Протокол №.../date" entry -- skip rather than guess

    seenUrls.add(href);
    entries.push({
      sessionNumber: parsed.sessionNumber,
      sessionDate: parsed.sessionDate,
      title: linkText.replace(/^\d+\.?\s*/, '').trim() || `Решения от Протокол №${parsed.sessionNumber}`,
      detailHref: href,
    });
  });

  return entries;
}

function findExisting(sessionNumber, decisionNumber) {
  return db
    .prepare(
      'SELECT id FROM council_decisions WHERE session_number = ? AND decision_number = ?'
    )
    .get(sessionNumber, decisionNumber);
}

function insertDecision({ sessionDate, sessionNumber, title, sourceUrl }) {
  const scrapedAt = new Date().toISOString();
  try {
    db.prepare(
      `INSERT INTO council_decisions
        (session_date, session_number, decision_number, title, summary, category, source_url, scraped_at)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)`
    ).run(sessionDate, sessionNumber, WHOLE_PROTOCOL_MARKER, title, sourceUrl, scrapedAt);
    return true;
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return false;
    }
    throw err;
  }
}

async function scrapeDecisions() {
  let upserted = 0;

  const listingRes = await politeFetch(LISTING_URL);
  const listingHtml = await listingRes.text();
  const entries = parseListingEntries(listingHtml);

  for (const entry of entries) {
    if (upserted >= MAX_SESSIONS_PER_RUN) break;
    if (findExisting(entry.sessionNumber, WHOLE_PROTOCOL_MARKER)) continue;

    const detailUrl = resolveUrl(LISTING_URL, entry.detailHref);
    const ok = insertDecision({
      sessionDate: entry.sessionDate,
      sessionNumber: entry.sessionNumber,
      title: entry.title,
      sourceUrl: detailUrl,
    });
    if (ok) upserted += 1;
  }

  return { upserted };
}

module.exports = scrapeDecisions;
module.exports.parseListingEntries = parseListingEntries;
module.exports.parseProtocolLine = parseProtocolLine;
module.exports.WHOLE_PROTOCOL_MARKER = WHOLE_PROTOCOL_MARKER;
