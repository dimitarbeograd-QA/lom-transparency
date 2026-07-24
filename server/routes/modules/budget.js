'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { db } = require('../../db');
const { requireAdmin } = require('../../middleware/auth');
const { registerReviewable } = require('../../reviewRegistry');

const router = express.Router();

registerReviewable({ key: 'budget-projects', table: 'projects', titleColumn: 'name' });
registerReviewable({ key: 'budget-lines', table: 'budget_lines', titleColumn: 'funding_source' });
registerReviewable({ key: 'budget-expenditures', table: 'expenditures', titleColumn: 'vendor_name' });

const STATUSES = ['planned', 'active', 'completed'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

// Returns a { value, error } pair. `value` is a finite number (or null if the
// input was absent) when there is no error.
function parseOptionalAmount(raw, fieldName) {
  if (raw === undefined || raw === null || raw === '') {
    return { value: null, error: null };
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return { value: null, error: `${fieldName} must be a number` };
  }
  if (n < 0) {
    return { value: null, error: `${fieldName} must be >= 0` };
  }
  return { value: n, error: null };
}

function parseOptionalYear(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { value: null, error: null };
  }
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    return { value: null, error: 'year must be an integer' };
  }
  return { value: n, error: null };
}

function getProjectTotals(projectId, year) {
  const allocatedRow = year
    ? db
        .prepare(
          `SELECT COALESCE(SUM(allocated_amount), 0) AS total FROM budget_lines
           WHERE project_id = ? AND review_status = 'approved' AND year = ?`
        )
        .get(projectId, year)
    : db
        .prepare(
          `SELECT COALESCE(SUM(allocated_amount), 0) AS total FROM budget_lines
           WHERE project_id = ? AND review_status = 'approved'`
        )
        .get(projectId);

  const spentRow = year
    ? db
        .prepare(
          `SELECT COALESCE(SUM(amount), 0) AS total FROM expenditures
           WHERE project_id = ? AND review_status = 'approved' AND strftime('%Y', expenditure_date) = ?`
        )
        .get(projectId, String(year))
    : db
        .prepare(
          `SELECT COALESCE(SUM(amount), 0) AS total FROM expenditures
           WHERE project_id = ? AND review_status = 'approved'`
        )
        .get(projectId);

  return { allocated_total: allocatedRow.total, spent_total: spentRow.total };
}

function deleteProjectAttachments(projectId) {
  const rows = db
    .prepare("SELECT * FROM attachments WHERE entity_type = 'project' AND entity_id = ?")
    .all(projectId);

  for (const row of rows) {
    if (row.stored_filename) {
      const filePath = path.join(__dirname, '..', '..', 'uploads', row.stored_filename);
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.warn('[budget] failed to unlink attachment file:', err.message);
        }
      }
    }
  }

  db.prepare("DELETE FROM attachments WHERE entity_type = 'project' AND entity_id = ?").run(
    projectId
  );
}

// ---------------------------------------------------------------------------
// Public: project listing + detail
// ---------------------------------------------------------------------------

router.get('/projects', (req, res) => {
  const { year, category, status } = req.query;

  if (status && !STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });
  }

  const { value: yearValue, error: yearError } = parseOptionalYear(year);
  if (yearError) {
    return res.status(400).json({ error: yearError });
  }

  const where = ["review_status = 'approved'"];
  const params = [];

  if (category) {
    where.push('category = ?');
    params.push(category);
  }
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  if (yearValue !== null) {
    where.push(
      `id IN (SELECT project_id FROM budget_lines WHERE review_status = 'approved' AND year = ?)`
    );
    params.push(yearValue);
  }

  const projects = db
    .prepare(`SELECT * FROM projects WHERE ${where.join(' AND ')} ORDER BY name`)
    .all(...params);

  const result = projects.map((p) => ({ ...p, ...getProjectTotals(p.id, yearValue) }));

  return res.json({ projects: result });
});

