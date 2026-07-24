'use strict';

// Scraper module for "Общинска администрация / контакти" (Administration &
// Contacts). Auto-run by server/scraper/runAll.js as part of `npm run sync`.
//
// Real site structure confirmed by hand (2026-07-24) -- see
// server/scraper/__fixtures__/administration-*.html for saved copies:
//
//   - https://lom.bg/section-52-kontakti.html ("Контакти") is a WEAK source
//     as documented in this module's brief: it only has two generic contact
//     blocks (the main municipality office, and the municipal council's own
//     address/phone/fax/email) inside a series of sibling <h4> tags under
//     #main-content .card-body, and it explicitly states the staff phone
//     directory is "в процес на актуализация" (under construction). There
//     is NO real department/staff roster here -- this module deliberately
//     does not invent one. See parseContactsPage() below.
//   - https://lom.bg/subsection-35-content.html ("Структура", redirects to
//     section-217-content.html) DOES have a real, structured roster: all 21
//     elected councilors for the 2023-2027 mandate, grouped under <p> party
//     headers ("ПП ГЕРБ – 9 МАНДАТА" etc.) each followed by one <p> per
//     councilor. The council chairwoman is identifiable by a
//     "– Председател на Общинския съвет" suffix on her name. See
//     parseCouncilStructurePage() below.
//   - https://lom.bg/subsection-36-content.html ("Комисии", redirects to
//     section-218-content.html) similarly has a real roster of the 9
//     standing committees for the same mandate, each as a <p><strong>NAME
//     </strong></p> header followed by one <p> per member, with the
//     committee chair's line suffixed "- Председател" / "– Председател".
//     See parseCommitteesPage() below.
//
// Because subsection-35/36 redirect (302) to their real section-2xx URLs,
// we rely on politeFetch()'s underlying fetch() following redirects by
// default (confirmed against the live site) rather than hardcoding the
// resolved URLs, which are liable to change if the site is republished.
//
// Idempotency / not clobbering admin edits: every upsert in this module is
// insert-only-if-missing (matched by natural key: name for
// departments/council_members/committees, name+department_id for officials,
// council_member_id+committee_id for memberships) -- a rerun never UPDATEs
// a row that already exists, so admin corrections made via the review UI
// are never silently overwritten by a later scrape.

const { politeFetch, parseHtml } = require('../lomBgClient');
const { db } = require('../../db');

const CONTACTS_URL = 'https://lom.bg/section-52-kontakti.html';
const STRUCTURE_URL = 'https://lom.bg/subsection-35-content.html';
const COMMITTEES_URL = 'https://lom.bg/subsection-36-content.html';

// ---------------------------------------------------------------------------
// Contacts page ("Контакти")
// ---------------------------------------------------------------------------

// Walks an element's child nodes converting <br> into line breaks (a plain
// string split on "<br>" would mangle cases like the second mailto link on
// this page, which wraps a bare <br> with no text -- see module docstring).
function blockToLines($, el) {
  const lines = [''];

  function walk(node) {
    if (!node) return;
    if (node.type === 'text') {
      lines[lines.length - 1] += node.data || '';
    } else if (node.type === 'tag') {
      if (node.name === 'br') {
        lines.push('');
      } else if (node.children) {
        node.children.forEach(walk);
      }
    }
  }

  ($(el)[0].children || []).forEach(walk);

  return lines
    .map((l) => l.replace(/[\s ]+/g, ' ').trim())
    .filter((l) => l.length > 0);
}

const ADDRESS_RE = /^адрес:?\s*(.+)/i;
const PHONE_RE = /^тел\.?:?\s*(.+)/i;
const FAX_RE = /^факс:?\s*(.+)/i;
const EMAIL_RE = /^e-?mail:?\s*(.+)/i;
const COUNCIL_MARKER_RE = /Общински\s+съвет/i;
const DIRECTORY_NOTE_RE = /Телефонен указател/i;
const MAYOR_RE = /Приемно време на кмета/i;
const STOP_RE = /Форма за сигнали/i;

/**
 * Parse the "Контакти" page into { main, council, telephoneDirectoryNote,
 * mayorReceptionNote }. Pure function of the HTML string -- safe to unit
 * test against a saved fixture without any network access.
 */
