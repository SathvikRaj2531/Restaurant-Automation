// Billing: table detail (running total), payment -> immutable bill, bill history, receipt text and PDF.
const S = require('./settings');
const { db, tx, nowIso } = require('./db');
const { HttpError } = require('./util');
const { loadOrders, staffView } = require('./orders');
const { getSettings } = require('./data');

const METHODS = ['cash', 'upi', 'card'];
const METHOD_LABEL = { cash: 'Cash', upi: 'UPI', card: 'Card' };
const pad6 = (n) => String(n).padStart(6, '0');

/** Combine order lines by item + portion (+ price, in case a price changed between two orders of the same visit). */
function aggregate(orders) {
  const map = new Map();
  for (const o of orders) {
    for (const i of o.items) {
      const key = `${i.name_snapshot}|${i.portion_label}|${i.unit_price_snapshot}`;
      const line = map.get(key) || { name: i.name_snapshot, portion_label: i.portion_label, unit_price: i.unit_price_snapshot, qty: 0, amount: 0 };
      line.qty += i.qty;
      line.amount += i.qty * i.unit_price_snapshot;
      map.set(key, line);
    }
  }
  return [...map.values()];
}

/** Service charge is on the subtotal; tax (GST) is on subtotal + service charge. Lines exist only if a percent is configured. */
function totals(subtotal, settings) {
  const scPct = settings.service_charge_percent > 0 ? settings.service_charge_percent : null;
  const taxPct = settings.tax_percent > 0 ? settings.tax_percent : null;
  const service = scPct ? Math.round((subtotal * scPct) / 100) : 0;
  const tax = taxPct ? Math.round(((subtotal + service) * taxPct) / 100) : 0;
  return { subtotal, service_charge_percent: scPct, service_charge: service, tax_percent: taxPct, tax, total: subtotal + service + tax };
}

const openVisit = (tableId) => db.prepare("SELECT id, opened_at FROM visits WHERE table_id = ? AND status = 'open'").get(tableId);

function tableByNumber(number) {
  const n = Number(number);
  const t = Number.isInteger(n) ? db.prepare('SELECT id, number FROM dining_tables WHERE number = ?').get(n) : null;
  if (!t) throw new HttpError(404, 'Table not found.');
  return t;
}

/** Running total for the table's open visit. This is NOT a bill. */
function tableDetail(number) {
  const table = tableByNumber(number);
  const visit = openVisit(table.id);
  const orders = visit ? loadOrders("o.visit_id = ? AND o.status != 'cancelled'", [visit.id]) : [];
  const subtotal = orders.reduce((sum, o) => sum + o.subtotal, 0);
  return {
    table: { number: table.number },
    visit: visit ? { id: visit.id, opened_at: visit.opened_at } : null,
    orders: orders.map(staffView),
    lines: aggregate(orders),
    running_total: subtotal,
    new_count: orders.filter((o) => o.status === 'new').length,
    unserved_count: orders.filter((o) => ['accepted', 'preparing', 'ready'].includes(o.status)).length,
    payable: totals(subtotal, getSettings()), // what would be charged now, with the configured service charge / tax
  };
}

function cleanReference(v) {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (t.length > 60) throw new HttpError(400, 'Reference must be at most 60 characters.');
  return t;
}

