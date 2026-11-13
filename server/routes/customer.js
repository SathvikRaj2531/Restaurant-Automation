// Customer QR ordering API. Anyone holding a table's link can order; customers can never cancel.
const express = require('express');
const S = require('../settings');
const { db } = require('../db');
const { createLimiter } = require('../auth');
const { getSettings } = require('../data');
const { HttpError } = require('../util');
const { createOrder, loadOrders, customerView } = require('../orders');
const waiter = require('../waiter');

const router = express.Router();
const orderLimiter = createLimiter(S.ORDER_RATE_LIMIT);
const waiterLimiter = createLimiter(S.WAITER_RATE_LIMIT);

router.use('/t/:token', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  const table = db.prepare('SELECT id, number FROM dining_tables WHERE qr_token = ?').get(String(req.params.token));
  if (!table) throw new HttpError(404, 'Table not found');
  req.table = table;
  next();
});

router.get('/t/:token', (req, res) => {
  res.json({ table: { number: req.table.number }, restaurant_name: getSettings().restaurant_name });
});

router.get('/t/:token/orders', (req, res) => {
  const visit = db.prepare("SELECT id FROM visits WHERE table_id = ? AND status = 'open'").get(req.table.id);
  const orders = visit ? loadOrders('o.visit_id = ?', [visit.id], 'o.created_at DESC, o.id DESC') : [];
  const visit_total = orders.filter((o) => o.status !== 'cancelled').reduce((sum, o) => sum + o.subtotal, 0);
  res.json({ table: { number: req.table.number }, visit_total, orders: orders.map(customerView) });
});

router.post('/t/:token/orders', (req, res) => {
  const key = String(req.params.token);
  if (orderLimiter.blocked(key)) throw new HttpError(429, 'Orders are coming in very quickly from this table. Please wait a moment and try again.');
  orderLimiter.hit(key);
  const order = createOrder({
    tableId: req.table.id,
    items: req.body?.items,
    overallNote: req.body?.overall_note,
    idempotencyKey: req.body?.idempotency_key,
  });
  res.status(order.duplicate ? 200 : 201).json({ order: customerView(order) });
});

// B1: Call Waiter. Anyone with the table link can call; a table can have only one active request.
router.get('/t/:token/waiter', (req, res) => res.json({ request: waiter.customerRequest(req.table.id) }));

router.post('/t/:token/waiter', (req, res) => {
  const key = String(req.params.token);
  if (waiterLimiter.blocked(key)) throw new HttpError(429, 'Please wait a moment before calling the waiter again.');
  waiterLimiter.hit(key);
  const { request, duplicate } = waiter.createRequest(req.table.id);
  res.status(duplicate ? 200 : 201).json({ request, duplicate });
});

module.exports = router;
