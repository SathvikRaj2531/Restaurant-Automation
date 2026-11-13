// Waiter API. One waiter serves every table, so there is no routing: the waiter sees all open requests.
const express = require('express');
const { requireAuth } = require('../auth');
const { handlers } = require('../waiter');

const router = express.Router();
router.use(requireAuth('waiter'));
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.get('/requests', handlers.list);
router.post('/requests/:id/acknowledge', handlers.acknowledge);
router.post('/requests/:id/complete', handlers.complete);

module.exports = router;
