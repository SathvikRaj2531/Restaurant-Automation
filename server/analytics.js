// Analytics. Uses ONLY paid bills (and the non-cancelled orders of those paid visits). Cancelled orders never count.
const S = require('./settings');
const { db } = require('./db');
const { HttpError } = require('./util');

const istDate = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: S.TIMEZONE }); // YYYY-MM-DD
const addDays = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const validYmd = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(Date.parse(v));

function resolveRange(range, from, to) {
  const today = istDate(new Date());
  switch (range) {
    case 'today': return { from: today, to: today };
    case 'yesterday': return { from: addDays(today, -1), to: addDays(today, -1) };
    case '7d': return { from: addDays(today, -6), to: today };
    case '30d': return { from: addDays(today, -29), to: today };
    case 'custom': {
      if (!validYmd(from) || !validYmd(to)) throw new HttpError(400, 'Choose a valid start and end date.');
      if (from > to) throw new HttpError(400, 'The start date must not be after the end date.');
      if (Date.parse(to) - Date.parse(from) > 365 * 86400000) throw new HttpError(400, 'Choose a range of at most one year.');
      return { from, to };
    }
    default: throw new HttpError(400, 'Unknown range.');
  }
}

function getAnalytics({ range, from, to }) {
  const r = resolveRange(range, from, to);
  const startIso = new Date(`${r.from}T00:00:00+05:30`).toISOString();
  const endIso = new Date(`${addDays(r.to, 1)}T00:00:00+05:30`).toISOString();

  const bills = db.prepare('SELECT table_number, paid_at, total, order_count, lines FROM bills WHERE paid_at >= ? AND paid_at < ?').all(startIso, endIso);

  // Daily revenue (every day in the range, zeros included)
  const daily = new Map();
  for (let d = r.from; d <= r.to; d = addDays(d, 1)) daily.set(d, { date: d, revenue: 0, bills: 0 });
  const monthly = new Map();
  const items = new Map();
  const tables = new Map(db.prepare('SELECT number FROM dining_tables ORDER BY number').all().map((t) => [t.number, { table: t.number, revenue: 0, bills: 0 }]));
  let revenue = 0, orders = 0;

  for (const b of bills) {
    const day = istDate(b.paid_at);
    const dd = daily.get(day);
    if (dd) { dd.revenue += b.total; dd.bills += 1; }
    const mk = day.slice(0, 7);
    const m = monthly.get(mk) || { month: mk, revenue: 0, bills: 0 };
    m.revenue += b.total; m.bills += 1; monthly.set(mk, m);
    revenue += b.total;
    orders += b.order_count;
    for (const l of JSON.parse(b.lines)) items.set(l.name, (items.get(l.name) || 0) + l.qty);
    const t = tables.get(b.table_number) || { table: b.table_number, revenue: 0, bills: 0 };
    t.revenue += b.total; t.bills += 1; tables.set(b.table_number, t);
  }

  // Peak hours: non-cancelled orders of paid visits, by India-time hour of day
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0 }));
  const orderRows = db.prepare(
    `SELECT o.created_at FROM orders o JOIN bills b ON b.visit_id = o.visit_id
     WHERE o.status != 'cancelled' AND b.paid_at >= ? AND b.paid_at < ?`
  ).all(startIso, endIso);
  for (const o of orderRows) hours[new Date(Date.parse(o.created_at) + 330 * 60000).getUTCHours()].orders += 1;

  const ranked = [...items.entries()].map(([name, qty]) => ({ name, qty })).filter((i) => i.qty > 0);
  const best = [...ranked].sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name)).slice(0, 10);
  const least = [...ranked].sort((a, b) => a.qty - b.qty || a.name.localeCompare(b.name)).slice(0, 10);

  return {
    range: { key: range, from: r.from, to: r.to },
    totals: { revenue, paid_bills: bills.length, orders, avg_order_value: bills.length ? Math.round(revenue / bills.length) : 0 },
    daily: [...daily.values()],
    monthly: [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month)),
    best_sellers: best,
    least_sellers: least,
    peak_hours: hours,
    tables: [...tables.values()].sort((a, b) => a.table - b.table),
  };
}

module.exports = { getAnalytics };