router.get('/projects/:id', (req, res) => {
  const project = db
    .prepare("SELECT * FROM projects WHERE id = ? AND review_status = 'approved'")
    .get(req.params.id);

  if (!project) {
    return res.status(404).json({ error: 'not_found' });
  }

  const budget_lines = db
    .prepare(
      "SELECT * FROM budget_lines WHERE project_id = ? AND review_status = 'approved' ORDER BY year"
    )
    .all(project.id);

  const expenditures = db
    .prepare(
      "SELECT * FROM expenditures WHERE project_id = ? AND review_status = 'approved' ORDER BY expenditure_date DESC"
    )
    .all(project.id);

  const attachments = db
    .prepare("SELECT * FROM attachments WHERE entity_type = 'project' AND entity_id = ? ORDER BY uploaded_at DESC")
    .all(project.id);

  // Cross-link to the procurement module: any approved procurement records
  // tied to this project, so the project page can link out to
  // /procurement/detail.html?id=<id> without the client needing a second
  // filtered request.
  const procurements = db
    .prepare(
      "SELECT id, title, status, publish_date FROM procurements WHERE project_id = ? AND review_status = 'approved' ORDER BY publish_date DESC"
    )
    .all(project.id);

  return res.json({
    project: { ...project, ...getProjectTotals(project.id, null) },
    budget_lines,
    expenditures,
    attachments,
    procurements,
  });
});

// ---------------------------------------------------------------------------
// Admin: full (all review statuses) listing + detail, for the admin CRUD UI.
// Not part of the public API surface -- protected by requireAdmin.
// ---------------------------------------------------------------------------

router.get('/admin/projects', requireAdmin, (req, res) => {
  const { category, status } = req.query;

  const where = ['1 = 1'];
  const params = [];

  if (category) {
    where.push('category = ?');
    params.push(category);
  }
  if (status) {
    where.push('status = ?');
    params.push(status);
  }

  const projects = db
    .prepare(`SELECT * FROM projects WHERE ${where.join(' AND ')} ORDER BY created_at DESC`)
    .all(...params);

  const result = projects.map((p) => ({ ...p, ...getProjectTotals(p.id, null) }));

  return res.json({ projects: result });
});

router.get('/admin/projects/:id', requireAdmin, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'not_found' });
  }

  const budget_lines = db
    .prepare('SELECT * FROM budget_lines WHERE project_id = ? ORDER BY year')
    .all(project.id);
  const expenditures = db
    .prepare('SELECT * FROM expenditures WHERE project_id = ? ORDER BY expenditure_date DESC')
    .all(project.id);
  const attachments = db
    .prepare("SELECT * FROM attachments WHERE entity_type = 'project' AND entity_id = ? ORDER BY uploaded_at DESC")
    .all(project.id);

  return res.json({
    project: { ...project, ...getProjectTotals(project.id, null) },
    budget_lines,
    expenditures,
    attachments,
  });
});

// ---------------------------------------------------------------------------
// Admin: projects CRUD
// ---------------------------------------------------------------------------

router.post('/projects', requireAdmin, (req, res) => {
  const body = req.body || {};

  if (!isNonEmptyString(body.name)) {
    return res.status(400).json({ error: 'name is required' });
  }

  const status = body.status || 'planned';
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });
  }

  // A project created directly by an admin is authoritative -- it does not
  // need to go through the pending-review queue the way scraped content does.
  const info = db
    .prepare(
      `INSERT INTO projects (name, description, category, status, review_status, reviewed_by, reviewed_at)
       VALUES (?, ?, ?, ?, 'approved', ?, datetime('now'))`
    )
    .run(body.name.trim(), body.description || null, body.category || null, status, req.user.id);

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid);
  return res.status(201).json({ project: { ...project, ...getProjectTotals(project.id, null) } });
});

