'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { db } = require('../../db');
const { requireAdmin } = require('../../middleware/auth');
const { registerReviewable } = require('../../reviewRegistry');

registerReviewable({ key: 'departments', table: 'departments', titleColumn: 'name' });
registerReviewable({ key: 'officials', table: 'officials', titleColumn: 'name' });
registerReviewable({ key: 'council_members', table: 'council_members', titleColumn: 'name' });
registerReviewable({ key: 'committees', table: 'committees', titleColumn: 'name' });

const router = express.Router();

function isUniqueConstraintError(err, table) {
  return (
    err &&
    typeof err.message === 'string' &&
    err.message.includes('UNIQUE constraint failed') &&
    err.message.includes(table)
  );
}

function deleteAttachmentsFor(entityType, entityId) {
  const attachments = db
    .prepare(`SELECT * FROM attachments WHERE entity_type = ? AND entity_id = ?`)
    .all(entityType, entityId);

  for (const att of attachments) {
    if (att.stored_filename) {
      const filePath = path.join(__dirname, '..', '..', 'uploads', att.stored_filename);
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.warn('[administration] failed to unlink attachment file:', err.message);
        }
      }
    }
  }

  db.prepare(`DELETE FROM attachments WHERE entity_type = ? AND entity_id = ?`).run(
    entityType,
    entityId
  );
}

// ===========================================================================
// Departments
// ===========================================================================

router.get('/departments', (req, res) => {
  const rows = db
    .prepare(`SELECT * FROM departments WHERE review_status = 'approved' ORDER BY name ASC`)
    .all();
  return res.json({ departments: rows });
});

router.get('/admin/departments', requireAdmin, (req, res) => {
  const { status } = req.query;
  let sql = 'SELECT * FROM departments';
  const params = [];
  if (status && status !== 'all') {
    sql += ' WHERE review_status = ?';
    params.push(status);
  }
  sql += ' ORDER BY created_at DESC';
  const rows = db.prepare(sql).all(...params);
  return res.json({ departments: rows });
});

router.post('/departments', requireAdmin, (req, res) => {
  const body = req.body || {};
  if (!body.name) {
    return res.status(400).json({ error: 'name is required' });
  }

  const info = db
    .prepare(`INSERT INTO departments (name, description) VALUES (?, ?)`)
    .run(body.name, body.description || null);

  const row = db.prepare('SELECT * FROM departments WHERE id = ?').get(info.lastInsertRowid);
  return res.status(201).json({ department: row });
});

router.put('/departments/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const body = req.body || {};
  if ('name' in body && !body.name) {
    return res.status(400).json({ error: 'name cannot be empty' });
  }

  const data = {
    name: body.name !== undefined ? body.name : existing.name,
    description: body.description !== undefined ? body.description : existing.description,
    id: req.params.id,
  };

  db.prepare(
    `UPDATE departments SET name = @name, description = @description, updated_at = datetime('now') WHERE id = @id`
  ).run(data);

  const row = db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id);
  return res.json({ department: row });
});

router.delete('/departments/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  // Officials referencing this department have department_id ON DELETE SET
  // NULL -- they are intentionally NOT deleted, just unlinked.
  db.prepare('DELETE FROM departments WHERE id = ?').run(req.params.id);
  return res.status(204).end();
});

// ===========================================================================
// Officials
// ===========================================================================

router.get('/officials', (req, res) => {
  const { department_id } = req.query;
  let sql = `SELECT * FROM officials WHERE review_status = 'approved'`;
  const params = [];
  if (department_id) {
    sql += ' AND department_id = ?';
    params.push(department_id);
  }
  sql += ' ORDER BY name ASC';
  const rows = db.prepare(sql).all(...params);
  return res.json({ officials: rows });
});

router.get('/admin/officials', requireAdmin, (req, res) => {
  const { status, department_id } = req.query;
  const clauses = [];
  const params = [];
  if (status && status !== 'all') {
    clauses.push('review_status = ?');
    params.push(status);
  }
  if (department_id) {
    clauses.push('department_id = ?');
    params.push(department_id);
  }
  let sql = 'SELECT * FROM officials';
  if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
  sql += ' ORDER BY created_at DESC';
  const rows = db.prepare(sql).all(...params);
  return res.json({ officials: rows });
});

router.post('/officials', requireAdmin, (req, res) => {
  const body = req.body || {};
  if (!body.name) {
    return res.status(400).json({ error: 'name is required' });
  }

  const info = db
    .prepare(
      `INSERT INTO officials (name, position, department_id, email, phone)
       VALUES (@name, @position, @department_id, @email, @phone)`
    )
    .run({
      name: body.name,
      position: body.position || null,
      department_id: body.department_id || null,
      email: body.email || null,
      phone: body.phone || null,
    });

  const row = db.prepare('SELECT * FROM officials WHERE id = ?').get(info.lastInsertRowid);
  return res.status(201).json({ official: row });
});

