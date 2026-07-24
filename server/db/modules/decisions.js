'use strict';

// Schema module for the "Решения на Общински съвет" (Council Decisions)
// feature. Auto-required and executed by server/db/index.js -- do not
// require this file directly anywhere else.

const SQL = `
  CREATE TABLE IF NOT EXISTS council_decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_date TEXT,
    session_number TEXT,
    decision_number TEXT,
    title TEXT,
    summary TEXT,
    category TEXT,

    review_status TEXT NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending','approved','rejected')),
    source_url TEXT,
    scraped_at TEXT,
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE(session_number, decision_number)
  );

  CREATE INDEX IF NOT EXISTS idx_council_decisions_session_date ON council_decisions(session_date);
  CREATE INDEX IF NOT EXISTS idx_council_decisions_category ON council_decisions(category);
  CREATE INDEX IF NOT EXISTS idx_council_decisions_review_status ON council_decisions(review_status);
`;

module.exports = {
  defineSchema(db) {
    db.exec(SQL);
  },
};
