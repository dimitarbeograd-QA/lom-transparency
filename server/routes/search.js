'use strict';

// Global site search -- cross-cutting by nature (has to know about every
// module's table), so it lives here as a base route (like auth.js/
// attachments.js/review.js) rather than under routes/modules/, same
// reasoning as reviewRegistry.js: this is infrastructure every module
// plugs into, not a module of its own.
//
// Only ever queries review_status = 'approved' rows -- same visibility
// rule as every public GET endpoint elsewhere in the app. Each source is a
// simple `LIKE` scan over its own title-ish column(s); no FTS5 virtual
// table, since the corpus here is a few hundred rows per table, not
// something that needs a real search index.

const express = require('express');
const { db } = require('../db');

const router = express.Router();

const MIN_QUERY_LENGTH = 2;
const LIMIT_PER_SOURCE = 8;

const SOURCES = [
  {
    type: 'budget',
    label: 'Бюджет',
    sql: `SELECT id, name AS title, category AS meta FROM projects
          WHERE review_status = 'approved' AND name LIKE ? ORDER BY name LIMIT ?`,
    href: (row) => `/budget/project.html?id=${row.id}`,
  },
  {
    type: 'procurement',
    label: 'Обществени поръчки',
    sql: `SELECT id, title, procedure_type AS meta FROM procurements
          WHERE review_status = 'approved' AND title LIKE ? ORDER BY publish_date DESC LIMIT ?`,
    href: (row) => `/procurement/detail.html?id=${row.id}`,
  },
  {
    type: 'decisions',
    label: 'Решения на ОбС',
    sql: `SELECT id, title, session_number AS meta FROM council_decisions
          WHERE review_status = 'approved' AND title LIKE ? ORDER BY session_date DESC LIMIT ?`,
    href: (row) => `/decisions/detail.html?id=${row.id}`,
  },
  {
    type: 'ordinances',
    label: 'Наредби',
    sql: `SELECT id, title, category AS meta FROM ordinances
          WHERE review_status = 'approved' AND title LIKE ? ORDER BY title LIMIT ?`,
    href: (row) => `/ordinances/detail.html?id=${row.id}`,
  },
  {
    type: 'officials',
    label: 'Администрация',
    sql: `SELECT id, name AS title, position AS meta FROM officials
          WHERE review_status = 'approved' AND name LIKE ? ORDER BY name LIMIT ?`,
    href: () => `/administration/`,
  },
  {
    type: 'council_members',
    label: 'Общински съветници',
    sql: `SELECT id, name AS title, party AS meta FROM council_members
          WHERE review_status = 'approved' AND name LIKE ? ORDER BY name LIMIT ?`,
    href: () => `/administration/`,
  },
  {
    type: 'departments',
    label: 'Администрация',
    sql: `SELECT id, name AS title, description AS meta FROM departments
          WHERE review_status = 'approved' AND name LIKE ? ORDER BY name LIMIT ?`,
    href: () => `/administration/`,
  },
];

router.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();

  if (q.length < MIN_QUERY_LENGTH) {
    return res.json({ query: q, groups: [] });
  }

  const like = `%${q}%`;
  const groups = [];

  for (const source of SOURCES) {
    const rows = db.prepare(source.sql).all(like, LIMIT_PER_SOURCE);
    if (rows.length === 0) continue;

    const existing = groups.find((g) => g.label === source.label);
    const items = rows.map((row) => ({
      id: row.id,
      title: row.title,
      meta: row.meta || null,
      type: source.type,
      href: source.href(row),
    }));

    if (existing) {
      existing.items.push(...items);
    } else {
      groups.push({ label: source.label, items });
    }
  }

  return res.json({ query: q, groups });
});

module.exports = router;
