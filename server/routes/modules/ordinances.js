'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { db } = require('../../db');
const { requireAdmin } = require('../../middleware/auth');
const { registerReviewable } = require('../../reviewRegistry');

registerReviewable({
  key: 'ordinances',
  table: 'ordinances',
  titleColumn: 'title',
});

const router = express.Router();

const STATUS_VALUES = ['active', 'repealed'];

function serializeBody(body, existing) {
  return {
    title: body.title !== undefined ? body.title : existing ? existing.title : null,
    adoption_date:
      body.adoption_date !== undefined ? body.adoption_date || null : existing ? existing.adoption_date : null,
    last_amended_date:
      body.last_amended_date !== undefined
        ? body.last_amended_date || null
        : existing
        ? existing.last_amended_date
        : null,
    status:
      body.status !== undefined ? body.status : existing ? existing.status : 'active',
    category:
      body.category !== undefined ? body.category || null : existing ? existing.category : null,
  };
}

// ---------------------------------------------------------------------------
// GET /ordinances -- public, approved only. Filters: status, category
// ---------------------------------------------------------------------------
router.get('/ordinances', (req, res) => {
  const { status, category } = req.query;

  const clauses = [`review_status = 'approved'`];
  const params = [];

  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }

  if (category) {
    clauses.push('category = ?');
    params.push(category);
  }

  const sql = `SELECT * FROM ordinances WHERE ${clauses.join(
    ' AND '
  )} ORDER BY (adoption_date IS NULL) ASC, adoption_date DESC, title ASC`;

  const rows = db.prepare(sql).all(...params);
  return res.json({ ordinances: rows });
});

// ---------------------------------------------------------------------------
// GET /admin/ordinances -- admin, all review statuses (admin triage table).
// Optional ?status= filter refers to review_status here (pending|approved|
// rejected|all) to match the admin-table convention used by other modules.
// ---------------------------------------------------------------------------
router.get('/admin/ordinances', requireAdmin, (req, res) => {
  const { status } = req.query;

  let sql = 'SELECT * FROM ordinances';
  const params = [];

  if (status && status !== 'all') {
    sql += ' WHERE review_status = ?';
    params.push(status);
  }

  sql += ' ORDER BY created_at DESC';

  const rows = db.prepare(sql).all(...params);
  return res.json({ ordinances: rows });
});

// ---------------------------------------------------------------------------
// GET /ordinances/:id -- public (only if approved), + attachments
// ---------------------------------------------------------------------------
router.get('/ordinances/:id', (req, res) => {
  const row = db
    .prepare(`SELECT * FROM ordinances WHERE id = ? AND review_status = 'approved'`)
    .get(req.params.id);

  if (!row) {
    return res.status(404).json({ error: 'not_found' });
  }

  const attachments = db
    .prepare(
      `SELECT * FROM attachments WHERE entity_type = 'ordinance' AND entity_id = ? ORDER BY uploaded_at DESC`
    )
    .all(req.params.id);

  return res.json({ ordinance: row, attachments });
});

// ---------------------------------------------------------------------------
// POST /ordinances -- admin
// ---------------------------------------------------------------------------
router.post('/ordinances', requireAdmin, (req, res) => {
  const body = req.body || {};

  if (!body.title) {
    return res.status(400).json({ error: 'title is required' });
  }

  if (body.status !== undefined && !STATUS_VALUES.includes(body.status)) {
    return res.status(400).json({ error: `status must be one of: ${STATUS_VALUES.join(', ')}` });
  }

  const data = serializeBody(body, null);

  const info = db
    .prepare(
      `INSERT INTO ordinances
        (title, adoption_date, last_amended_date, status, category)
       VALUES (@title, @adoption_date, @last_amended_date, @status, @category)`
    )
    .run(data);

  const row = db.prepare('SELECT * FROM ordinances WHERE id = ?').get(info.lastInsertRowid);

  return res.status(201).json({ ordinance: row });
});

// ---------------------------------------------------------------------------
// PUT /ordinances/:id -- admin
// ---------------------------------------------------------------------------
router.put('/ordinances/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM ordinances WHERE id = ?').get(req.params.id);

  if (!existing) {
    return res.status(404).json({ error: 'not_found' });
  }

  const body = req.body || {};

  if ('title' in body && !body.title) {
    return res.status(400).json({ error: 'title cannot be empty' });
  }

  if (body.status !== undefined && !STATUS_VALUES.includes(body.status)) {
    return res.status(400).json({ error: `status must be one of: ${STATUS_VALUES.join(', ')}` });
  }

  const data = serializeBody(body, existing);
  data.id = req.params.id;

  db.prepare(
    `UPDATE ordinances
     SET title = @title,
         adoption_date = @adoption_date,
         last_amended_date = @last_amended_date,
         status = @status,
         category = @category,
         updated_at = datetime('now')
     WHERE id = @id`
  ).run(data);

  const row = db.prepare('SELECT * FROM ordinances WHERE id = ?').get(req.params.id);

  return res.json({ ordinance: row });
});

// ---------------------------------------------------------------------------
// DELETE /ordinances/:id -- admin, cascades attachments (rows + files)
// ---------------------------------------------------------------------------
router.delete('/ordinances/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM ordinances WHERE id = ?').get(req.params.id);

  if (!existing) {
    return res.status(404).json({ error: 'not_found' });
  }

  const attachments = db
    .prepare(`SELECT * FROM attachments WHERE entity_type = 'ordinance' AND entity_id = ?`)
    .all(req.params.id);

  for (const att of attachments) {
    if (att.stored_filename) {
      const filePath = path.join(__dirname, '..', '..', 'uploads', att.stored_filename);
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.warn('[ordinances] failed to unlink attachment file:', err.message);
        }
      }
    }
  }

  db.prepare(`DELETE FROM attachments WHERE entity_type = 'ordinance' AND entity_id = ?`).run(
    req.params.id
  );

  db.prepare('DELETE FROM ordinances WHERE id = ?').run(req.params.id);

  return res.status(204).end();
});

module.exports = router;