function parseContactsPage(html) {
  const $ = parseHtml(html);
  const lines = [];
  $('#main-content .card-body h4').each((_, el) => {
    lines.push(...blockToLines($, el));
  });

  const contacts = { main: {}, council: {} };
  let section = 'main';
  const addressOpen = { main: false, council: false };
  let telephoneDirectoryNote = null;
  let mayorReceptionNote = null;

  for (const line of lines) {
    if (COUNCIL_MARKER_RE.test(line)) {
      section = 'council';
      addressOpen[section] = false;
      continue;
    }
    if (DIRECTORY_NOTE_RE.test(line)) {
      telephoneDirectoryNote = line;
      addressOpen[section] = false;
      continue;
    }
    if (MAYOR_RE.test(line)) {
      mayorReceptionNote = line;
      addressOpen[section] = false;
      continue;
    }
    if (STOP_RE.test(line)) {
      addressOpen[section] = false;
      continue;
    }

    let m = ADDRESS_RE.exec(line);
    if (m) {
      contacts[section].address = m[1].trim();
      addressOpen[section] = true;
      continue;
    }
    m = PHONE_RE.exec(line);
    if (m) {
      contacts[section].phone = m[1].trim();
      addressOpen[section] = false;
      continue;
    }
    m = FAX_RE.exec(line);
    if (m) {
      contacts[section].fax = m[1].trim();
      addressOpen[section] = false;
      continue;
    }
    m = EMAIL_RE.exec(line);
    if (m) {
      contacts[section].email = m[1].replace(/,\s*$/, '').trim();
      addressOpen[section] = false;
      continue;
    }

    // Continuation of a multi-line address (e.g. "ет. 3 стая № 303" on its
    // own line right after "Адрес: ...") -- only while no other label has
    // been seen since the address line.
    if (addressOpen[section] && contacts[section].address) {
      contacts[section].address += ', ' + line;
    }
  }

  return {
    main: contacts.main,
    council: contacts.council,
    telephoneDirectoryNote,
    mayorReceptionNote,
  };
}

// ---------------------------------------------------------------------------
// Council structure page ("Структура") -- real councilor roster
// ---------------------------------------------------------------------------

const PARTY_HEADER_RE = /^(.*?)[\s–-]+\d+\s+МАНДАТ[А]?\.?\s*$/i;
const CHAIR_SUFFIX_RE = /\s*[–-]\s*Председател\s+на\s+Общинския\s+съвет\s*$/i;

/**
 * Parse the "Структура" page into { members: [{name, party}], chairName }.
 * Pure function of the HTML string -- safe to unit test against a saved
 * fixture without any network access.
 */
function parseCouncilStructurePage(html) {
  const $ = parseHtml(html);
  const members = [];
  let currentParty = null;
  let chairName = null;

  $('.new-item-content p').each((_, el) => {
    const text = $(el).text().replace(/[\s ]+/g, ' ').trim();
    if (!text) return;

    const headerMatch = PARTY_HEADER_RE.exec(text);
    if (headerMatch) {
      currentParty = headerMatch[1].trim();
      return;
    }

    // Skip intro paragraphs before the first party header (e.g. "СЪСТАВЪТ
    // НА ОБЩИНСКИЯ СЪВЕТ Е ОТ 21 ОБЩИНСКИ СЪВЕТНИЦИ").
    if (!currentParty) return;

    let name = text;
    const chairMatch = CHAIR_SUFFIX_RE.exec(name);
    if (chairMatch) {
      name = name.slice(0, chairMatch.index).trim();
      chairName = name;
    }

    members.push({ name, party: currentParty });
  });

  return { members, chairName };
}

// ---------------------------------------------------------------------------
// Committees page ("Комисии") -- real committee roster
// ---------------------------------------------------------------------------

// NOTE: no trailing \b here -- \b is defined in terms of the ASCII \w
// class, so it does not recognize a boundary between two Cyrillic
// characters (or Cyrillic + whitespace) in a non-unicode-flag regex, and
// would silently fail to match every real header on this page.
const COMMITTEE_HEADER_RE = /^КОМИСИЯ/i;
const ROLE_SUFFIX_RE = /\s*[–-]\s*Председател\s*$/i;

/**
 * Parse the "Комисии" page into a list of
 * { name, members: [{name, role}] }, role is 'Председател' or null.
 * Pure function of the HTML string -- safe to unit test against a saved
 * fixture without any network access.
 */
function parseCommitteesPage(html) {
  const $ = parseHtml(html);
  const committees = [];
  let current = null;

  $('.new-item-content p').each((_, el) => {
    const text = $(el).text().replace(/[\s ]+/g, ' ').trim();
    if (!text) return;

    if (COMMITTEE_HEADER_RE.test(text)) {
      current = { name: text.replace(/:\s*$/, '').trim(), members: [] };
      committees.push(current);
      return;
    }

    if (!current) return;

    let name = text;
    let role = null;
    const roleMatch = ROLE_SUFFIX_RE.exec(name);
    if (roleMatch) {
      name = name.slice(0, roleMatch.index).trim();
      role = 'Председател';
    }

    current.members.push({ name, role });
  });

  return committees;
}