router.put('/projects/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'not_found' });
  }

  const body = req.body || {};

  const name = body.name !== undefined ? body.name : existing.name;
  if (!isNonEmptyString(name)) {
    return res.status(400).json({ error: 'name is required' });
  }

  const status = body.status !== undefined ? body.status : existing.status;
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });
  }

  const description = body.description !== undefined ? body.description : existing.description;
  const category = body.category !== undefined ? body.category : existing.category;

  db.prepare(
    `UPDATE projects SET name = ?, description = ?, category = ?, status = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(name.trim(), description, category, status, req.params.id);

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  return res.json({ project: { ...project, ...getProjectTotals(project.id, null) } });
});

router.delete('/projects/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'not_found' });
  }

  // budget_lines / expenditures cascade-delete via the FK (foreign_keys = ON
  // is set in server/db/modules/budget.js), but attachments are not a real FK
  // relationship, so we must clean those (and their files) up ourselves.
  deleteProjectAttachments(req.params.id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);

  return res.status(204).end();
});

// ---------------------------------------------------------------------------
// Admin: budget lines CRUD
// ---------------------------------------------------------------------------

router.post('/projects/:id/budget-lines', requireAdmin, (req, res) => {
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'project_not_found' });
  }

  const body = req.body || {};

  const { value: year, error: yearError } = parseOptionalYear(body.year);
  if (yearError) {
    return res.status(400).json({ error: yearError });
  }

  const { value: allocated_amount, error: amountError } = parseOptionalAmount(
    body.allocated_amount,
    'allocated_amount'
  );
  if (amountError) {
    return res.status(400).json({ error: amountError });
  }

  const info = db
    .prepare(
      `INSERT INTO budget_lines (project_id, year, funding_source, allocated_amount, notes, review_status, reviewed_by, reviewed_at)
       VALUES (?, ?, ?, ?, ?, 'approved', ?, datetime('now'))`
    )
    .run(project.id, year, body.funding_source || null, allocated_amount, body.notes || null, req.user.id);

  const budgetLine = db.prepare('SELECT * FROM budget_lines WHERE id = ?').get(info.lastInsertRowid);
  return res.status(201).json({ budget_line: budgetLine });
});

router.put('/budget-lines/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM budget_lines WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'not_found' });
  }

  const body = req.body || {};

  const { value: year, error: yearError } =
    body.year !== undefined ? parseOptionalYear(body.year) : { value: existing.year, error: null };
  if (yearError) {
    return res.status(400).json({ error: yearError });
  }

  const { value: allocated_amount, error: amountError } =
    body.allocated_amount !== undefined
      ? parseOptionalAmount(body.allocated_amount, 'allocated_amount')
      : { value: existing.allocated_amount, error: null };
  if (amountError) {
    return res.status(400).json({ error: amountError });
  }

  const funding_source = body.funding_source !== undefined ? body.funding_source : existing.funding_source;
  const notes = body.notes !== undefined ? body.notes : existing.notes;

  db.prepare(
    `UPDATE budget_lines SET year = ?, funding_source = ?, allocated_amount = ?, notes = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(year, funding_source, allocated_amount, notes, req.params.id);

  const budgetLine = db.prepare('SELECT * FROM budget_lines WHERE id = ?').get(req.params.id);
  return res.json({ budget_line: budgetLine });
});

router.delete('/budget-lines/:id', requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM budget_lines WHERE id = ?').run(req.params.id);
  if (info.changes === 0) {
    return res.status(404).json({ error: 'not_found' });
  }
  return res.status(204).end();
});

// ---------------------------------------------------------------------------
// Admin: expenditures CRUD
// ---------------------------------------------------------------------------

router.post('/projects/:id/expenditures', requireAdmin, (req, res) => {
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'project_not_found' });
  }

  const body = req.body || {};

  if (!isNonEmptyString(body.vendor_name)) {
    return res.status(400).json({ error: 'vendor_name is required' });
  }

  const { value: amount, error: amountError } = parseOptionalAmount(body.amount, 'amount');
  if (amountError) {
    return res.status(400).json({ error: amountError });
  }

  const info = db
    .prepare(
      `INSERT INTO expenditures
        (project_id, vendor_name, amount, expenditure_date, document_reference, description, review_status, reviewed_by, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, datetime('now'))`
    )
    .run(
      project.id,
      body.vendor_name.trim(),
      amount,
      body.expenditure_date || null,
      body.document_reference || null,
      body.description || null,
      req.user.id
    );

  const expenditure = db.prepare('SELECT * FROM expenditures WHERE id = ?').get(info.lastInsertRowid);
  return res.status(201).json({ expenditure });
});

