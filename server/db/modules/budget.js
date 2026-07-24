'use strict';

// Schema for the "Бюджет и разходи по проекти" (Budget & Expenditures) module.
//
// projects        -- top-level entities (a municipal project / budget program)
// budget_lines    -- per-year allocated amounts for a project, by funding source
// expenditures    -- actual spend against a project, tied to a vendor/document
//
// Both budget_lines and expenditures cascade-delete when their parent project
// is deleted (enforced via PRAGMA foreign_keys = ON, set below -- better-sqlite3
// does not enforce FKs unless this pragma is explicitly turned on for the
// connection).

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
  // Needed for ON DELETE CASCADE below to actually take effect.
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'completed')),
      ${REVIEW_COLUMNS}
    );

    CREATE TABLE IF NOT EXISTS budget_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      year INTEGER,
      funding_source TEXT,
      allocated_amount REAL CHECK (allocated_amount IS NULL OR allocated_amount >= 0),
      notes TEXT,
      ${REVIEW_COLUMNS}
    );

    CREATE TABLE IF NOT EXISTS expenditures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      vendor_name TEXT,
      amount REAL CHECK (amount IS NULL OR amount >= 0),
      expenditure_date TEXT,
      document_reference TEXT,
      description TEXT,
      ${REVIEW_COLUMNS}
    );

    CREATE INDEX IF NOT EXISTS idx_budget_lines_project_id ON budget_lines(project_id);
    CREATE INDEX IF NOT EXISTS idx_expenditures_project_id ON expenditures(project_id);
    CREATE INDEX IF NOT EXISTS idx_budget_lines_year ON budget_lines(year);
    CREATE INDEX IF NOT EXISTS idx_projects_category ON projects(category);
    CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
  `);
}

module.exports = { defineSchema };
