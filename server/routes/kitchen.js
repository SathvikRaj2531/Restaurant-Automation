// Kitchen API. Kitchen sees only accepted-and-later orders, without prices. It cannot accept, cancel or see bills.
const express = require('express');
const { requireAuth } = require('../auth');
const { HttpError } = require('../util');
const { loadOrders, transition, kitchenView } = require('../orders');

const router = express.Router();
router.use(requireAuth('kitchen', 'owner'));
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// Oldest first (by the time the manager accepted them)
router.get('/orders', (req, res) => {
  const orders = loadOrders("o.status IN ('accepted','preparing','ready')", [], 'o.accepted_at ASC, o.id ASC').map(kitchenView);
  res.json({ orders, waiting_count: orders.filter((o) => o.status === 'accepted').length });
});

const orderId = (req) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw new HttpError(400, 'Invalid order.');
  return id;
};

router.post('/orders/:id/start', (req, res) => {
  res.json({ order: kitchenView(transition(orderId(req), { from: ['accepted'], to: 'preparing', tsColumn: 'preparing_at' })) });
});

router.post('/orders/:id/ready', (req, res) => {
  res.json({ order: kitchenView(transition(orderId(req), { from: ['preparing'], to: 'ready', tsColumn: 'ready_at' })) });
});

module.exports = router;
