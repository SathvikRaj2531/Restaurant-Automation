const crypto = require('crypto');
const S = require('./settings');
const { db, nowIso } = require('./db');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + S.SESSION_DAYS * 86400 * 1000).toISOString();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowIso());
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)').run(sha256(token), userId, expires);
  return token;
}

function publicUser(u) {
  return { id: u.id, username: u.username, name: u.name, role: u.role, must_change_password: !!u.must_change_password };
}

function tokenFromRequest(req) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '');
  return m ? m[1] : null;
}

/** Express middleware. requireAuth('manager','owner') -> only those roles. No args -> any signed-in user. */
function requireAuth(...roles) {
  return (req, res, next) => {
    const token = tokenFromRequest(req);
    if (!token) return res.status(401).json({ error: 'Please sign in.' });
    const row = db.prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`
    ).get(sha256(token), nowIso());
    if (!row) return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    if (roles.length && !roles.includes(row.role)) {
      return res.status(403).json({ error: 'You do not have permission to do this.' });
    }
    req.user = row;
    req.tokenHash = sha256(token);
    next();
  };
}

function createLimiter({ windowMs, max }) {
  const map = new Map();
  const recent = (key) => {
    const now = Date.now();
    const arr = (map.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length) map.set(key, arr); else map.delete(key);
    return arr;
  };
  return {
    blocked: (key) => recent(key).length >= max,
    hit(key) { const arr = recent(key); arr.push(Date.now()); map.set(key, arr); },
  };
}

module.exports = { hashPassword, verifyPassword, createSession, publicUser, requireAuth, createLimiter, sha256 };
