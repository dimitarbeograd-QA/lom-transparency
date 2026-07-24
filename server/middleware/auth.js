'use strict';

const crypto = require('crypto');
const { db } = require('../db');

const COOKIE_NAME = 'lt_sid';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  db.prepare(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)'
  ).run(token, userId, expiresAt.toISOString());
  return { token, expires: expiresAt };
}

function destroySession(token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function getUserForToken(token) {
  if (!token) return null;

  const row = db
    .prepare(
      `SELECT users.id as id, users.username as username, sessions.expires_at as expires_at
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token = ?`
    )
    .get(token);

  if (!row) return null;

  if (new Date(row.expires_at).getTime() < Date.now()) {
    // Expired -- clean it up and treat as unauthenticated.
    destroySession(token);
    return null;
  }

  return { id: row.id, username: row.username };
}

function setSessionCookie(res, token, expires) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}

function requireAuth(req, res, next) {
  const token = req.cookies ? req.cookies[COOKIE_NAME] : null;
  const user = getUserForToken(token);
  if (!user) {
    return res.status(401).json({ error: 'not_authenticated' });
  }
  req.user = user;
  next();
}

// There is only ever one admin role in this app today (no multi-role
// system). requireAdmin is kept as its own named export so module routes
// can semantically require "admin" access, even though right now it is
// equivalent to requireAuth.
function requireAdmin(req, res, next) {
  return requireAuth(req, res, next);
}

module.exports = {
  COOKIE_NAME,
  createSession,
  destroySession,
  getUserForToken,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  requireAdmin,
};
