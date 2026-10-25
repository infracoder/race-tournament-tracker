const express = require('express');
const crypto = require('node:crypto');
const COOKIE = 'mk_organizer_session';

function createOrganizer({ pin = process.env.ORGANIZER_PIN || '1234', now = Date.now } = {}) {
  const router = express.Router();
  const sessions = new Map();
  function authenticated(req, res) {
    const token = req.cookies[COOKIE];
    const expires = sessions.get(token);
    if (!expires || expires <= now()) {
      sessions.delete(token);
      if (token) res.clearCookie(COOKIE);
      return false;
    }
    return true;
  }
  function requireOrganizer(req, res, next) {
    if (!authenticated(req, res)) return res.status(401).json({ error: 'Organizer login required.' });
    next();
  }
  router.post('/login', (req, res) => {
    if (typeof req.body.pin !== 'string' || !req.body.pin)
      return res.status(400).json({ error: 'PIN required.' });
    if (req.body.pin !== pin) return res.status(401).json({ error: 'Invalid PIN.' });
    const old = req.cookies[COOKIE];
    if (old) sessions.delete(old);
    for (const [token, expiry] of sessions) if (expiry <= now()) sessions.delete(token);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, now() + 3600000);
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', maxAge: 3600000 });
    res.json({ success: true, message: 'Logged in successfully' });
  });
  router.post('/logout', (req, res) => {
    sessions.delete(req.cookies[COOKIE]);
    res.clearCookie(COOKIE);
    res.json({ success: true });
  });
  router.get('/check', (req, res) => res.json({ authenticated: authenticated(req, res) }));
  return { router, requireOrganizer };
}

module.exports = { createOrganizer };
