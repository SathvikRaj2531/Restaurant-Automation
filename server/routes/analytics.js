// Analytics API (owner / manager). Waiter and kitchen get 403.
const express = require('express');
const { requireAuth } = require('../auth');
const { getAnalytics } = require('../analytics');

const router = express.Router();
router.use(requireAuth('owner', 'manager'));
router.get('/analytics', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(getAnalytics({ range: String(req.query.range || '7d'), from: req.query.from, to: req.query.to }));
});
module.exports = router;
