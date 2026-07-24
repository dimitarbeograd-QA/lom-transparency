'use strict';

const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseContactsPage,
  parseCouncilStructurePage,
  parseCommitteesPage,
} = require('../scraper/modules/administration');

const FIXTURES_DIR = path.join(__dirname, '..', 'scraper', '__fixtures__');
const contactsHtml = fs.readFileSync(
  path.join(FIXTURES_DIR, 'administration-kontakti.html'),
  'utf8'
);
const structureHtml = fs.readFileSync(
  path.join(FIXTURES_DIR, 'administration-council-structure.html'),
  'utf8'
);
const commissionsHtml = fs.readFileSync(
  path.join(FIXTURES_DIR, 'administration-council-commissions.html'),
  'utf8'
);

// ---------------------------------------------------------------------------
// parseContactsPage
// ---------------------------------------------------------------------------

test('parseContactsPage extracts the main municipality contact block from the real saved fixture', () => {
  const result = parseContactsPage(contactsHtml);

  assert.equal(result.main.address, '3600 Лом, ул. "Дунавска" №12');
  assert.equal(result.main.phone, '0971/69 101');
  assert.equal(result.main.fax, '0971/66 026');
  assert.equal(result.main.email, 'lom.municipality@lom.egov.bg');
});

test('parseContactsPage extracts the separate council contact block, including the multi-line address', () => {
  const result = parseContactsPage(contactsHtml);

  assert.equal(
    result.council.address,
    '3600 Лом, ул. "Дунавска" №12, ет. 3 стая № 303'
  );
  assert.equal(result.council.phone, '0971/69 131');
  assert.equal(result.council.fax, '0971/66 026');
  assert.equal(result.council.email, 'predsedatel.lom@abv.bg');
});

test('parseContactsPage surfaces the "телефонен указател в процес на актуализация" and mayor reception notes', () => {
  const result = parseContactsPage(contactsHtml);

  assert.match(result.telephoneDirectoryNote, /в процес на актуализация/i);
  assert.match(result.mayorReceptionNote, /Приемно време на кмета/i);
});

test('parseContactsPage does not confuse the mayor-reception sentence for a phone field (it mentions "тел." mid-sentence, not as a line-start label)', () => {
  const result = parseContactsPage(contactsHtml);

  // The main phone must stay the clean "0971/69 101" value from its own
  // dedicated "тел: ..." line, not get overwritten/polluted by the mayor
  // reception sentence that happens to also mention a phone number.
  assert.equal(result.main.phone, '0971/69 101');
});

// ---------------------------------------------------------------------------
// parseCouncilStructurePage
// ---------------------------------------------------------------------------

test('parseCouncilStructurePage extracts all 21 councilors grouped by party from the real saved fixture', () => {
  const result = parseCouncilStructurePage(structureHtml);

  assert.equal(result.members.length, 21);

  const parties = new Set(result.members.map((m) => m.party));
  assert.ok(parties.has('ПП ГЕРБ'));
  assert.ok([...parties].some((p) => p.includes('БСП ЗА БЪЛГАРИЯ')));
  assert.ok([...parties].some((p) => p.includes('ВЪЗРАЖДАНЕ')));

  const gerb = result.members.filter((m) => m.party === 'ПП ГЕРБ');
  assert.equal(gerb.length, 9);
  assert.ok(gerb.some((m) => m.name === 'Александър Любомиров Михайлов'));
});

test('parseCouncilStructurePage identifies the council chairwoman and strips her role suffix from the name', () => {
  const result = parseCouncilStructurePage(structureHtml);

  assert.equal(result.chairName, 'Пенка Неделкова Пенкова');

  const chairMember = result.members.find((m) => m.name === 'Пенка Неделкова Пенкова');
  assert.ok(chairMember, 'chairwoman should also appear as a plain member with her party');
  assert.doesNotMatch(chairMember.name, /Председател/);
});

test('parseCouncilStructurePage ignores the intro paragraphs before the first party header', () => {
  const result = parseCouncilStructurePage(structureHtml);

  assert.ok(
    !result.members.some((m) => /СЪСТАВЪТ НА ОБЩИНСКИЯ СЪВЕТ/i.test(m.name)),
    'the "СЪСТАВЪТ НА ОБЩИНСКИЯ СЪВЕТ..." intro line must not be treated as a councilor'
  );
});

// ---------------------------------------------------------------------------
// parseCommitteesPage
// ---------------------------------------------------------------------------

test('parseCommitteesPage extracts all 9 standing committees with 5 members each from the real saved fixture', () => {
  const result = parseCommitteesPage(commissionsHtml);

  assert.equal(result.length, 9);
  for (const committee of result) {
    assert.match(committee.name, /^КОМИСИЯ/);
    assert.equal(committee.members.length, 5);
  }
});

test('parseCommitteesPage identifies each committee chair via the "- Председател" / "– Председател" suffix (both dash variants) and strips it from the name', () => {
  const result = parseCommitteesPage(commissionsHtml);

  const finance = result.find((c) => /ФИНАНСИ/.test(c.name));
  assert.ok(finance);
  assert.equal(finance.members[0].name, 'Христина Стефанова Христова');
  assert.equal(finance.members[0].role, 'Председател');
  assert.equal(finance.members[1].role, null);

  // "КОМИСИЯ ПО РАЗВИТИЕТО НА МЛАДЕЖТА..." uses an en-dash ("–") before
  // "Председател" rather than a hyphen -- both must be handled.
  const youth = result.find((c) => /МЛАДЕЖТА/.test(c.name));
  assert.ok(youth);
  assert.equal(youth.members[0].name, 'Борислав Цветанов Борисов');
  assert.equal(youth.members[0].role, 'Председател');
});

test('parseCommitteesPage keeps the "д-р" title prefix on a member name as parsed (matching to council_members is normalized separately at scrape time)', () => {
  const result = parseCommitteesPage(commissionsHtml);

  const health = result.find((c) => /ЗДРАВЕОПАЗВАНЕ/.test(c.name));
  assert.ok(health);
  assert.equal(health.members[0].name, 'д-р Дилян Феликсов Симеонов');
  assert.equal(health.members[0].role, 'Председател');
});
