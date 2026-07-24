'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { db } = require('../../db');
const { requireAdmin } = require('../../middleware/auth');
const { registerReviewable } = require('../../reviewRegistry');

registerReviewable({
  key: 'decisions',
  table: 'council_decisions',
  titleColumn: 'title',
});

const router = express.Router();

const ALLOWED_CATEGORIES = null; // categories are free-text, no fixed enum

function serializeBody(body) {
  return {
    session_date: body.session_date || null,
    session_number: body.session_number || null,
    decision_number: body.decision_number || null,
    title: body.title || null,
    summary: body.summary || null,
    category: body.category || null,
  };
}

function isUniqueConstraintError(err) {
  return (
    err &&
    typeof err.message === 'string' &&
    err.message.includes('UNIQUE constraint failed') &&
    err.message.includes('council_decisions')
  );
}

// ---------------------------------------------------------------------------
// GET /council-decisions -- public, approved only
// Filters: session_number, category, from/to (session_date range, inclusive)
// ---------------------------------------------------------------------------
router.get('/council-decisions', (req, res) => {
  const { session_number, category, from, to } = req.query;

  const clauses = [`review_status = 'approved'`];
  const params = [];

  if (session_number) {
    clauses.push('session_number = ?');
    params.push(session_number);
  }

  if (category) {
    clauses.push('category = ?');
    params.push(category);
  }

  if (from) {
    clauses.push('session_date >= ?');
    params.push(from);
  }

  if (to) {
    clauses.push('session_date <= ?');
    params.push(to);
  }

  const sql = `SELECT * FROM council_decisions WHERE ${clauses.join(
    ' AND '
  )} ORDER BY session_date DESC, decision_number ASC`;

  const rows = db.prepare(sql).all(...params);
  return res.json({ decisions: rows });
});

// ---------------------------------------------------------------------------
// GET /admin/council-decisions -- admin, all review statuses (for the admin
// triage table). Kept at a distinct path (rather than reusing
// /council-decisions with an auth-conditional filter) so the public route
// above stays simple and unambiguous about what it returns. Optional
// ?status= filter (pending|approved|rejected); omit/'all' for everything.
// ---------------------------------------------------------------------------
router.get('/admin/council-decisions', requireAdmin, (req, res) => {
  const { status } = req.query;

  let sql = 'SELECT * FROM council_decisions';
  const params = [];

  if (status && status !== 'all') {
    sql += ' WHERE review_status = ?';
    params.push(status);
  }

  sql += ' ORDER BY created_at DESC';

  const rows = db.prepare(sql).all(...params);
  return res.json({ decisions: rows });
});

// ---------------------------------------------------------------------------
// GET /council-decisions/:id -- public (only if approved), + attachments
// ---------------------------------------------------------------------------
router.get('/council-decisions/:id', (req, res) => {
  const row = db
    .prepare(`SELECT * FROM council_decisions WHERE id = ? AND review_status = 'approved'`)
    .get(req.params.id);

  if (!row) {
    return res.status(404).json({ error: 'not_found' });
  }

  const attachments = db
    .prepare(
      `SELECT * FROM attachments WHERE entity_type = 'council_decision' AND entity_id = ? ORDER BY uploaded_at DESC`
    )
    .all(req.params.id);

  return res.json({ decision: row, attachments });
});

// ---------------------------------------------------------------------------
// POST /council-decisions -- admin
// ---------------------------------------------------------------------------
router.post('/council-decisions', requireAdmin, (req, res) => {
  const body = req.body || {};

  if (!body.title) {
    return res.status(400).json({ error: 'title is required' });
  }

  const data = serializeBody(body);

  try {
    const info = db
      .prepare(
        `INSERT INTO council_decisions
          (session_date, session_number, decision_number, title, summary, category)
         VALUES (@session_date, @session_number, @decision_number, @title, @summary, @category)`
      )
      .run(data);

    const row = db
      .prepare('SELECT * FROM council_decisions WHERE id = ?')
      .get(info.lastInsertRowid);

    return res.status(201).json({ decision: row });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return res.status(409).json({
        error: 'duplicate_decision',
        message:
          'Вече съществува решение с тези номер на сесия и номер на решение.',
      });
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// PUT /council-decisions/:id -- admin
// ---------------------------------------------------------------------------
router.put('/council-decisions/:id', requireAdmin, (req, res) => {
  const existing = db
    .prepare('SELECT * FROM council_decisions WHERE id = ?')
    .get(req.params.id);

  if (!existing) {
    return res.status(404).json({ error: 'not_found' });
  }

  const body = req.body || {};

  if ('title' in body && !body.title) {
    return res.status(400).json({ error: 'title cannot be empty' });
  }

  const data = {
    session_date:
      body.session_date !== undefined ? body.session_date : existing.session_date,
    session_number:
      body.session_number !== undefined ? body.session_number : existing.session_number,
    decision_number:
      body.decision_number !== undefined ? body.decision_number : existing.decision_number,
    title: body.title !== undefined ? body.title : existing.title,
    summary: body.summary !== undefined ? body.summary : existing.summary,
    category: body.category !== undefined ? body.category : existing.category,
    id: req.params.id,
  };

  try {
    db.prepare(
      `UPDATE council_decisions
       SET session_date = @session_date,
           session_number = @session_number,
           decision_number = @decision_number,
           title = @title,
           summary = @summary,
           category = @category,
           updated_at = datetime('now')
       WHERE id = @id`
    ).run(data);
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return res.status(409).json({
        error: 'duplicate_decision',
        message:
          'Вече съществува решение с тези номер на сесия и номер на решение.',
      });
    }
    throw err;
  }

  const row = db
    .prepare('SELECT * FROM council_decisions WHERE id = ?')
    .get(req.params.id);

  return res.json({ decision: row });
});

// ---------------------------------------------------------------------------
// DELETE /council-decisions/:id -- admin, cascades attachments (rows + files)
// ---------------------------------------------------------------------------
router.delete('/council-decisions/:id', requireAdmin, (req, res) => {
  const existing = db
    .prepare('SELECT * FROM council_decisions WHERE id = ?')
    .get(req.params.id);

  if (!existing) {
    return res.status(404).json({ error: 'not_found' });
  }

  const attachments = db
    .prepare(
      `SELECT * FROM attachments WHERE entity_type = 'council_decision' AND entity_id = ?`
    )
    .all(req.params.id);

  for (const att of attachments) {
    if (att.stored_filename) {
      const filePath = path.join(__dirname, '..', '..', 'uploads', att.stored_filename);
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.warn('[decisions] failed to unlink attachment file:', err.message);
        }
      }
    }
  }

  db.prepare(
    `DELETE FROM attachments WHERE entity_type = 'council_decision' AND entity_id = ?`
  ).run(req.params.id);

  db.prepare('DELETE FROM council_decisions WHERE id = ?').run(req.params.id);

  return res.status(204).end();
});

module.exports = router;
