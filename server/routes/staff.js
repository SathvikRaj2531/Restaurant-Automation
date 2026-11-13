// Staff API (owner / manager). Every route enforces its role on the server.
const express = require('express');
const QRCode = require('qrcode');
const S = require('../settings');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const { baseUrl, HttpError } = require('../util');
const { loadOrders, transition, requireReason, staffView } = require('../orders');
const waiter = require('../waiter');

const router = express.Router();
const MANAGERS = ['owner', 'manager'];
router.use(requireAuth(...MANAGERS));
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// ---- A3: QR codes. Every table QR is permanent and public: there are no activate/deactivate controls. ----
router.get('/qr', async (req, res) => {
  const base = baseUrl(req);
  const tables = db.prepare('SELECT number, qr_token FROM dining_tables ORDER BY number').all();
  const out = [];
  for (const t of tables) {
    const url = `${base}/t/${t.qr_token}`;
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    out.push({ number: t.number, url, svg });
  }
  res.json({ tables: out });
});

// ---- B1: waiter requests (the manager can also acknowledge or complete) ----
router.get('/waiter-requests', waiter.handlers.list);
router.post('/waiter-requests/:id/acknowledge', waiter.handlers.acknowledge);
router.post('/waiter-requests/:id/complete', waiter.handlers.complete);

// ---- A4: Live orders (new first, then in progress, oldest first within each) ----
router.get('/orders/live', (req, res) => {
  const orders = loadOrders(
    "o.status IN ('new','accepted','preparing','ready')", [],
    "CASE o.status WHEN 'new' THEN 0 ELSE 1 END, o.created_at ASC, o.id ASC"
  ).map(staffView);
  res.json({ orders, pending_count: orders.filter((o) => o.status === 'new').length, waiter_open: waiter.countActive() });
});

// ---- A4: Tables overview ----
router.get('/tables', (req, res) => {
  const tables = db.prepare('SELECT id, number FROM dining_tables ORDER BY number').all();
  const openOrders = loadOrders("o.visit_id IN (SELECT id FROM visits WHERE status = 'open')");
  const requests = new Map(db.prepare("SELECT table_id, COUNT(*) AS n FROM waiter_requests WHERE status IN ('requested','acknowledged') GROUP BY table_id").all().map((r) => [r.table_id, r.n]));
  res.json({
    tables: tables.map((t) => {
      const orders = openOrders.filter((o) => o.table_id === t.id);
      const counted = orders.filter((o) => o.status !== 'cancelled');
      const state = orders.some((o) => o.status === 'new') ? 'new'
        : orders.some((o) => ['accepted', 'preparing', 'ready', 'served'].includes(o.status)) ? 'in_progress' : 'free';
      return {
        number: t.number, state,
        order_count: counted.length,
        running_total: counted.reduce((sum, o) => sum + o.subtotal, 0),
        waiter_requests: requests.get(t.id) || 0, // open (requested or acknowledged) waiter requests
      };
    }),
  });
});

// ---- A4: History (completed + cancelled), filter by date (India time) and table ----
router.get('/history', (req, res) => {
  const where = ["o.status IN ('completed','cancelled')"];
  const params = [];
  const date = String(req.query.date || '');
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new HttpError(400, 'Invalid date.');
    const start = new Date(`${date}T00:00:00+05:30`);
    where.push('o.created_at >= ? AND o.created_at < ?');
    params.push(start.toISOString(), new Date(start.getTime() + 86400000).toISOString());
  }
  if (req.query.table) {
    const n = Number(req.query.table);
    if (!Number.isInteger(n)) throw new HttpError(400, 'Invalid table.');
    where.push('t.number = ?');
    params.push(n);
  }
  res.json({ orders: loadOrders(where.join(' AND '), params, 'o.created_at DESC, o.id DESC', 200).map(staffView) });
});

// ---- A4: Order actions ----
const orderId = (req) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw new HttpError(400, 'Invalid order.');
  return id;
};
const respond = (res, order) => res.json({ order: staffView(order) });

// The manager must accept an order before the kitchen sees it.
router.post('/orders/:id/accept', (req, res) => {
  respond(res, transition(orderId(req), { from: ['new'], to: 'accepted', tsColumn: 'accepted_at' }));
});

// Reject = cancel an order that has not been accepted yet. Reason required.
router.post('/orders/:id/reject', (req, res) => {
  const reason = requireReason(req.body?.reason);
  respond(res, transition(orderId(req), {
    from: ['new'], to: 'cancelled', tsColumn: 'cancelled_at',
    extra: { cancelled_reason: reason, cancelled_by: req.user.id },
  }));
});

// Cancel: staff only, any status that is not completed (or already cancelled). Reason required.
router.post('/orders/:id/cancel', (req, res) => {
  const reason = requireReason(req.body?.reason);
  respond(res, transition(orderId(req), {
    from: ['new', 'accepted', 'preparing', 'ready', 'served'], to: 'cancelled', tsColumn: 'cancelled_at',
    extra: { cancelled_reason: reason, cancelled_by: req.user.id },
  }));
});

router.post('/orders/:id/served', (req, res) => {
  respond(res, transition(orderId(req), { from: ['ready'], to: 'served', tsColumn: 'served_at' }));
});

module.exports = router;
