'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { db } = require('../../db');
const { requireAdmin } = require('../../middleware/auth');
const { registerReviewable } = require('../../reviewRegistry');

registerReviewable({
  key: 'procurement',
  table: 'procurements',
  titleColumn: 'title',
});

const router = express.Router();

const STATUS_VALUES = ['обявена', 'в ход', 'възложена', 'приключена', 'прекратена'];

function isUniqueConstraintError(err) {
  return (
    err &&
    typeof err.message === 'string' &&
    err.message.includes('UNIQUE constraint failed') &&
    err.message.includes('procurements')
  );
}

function toNullableNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function serializeBody(body) {
  return {
    title: body.title || null,
    description: body.description || null,
    procedure_type: body.procedure_type || null,
    estimated_value: toNullableNumber(body.estimated_value),
    publish_date: body.publish_date || null,
    deadline_date: body.deadline_date || null,
    status: body.status || 'обявена',
    awarded_contractor: body.awarded_contractor || null,
    contract_value: toNullableNumber(body.contract_value),
    contract_date: body.contract_date || null,
    project_id: body.project_id === undefined || body.project_id === null || body.project_id === '' ? null : Number(body.project_id),
  };
}

// ---------------------------------------------------------------------------
// GET /procurements -- public, approved only
// Filters: status, procedure_type, year (matched against publish_date's
// leading YYYY)
// ---------------------------------------------------------------------------
router.get('/procurements', (req, res) => {
  const { status, procedure_type, year, project_id } = req.query;

  const clauses = [`review_status = 'approved'`];
  const params = [];

  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }

  if (procedure_type) {
    clauses.push('procedure_type = ?');
    params.push(procedure_type);
  }

  if (year) {
    clauses.push(`strftime('%Y', publish_date) = ?`);
    params.push(String(year));
  }

  if (project_id) {
    clauses.push('project_id = ?');
    params.push(Number(project_id));
  }

  const sql = `SELECT * FROM procurements WHERE ${clauses.join(
    ' AND '
  )} ORDER BY publish_date DESC, id DESC`;

  const rows = db.prepare(sql).all(...params);
  return res.json({ procurements: rows });
});

// ---------------------------------------------------------------------------
// GET /admin/procurements -- admin, all review statuses (admin triage table)
// Optional ?status= filter is the REVIEW status here (pending|approved|
// rejected|all), matching the admin pages of the other modules -- not to be
// confused with the procurement lifecycle `status` column filtered above on
// the public route.
// ---------------------------------------------------------------------------
router.get('/admin/procurements', requireAdmin, (req, res) => {
  const { status } = req.query;

  let sql = 'SELECT * FROM procurements';
  const params = [];

  if (status && status !== 'all') {
    sql += ' WHERE review_status = ?';
    params.push(status);
  }

  sql += ' ORDER BY created_at DESC';

  const rows = db.prepare(sql).all(...params);
  return res.json({ procurements: rows });
});

// ---------------------------------------------------------------------------
// GET /procurements/:id -- public (only if approved), + attachments
// ---------------------------------------------------------------------------
router.get('/procurements/:id', (req, res) => {
  const row = db
    .prepare(`SELECT * FROM procurements WHERE id = ? AND review_status = 'approved'`)
    .get(req.params.id);

  if (!row) {
    return res.status(404).json({ error: 'not_found' });
  }

  const attachments = db
    .prepare(
      `SELECT * FROM attachments WHERE entity_type = 'procurement' AND entity_id = ? ORDER BY uploaded_at DESC`
    )
    .all(req.params.id);

  // Cross-link to the budget module: if this procurement is tied to a
  // budget project, surface that project's id/name (only when the project
  // itself is public/approved) so the detail page can link to
  // /budget/project.html?id=<id> without a second round trip.
  let project = null;
  if (row.project_id) {
    project = db
      .prepare(`SELECT id, name FROM projects WHERE id = ? AND review_status = 'approved'`)
      .get(row.project_id) || null;
  }

  return res.json({ procurement: row, attachments, project });
});

