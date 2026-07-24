'use strict';

// Schema module for "Общинска администрация / контакти" (Administration &
// Contacts). Auto-required and executed by server/db/index.js -- do not
// require this file directly anywhere else.
//
// departments             -- top-level org units (e.g. "Общинска администрация")
// officials               -- staff/contacts, optionally attached to a department
// council_members         -- municipal councilors (name + party)
// committees              -- standing council committees/commissions
// committee_memberships   -- join table: which council member sits on which
//                             committee, with an optional role (e.g. "Председател")
//
// committee_memberships carries the shared review/source/timestamp columns
// (required verbatim on every content table per project convention) but is
// NOT registered in reviewRegistry -- its own review_status is set to
// 'approved' at creation time (memberships are only ever admin-authored via
// the admin-gated POST /committee-memberships route, never scraped, so there
// is nothing for a human to triage) and public visibility is instead gated
// by joining against the parent council_member's (and committee's) own
// review_status. See routes/modules/administration.js for the exact query.

const REVIEW_COLUMNS = `
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending','approved','rejected')),
  source_url TEXT,
  scraped_at TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
`;

function defineSchema(db) {
  // Needed for ON DELETE CASCADE / SET NULL below to actually take effect --
  // this module sorts alphabetically before budget.js (which also sets this
  // pragma), so we can't rely on another module having done it first.
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      ${REVIEW_COLUMNS}
    );

    CREATE TABLE IF NOT EXISTS officials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      position TEXT,
      department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
      email TEXT,
      phone TEXT,
      ${REVIEW_COLUMNS}
    );

    CREATE TABLE IF NOT EXISTS council_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      party TEXT,
      ${REVIEW_COLUMNS}
    );

    CREATE TABLE IF NOT EXISTS committees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      ${REVIEW_COLUMNS}
    );

    CREATE TABLE IF NOT EXISTS committee_memberships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      council_member_id INTEGER NOT NULL REFERENCES council_members(id) ON DELETE CASCADE,
      committee_id INTEGER NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
      role TEXT,
      ${REVIEW_COLUMNS},
      UNIQUE(council_member_id, committee_id)
    );

    CREATE INDEX IF NOT EXISTS idx_officials_department_id ON officials(department_id);
    CREATE INDEX IF NOT EXISTS idx_officials_review_status ON officials(review_status);
    CREATE INDEX IF NOT EXISTS idx_departments_review_status ON departments(review_status);
    CREATE INDEX IF NOT EXISTS idx_council_members_review_status ON council_members(review_status);
    CREATE INDEX IF NOT EXISTS idx_committees_review_status ON committees(review_status);
    CREATE INDEX IF NOT EXISTS idx_committee_memberships_council_member_id ON committee_memberships(council_member_id);
    CREATE INDEX IF NOT EXISTS idx_committee_memberships_committee_id ON committee_memberships(committee_id);
  `);
}

module.exports = { defineSchema };
