'use strict';

const express = require('express');
const { db } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { getReviewables } = require('../reviewRegistry');

const router = express.Router();

// Scoped to '/review' only -- this router is mounted unprefixed alongside
// every other route file (see routes/index.js), so an unscoped
// `router.use(requireAdmin)` here would have gated EVERY request that
// reaches this router instance, including ones meant for later-mounted
// module routers (e.g. GET /projects), since Express short-circuits on a
// 401 response before the request can fall through to sibling routers.
router.use('/review', requireAdmin);

router.get('/review/pending', (req, res) => {
  const modules = getReviewables().map(({ key, table, titleColumn }) => {
    const items = db
      .prepare(
        `SELECT * FROM ${table} WHERE review_status = 'pending' ORDER BY created_at DESC`
      )
      .all();
    return { key, table, titleColumn, items };
  });

  return res.json({ modules });
});

function findReviewableByTable(table) {
  return getReviewables().find((r) => r.table === table);
}

function setReviewStatus(status) {
  return (req, res) => {
    const { table, id } = req.params;

    // This is the actual security boundary: only tables that a trusted
    // module registered via registerReviewable() may be targeted here, not
    // just a SQL-injection concern -- an arbitrary table name must never be
    // reachable from a request even if it were "safe" SQL.
    const reviewable = findReviewableByTable(table);
    if (!reviewable) {
      return res.status(403).json({ error: 'unknown_reviewable_table' });
    }

    const info = db
      .prepare(
        `UPDATE ${table}
         SET review_status = ?, reviewed_by = ?, reviewed_at = datetime('now')
         WHERE id = ?`
      )
      .run(status, req.user.id, id);

    if (info.changes === 0) {
      return res.status(404).json({ error: 'not_found' });
    }

    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    return res.json({ item: row });
  };
}

router.post('/review/:table/:id/approve', setReviewStatus('approved'));
router.post('/review/:table/:id/reject', setReviewStatus('rejected'));

// Bulk approve/reject -- added after the initial build: a scraper run can
// easily leave hundreds of pending rows in one table (e.g. a full
// procurement-history backfill), and clicking "Одобри" one row at a time on
// that scale isn't realistic admin UX. Same security boundary as the
// single-row routes (table must be a registered reviewable); acts only on
// rows currently 'pending' so it's safe to call repeatedly.
function setReviewStatusBulk(status) {
  return (req, res) => {
    const { table } = req.params;

    const reviewable = findReviewableByTable(table);
    if (!reviewable) {
      return res.status(403).json({ error: 'unknown_reviewable_table' });
    }

    const info = db
      .prepare(
        `UPDATE ${table}
         SET review_status = ?, reviewed_by = ?, reviewed_at = datetime('now')
         WHERE review_status = 'pending'`
      )
      .run(status, req.user.id);

    return res.json({ updated: info.changes });
  };
}

router.post('/review/:table/approve-all', setReviewStatusBulk('approved'));
router.post('/review/:table/reject-all', setReviewStatusBulk('rejected'));

module.exports = router;
