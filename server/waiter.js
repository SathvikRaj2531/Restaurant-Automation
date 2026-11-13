// Waiter requests: requested -> acknowledged -> completed. One active request per table.
const S = require('./settings');
const { db, nowIso } = require('./db');
const { HttpError } = require('./util');

const BASE = `SELECT r.*, t.number AS table_number FROM waiter_requests r JOIN dining_tables t ON t.id = r.table_id`;

const view = (r) => r && ({
  id: r.id, table_number: r.table_number, status: r.status,
  created_at: r.created_at, acknowledged_at: r.acknowledged_at, completed_at: r.completed_at,
});

const activeFor = (tableId) =>
  db.prepare(`${BASE} WHERE r.table_id = ? AND r.status IN ('requested','acknowledged')`).get(tableId);

/** What the customer sees: the active request, else one completed in the last couple of minutes, else null. */
function customerRequest(tableId) {
  const active = activeFor(tableId);
  if (active) return view(active);
  const cutoff = new Date(Date.now() - S.WAITER_COMPLETED_VISIBLE_SECONDS * 1000).toISOString();
  return view(db.prepare(`${BASE} WHERE r.table_id = ? AND r.status = 'completed' AND r.completed_at > ? ORDER BY r.id DESC LIMIT 1`).get(tableId, cutoff)) || null;
}

/** Creates a request unless the table already has an active one (then returns that one). */
function createRequest(tableId) {
  const existing = activeFor(tableId);
  if (existing) return { request: view(existing), duplicate: true };
  const visit = db.prepare("SELECT id FROM visits WHERE table_id = ? AND status = 'open'").get(tableId);
  let id;
  try {
    id = Number(db.prepare('INSERT INTO waiter_requests (table_id, visit_id, created_at) VALUES (?, ?, ?)').run(tableId, visit ? visit.id : null, nowIso()).lastInsertRowid);
  } catch (e) {
    const again = activeFor(tableId); // lost a race with another phone: the unique index stopped the duplicate
    if (again) return { request: view(again), duplicate: true };
    throw e;
  }
  return { request: view(db.prepare(`${BASE} WHERE r.id = ?`).get(id)), duplicate: false };
}

const listActive = () => db.prepare(`${BASE} WHERE r.status IN ('requested','acknowledged') ORDER BY r.created_at ASC, r.id ASC`).all().map(view);
const countActive = () => Number(db.prepare("SELECT COUNT(*) AS n FROM waiter_requests WHERE status IN ('requested','acknowledged')").get().n);

function move(id, to, from, userId) {
  const col = to === 'acknowledged' ? 'acknowledged' : 'completed';
  const r = db.prepare(
    `UPDATE waiter_requests SET status = ?, ${col}_at = ?, ${col}_by = ? WHERE id = ? AND status IN (${from.map(() => '?').join(',')})`
  ).run(to, nowIso(), userId, id, ...from);
  if (!Number(r.changes)) {
    const cur = db.prepare('SELECT status FROM waiter_requests WHERE id = ?').get(id);
    if (!cur) throw new HttpError(404, 'Request not found.');
    throw new HttpError(409, `This request is already "${cur.status}". The list has been refreshed.`);
  }
  return view(db.prepare(`${BASE} WHERE r.id = ?`).get(id));
}
const acknowledge = (id, userId) => move(id, 'acknowledged', ['requested'], userId);
const complete = (id, userId) => move(id, 'completed', ['requested', 'acknowledged'], userId);

const parseId = (req) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw new HttpError(400, 'Invalid request.');
  return id;
};

/** Express handlers shared by the waiter screen and the manager dashboard. */
const handlers = {
  list: (req, res) => res.json({ requests: listActive() }),
  acknowledge: (req, res) => res.json({ request: acknowledge(parseId(req), req.user.id) }),
  complete: (req, res) => res.json({ request: complete(parseId(req), req.user.id) }),
};

module.exports = { customerRequest, createRequest, listActive, countActive, acknowledge, complete, handlers };