router.put('/expenditures/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM expenditures WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'not_found' });
  }

  const body = req.body || {};

  const vendor_name = body.vendor_name !== undefined ? body.vendor_name : existing.vendor_name;
  if (!isNonEmptyString(vendor_name)) {
    return res.status(400).json({ error: 'vendor_name is required' });
  }

  const { value: amount, error: amountError } =
    body.amount !== undefined ? parseOptionalAmount(body.amount, 'amount') : { value: existing.amount, error: null };
  if (amountError) {
    return res.status(400).json({ error: amountError });
  }

  const expenditure_date = body.expenditure_date !== undefined ? body.expenditure_date : existing.expenditure_date;
  const document_reference =
    body.document_reference !== undefined ? body.document_reference : existing.document_reference;
  const description = body.description !== undefined ? body.description : existing.description;

  db.prepare(
    `UPDATE expenditures SET vendor_name = ?, amount = ?, expenditure_date = ?, document_reference = ?, description = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(vendor_name.trim(), amount, expenditure_date, document_reference, description, req.params.id);

  const expenditure = db.prepare('SELECT * FROM expenditures WHERE id = ?').get(req.params.id);
  return res.json({ expenditure });
});

router.delete('/expenditures/:id', requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM expenditures WHERE id = ?').run(req.params.id);
  if (info.changes === 0) {
    return res.status(404).json({ error: 'not_found' });
  }
  return res.status(204).end();
});

// ---------------------------------------------------------------------------
// Public: dashboard aggregation (allocated vs spent, by category and by year)
// ---------------------------------------------------------------------------

router.get('/dashboard/budget', (req, res) => {
  const allocatedRows = db
    .prepare(
      `SELECT p.category AS category, bl.year AS year, bl.allocated_amount AS amount
       FROM budget_lines bl
       JOIN projects p ON p.id = bl.project_id
       WHERE bl.review_status = 'approved' AND p.review_status = 'approved'`
    )
    .all();

  const spentRows = db
    .prepare(
      `SELECT p.category AS category, CAST(strftime('%Y', e.expenditure_date) AS INTEGER) AS year, e.amount AS amount
       FROM expenditures e
       JOIN projects p ON p.id = e.project_id
       WHERE e.review_status = 'approved' AND p.review_status = 'approved'`
    )
    .all();

  const UNCATEGORIZED = 'Без категория';
  const byCategory = new Map();
  const byYear = new Map();
  let allocatedTotal = 0;
  let spentTotal = 0;

  function ensureCategory(cat) {
    const key = cat || UNCATEGORIZED;
    if (!byCategory.has(key)) {
      byCategory.set(key, { category: key, allocated_total: 0, spent_total: 0 });
    }
    return byCategory.get(key);
  }

  function ensureYear(year) {
    if (year === null || year === undefined || Number.isNaN(year)) return null;
    if (!byYear.has(year)) {
      byYear.set(year, { year, allocated_total: 0, spent_total: 0 });
    }
    return byYear.get(year);
  }

  for (const row of allocatedRows) {
    const amount = row.amount || 0;
    ensureCategory(row.category).allocated_total += amount;
    const yearBucket = ensureYear(row.year);
    if (yearBucket) yearBucket.allocated_total += amount;
    allocatedTotal += amount;
  }

  for (const row of spentRows) {
    const amount = row.amount || 0;
    ensureCategory(row.category).spent_total += amount;
    const yearBucket = ensureYear(row.year);
    if (yearBucket) yearBucket.spent_total += amount;
    spentTotal += amount;
  }

  const by_category = Array.from(byCategory.values()).sort((a, b) => a.category.localeCompare(b.category, 'bg'));
  const by_year = Array.from(byYear.values()).sort((a, b) => a.year - b.year);

  return res.json({
    overall: { allocated_total: allocatedTotal, spent_total: spentTotal },
    by_category,
    by_year,
  });
});

module.exports = router;
