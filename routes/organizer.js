const express = require('express');
const router = express.Router();
const crypto = require('crypto');

const ORGANIZER_PIN = process.env.ORGANIZER_PIN || '1234';
const SESSION_COOKIE = 'mk_organizer_session';

// Simple session store (in-memory)
const sessions = new Map();

// Generate session token
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Middleware to check if user is authenticated organizer
function requireOrganizer(req, res, next) {
  const sessionToken = req.cookies[SESSION_COOKIE];
  
  if (!sessionToken || !sessions.has(sessionToken)) {
    return res.status(401).json({ error: 'Unauthorized - Organizer login required' });
  }
  
  // Check session expiry (1 hour)
  const session = sessions.get(sessionToken);
  if (Date.now() - session.createdAt > 3600000) {
    sessions.delete(sessionToken);
    res.clearCookie(SESSION_COOKIE);
    return res.status(401).json({ error: 'Session expired' });
  }
  
  next();
}

// POST /api/organizer/login
router.post('/login', (req, res) => {
  const { pin } = req.body;
  
  if (!pin) {
    return res.status(400).json({ error: 'PIN required' });
  }
  
  if (pin !== ORGANIZER_PIN) {
    return res.status(401).json({ error: 'Invalid PIN' });
  }
  
  // Create session
  const sessionToken = generateSessionToken();
  sessions.set(sessionToken, {
    createdAt: Date.now()
  });
  
  // Set cookie
  res.cookie(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    maxAge: 3600000, // 1 hour
    sameSite: 'strict'
  });
  
  res.json({ success: true, message: 'Logged in successfully' });
});

// POST /api/organizer/logout
router.post('/logout', (req, res) => {
  const sessionToken = req.cookies[SESSION_COOKIE];
  
  if (sessionToken) {
    sessions.delete(sessionToken);
  }
  
  res.clearCookie(SESSION_COOKIE);
  res.json({ success: true, message: 'Logged out successfully' });
});

// GET /api/organizer/check - Check if logged in
router.get('/check', (req, res) => {
  const sessionToken = req.cookies[SESSION_COOKIE];
  
  if (!sessionToken || !sessions.has(sessionToken)) {
    return res.json({ authenticated: false });
  }
  
  const session = sessions.get(sessionToken);
  if (Date.now() - session.createdAt > 3600000) {
    sessions.delete(sessionToken);
    res.clearCookie(SESSION_COOKIE);
    return res.json({ authenticated: false });
  }
  
  res.json({ authenticated: true });
});

module.exports = { router, requireOrganizer };
