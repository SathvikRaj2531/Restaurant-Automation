const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const S = require('./settings');

fs.mkdirSync(path.dirname(S.DB_PATH), { recursive: true });
const db = new DatabaseSync(S.DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const TS = "TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

// ---- Migration (B1): waiter_requests used to have statuses open/resolved. Nothing wrote to it, but copy rows to be safe. ----
const oldWaiter = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'waiter_requests'").get();
const waiterIsOld = !!oldWaiter && !oldWaiter.sql.includes("'requested'");
if (waiterIsOld) db.exec('ALTER TABLE waiter_requests RENAME TO waiter_requests_old');

// ---- Migration (B3): the first-draft bills/payments tables were never written to. Replace them with the real schema. ----
const oldBills = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'bills'").get();
if (oldBills && !oldBills.sql.includes('bill_no')) {
  const used = Number(db.prepare('SELECT (SELECT COUNT(*) FROM bills) + (SELECT COUNT(*) FROM payments) AS n').get().n);
  if (used === 0) db.exec('DROP TABLE payments; DROP TABLE bills;');
  else db.exec('ALTER TABLE payments RENAME TO payments_legacy; ALTER TABLE bills RENAME TO bills_legacy;');
}

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  restaurant_name TEXT NOT NULL,
  address TEXT NOT NULL,
  hours TEXT NOT NULL,
  phone TEXT, whatsapp TEXT, gstin TEXT,
  tagline TEXT, about_text TEXT, maps_link TEXT, reviews_source TEXT,
  instagram TEXT, facebook TEXT,
  tax_percent REAL,             -- NULL = no tax
  service_charge_percent REAL   -- NULL = no service charge
);

CREATE TABLE IF NOT EXISTS dining_tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number INTEGER NOT NULL UNIQUE,
  qr_token TEXT NOT NULL UNIQUE,
  created_at ${TS}
);

CREATE TABLE IF NOT EXISTS menu_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES menu_categories(id),
  name TEXT NOT NULL,
  description TEXT,
  subcategory TEXT,
  is_veg INTEGER NOT NULL DEFAULT 1,
  portions TEXT NOT NULL,            -- JSON: [{label, price}]  price NULL = to be confirmed
  available INTEGER NOT NULL DEFAULT 1,
  special INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  UNIQUE (category_id, name)
);

CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_id INTEGER NOT NULL REFERENCES dining_tables(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_at ${TS},
  closed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_visit_per_table ON visits(table_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','manager','kitchen','waiter')),
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at ${TS}
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at ${TS},
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  table_id INTEGER NOT NULL REFERENCES dining_tables(id),
  visit_id INTEGER NOT NULL REFERENCES visits(id),
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','accepted','preparing','ready','served','completed','cancelled')),
  overall_note TEXT,
  subtotal INTEGER NOT NULL,         -- whole rupees, recalculated by the server
  idempotency_key TEXT,
  created_at ${TS},
  accepted_at TEXT, preparing_at TEXT, ready_at TEXT, served_at TEXT, completed_at TEXT, cancelled_at TEXT,
  cancelled_reason TEXT,
  cancelled_by INTEGER REFERENCES users(id),
  UNIQUE (table_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS orders_visit ON orders(visit_id);
CREATE INDEX IF NOT EXISTS orders_created ON orders(created_at);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES menu_items(id),
  name_snapshot TEXT NOT NULL,
  portion_label TEXT NOT NULL,
  unit_price_snapshot INTEGER NOT NULL,
  qty INTEGER NOT NULL,
  note TEXT
);
CREATE INDEX IF NOT EXISTS order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS waiter_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_id INTEGER NOT NULL REFERENCES dining_tables(id),
  visit_id INTEGER REFERENCES visits(id),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','acknowledged','completed')),
  created_at ${TS},
  acknowledged_at TEXT,
  acknowledged_by INTEGER REFERENCES users(id),
  completed_at TEXT,
  completed_by INTEGER REFERENCES users(id)
);
-- At most one active request per table: no duplicates even if two phones tap at once.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_waiter_request_per_table ON waiter_requests(table_id) WHERE status IN ('requested','acknowledged');
CREATE INDEX IF NOT EXISTS waiter_requests_status ON waiter_requests(status);

-- Bills are immutable snapshots: everything needed to reprint is stored on the row (B3).
CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY,                       -- sequential; bill_no = PC- + id padded to 6 digits
  bill_no TEXT NOT NULL UNIQUE,
  visit_id INTEGER NOT NULL UNIQUE REFERENCES visits(id),
  table_id INTEGER NOT NULL REFERENCES dining_tables(id),
  table_number INTEGER NOT NULL,
  lines TEXT NOT NULL,                          -- JSON: [{name, portion_label, unit_price, qty, amount}] aggregated by item + portion
  order_count INTEGER NOT NULL,
  subtotal INTEGER NOT NULL,
  service_charge_percent REAL,                  -- NULL = no service charge line
  service_charge INTEGER NOT NULL DEFAULT 0,
  tax_percent REAL,                             -- NULL = no tax line
  tax INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'paid',
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','upi','card')),
  payment_reference TEXT,
  header TEXT NOT NULL,                         -- JSON snapshot: restaurant name, address, phone, gstin
  paid_at ${TS},
  created_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS bills_paid_at ON bills(paid_at);
CREATE INDEX IF NOT EXISTS bills_table ON bills(table_id);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL REFERENCES bills(id),
  method TEXT NOT NULL CHECK (method IN ('cash','upi','card')),
  reference TEXT,
  amount INTEGER NOT NULL,
  created_at ${TS}
);

CREATE TRIGGER IF NOT EXISTS bills_no_update BEFORE UPDATE ON bills BEGIN SELECT RAISE(ABORT, 'bills are immutable'); END;
CREATE TRIGGER IF NOT EXISTS bills_no_delete BEFORE DELETE ON bills BEGIN SELECT RAISE(ABORT, 'bills are immutable'); END;
CREATE TRIGGER IF NOT EXISTS payments_no_update BEFORE UPDATE ON payments BEGIN SELECT RAISE(ABORT, 'payments are immutable'); END;
CREATE TRIGGER IF NOT EXISTS payments_no_delete BEFORE DELETE ON payments BEGIN SELECT RAISE(ABORT, 'payments are immutable'); END;
`);

if (waiterIsOld) {
  db.exec(`INSERT INTO waiter_requests (id, table_id, visit_id, status, created_at, completed_at)
    SELECT id, table_id, visit_id, CASE status WHEN 'open' THEN 'requested' ELSE 'completed' END, created_at, resolved_at FROM waiter_requests_old;
    DROP TABLE waiter_requests_old;`);
}

/** Run fn inside a write transaction. Rolls back if fn throws. */
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const nowIso = () => new Date().toISOString();

module.exports = { db, tx, nowIso };
