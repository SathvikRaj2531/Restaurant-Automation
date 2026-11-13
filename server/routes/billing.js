// Billing, bill history and settings. Mounted under /api/staff after the staff router, so the
// manager/owner check in routes/staff.js already blocks waiter and kitchen from every route here.
const express = require('express');
const { requireAuth } = require('../auth');
const B = require('../billing');

const router = express.Router();
router.use(requireAuth('owner', 'manager'));
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.get('/tables/:number/detail', (req, res) => res.json(B.tableDetail(req.params.number)));
router.post('/tables/:number/pay', (req, res) => res.status(201).json({ bill: B.recordPayment(req.params.number, req.body || {}, req.user.id) }));

router.get('/bills', (req, res) => res.json({ bills: B.listBills({ q: req.query.q, table: req.query.table, date: req.query.date }) }));
router.get('/bills/:billNo', (req, res) => res.json({ bill: B.billView(B.getBill(req.params.billNo)) }));
router.get('/bills/:billNo/pdf', (req, res) => {
  const bill = B.billView(B.getBill(req.params.billNo));
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${bill.bill_no}.pdf"` });
  res.send(B.receiptPdf(bill));
});

// Settings: owner only
router.get('/settings', requireAuth('owner'), (req, res) => res.json({ settings: B.settingsView() }));
router.put('/settings', requireAuth('owner'), (req, res) => res.json({ settings: B.updateSettings(req.body) }));

module.exports = router;
