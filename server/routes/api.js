const express = require('express');
const S = require('../settings');
const { db, nowIso } = require('../db');
const { verifyPassword, hashPassword, createSession, publicUser, requireAuth, createLimiter } = require('../auth');
const { getSettings, getPublicMenu } = require('../data');

const router = express.Router();
const loginLimiter = createLimiter(S.LOGIN_RATE_LIMIT);

// ---------- Public ----------
router.get('/menu', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(getPublicMenu()); });

router.get('/config', (req, res) => {
  const s = getSettings();
  res.json({
    restaurant_name: s.restaurant_name,
    currency: S.CURRENCY_CODE,
    timezone: S.TIMEZONE,
    poll_interval_ms: S.POLL_INTERVAL_MS,
    kitchen_wait_warn_minutes: S.KITCHEN_WAIT_WARN_MINUTES,
    has_tax_or_service: s.tax_percent != null || s.service_charge_percent != null,
  });
});

// ---------- Auth ----------
router.post('/auth/login', (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!username || !password) return res.status(400).json({ error: 'Enter username and password.' });
  if (loginLimiter.blocked(username)) {
    return res.status(429).json({ error: 'Too many failed attempts. Please wait a few minutes and try again.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    loginLimiter.hit(username);
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }
  res.json({ token: createSession(user.id), user: publicUser(user) });
});

router.post('/auth/logout', requireAuth(), (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.tokenHash);
  res.json({ ok: true });
});

router.get('/auth/me', requireAuth(), (req, res) => res.json({ user: publicUser(req.user) }));

router.post('/auth/change-password', requireAuth(), (req, res) => {
  const current = String(req.body?.current_password || '');
  const next = String(req.body?.new_password || '');
  if (!verifyPassword(current, req.user.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }
  if (next.length < S.MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `New password must be at least ${S.MIN_PASSWORD_LENGTH} characters.` });
  }
  if (next === current) return res.status(400).json({ error: 'New password must be different from the current one.' });
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hashPassword(next), req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(req.user.id, req.tokenHash);
  res.json({ ok: true, user: publicUser({ ...req.user, must_change_password: 0 }) });
});

router.use((req, res) => res.status(404).json({ error: 'Not found.' }));

module.exports = router;
