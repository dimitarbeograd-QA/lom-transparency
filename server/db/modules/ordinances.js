'use strict';

// Schema module for the "Наредби и нормативни актове" (Ordinances) feature.
// Auto-required and executed by server/db/index.js -- do not require this
// file directly anywhere else.

const SQL = `
  CREATE TABLE IF NOT EXISTS ordinances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    adoption_date TEXT,
    last_amended_date TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','repealed')),
    category TEXT,

    review_status TEXT NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending','approved','rejected')),
    source_url TEXT,
    scraped_at TEXT,
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_ordinances_status ON ordinances(status);
  CREATE INDEX IF NOT EXISTS idx_ordinances_category ON ordinances(category);
  CREATE INDEX IF NOT EXISTS idx_ordinances_review_status ON ordinances(review_status);
`;

module.exports = {
  defineSchema(db) {
    db.exec(SQL);
  },
};
