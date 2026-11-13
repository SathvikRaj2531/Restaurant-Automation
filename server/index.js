const path = require('path');
const express = require('express');
const S = require('./settings');
const { db } = require('./db');
const { HttpError } = require('./util');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

const PAGES = path.join(__dirname, '..', 'pages');
const PUBLIC = path.join(__dirname, '..', 'public');
const sendPage = (name) => (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(PAGES, name));
};

// API routers. The generic /api router ends with a 404 catch-all, so it must stay last.
app.use('/api', require('./routes/customer'));
app.use('/api/staff/menu', require('./routes/menuAdmin'));
app.use('/api/staff', require('./routes/staff'));
app.use('/api/staff', require('./routes/billing'));
app.use('/api/staff', require('./routes/analytics'));
app.use('/api/kitchen', require('./routes/kitchen'));
app.use('/api/waiter', require('./routes/waiter'));
app.use('/api', require('./routes/api'));
app.use('/img', express.static(path.join(PUBLIC, 'img'), { maxAge: '30d' }));
app.use(express.static(PUBLIC, { index: false, maxAge: '1h' }));

// Staff-side pages (HTML shells; data and permissions are enforced by the API)
app.get('/staff/login', sendPage('login.html'));
app.get('/staff/change-password', sendPage('change-password.html'));
app.get('/staff/qr', sendPage('qr.html'));
app.get('/staff/menu', sendPage('menu-admin.html'));
app.get('/staff/table/:number', sendPage('table.html'));
app.get('/staff/bills', sendPage('bills.html'));
app.get('/staff/bill/:billNo', sendPage('bill.html'));
app.get('/staff/settings', sendPage('settings.html'));
app.get('/staff/analytics', sendPage('analytics.html'));
app.get('/staff', sendPage('staff.html'));
app.get('/kitchen', sendPage('kitchen.html'));
app.get('/waiter', sendPage('waiter.html'));

// A3: customer ordering page. Unknown token -> "Table not found".
const TABLE_NOT_FOUND = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Table not found</title><link rel="stylesheet" href="/css/theme.css"><link rel="stylesheet" href="/css/app.css"></head><body><main class="auth-wrap"><div class="card auth-card"><h1>Table not found</h1><p class="muted">This QR code is not valid. Please ask a member of staff for help.</p></div></main></body></html>`;
app.get('/t/:token', (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');
  const found = db.prepare('SELECT 1 FROM dining_tables WHERE qr_token = ?').get(String(req.params.token));
  if (!found) return res.status(404).type('html').send(TABLE_NOT_FOUND);
  res.sendFile(path.join(PAGES, 'order.html'));
});

// A2 public website
const site = require('./routes/site');
app.use(site);

app.use(site.notFoundHandler);
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  if (err.status && err.status < 500) return res.status(err.status).json({ error: 'Invalid request.' }); // e.g. malformed JSON
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

if (require.main === module) {
  app.listen(S.PORT, () => console.log(`P Cube Charcoal Food Den running on http://localhost:${S.PORT}`));
}
module.exports = app;
