// Order creation, loading and per-audience views. Prices are always recalculated here from the menu.
const S = require('./settings');
const { db, tx, nowIso } = require('./db');
const { HttpError } = require('./util');

const cleanText = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Order numbers look like 1211-004: day+month (India time) and a running number for that day. */
function nextOrderNo() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: S.TIMEZONE, day: '2-digit', month: '2-digit' }).formatToParts(new Date());
  const prefix = parts.find((p) => p.type === 'day').value + parts.find((p) => p.type === 'month').value;
  const row = db.prepare("SELECT MAX(CAST(substr(order_no, 6) AS INTEGER)) AS n FROM orders WHERE order_no LIKE ?").get(prefix + '-%');
  return `${prefix}-${String((row.n || 0) + 1).padStart(3, '0')}`;
}

function validateLines(raw) {
  if (!Array.isArray(raw) || !raw.length) throw new HttpError(400, 'Your cart is empty.');
  if (raw.length > S.MAX_ORDER_LINES) throw new HttpError(400, `Too many different items (maximum ${S.MAX_ORDER_LINES}).`);
  return raw.map((l) => {
    const item_id = Number(l?.item_id);
    const qty = Number(l?.qty);
    if (!Number.isInteger(item_id)) throw new HttpError(400, 'Invalid item in cart.');
    if (!Number.isInteger(qty) || qty < 1 || qty > S.MAX_QTY_PER_LINE) {
      throw new HttpError(400, `Quantity must be between 1 and ${S.MAX_QTY_PER_LINE}.`);
    }
    // Any client-sent price is ignored on purpose.
    return { item_id, qty, portion_label: String(l.portion_label ?? ''), note: cleanText(l.note, S.MAX_NOTE_LENGTH) };
  });
}

