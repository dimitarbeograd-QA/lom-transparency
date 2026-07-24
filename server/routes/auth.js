'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const {
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  COOKIE_NAME,
} = require('../middleware/auth');

const router = express.Router();

router.post('/auth/login', (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  const user = db
    .prepare('SELECT id, username, password_hash FROM users WHERE username = ?')
    .get(username);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  const { token, expires } = createSession(user.id);
  setSessionCookie(res, token, expires);

  return res.json({ user: { id: user.id, username: user.username } });
});

router.post('/auth/logout', (req, res) => {
  const token = req.cookies ? req.cookies[COOKIE_NAME] : null;
  destroySession(token);
  clearSessionCookie(res);
  return res.status(204).end();
});

router.get('/auth/me', requireAuth, (req, res) => {
  return res.json({ user: req.user });
});

module.exports = router;