router.put('/officials/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM officials WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const body = req.body || {};
  if ('name' in body && !body.name) {
    return res.status(400).json({ error: 'name cannot be empty' });
  }

  const data = {
    name: body.name !== undefined ? body.name : existing.name,
    position: body.position !== undefined ? body.position : existing.position,
    department_id:
      body.department_id !== undefined ? body.department_id : existing.department_id,
    email: body.email !== undefined ? body.email : existing.email,
    phone: body.phone !== undefined ? body.phone : existing.phone,
    id: req.params.id,
  };

  db.prepare(
    `UPDATE officials SET name = @name, position = @position, department_id = @department_id,
       email = @email, phone = @phone, updated_at = datetime('now') WHERE id = @id`
  ).run(data);

  const row = db.prepare('SELECT * FROM officials WHERE id = ?').get(req.params.id);
  return res.json({ official: row });
});

router.delete('/officials/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM officials WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  deleteAttachmentsFor('official', req.params.id);
  db.prepare('DELETE FROM officials WHERE id = ?').run(req.params.id);
  return res.status(204).end();
});

// ===========================================================================
// Council members (with embedded committee memberships)
// ===========================================================================

function attachMemberships(members, { publicOnly }) {
  const stmt = publicOnly
    ? db.prepare(`
        SELECT cm.id, cm.role, c.id AS committee_id, c.name AS committee_name
        FROM committee_memberships cm
        JOIN committees c ON c.id = cm.committee_id
        WHERE cm.council_member_id = ? AND c.review_status = 'approved'
        ORDER BY c.name ASC
      `)
    : db.prepare(`
        SELECT cm.id, cm.role, c.id AS committee_id, c.name AS committee_name,
               c.review_status AS committee_review_status
        FROM committee_memberships cm
        JOIN committees c ON c.id = cm.committee_id
        WHERE cm.council_member_id = ?
        ORDER BY c.name ASC
      `);

  return members.map((m) => ({
    ...m,
    committee_memberships: stmt.all(m.id),
  }));
}

router.get('/council-members', (req, res) => {
  const rows = db
    .prepare(`SELECT * FROM council_members WHERE review_status = 'approved' ORDER BY name ASC`)
    .all();
  return res.json({ council_members: attachMemberships(rows, { publicOnly: true }) });
});

router.get('/admin/council-members', requireAdmin, (req, res) => {
  const { status } = req.query;
  let sql = 'SELECT * FROM council_members';
  const params = [];
  if (status && status !== 'all') {
    sql += ' WHERE review_status = ?';
    params.push(status);
  }
  sql += ' ORDER BY created_at DESC';
  const rows = db.prepare(sql).all(...params);
  return res.json({ council_members: attachMemberships(rows, { publicOnly: false }) });
});

router.post('/council-members', requireAdmin, (req, res) => {
  const body = req.body || {};
  if (!body.name) {
    return res.status(400).json({ error: 'name is required' });
  }

  const info = db
    .prepare(`INSERT INTO council_members (name, party) VALUES (?, ?)`)
    .run(body.name, body.party || null);

  const row = db.prepare('SELECT * FROM council_members WHERE id = ?').get(info.lastInsertRowid);
  return res.status(201).json({ council_member: attachMemberships([row], { publicOnly: false })[0] });
});

router.put('/council-members/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM council_members WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const body = req.body || {};
  if ('name' in body && !body.name) {
    return res.status(400).json({ error: 'name cannot be empty' });
  }

  const data = {
    name: body.name !== undefined ? body.name : existing.name,
    party: body.party !== undefined ? body.party : existing.party,
    id: req.params.id,
  };

  db.prepare(
    `UPDATE council_members SET name = @name, party = @party, updated_at = datetime('now') WHERE id = @id`
  ).run(data);

  const row = db.prepare('SELECT * FROM council_members WHERE id = ?').get(req.params.id);
  return res.json({ council_member: attachMemberships([row], { publicOnly: false })[0] });
});

router.delete('/council-members/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM council_members WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  // committee_memberships rows cascade-delete via ON DELETE CASCADE.
  db.prepare('DELETE FROM council_members WHERE id = ?').run(req.params.id);
  return res.status(204).end();
});

// ===========================================================================
// Committees
// ===========================================================================

