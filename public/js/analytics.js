/* Analytics (owner / manager). Paid bills only; cancelled orders are never counted. */
(function () {
  const { h, api, fmtINR } = PC;
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const RANGES = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['custom', 'Custom range']];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  let range = '7d';
  let from = PC.todayIST();
  let to = PC.todayIST();
  let seq = 0; // ignore out-of-order responses

  const svg = (tag, attrs, ...kids) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    kids.forEach((k) => el.append(k));
    return el;
  };
  const shortDate = (ymd) => { const [, m, d] = ymd.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; };
  const monthLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
  const hourLabel = (hr) => `${((hr + 11) % 12) + 1}${hr < 12 ? 'am' : 'pm'}`;
  const niceMax = (v) => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); const f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };

  /** Column chart: thin bars, 4px rounded data end on the baseline, recessive grid, hover/focus tooltip, table view below. */
  function columnChart(data, { fmt, title, labelEvery }) {
    const W = 620, H = 240, L = 64, R = 8, T = 12, B = 30;
    const pw = W - L - R, ph = H - T - B;
    const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
    const slot = pw / data.length;
    const bw = Math.max(3, Math.min(28, slot - 2));
    const root = svg('svg', { class: 'an-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': title });
    [0, 0.5, 1].forEach((f) => {
      const y = T + ph - ph * f;
      root.append(svg('line', { class: 'grid', x1: L, x2: W - R, y1: y, y2: y }));
      const t = svg('text', { class: 'tick', x: L - 6, y: y + 4, 'text-anchor': 'end' });
      t.textContent = fmt(max * f);
      root.append(t);
    });
    data.forEach((d, i) => {
      const x = L + slot * i + (slot - bw) / 2;
      const bh = d.value > 0 ? Math.max(2, (d.value / max) * ph) : 0;
      const r = Math.min(4, bw / 2, bh);
      const y = T + ph - bh;
      const g = svg('g', { tabindex: '0', 'aria-label': d.tip });
      const tip = svg('title'); tip.textContent = d.tip;
      g.append(tip, svg('rect', { class: 'hit', x: L + slot * i, y: T, width: slot, height: ph }));
      if (bh) g.append(svg('path', { class: 'bar', d: `M${x},${T + ph} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${T + ph} Z` }));
      root.append(g);
      if (i % labelEvery === 0) {
        const t = svg('text', { class: 'tick', x: x + bw / 2, y: H - 9, 'text-anchor': 'middle' });
        t.textContent = d.label;
        root.append(t);
      }
    });
    return root;
  }

  function dataTable(headers, rows) {
    return h('details', { class: 'an-data' }, h('summary', { text: 'View as table' }),
      h('table', { class: 'an-table' },
        h('thead', {}, h('tr', {}, headers.map((t, i) => h('th', { class: i ? 'num' : '', text: t })))),
        h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c, i) => h('td', { class: i ? 'num' : '', text: c })))))));
  }

  function rank(items, fmtVal, emptyText) {
    if (!items.length) return h('p', { class: 'muted', text: emptyText });
    const max = Math.max(...items.map((i) => i.v));
    return h('ol', { class: 'an-rank' }, items.map((i) => h('li', {},
      h('span', { text: i.name }), h('span', { class: 'val', text: fmtVal(i.v) }),
      h('span', { class: 'track', 'aria-hidden': 'true' }, h('span', { class: 'fill', style: `width:${max ? Math.max(2, (i.v / max) * 100) : 0}%` })))));
  }

  const card = (title, sub, ...body) => h('section', { class: 'an-card' }, h('h2', { text: title }), sub ? h('p', { class: 'sub', text: sub }) : null, body);
  const kpi = (l, v) => h('div', { class: 'an-kpi' }, h('div', { class: 'v', text: v }), h('div', { class: 'l', text: l }));
  const compact = (n) => (n >= 100000 ? '₹' + (n / 100000).toFixed(n % 100000 ? 1 : 0) + 'L' : n >= 1000 ? '₹' + (n / 1000).toFixed(n % 1000 ? 1 : 0) + 'k' : '₹' + Math.round(n));

  function render(d) {
    const t = d.totals;
    if (!t.paid_bills) {
      $('root').replaceChildren(h('div', { class: 's-empty', text: `No paid bills between ${shortDate(d.range.from)} and ${shortDate(d.range.to)}.` }));
      return;
    }
    const every = Math.max(1, Math.ceil(d.daily.length / 8));
    const sold = (list) => list.map((i) => ({ name: i.name, v: i.qty }));
    $('root').replaceChildren(
      h('div', { class: 'an-kpis' }, kpi('Revenue', fmtINR(t.revenue)), kpi('Paid bills', String(t.paid_bills)), kpi('Total orders', String(t.orders)), kpi('Average order value', fmtINR(t.avg_order_value))),
      h('div', { class: 'an-grid' },
        h('div', { class: 'an-wide' }, card('Daily revenue', `${shortDate(d.range.from)} – ${shortDate(d.range.to)}, paid bills`,
          columnChart(d.daily.map((x) => ({ label: shortDate(x.date), value: x.revenue, tip: `${shortDate(x.date)}: ${fmtINR(x.revenue)} from ${x.bills} bill${x.bills === 1 ? '' : 's'}` })), { fmt: compact, title: 'Daily revenue', labelEvery: every }),
          dataTable(['Date', 'Revenue', 'Bills'], d.daily.map((x) => [shortDate(x.date), fmtINR(x.revenue), String(x.bills)])))),
        card('Monthly revenue', 'Months inside the selected range', rank(d.monthly.map((m) => ({ name: `${monthLabel(m.month)} · ${m.bills} bill${m.bills === 1 ? '' : 's'}`, v: m.revenue })), fmtINR, 'No data.')),
        card('Table performance', 'Revenue and bills per table', rank(d.tables.map((x) => ({ name: `Table ${x.table} · ${x.bills} bill${x.bills === 1 ? '' : 's'}`, v: x.revenue })), fmtINR, 'No tables.')),
        card('Best-selling items', 'Top 10 by quantity', rank(sold(d.best_sellers), (n) => n + ' sold', 'No sales.')),
        card('Least-selling items', 'Bottom 10 by quantity, items with at least one sale', rank(sold(d.least_sellers), (n) => n + ' sold', 'No sales.')),
        h('div', { class: 'an-wide' }, card('Peak hours', 'Orders by hour of day (India time)',
          columnChart(d.peak_hours.map((x) => ({ label: hourLabel(x.hour), value: x.orders, tip: `${hourLabel(x.hour)}: ${x.orders} order${x.orders === 1 ? '' : 's'}` })), { fmt: (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1)), title: 'Orders by hour', labelEvery: 3 }),
          dataTable(['Hour', 'Orders'], d.peak_hours.filter((x) => x.orders).map((x) => [hourLabel(x.hour), String(x.orders)]))))));
  }

  async function load() {
    const my = ++seq;
    $('err').hidden = true;
    $('root').replaceChildren(h('p', { class: 'muted', text: 'Loading…' }));
    const qs = new URLSearchParams({ range });
    if (range === 'custom') { qs.set('from', from); qs.set('to', to); }
    try {
      const d = await api('/api/staff/analytics?' + qs, { staff: true });
      if (my === seq) render(d);
    } catch (e) {
      if (my !== seq) return;
      $('root').replaceChildren();
      $('err').replaceChildren(`Could not load analytics. ${e.message} `, h('button', { class: 'btn btn-sm', type: 'button', text: 'Try again', onclick: load }));
      $('err').hidden = false;
    }
  }

  function renderFilters() {
    const f = $('filters');
    const chips = RANGES.map(([k, label]) => h('button', { class: 'an-chip', type: 'button', 'aria-pressed': String(range === k), text: label, onclick: () => { range = k; renderFilters(); if (k !== 'custom') load(); } }));
    f.replaceChildren(...chips);
    if (range === 'custom') {
      const a = h('input', { class: 'input', id: 'an-from', type: 'date', value: from, max: PC.todayIST() });
      const b = h('input', { class: 'input', id: 'an-to', type: 'date', value: to, max: PC.todayIST() });
      f.append(h('div', { class: 'an-custom' },
        h('div', { class: 'field' }, h('label', { for: 'an-from', text: 'From' }), a),
        h('div', { class: 'field' }, h('label', { for: 'an-to', text: 'To' }), b),
        h('button', { class: 'btn', type: 'button', text: 'Apply', onclick: () => { from = a.value; to = b.value; load(); } })));
    }
  }

  async function init() {
    const user = await PC.requireStaff(['owner', 'manager']);
    $('who').textContent = `${user.name} (${user.role})`;
    $('logout').addEventListener('click', PC.logout);
    renderFilters();
    load();
  }

  init();
})();
