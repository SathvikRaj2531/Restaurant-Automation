// Central constants. Change values here, not in the code that uses them.
module.exports = {
  PORT: Number(process.env.PORT) || 3000,
  DB_PATH: process.env.DB_PATH || require('path').join(__dirname, '..', 'data', 'pcube.db'),
  // Optional. Set in production so printed QR codes always use the real domain, e.g. https://example.com
  PUBLIC_BASE_URL: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),

  TIMEZONE: 'Asia/Kolkata',
  CURRENCY_CODE: 'INR',
  CURRENCY_SYMBOL: '₹',

  TABLE_COUNT: Number(process.env.TABLE_COUNT) || 6,

  POLL_INTERVAL_MS: 4000,
  KITCHEN_WAIT_WARN_MINUTES: 10,

  SESSION_DAYS: 7,
  MIN_PASSWORD_LENGTH: 8,

  // Order limits (server-side validation)
  MAX_ORDER_LINES: 30,
  MAX_QTY_PER_LINE: 20,
  MAX_NOTE_LENGTH: 200,
  MAX_OVERALL_NOTE_LENGTH: 500,
  MAX_REASON_LENGTH: 300,
  WAITER_RATE_LIMIT: { windowMs: 60 * 1000, max: 6 }, // per table
  WAITER_COMPLETED_VISIBLE_SECONDS: 120, // how long a customer still sees "completed"
  ORDER_RATE_LIMIT: { windowMs: 60 * 1000, max: 10 }, // per table
  LOGIN_RATE_LIMIT: { windowMs: 10 * 60 * 1000, max: 8 }, // failed attempts per username

  ROLES: ['owner', 'manager', 'kitchen', 'waiter'],
  STATUSES: ['new', 'accepted', 'preparing', 'ready', 'served', 'completed', 'cancelled'],
};
