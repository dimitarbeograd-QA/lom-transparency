'use strict';

// Scraper module for "Наредби и нормативни актове" (Ordinances). Auto-run by
// server/scraper/runAll.js as part of `npm run sync`.
//
// Real site structure confirmed by hand (2026-07-24) against
// https://lom.bg/subsection-34-naredbi.html (which 302-redirects to
// https://lom.bg/section-277-content.html) -- see
// server/scraper/__fixtures__/ordinances-list.html for a saved copy:
//
//   - The whole list lives in a single `.new-item-content` container made
//     of a handful of `<p>` paragraphs. Inside those paragraphs, each
//     ordinance is just free text ("Наредба за ... - <a href="...">тук</a>")
//     with entries separated by `<br><br>` -- there is NO wrapping element
//     per entry, no dates, and no status shown anywhere in the listing.
//   - The "тук" link's href is either a content page
//     (../currentNews-<id>-newitem.html), a direct file download
//     (inc/service/service-download-file.php?fid=####), or occasionally a
//     legacy .doc file under ../assets/obshtinski_savet/NAREDBI/*.doc.
//   - A handful of ordinances have TWO links back to back with no text in
//     between (e.g. an empty/whitespace-only second <a>) -- that is an
//     alternate/duplicate download link for the SAME ordinance, not a
//     second entry, so parseListingEntries treats an anchor preceded by no
//     real title text as "belongs to the previous entry" and skips it
//     rather than emitting a blank-title row.
//   - Since adoption dates are genuinely absent from the source, entries are
//     inserted with adoption_date=NULL rather than guessed; review_status
//     stays 'pending' so an admin can open the linked document and fill the
//     date in via the review UI.

const { politeFetch, parseHtml, resolveUrl } = require('../lomBgClient');
const { db } = require('../../db');

const LISTING_URL = 'https://lom.bg/subsection-34-naredbi.html';

// Trailing separators like " - ", " – ", " — ", " : " left dangling at the
// end of a title once the following <a href> has been stripped off.
const TRAILING_SEPARATOR_RE = /[-–—:]+\s*$/;

/**
 * Parse the ordinances listing page into a flat list of
 * { title, sourceUrl } entries. Pure function of the HTML string + the
 * page's own (post-redirect) URL, for resolving relative hrefs -- safe to
 * unit test against a saved fixture without any network access.
 */
function parseListingEntries(html, pageUrl) {
  const $ = parseHtml(html);
  const container = $('.new-item-content').first();
  const paragraphs = container.length ? container.find('p') : $('p');

  const entries = [];
  let buffer = '';

  function walk(node) {
    if (node.type === 'text') {
      buffer += $(node).text();
      return;
    }
    if (node.type === 'tag') {
      if (node.tagName === 'br') {
        buffer += ' ';
        return;
      }
      if (node.tagName === 'a') {
        const href = $(node).attr('href');
        const title = buffer.replace(/\s+/g, ' ').trim().replace(TRAILING_SEPARATOR_RE, '').trim();
        buffer = '';

        // No real title text since the previous link -> this anchor is a
        // supplementary/duplicate download link for the entry we already
        // emitted, not a new entry. Skip it.
        if (title && href) {
          entries.push({ title, sourceUrl: resolveUrl(pageUrl, href) });
        }
        return;
      }
      (node.children || []).forEach(walk);
      return;
    }
  }

  paragraphs.each((_, p) => {
    $(p)
      .contents()
      .each((__, el) => walk(el));
  });

  return entries;
}

function findExistingBySourceUrl(sourceUrl) {
  return db.prepare('SELECT id FROM ordinances WHERE source_url = ?').get(sourceUrl);
}

function insertOrdinance({ title, sourceUrl }) {
  const scrapedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO ordinances (title, adoption_date, last_amended_date, status, category, source_url, scraped_at)
     VALUES (?, NULL, NULL, 'active', NULL, ?, ?)`
  ).run(title, sourceUrl, scrapedAt);
}

async function scrapeOrdinances() {
  let upserted = 0;

  const listingRes = await politeFetch(LISTING_URL);
  const listingHtml = await listingRes.text();
  // fetch() follows redirects by default -- LISTING_URL 302s to a
  // section-###-content.html page, and the listing's own relative hrefs
  // (../currentNews-...html etc.) must be resolved against that FINAL URL,
  // not the pre-redirect one.
  const pageUrl = listingRes.url || LISTING_URL;

  const entries = parseListingEntries(listingHtml, pageUrl);

  for (const entry of entries) {
    if (findExistingBySourceUrl(entry.sourceUrl)) continue;
    insertOrdinance(entry);
    upserted += 1;
  }

  return { upserted };
}

module.exports = scrapeOrdinances;
module.exports.parseListingEntries = parseListingEntries;
