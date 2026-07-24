'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { db } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const upload = require('../middleware/upload');

const router = express.Router();

// Keep in sync with the CHECK constraint on attachments.entity_type in
// server/db/index.js. We validate here too so we can return a clear 400
// instead of relying solely on the DB throwing a constraint error.
const ENTITY_TYPES = [
  'project',
  'expenditure',
  'budget_line',
  'procurement',
  'council_decision',
  'ordinance',
  'official',
];

router.get('/attachments', (req, res) => {
  const { entity_type, entity_id } = req.query;

  if (!entity_type || !entity_id) {
    return res
      .status(400)
      .json({ error: 'entity_type and entity_id query params are required' });
  }

  const rows = db
    .prepare(
      'SELECT * FROM attachments WHERE entity_type = ? AND entity_id = ? ORDER BY uploaded_at DESC'
    )
    .all(entity_type, entity_id);

  return res.json({ attachments: rows });
});

router.post('/attachments', requireAdmin, upload.single('file'), (req, res) => {
  const body = req.body || {};
  const entity_type = body.entity_type;
  const entity_id = body.entity_id;
  const label = body.label || null;
  const url = body.url || null;

  if (!entity_type || !ENTITY_TYPES.includes(entity_type)) {
    return res.status(400).json({
      error: `entity_type must be one of: ${ENTITY_TYPES.join(', ')}`,
    });
  }

  if (!entity_id) {
    return res.status(400).json({ error: 'entity_id is required' });
  }

  const file = req.file;

  if (!file && !url) {
    return res
      .status(400)
      .json({ error: 'either a file upload or a url must be provided' });
  }

  const stmt = db.prepare(
    `INSERT INTO attachments
      (entity_type, entity_id, label, original_filename, stored_filename, url, mime_type, size_bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const info = stmt.run(
    entity_type,
    entity_id,
    label,
    file ? file.originalname : null,
    file ? file.filename : null,
    file ? null : url,
    file ? file.mimetype : null,
    file ? file.size : null
  );

  const row = db
    .prepare('SELECT * FROM attachments WHERE id = ?')
    .get(info.lastInsertRowid);

  return res.status(201).json({ attachment: row });
});

router.delete('/attachments/:id', requireAdmin, (req, res) => {
  const row = db
    .prepare('SELECT * FROM attachments WHERE id = ?')
    .get(req.params.id);

  if (!row) {
    return res.status(404).json({ error: 'not_found' });
  }

  if (row.stored_filename) {
    const filePath = path.join(__dirname, '..', 'uploads', row.stored_filename);
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn('[attachments] failed to unlink file:', err.message);
      }
    }
  }

  db.prepare('DELETE FROM attachments WHERE id = ?').run(req.params.id);

  return res.status(204).end();
});

module.exports = router;
