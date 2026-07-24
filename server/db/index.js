'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.LOM_DB_PATH || path.join(__dirname, '..', 'lom.db');

// Make sure the directory for the DB file exists (useful when LOM_DB_PATH
// points somewhere that hasn't been created yet, e.g. a tmp dir in tests).
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// ---------------------------------------------------------------------------
// Core schema
// ---------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL CHECK (entity_type IN (
      'project', 'expenditure', 'budget_line', 'procurement',
      'council_decision', 'ordinance', 'official'
    )),
    entity_id INTEGER NOT NULL,
    label TEXT,
    original_filename TEXT,
    stored_filename TEXT,
    url TEXT,
    mime_type TEXT,
    size_bytes INTEGER,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (stored_filename IS NOT NULL OR url IS NOT NULL)
  );
`);

// ---------------------------------------------------------------------------
// Auto-load per-module schema definitions from server/db/modules/*.js
//
// Each feature module owns its own schema file and drops it into this
// directory. We require every .js file here (sorted alphabetically for
// deterministic ordering) and call its `defineSchema(db)` export if present.
// This lets independent module-building agents add tables without ever
// touching this file (and therefore without merge conflicts).
// ---------------------------------------------------------------------------
const modulesDir = path.join(__dirname, 'modules');
if (fs.existsSync(modulesDir)) {
  const moduleFiles = fs
    .readdirSync(modulesDir)
    .filter((f) => f.endsWith('.js'))
    .sort();

  for (const file of moduleFiles) {
    const mod = require(path.join(modulesDir, file));
    if (mod && typeof mod.defineSchema === 'function') {
      mod.defineSchema(db);
    }
  }
}

// ---------------------------------------------------------------------------
// Seed the single admin user (idempotent)
// ---------------------------------------------------------------------------
const adminUsername = process.env.LOM_ADMIN_USERNAME || 'admin';
const adminPassword = process.env.LOM_ADMIN_PASSWORD || 'admin123';

const existingAdmin = db
  .prepare('SELECT id FROM users WHERE username = ?')
  .get(adminUsername);

if (!existingAdmin) {
  const passwordHash = bcrypt.hashSync(adminPassword, 10);
  db.prepare(
    'INSERT INTO users (username, password_hash) VALUES (?, ?)'
  ).run(adminUsername, passwordHash);
}

module.exports = { db };