// ---------------------------------------------------------------------------
// DB upserts -- all insert-only-if-missing, see module docstring.
// ---------------------------------------------------------------------------

function upsertDepartment(name, description, sourceUrl, scrapedAt) {
  const existing = db.prepare('SELECT id FROM departments WHERE name = ?').get(name);
  if (existing) return existing.id;

  const info = db
    .prepare(
      `INSERT INTO departments (name, description, source_url, scraped_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(name, description || null, sourceUrl, scrapedAt);
  return info.lastInsertRowid;
}

function upsertOfficial({ name, position, departmentId, email, phone, sourceUrl, scrapedAt }) {
  const existing = db
    .prepare('SELECT id FROM officials WHERE name = ? AND department_id IS ?')
    .get(name, departmentId);
  if (existing) return { id: existing.id, created: false };

  const info = db
    .prepare(
      `INSERT INTO officials (name, position, department_id, email, phone, source_url, scraped_at)
       VALUES (@name, @position, @department_id, @email, @phone, @source_url, @scraped_at)`
    )
    .run({
      name,
      position: position || null,
      department_id: departmentId || null,
      email: email || null,
      phone: phone || null,
      source_url: sourceUrl,
      scraped_at: scrapedAt,
    });
  return { id: info.lastInsertRowid, created: true };
}

function upsertCouncilMember(name, party, sourceUrl, scrapedAt) {
  const existing = db.prepare('SELECT id FROM council_members WHERE name = ?').get(name);
  if (existing) return { id: existing.id, created: false };

  const info = db
    .prepare(
      `INSERT INTO council_members (name, party, source_url, scraped_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(name, party || null, sourceUrl, scrapedAt);
  return { id: info.lastInsertRowid, created: true };
}

function upsertCommittee(name, sourceUrl, scrapedAt) {
  const existing = db.prepare('SELECT id FROM committees WHERE name = ?').get(name);
  if (existing) return { id: existing.id, created: false };

  const info = db
    .prepare(`INSERT INTO committees (name, source_url, scraped_at) VALUES (?, ?, ?)`)
    .run(name, sourceUrl, scrapedAt);
  return { id: info.lastInsertRowid, created: true };
}

// Strips common honorific/title prefixes (e.g. "д-р " / "Dr.") so a
// committee roster entry like "д-р Дилян Феликсов Симеонов" still matches
// the same person's plain "Дилян Феликсов Симеонов" entry on the structure
// page -- confirmed against the real fixtures this module was built
// against (the committees page prefixes this one member with "д-р " where
// the structure page does not).
function normalizeNameForMatch(name) {
  return (name || '')
    .replace(/^(д-р|проф\.|инж\.|адв\.)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function upsertMembership(councilMemberId, committeeId, role, sourceUrl, scrapedAt) {
  const existing = db
    .prepare(
      'SELECT id FROM committee_memberships WHERE council_member_id = ? AND committee_id = ?'
    )
    .get(councilMemberId, committeeId);
  if (existing) return { created: false };

  db.prepare(
    `INSERT INTO committee_memberships
      (council_member_id, committee_id, role, review_status, source_url, scraped_at)
     VALUES (?, ?, ?, 'approved', ?, ?)`
  ).run(councilMemberId, committeeId, role || null, sourceUrl, scrapedAt);
  return { created: true };
}

// ---------------------------------------------------------------------------
// Main entrypoint
// ---------------------------------------------------------------------------

async function scrapeAdministration() {
  let upserted = 0;
  const scrapedAt = new Date().toISOString();

  // -- Contacts (weak source: 2 generic contact points) -------------------
  let contactsParsed = null;
  try {
    const res = await politeFetch(CONTACTS_URL);
    const html = await res.text();
    contactsParsed = parseContactsPage(html);
  } catch (err) {
    console.warn('[administration] failed to fetch/parse contacts page:', err.message);
  }

  // -- Council structure (real roster) -------------------------------------
  let structureParsed = null;
  try {
    const res = await politeFetch(STRUCTURE_URL);
    const html = await res.text();
    structureParsed = parseCouncilStructurePage(html);
  } catch (err) {
    console.warn('[administration] failed to fetch/parse council structure page:', err.message);
  }

  if (contactsParsed) {
    const mainDescParts = [];
    if (contactsParsed.main.address) mainDescParts.push(`Адрес: ${contactsParsed.main.address}`);
    if (contactsParsed.mayorReceptionNote) mainDescParts.push(contactsParsed.mayorReceptionNote);
    if (contactsParsed.telephoneDirectoryNote)
      mainDescParts.push(contactsParsed.telephoneDirectoryNote);

    const mainDeptId = upsertDepartment(
      'Общинска администрация',
      mainDescParts.join(' ') || null,
      CONTACTS_URL,
      scrapedAt
    );

    if (contactsParsed.main.phone || contactsParsed.main.email) {
      const { created } = upsertOfficial({
        // No individual name is published for the general municipal line on
        // this page (only the mayor's reception hours, with no name given)
        // -- honestly represent this as a general contact point rather than
        // inventing a person, per this module's brief.
        name: 'Общинска администрация — обща информация',
        position: 'Дежурен телефон / приемна',
        departmentId: mainDeptId,
        email: contactsParsed.main.email,
        phone: contactsParsed.main.phone,
        sourceUrl: CONTACTS_URL,
        scrapedAt,
      });
      if (created) upserted += 1;
    }

    const councilDescParts = [];
    if (contactsParsed.council.address)
      councilDescParts.push(`Адрес: ${contactsParsed.council.address}`);

    const councilDeptId = upsertDepartment(
      'Общински съвет',
      councilDescParts.join(' ') || null,
      CONTACTS_URL,
      scrapedAt
    );

    if (contactsParsed.council.phone || contactsParsed.council.email) {
      // Unlike the main line, the council's contact email
      // (predsedatel.lom@abv.bg) IS genuinely the chairwoman's official
      // address -- if the structure page scrape above found her real name,
      // attribute the contact record to her by name honestly; otherwise
      // fall back to a generic (non-fabricated) label.
      const chairName = structureParsed && structureParsed.chairName;
      const { created } = upsertOfficial({
        name: chairName || 'Общински съвет — приемна',
        position: chairName ? 'Председател на Общинския съвет' : 'Дежурен телефон / приемна',
        departmentId: councilDeptId,
        email: contactsParsed.council.email,
        phone: contactsParsed.council.phone,
        sourceUrl: CONTACTS_URL,
        scrapedAt,
      });
      if (created) upserted += 1;
    }
  }

  if (structureParsed) {
    for (const member of structureParsed.members) {
      const { created } = upsertCouncilMember(
        member.name,
        member.party,
        STRUCTURE_URL,
        scrapedAt
      );
      if (created) upserted += 1;
    }
  }

  // -- Committees (real roster, links back to council members above) ------
  try {
    const res = await politeFetch(COMMITTEES_URL);
    const html = await res.text();
    const committees = parseCommitteesPage(html);

    // Build a normalized-name -> id lookup once (rather than a query per
    // committee member) so titled variants like "д-р Дилян Феликсов
    // Симеонов" still resolve to the same council member as the plain name
    // on the structure page -- see normalizeNameForMatch() above.
    const allMembers = db.prepare('SELECT id, name FROM council_members').all();
    const memberIdByNormalizedName = new Map(
      allMembers.map((m) => [normalizeNameForMatch(m.name), m.id])
    );

    for (const committee of committees) {
      const { id: committeeId, created: committeeCreated } = upsertCommittee(
        committee.name,
        COMMITTEES_URL,
        scrapedAt
      );
      if (committeeCreated) upserted += 1;

      for (const member of committee.members) {
        const memberId = memberIdByNormalizedName.get(normalizeNameForMatch(member.name));

        if (!memberId) {
          // Committee rosters should only ever reference councilors already
          // known from the structure page scrape above -- if one isn't
          // found (e.g. a name-spelling mismatch between the two source
          // pages), skip creating the membership rather than fabricating a
          // councilor with no party affiliation on file.
          console.warn(
            `[administration] committee "${committee.name}" references unknown council member "${member.name}" -- skipping membership`
          );
          continue;
        }

        const { created: membershipCreated } = upsertMembership(
          memberId,
          committeeId,
          member.role,
          COMMITTEES_URL,
          scrapedAt
        );
        if (membershipCreated) upserted += 1;
      }
    }
  } catch (err) {
    console.warn('[administration] failed to fetch/parse committees page:', err.message);
  }

  return { upserted };
}

module.exports = scrapeAdministration;
module.exports.parseContactsPage = parseContactsPage;
module.exports.parseCouncilStructurePage = parseCouncilStructurePage;
module.exports.parseCommitteesPage = parseCommitteesPage;
