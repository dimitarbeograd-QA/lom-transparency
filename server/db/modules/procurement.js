'use strict';

// Schema module for "Обществени поръчки" (Public Procurement).
// Auto-required and executed by server/db/index.js -- do not require this
// file directly anywhere else.
//
// project_id is an OPTIONAL cross-link to the budget module's `projects`
// table (server/db/modules/budget.js). It is declared as a plain nullable
// INTEGER with NO `REFERENCES projects(id)` clause on purpose: the budget
// module turns `PRAGMA foreign_keys = ON` on for the whole shared db
// connection, and per-module schema files are auto-loaded in alphabetical
// filename order (budget -> decisions -> ordinances -> procurement), so in
// the *current* load order that pragma would already be active by the time
// this file runs -- but that ordering is an incidental side effect of
// filenames, not a guarantee, and a future module alphabetically before
// "budget" (or a rename) could flip it. Rather than depend on cross-module
// load order for a FK to behave correctly, this stays a plain nullable
// INTEGER; application code must not assume referential integrity is
// enforced by SQLite here.

const SQL = `
  CREATE TABLE IF NOT EXISTS procurements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    procedure_type TEXT,
    estimated_value REAL,
    publish_date TEXT,
    deadline_date TEXT,
    status TEXT NOT NULL DEFAULT 'обявена' CHECK(status IN ('обявена','в ход','възложена','приключена','прекратена')),
    awarded_contractor TEXT,
    contract_value REAL,
    contract_date TEXT,
    project_id INTEGER,

    review_status TEXT NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending','approved','rejected')),
    source_url TEXT,
    scraped_at TEXT,
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE(source_url)
  );

  CREATE INDEX IF NOT EXISTS idx_procurements_status ON procurements(status);
  CREATE INDEX IF NOT EXISTS idx_procurements_procedure_type ON procurements(procedure_type);
  CREATE INDEX IF NOT EXISTS idx_procurements_publish_date ON procurements(publish_date);
  CREATE INDEX IF NOT EXISTS idx_procurements_review_status ON procurements(review_status);
  CREATE INDEX IF NOT EXISTS idx_procurements_project_id ON procurements(project_id);
`;

module.exports = {
  defineSchema(db) {
    db.exec(SQL);
  },
};
