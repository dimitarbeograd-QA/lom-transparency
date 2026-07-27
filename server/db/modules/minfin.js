'use strict';

// Schema module for the "Финансови показатели на общините" (Ministry of
// Finance quarterly municipal finance indicators) feature.
// Auto-required and executed by server/db/index.js -- do not require this
// file directly anywhere else.
//
// Source: minfin.bg publishes one xlsx per quarter under "Финансови
// показатели на общините" (https://www.minfin.bg/bg/810), each covering
// the current quarter plus the same quarter a year ago and the previous
// quarter (three period columns per indicator, for one row per
// municipality). This table stores one row per real (period_year,
// period_quarter) for Община Лом specifically, re-fetched/upserted as
// newer files revise or extend the series -- see
// server/scraper/modules/minfin.js.

const SQL = `
  CREATE TABLE IF NOT EXISTS minfin_indicators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_year INTEGER NOT NULL,
    period_quarter INTEGER NOT NULL CHECK(period_quarter IN (1,2,3,4)),
    period_label TEXT NOT NULL,

    own_revenue REAL,
    expenditure REAL,
    budget_balance REAL,
    available_cash REAL,
    municipal_debt REAL,
    arrears REAL,
    obligations_for_expenditure REAL,
    committed_appropriations REAL,

    review_status TEXT NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending','approved','rejected')),
    source_url TEXT,
    source_file TEXT,
    scraped_at TEXT,
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE(period_year, period_quarter)
  );

  CREATE INDEX IF NOT EXISTS idx_minfin_indicators_review_status ON minfin_indicators(review_status);
`;

module.exports = {
  defineSchema(db) {
    db.exec(SQL);
  },
};