/** Record the payment: creates the immutable bill, closes the visit and completes its orders, all or nothing. */
function recordPayment(number, { method, reference, confirm_unserved }, userId) {
  if (!METHODS.includes(method)) throw new HttpError(400, 'Choose Cash, UPI or Card.');
  const ref = method === 'cash' ? '' : cleanReference(reference);
  const table = tableByNumber(number);

  const billId = tx(() => {
    const visit = openVisit(table.id);
    if (!visit) throw new HttpError(409, 'This table has no open visit to bill.');
    const orders = loadOrders("o.visit_id = ? AND o.status != 'cancelled'", [visit.id]);
    if (!orders.length) throw new HttpError(409, 'There is nothing to bill for this table.');
    if (orders.some((o) => o.status === 'new')) throw new HttpError(409, 'A new order is waiting to be accepted. Accept or reject it before taking payment.');
    if (!confirm_unserved && orders.some((o) => ['accepted', 'preparing', 'ready'].includes(o.status))) {
      throw new HttpError(409, 'Some orders are not served yet.', { needs_confirm: true });
    }

    const settings = getSettings();
    const subtotal = orders.reduce((sum, o) => sum + o.subtotal, 0);
    const t = totals(subtotal, settings);
    const id = Number(db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM bills').get().n);
    const header = { restaurant_name: settings.restaurant_name, address: settings.address, phone: settings.phone || '', gstin: settings.gstin || '' };
    const now = nowIso();
    db.prepare(
      `INSERT INTO bills (id, bill_no, visit_id, table_id, table_number, lines, order_count, subtotal,
         service_charge_percent, service_charge, tax_percent, tax, total, payment_method, payment_reference, header, paid_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, `PC-${pad6(id)}`, visit.id, table.id, table.number, JSON.stringify(aggregate(orders)), orders.length, t.subtotal,
      t.service_charge_percent, t.service_charge, t.tax_percent, t.tax, t.total, method, ref || null, JSON.stringify(header), now, userId);
    db.prepare('INSERT INTO payments (bill_id, method, reference, amount, created_at) VALUES (?, ?, ?, ?, ?)').run(id, method, ref || null, t.total, now);
    db.prepare("UPDATE visits SET status = 'closed', closed_at = ? WHERE id = ?").run(now, visit.id);
    db.prepare("UPDATE orders SET status = 'completed', completed_at = ? WHERE visit_id = ? AND status IN ('accepted','preparing','ready','served')").run(now, visit.id);
    return id;
  });
  return billView(db.prepare('SELECT * FROM bills WHERE id = ?').get(billId));
}

function billView(b) {
  return {
    bill_no: b.bill_no, table_number: b.table_number, paid_at: b.paid_at, payment_status: b.payment_status,
    payment_method: b.payment_method, payment_reference: b.payment_reference || '',
    lines: JSON.parse(b.lines), order_count: b.order_count,
    subtotal: b.subtotal, service_charge_percent: b.service_charge_percent, service_charge: b.service_charge,
    tax_percent: b.tax_percent, tax: b.tax, total: b.total, header: JSON.parse(b.header),
  };
}

function getBill(billNo) {
  const b = db.prepare('SELECT * FROM bills WHERE bill_no = ?').get(String(billNo).toUpperCase());
  if (!b) throw new HttpError(404, 'Bill not found.');
  return b;
}

/** Bill history, newest first. q = part of the bill number, table = table number, date = YYYY-MM-DD (India time). */
function listBills({ q, table, date }) {
  const where = [];
  const params = [];
  const term = String(q || '').trim().toUpperCase();
  if (term) { where.push('bill_no LIKE ?'); params.push('%' + term.replace(/[%_]/g, '') + '%'); }
  if (table) {
    const n = Number(table);
    if (!Number.isInteger(n)) throw new HttpError(400, 'Invalid table.');
    where.push('table_number = ?'); params.push(n);
  }
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new HttpError(400, 'Invalid date.');
    const start = new Date(`${date}T00:00:00+05:30`);
    where.push('paid_at >= ? AND paid_at < ?');
    params.push(start.toISOString(), new Date(start.getTime() + 86400000).toISOString());
  }
  const rows = db.prepare(
    `SELECT bill_no, table_number, paid_at, payment_method, total FROM bills ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 200`
  ).all(...params);
  return rows.map((r) => ({ ...r }));
}

// ---------------- Settings (owner) ----------------
function percent(v, label) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new HttpError(400, `${label} must be a number between 0 and 100, or empty for none.`);
  const r = Math.round(n * 100) / 100;
  return r === 0 ? null : r;
}
const field = (v, max, label, required) => {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (required && !t) throw new HttpError(400, `${label} is required.`);
  if (t.length > max) throw new HttpError(400, `${label} must be at most ${max} characters.`);
  return t;
};

function updateSettings(b) {
  const v = {
    restaurant_name: field(b?.restaurant_name, 100, 'Restaurant name', true),
    address: field(b?.address, 300, 'Address', true),
    phone: field(b?.phone, 40, 'Phone', false),
    gstin: field(b?.gstin, 30, 'GSTIN', false),
    tax_percent: percent(b?.tax_percent, 'Tax percent'),
    service_charge_percent: percent(b?.service_charge_percent, 'Service charge percent'),
  };
  db.prepare(
    `UPDATE settings SET restaurant_name = ?, address = ?, phone = ?, gstin = ?, tax_percent = ?, service_charge_percent = ? WHERE id = 1`
  ).run(v.restaurant_name, v.address, v.phone || null, v.gstin || null, v.tax_percent, v.service_charge_percent);
  return settingsView();
}
function settingsView() {
  const s = getSettings();
  return { restaurant_name: s.restaurant_name, address: s.address, phone: s.phone || '', gstin: s.gstin || '', tax_percent: s.tax_percent, service_charge_percent: s.service_charge_percent };
}

// ---------------- Receipt text + PDF ----------------
const ascii = (t) => String(t ?? '').replace(/₹/g, 'Rs.').replace(/[–—]/g, '-').replace(/[^\x20-\x7e]/g, '?');
const istParts = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: S.TIMEZONE, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso));
const money = (n) => 'Rs.' + Math.round(n).toLocaleString('en-IN');
const COLS = 42;

function wrap(text, width) {
  const words = ascii(text).split(' ');
  const out = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > width) { if (cur) out.push(cur); cur = w.slice(0, width); } else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(cur);
  return out;
}
const center = (t) => ' '.repeat(Math.max(0, Math.floor((COLS - t.length) / 2))) + t;
const lr = (l, r) => { const gap = COLS - l.length - r.length; return gap >= 1 ? l + ' '.repeat(gap) + r : l + ' ' + r; };
const rule = (c = '-') => c.repeat(COLS);

function receiptLines(b) {
  const L = [];
  const h = b.header;
  wrap(h.restaurant_name.toUpperCase(), COLS).forEach((t) => L.push(center(t)));
  wrap(h.address, COLS).forEach((t) => L.push(center(t)));
  if (h.phone) L.push(center(ascii('Ph: ' + h.phone)));
  if (h.gstin) L.push(center(ascii('GSTIN: ' + h.gstin)));
  L.push(rule('='));
  L.push(lr('Bill: ' + b.bill_no, 'Table ' + b.table_number));
  L.push(ascii(istParts(b.paid_at)));
  L.push(rule());
  L.push(lr('Item', 'Amount'));
  L.push(rule());
  for (const i of b.lines) {
    const name = i.name + (i.portion_label === 'Regular' ? '' : ` (${i.portion_label})`);
    const wrapped = wrap(name, COLS - 12);
    wrapped.forEach((t, k) => L.push(k === wrapped.length - 1 ? lr(t, money(i.amount)) : t));
    L.push('  ' + `${i.qty} x ${money(i.unit_price)}`);
  }
  L.push(rule());
  L.push(lr('Subtotal', money(b.subtotal)));
  if (b.service_charge_percent) L.push(lr(`Service charge (${b.service_charge_percent}%)`, money(b.service_charge)));
  if (b.tax_percent) L.push(lr(`Tax (${b.tax_percent}%)`, money(b.tax)));
  L.push(rule('='));
  L.push(lr('TOTAL', money(b.total)));
  L.push(rule('='));
  L.push(lr('Payment', `${METHOD_LABEL[b.payment_method]} - ${b.payment_status.toUpperCase()}`));
  if (b.payment_reference) L.push(ascii('Ref: ' + b.payment_reference));
  L.push('');
  L.push(center('Thank you! Visit again.'));
  return L;
}

/** Minimal single-page PDF (80 mm wide, Courier). No library needed. */
function receiptPdf(b) {
  const lines = receiptLines(b);
  const FS = 8, LEAD = 10, MX = 8, MY = 10;
  const W = 226.77; // 80 mm in points
  const H = Math.max(120, MY * 2 + lines.length * LEAD);
  const esc = (t) => t.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  let stream = `BT /F1 ${FS} Tf ${LEAD} TL ${MX} ${(H - MY - FS + 2).toFixed(2)} Td\n`;
  for (const l of lines) stream += `(${esc(l)}) Tj T*\n`;
  stream += 'ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H.toFixed(2)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

module.exports = { tableDetail, recordPayment, billView, getBill, listBills, updateSettings, settingsView, receiptPdf, receiptLines, totals, METHODS };
