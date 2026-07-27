'use strict';

// Read-only API for "Финансови показатели на общините" (Ministry of
// Finance quarterly municipal finance indicators for Община Лом).
//
// Unlike the other modules, there is no admin create/edit form here: every
// row comes straight from an official minfin.bg xlsx (see
// server/scraper/modules/minfin.js) and there are no free-text fields an
// admin would ever need to fill in by hand -- moderation is limited to the
// generic approve/reject (and bulk approve-all/reject-all) endpoints in
// server/routes/review.js, same as every other scraped-content table.

const express = require('express');
const { db } = require('../../db');
const { requireAdmin } = require('../../middleware/auth');
const { registerReviewable } = require('../../reviewRegistry');

registerReviewable({
  key: 'minfin-indicators',
  table: 'minfin_indicators',
  titleColumn: 'period_label',
});

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /minfin -- public, approved only, most recent quarter first.
// ---------------------------------------------------------------------------
router.get('/minfin', (req, res) => {
  const rows = db
    .prepare(
      `SELECT * FROM minfin_indicators
       WHERE review_status = 'approved'
       ORDER BY period_year DESC, period_quarter DESC`
    )
    .all();

  return res.json({ indicators: rows });
});

// ---------------------------------------------------------------------------
// GET /admin/minfin -- admin, all review statuses.
// ---------------------------------------------------------------------------
router.get('/admin/minfin', requireAdmin, (req, res) => {
  const { status } = req.query;

  let sql = 'SELECT * FROM minfin_indicators';
  const params = [];

  if (status && status !== 'all') {
    sql += ' WHERE review_status = ?';
    params.push(status);
  }

  sql += ' ORDER BY period_year DESC, period_quarter DESC';

  const rows = db.prepare(sql).all(...params);
  return res.json({ indicators: rows });
});

module.exports = router;