function createOrder({ tableId, items, overallNote, idempotencyKey }) {
  const lines = validateLines(items);
  const note = cleanText(overallNote, S.MAX_OVERALL_NOTE_LENGTH);
  const key = /^[\w-]{8,64}$/.test(String(idempotencyKey || '')) ? String(idempotencyKey) : null;

  const orderId = tx(() => {
    if (key) {
      const existing = db.prepare('SELECT id FROM orders WHERE table_id = ? AND idempotency_key = ?').get(tableId, key);
      if (existing) return { id: existing.id, duplicate: true };
    }
    const priced = lines.map((l) => {
      const item = db.prepare('SELECT * FROM menu_items WHERE id = ? AND deleted_at IS NULL').get(l.item_id);
      if (!item) throw new HttpError(409, 'An item in your cart is no longer on the menu.', { item_id: l.item_id });
      if (!item.available) throw new HttpError(409, `"${item.name}" is currently unavailable.`, { item_id: item.id });
      const portion = JSON.parse(item.portions).find((p) => p.label === l.portion_label);
      if (!portion) throw new HttpError(409, `"${item.name}" is no longer offered in that portion.`, { item_id: item.id });
      if (!Number.isInteger(portion.price)) throw new HttpError(409, `The price of "${item.name}" is yet to be confirmed, so it cannot be ordered.`, { item_id: item.id });
      return { item, portion, ...l };
    });
    const subtotal = priced.reduce((sum, l) => sum + l.portion.price * l.qty, 0);

    let visit = db.prepare("SELECT id FROM visits WHERE table_id = ? AND status = 'open'").get(tableId);
    if (!visit) {
      const r = db.prepare('INSERT INTO visits (table_id) VALUES (?)').run(tableId);
      visit = { id: Number(r.lastInsertRowid) };
    }
    const r = db.prepare(
      `INSERT INTO orders (order_no, table_id, visit_id, status, overall_note, subtotal, idempotency_key, created_at)
       VALUES (?, ?, ?, 'new', ?, ?, ?, ?)`
    ).run(nextOrderNo(), tableId, visit.id, note || null, subtotal, key, nowIso());
    const id = Number(r.lastInsertRowid);
    const ins = db.prepare(
      `INSERT INTO order_items (order_id, item_id, name_snapshot, portion_label, unit_price_snapshot, qty, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const l of priced) ins.run(id, l.item.id, l.item.name, l.portion.label, l.portion.price, l.qty, l.note || null);
    return { id, duplicate: false };
  });

  const order = loadOrders('o.id = ?', [orderId.id])[0];
  order.duplicate = orderId.duplicate;
  return order;
}

/** whereSql is built by our own code only (never from user input); values go through params. */
function loadOrders(whereSql, params = [], orderBy = 'o.created_at ASC, o.id ASC', limit = 500) {
  const rows = db.prepare(
    `SELECT o.*, t.number AS table_number, u.name AS cancelled_by_name
     FROM orders o JOIN dining_tables t ON t.id = o.table_id LEFT JOIN users u ON u.id = o.cancelled_by
     WHERE ${whereSql} ORDER BY ${orderBy} LIMIT ${limit}`
  ).all(...params);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const items = db.prepare(`SELECT * FROM order_items WHERE order_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`).all(...ids);
  const byOrder = new Map(ids.map((id) => [id, []]));
  for (const it of items) byOrder.get(it.order_id).push(it);
  return rows.map((r) => ({ ...r, items: byOrder.get(r.id) }));
}

/**
 * Move an order to a new status, but only if it is currently in one of the allowed `from` statuses.
 * The check and the update are one SQL statement, so two people tapping at once cannot both win.
 * `tsColumn` and `extra` keys are fixed names from our own code, never user input.
 */
function transition(orderId, { from, to, tsColumn, extra = {} }) {
  const sets = ['status = ?', `${tsColumn} = ?`];
  const params = [to, nowIso()];
  for (const [col, val] of Object.entries(extra)) { sets.push(`${col} = ?`); params.push(val); }
  const r = db.prepare(
    `UPDATE orders SET ${sets.join(', ')} WHERE id = ? AND status IN (${from.map(() => '?').join(',')})`
  ).run(...params, orderId, ...from);
  if (!Number(r.changes)) {
    const cur = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
    if (!cur) throw new HttpError(404, 'Order not found.');
    throw new HttpError(409, `This order is already "${cur.status}". The list has been refreshed.`);
  }
  return loadOrders('o.id = ?', [orderId])[0];
}

function requireReason(value) {
  const reason = cleanText(value, S.MAX_REASON_LENGTH);
  if (!reason) throw new HttpError(400, 'A reason is required.');
  return reason;
}

const itemView = (i) => ({
  name: i.name_snapshot, portion_label: i.portion_label, unit_price: i.unit_price_snapshot,
  qty: i.qty, note: i.note || '', line_total: i.unit_price_snapshot * i.qty,
});

/** What the customer at the table sees. */
function customerView(o) {
  return {
    id: o.id, order_no: o.order_no, status: o.status, overall_note: o.overall_note || '',
    subtotal: o.subtotal, created_at: o.created_at,
    cancelled_reason: o.status === 'cancelled' ? o.cancelled_reason : null,
    items: o.items.map(itemView),
  };
}

/** Manager / owner view. */
function staffView(o) {
  return {
    ...customerView(o),
    table_id: o.table_id, table_number: o.table_number, visit_id: o.visit_id,
    accepted_at: o.accepted_at, preparing_at: o.preparing_at, ready_at: o.ready_at,
    served_at: o.served_at, completed_at: o.completed_at, cancelled_at: o.cancelled_at,
    cancelled_reason: o.cancelled_reason, cancelled_by_name: o.cancelled_by_name || null,
  };
}

/** Kitchen view: no prices or totals. */
function kitchenView(o) {
  return {
    id: o.id, order_no: o.order_no, status: o.status, table_number: o.table_number,
    overall_note: o.overall_note || '', created_at: o.created_at, accepted_at: o.accepted_at,
    preparing_at: o.preparing_at, ready_at: o.ready_at,
    items: o.items.map((i) => ({ name: i.name_snapshot, portion_label: i.portion_label, qty: i.qty, note: i.note || '' })),
  };
}

module.exports = { createOrder, loadOrders, transition, requireReason, customerView, staffView, kitchenView };