router.get('/committees', (req, res) => {
  const rows = db
    .prepare(`SELECT * FROM committees WHERE review_status = 'approved' ORDER BY name ASC`)
    .all();
  return res.json({ committees: rows });
});

router.get('/admin/committees', requireAdmin, (req, res) => {
  const { status } = req.query;
  let sql = 'SELECT * FROM committees';
  const params = [];
  if (status && status !== 'all') {
    sql += ' WHERE review_status = ?';
    params.push(status);
  }
  sql += ' ORDER BY created_at DESC';
  const rows = db.prepare(sql).all(...params);
  return res.json({ committees: rows });
});

router.post('/committees', requireAdmin, (req, res) => {
  const body = req.body || {};
  if (!body.name) {
    return res.status(400).json({ error: 'name is required' });
  }

  try {
    const info = db.prepare(`INSERT INTO committees (name) VALUES (?)`).run(body.name);
    const row = db.prepare('SELECT * FROM committees WHERE id = ?').get(info.lastInsertRowid);
    return res.status(201).json({ committee: row });
  } catch (err) {
    if (isUniqueConstraintError(err, 'committees')) {
      return res.status(409).json({
        error: 'duplicate_committee',
        message: 'Вече съществува комисия с това име.',
      });
    }
    throw err;
  }
});

router.put('/committees/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM committees WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const body = req.body || {};
  if ('name' in body && !body.name) {
    return res.status(400).json({ error: 'name cannot be empty' });
  }

  const data = {
    name: body.name !== undefined ? body.name : existing.name,
    id: req.params.id,
  };

  try {
    db.prepare(
      `UPDATE committees SET name = @name, updated_at = datetime('now') WHERE id = @id`
    ).run(data);
  } catch (err) {
    if (isUniqueConstraintError(err, 'committees')) {
      return res.status(409).json({
        error: 'duplicate_committee',
        message: 'Вече съществува комисия с това име.',
      });
    }
    throw err;
  }

  const row = db.prepare('SELECT * FROM committees WHERE id = ?').get(req.params.id);
  return res.json({ committee: row });
});

router.delete('/committees/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM committees WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  // committee_memberships rows cascade-delete via ON DELETE CASCADE.
  db.prepare('DELETE FROM committees WHERE id = ?').run(req.params.id);
  return res.status(204).end();
});

// ===========================================================================
// Committee memberships
//
// No GET endpoint of their own -- they are always fetched embedded inside
// GET /council-members and GET /admin/council-members. Always created with
// review_status = 'approved' (see server/db/modules/administration.js for
// why): they are only ever admin-authored via this admin-gated POST route,
// never scraped, so there is nothing here for a human to triage -- public
// visibility is instead gated by the parent council_member's/committee's
// own review_status at read time.
// ===========================================================================

router.post('/committee-memberships', requireAdmin, (req, res) => {
  const body = req.body || {};
  const { council_member_id, committee_id, role } = body;

  if (!council_member_id || !committee_id) {
    return res.status(400).json({ error: 'council_member_id and committee_id are required' });
  }

  const member = db
    .prepare('SELECT id FROM council_members WHERE id = ?')
    .get(council_member_id);
  if (!member) {
    return res.status(400).json({ error: 'invalid_council_member' });
  }

  const committee = db.prepare('SELECT id FROM committees WHERE id = ?').get(committee_id);
  if (!committee) {
    return res.status(400).json({ error: 'invalid_committee' });
  }

  try {
    const info = db
      .prepare(
        `INSERT INTO committee_memberships (council_member_id, committee_id, role, review_status)
         VALUES (?, ?, ?, 'approved')`
      )
      .run(council_member_id, committee_id, role || null);

    const row = db
      .prepare(
        `SELECT cm.*, c.name AS committee_name, m.name AS council_member_name
         FROM committee_memberships cm
         JOIN committees c ON c.id = cm.committee_id
         JOIN council_members m ON m.id = cm.council_member_id
         WHERE cm.id = ?`
      )
      .get(info.lastInsertRowid);

    return res.status(201).json({ membership: row });
  } catch (err) {
    if (isUniqueConstraintError(err, 'committee_memberships')) {
      return res.status(409).json({
        error: 'duplicate_membership',
        message: 'Този съветник вече е включен в тази комисия.',
      });
    }
    throw err;
  }
});

router.delete('/committee-memberships/:id', requireAdmin, (req, res) => {
  const existing = db
    .prepare('SELECT * FROM committee_memberships WHERE id = ?')
    .get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  db.prepare('DELETE FROM committee_memberships WHERE id = ?').run(req.params.id);
  return res.status(204).end();
});

module.exports = router;
