/* Bill history: search by bill number, table and date. */
(function () {
  const { h, api, fmtINR, fmtDateTime, toast } = PC;
  const $ = (id) => document.getElementById(id);
  const METHOD = { cash: 'Cash', upi: 'UPI', card: 'Card' };
  let timer;

  const q = h('input', { class: 'input', id: 'bq', type: 'search', placeholder: 'e.g. PC-000012', autocomplete: 'off' });
  const table = h('select', { class: 'select', id: 'bt' }, h('option', { value: '', text: 'All tables' }));
  const date = h('input', { class: 'input', id: 'bd', type: 'date' });
  const info = h('p', { class: 'muted' });
  const list = h('div', { class: 'b-list' });

  async function load() {
    const qs = new URLSearchParams();
    if (q.value.trim()) qs.set('q', q.value.trim());
    if (table.value) qs.set('table', table.value);
    if (date.value) qs.set('date', date.value);
    info.textContent = 'Loading…';
    try {
      const { bills } = await api('/api/staff/bills?' + qs, { staff: true });
      info.textContent = `${bills.length} bill${bills.length === 1 ? '' : 's'}${bills.length === 200 ? ' (showing the latest 200)' : ''}`;
      list.replaceChildren(...(bills.length ? bills.map((b) => h('div', { class: 'b-row' },
        h('div', {}, h('div', { class: 'no', text: b.bill_no }), h('div', { class: 'muted', text: `Table ${b.table_number} · ${fmtDateTime(b.paid_at)} · ${METHOD[b.payment_method]}` })),
        h('div', { class: 'b-actions', style: 'margin:0;align-items:center' }, h('strong', { text: fmtINR(b.total) }), h('a', { class: 'btn btn-sm', href: '/staff/bill/' + encodeURIComponent(b.bill_no), text: 'Bill' })))) : [h('div', { class: 's-empty', text: 'No bills match.' })]));
    } catch (e) {
      info.textContent = '';
      toast(e.message, true);
    }
  }

  async function init() {
    const user = await PC.requireStaff(['owner', 'manager']);
    $('who').textContent = `${user.name} (${user.role})`;
    $('logout').addEventListener('click', PC.logout);
    try {
      const { tables } = await api('/api/staff/tables', { staff: true });
      tables.forEach((t) => table.append(h('option', { value: String(t.number), text: 'Table ' + t.number })));
    } catch { /* filter stays on "All tables" */ }
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });
    table.addEventListener('change', load);
    date.addEventListener('change', load);
    $('root').replaceChildren(
      h('div', { class: 'b-filters' },
        h('div', { class: 'field wide' }, h('label', { for: 'bq', text: 'Bill number' }), q),
        h('div', { class: 'field' }, h('label', { for: 'bt', text: 'Table' }), table),
        h('div', { class: 'field' }, h('label', { for: 'bd', text: 'Date' }), date)),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Clear filters', onclick: () => { q.value = ''; table.value = ''; date.value = ''; load(); } }),
      info, list);
    load();
  }

  init();
})();