// ---------------------------------------------------------------------------
// POST /procurements -- admin
// ---------------------------------------------------------------------------
router.post('/procurements', requireAdmin, (req, res) => {
  const body = req.body || {};

  if (!body.title) {
    return res.status(400).json({ error: 'title is required' });
  }

  if (body.status && !STATUS_VALUES.includes(body.status)) {
    return res.status(400).json({
      error: `status must be one of: ${STATUS_VALUES.join(', ')}`,
    });
  }

  const data = serializeBody(body);

  try {
    const info = db
      .prepare(
        `INSERT INTO procurements
          (title, description, procedure_type, estimated_value, publish_date, deadline_date,
           status, awarded_contractor, contract_value, contract_date, project_id)
         VALUES (@title, @description, @procedure_type, @estimated_value, @publish_date, @deadline_date,
           @status, @awarded_contractor, @contract_value, @contract_date, @project_id)`
      )
      .run(data);

    const row = db.prepare('SELECT * FROM procurements WHERE id = ?').get(info.lastInsertRowid);

    return res.status(201).json({ procurement: row });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return res.status(409).json({
        error: 'duplicate_procurement',
        message: 'Вече съществува поръчка с този източник (source_url).',
      });
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// PUT /procurements/:id -- admin
// ---------------------------------------------------------------------------
router.put('/procurements/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM procurements WHERE id = ?').get(req.params.id);

  if (!existing) {
    return res.status(404).json({ error: 'not_found' });
  }

  const body = req.body || {};

  if ('title' in body && !body.title) {
    return res.status(400).json({ error: 'title cannot be empty' });
  }

  if (body.status && !STATUS_VALUES.includes(body.status)) {
    return res.status(400).json({
      error: `status must be one of: ${STATUS_VALUES.join(', ')}`,
    });
  }

  const merged = Object.assign({}, existing, body);
  const data = serializeBody(merged);
  data.id = req.params.id;

  try {
    db.prepare(
      `UPDATE procurements
       SET title = @title,
           description = @description,
           procedure_type = @procedure_type,
           estimated_value = @estimated_value,
           publish_date = @publish_date,
           deadline_date = @deadline_date,
           status = @status,
           awarded_contractor = @awarded_contractor,
           contract_value = @contract_value,
           contract_date = @contract_date,
           project_id = @project_id,
           updated_at = datetime('now')
       WHERE id = @id`
    ).run(data);
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return res.status(409).json({
        error: 'duplicate_procurement',
        message: 'Вече съществува поръчка с този източник (source_url).',
      });
    }
    throw err;
  }

  const row = db.prepare('SELECT * FROM procurements WHERE id = ?').get(req.params.id);

  return res.json({ procurement: row });
});

// ---------------------------------------------------------------------------
// DELETE /procurements/:id -- admin, cascades attachments (rows + files)
// ---------------------------------------------------------------------------
router.delete('/procurements/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM procurements WHERE id = ?').get(req.params.id);

  if (!existing) {
    return res.status(404).json({ error: 'not_found' });
  }

  const attachments = db
    .prepare(`SELECT * FROM attachments WHERE entity_type = 'procurement' AND entity_id = ?`)
    .all(req.params.id);

  for (const att of attachments) {
    if (att.stored_filename) {
      const filePath = path.join(__dirname, '..', '..', 'uploads', att.stored_filename);
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.warn('[procurement] failed to unlink attachment file:', err.message);
        }
      }
    }
  }

  db.prepare(`DELETE FROM attachments WHERE entity_type = 'procurement' AND entity_id = ?`).run(
    req.params.id
  );

  db.prepare('DELETE FROM procurements WHERE id = ?').run(req.params.id);

  return res.status(204).end();
});

module.exports = router;
