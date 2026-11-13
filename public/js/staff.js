/* Manager / owner dashboard: Live orders, Tables, History. */
(function () {
  const { h, api, fmtINR, fmtTime, fmtDateTime, todayIST, waitText, toast, poll, askReason, Sound } = PC;
  const $ = (id) => document.getElementById(id);
  const LABEL = { new: 'New', accepted: 'Accepted', preparing: 'Preparing', ready: 'Ready', served: 'Served', completed: 'Completed', cancelled: 'Cancelled' };
  const STATE_LABEL = { free: 'Free', new: 'New order', in_progress: 'In progress' };
  const TITLE = 'Orders | P Cube Charcoal Food Den';

  let tab = 'live';
  let live = [];
  let knownNew = null; // ids of "new" orders already seen; null until the first load
  let liveSig = '';
  let tablesSig = '';
  let knownReq = null; // waiter request ids already seen
  let reqRows = [];
  let tableNumbers = [];
  let livePoll;
  let tablesPoll;

  const itemText = (i) => `${i.name}${i.portion_label === 'Regular' ? '' : ` (${i.portion_label})`}`;

  async function post(path, body, button) {
    if (button) button.disabled = true;
    try {
      await api(path, { method: 'POST', staff: true, body });
    } catch (e) {
      toast(e.message, true);
    }
    await livePoll.now();
    if (tab === 'tables') tablesPoll.now();
  }

  async function withReason(o, verb, path, confirmLabel) {
    const reason = await askReason(`${verb} order ${o.order_no} (Table ${o.table_number})?`, confirmLabel);
    if (reason) post(path, { reason });
  }

  function orderCard(o) {
    const actions = [];
    if (o.status === 'new') {
      actions.push(
        h('button', { class: 'btn btn-success', type: 'button', text: 'Accept', onclick: (e) => post(`/api/staff/orders/${o.id}/accept`, null, e.currentTarget) }),
        h('button', { class: 'btn btn-outline-danger', type: 'button', text: 'Reject', onclick: () => withReason(o, 'Reject', `/api/staff/orders/${o.id}/reject`, 'Reject order') }));
    } else {
      if (o.status === 'ready') {
        actions.push(h('button', { class: 'btn btn-success', type: 'button', text: 'Mark Served', onclick: (e) => post(`/api/staff/orders/${o.id}/served`, null, e.currentTarget) }));
      }
      actions.push(h('button', { class: 'btn btn-outline-danger', type: 'button', text: 'Cancel', onclick: () => withReason(o, 'Cancel', `/api/staff/orders/${o.id}/cancel`, 'Cancel order') }));
    }
    return h('article', { class: 'o-card is-' + o.status },
      h('div', { class: 'o-head' },
        h('div', {}, h('div', { class: 'o-table', text: 'Table ' + o.table_number }), h('div', { class: 'o-no', text: 'Order ' + o.order_no })),
        h('div', { style: 'text-align:right' },
          h('span', { class: 'pill ' + o.status, text: LABEL[o.status] }),
          h('div', { class: 'o-wait', dataset: { since: o.created_at, prefix: 'Waiting ' }, text: 'Waiting ' + waitText(o.created_at) }))),
      h('ul', { class: 'o-items' }, o.items.map((i) => h('li', {},
        h('span', { class: 'o-qty', text: i.qty + ' ×' }),
        h('span', {}, itemText(i), i.note ? h('span', { class: 'o-note', text: 'Note: ' + i.note }) : null)))),
      o.overall_note ? h('div', { class: 'o-overall', text: 'Order note: ' + o.overall_note }) : null,
      h('div', { class: 'o-foot' }, h('span', { class: 'muted', text: 'Placed ' + fmtTime(o.created_at) }), h('strong', { text: fmtINR(o.subtotal) })),
      h('div', { class: 'o-actions' }, actions));
  }

  function renderLive() {
    const news = live.filter((o) => o.status === 'new');
    const rest = live.filter((o) => o.status !== 'new');
    const section = (title, list, emptyText) => [
      h('h2', { class: 's-section-title', text: `${title} (${list.length})` }),
      list.length ? h('div', { class: 'o-grid' }, list.map(orderCard)) : h('div', { class: 's-empty', text: emptyText }),
    ];
    $('live').replaceChildren(...section('New orders', news, 'No new orders waiting.'), ...section('In progress', rest, 'Nothing in progress.'));
  }

  function onLiveData(orders, pending) {
    const newIds = orders.filter((o) => o.status === 'new').map((o) => o.id);
    if (knownNew && newIds.some((id) => !knownNew.has(id))) Sound.beep();
    knownNew = new Set(newIds);
    document.title = (pending ? `(${pending}) ` : '') + TITLE;
    $('live-count').textContent = pending;
    $('live-count').hidden = !pending;
  }

  function setReqCount(n) {
    $('req-count').textContent = n;
    $('req-count').hidden = !n;
  }

  async function refreshLive() {
    const d = await api('/api/staff/orders/live', { staff: true });
    onLiveData(d.orders, d.pending_count);
    setReqCount(d.waiter_open || 0);
    const sig = JSON.stringify(d.orders.map((o) => [o.id, o.status, o.overall_note, o.subtotal]));
    if (sig === liveSig) return;
    liveSig = sig;
    live = d.orders;
    renderLive();
  }

  // ---------- Tables ----------
  async function reqAct(id, verb, button) {
    button.disabled = true;
    try {
      await api(`/api/staff/waiter-requests/${id}/${verb}`, { method: 'POST', staff: true });
    } catch (e) {
      toast(e.message, true);
    }
    tablesSig = '';
    await tablesPoll.now();
  }

  function requestList() {
    if (!reqRows.length) return h('div', { class: 's-empty', text: 'No open waiter requests.' });
    return h('div', { class: 'r-list' }, reqRows.map((r) => h('div', { class: 'r-row is-' + r.status },
      h('div', { class: 'r-info' },
        h('span', { text: 'Table ' + r.table_number }),
        h('span', { class: 'pill ' + r.status, text: r.status === 'requested' ? 'Requested' : 'Acknowledged' }),
        h('span', { class: 'muted', dataset: { since: r.created_at, prefix: 'Waiting ' }, text: 'Waiting ' + waitText(r.created_at) })),
      h('div', { class: 'r-btns' },
        r.status === 'requested' ? h('button', { class: 'btn btn-sm', type: 'button', text: 'Acknowledge', onclick: (e) => reqAct(r.id, 'acknowledge', e.currentTarget) }) : null,
        h('button', { class: 'btn btn-sm btn-success', type: 'button', text: 'Complete', onclick: (e) => reqAct(r.id, 'complete', e.currentTarget) })))));
  }

  function renderTables(tables) {
    $('tables').replaceChildren(
      h('h2', { class: 's-section-title', text: `Waiter requests (${reqRows.length})` }),
      requestList(),
      h('div', { class: 't-grid' }, tables.map((t) => h('a', { class: 't-card ' + t.state, href: '/staff/table/' + t.number, 'aria-label': `Table ${t.number}: open details and payment` },
        h('div', { class: 't-num', text: 'Table ' + t.number }),
        h('div', { class: 't-state', text: STATE_LABEL[t.state] }),
        t.state === 'free' && !t.order_count ? h('div', { class: 'muted', text: 'No open orders' })
          : h('div', {}, `${t.order_count} order${t.order_count === 1 ? '' : 's'} · `, h('strong', { text: fmtINR(t.running_total) })),
        h('span', { class: 't-badge', title: 'Open waiter requests', text: '🔔 ' + t.waiter_requests })))),
      h('div', { class: 't-legend' },
        h('span', {}, h('i', { style: 'background:var(--table-free)' }), 'Free'),
        h('span', {}, h('i', { style: 'background:var(--table-new)' }), 'Has new order'),
        h('span', {}, h('i', { style: 'background:var(--table-progress)' }), 'In progress')));
  }

  async function refreshTables() {
    if (tab !== 'tables') return;
    const [{ tables }, { requests }] = await Promise.all([
      api('/api/staff/tables', { staff: true }),
      api('/api/staff/waiter-requests', { staff: true }),
    ]);
    const ids = requests.map((r) => r.id);
    if (knownReq && ids.some((id) => !knownReq.has(id))) Sound.beep();
    knownReq = new Set(ids);
    setReqCount(requests.length);
    reqRows = requests;
    const sig = JSON.stringify([tables, requests.map((r) => [r.id, r.status])]);
    if (sig === tablesSig) return;
    tablesSig = sig;
    renderTables(tables);
  }

  // ---------- History ----------
  const histDate = h('input', { class: 'input', type: 'date', id: 'h-date', value: todayIST(), 'aria-label': 'Date' });
  const histTable = h('select', { class: 'select', id: 'h-table', 'aria-label': 'Table' }, h('option', { value: '', text: 'All tables' }));
  const histList = h('div', { class: 'o-grid' });
  const histInfo = h('p', { class: 'muted' });

  function historyCard(o) {
    return h('article', { class: 'o-card h-card' },
      h('div', { class: 'o-head' },
        h('div', {}, h('strong', { text: `Table ${o.table_number}` }), h('span', { class: 'o-no', text: ` · Order ${o.order_no}` })),
        h('span', { class: 'pill ' + o.status, text: LABEL[o.status] })),
      h('div', { class: 'muted', text: fmtDateTime(o.created_at) }),
      h('ul', { class: 'o-items' }, o.items.map((i) => h('li', {},
        h('span', { class: 'o-qty', text: i.qty + ' ×' }),
        h('span', {}, itemText(i), i.note ? h('span', { class: 'o-note', text: 'Note: ' + i.note }) : null)))),
      o.status === 'cancelled'
        ? h('div', { class: 'o-overall', text: `Cancelled${o.cancelled_by_name ? ' by ' + o.cancelled_by_name : ''}: ${o.cancelled_reason || ''}` })
        : null,
      h('div', { class: 'o-foot' }, h('span', { class: 'muted', text: 'Order total' }), h('strong', { text: fmtINR(o.subtotal) })));
  }

  async function loadHistory() {
    const qs = new URLSearchParams();
    if (histDate.value) qs.set('date', histDate.value);
    if (histTable.value) qs.set('table', histTable.value);
    histInfo.textContent = 'Loading…';
    try {
      const { orders } = await api('/api/staff/history?' + qs, { staff: true });
      histInfo.textContent = `${orders.length} order${orders.length === 1 ? '' : 's'}`;
      histList.replaceChildren(...(orders.length ? orders.map(historyCard) : [h('div', { class: 's-empty', text: 'No completed or cancelled orders for this filter.' })]));
    } catch (e) {
      histInfo.textContent = '';
      toast(e.message, true);
    }
  }

  function buildHistory() {
    histDate.addEventListener('change', loadHistory);
    histTable.addEventListener('change', loadHistory);
    $('history').replaceChildren(
      h('div', { class: 'h-filters' },
        h('div', { class: 'field' }, h('label', { for: 'h-date', text: 'Date' }), histDate),
        h('div', { class: 'field' }, h('label', { for: 'h-table', text: 'Table' }), histTable),
        h('button', { class: 'btn btn-ghost', type: 'button', text: 'Refresh', onclick: loadHistory })),
      histInfo, histList);
  }

  // ---------- Tabs, timers, startup ----------
  function setTab(name) {
    tab = name;
    for (const t of ['live', 'tables', 'history']) {
      $(t).hidden = t !== name;
      $('t-' + t).setAttribute('aria-selected', String(t === name));
    }
    if (name === 'tables') tablesPoll.now();
    if (name === 'history') loadHistory();
  }

  function tick() {
    document.querySelectorAll('[data-since]').forEach((el) => { el.textContent = (el.dataset.prefix || '') + waitText(el.dataset.since); });
  }

  async function init() {
    const user = await PC.requireStaff(['owner', 'manager']);
    $('who').textContent = `${user.name} (${user.role})`;
    $('settings-link').hidden = user.role !== 'owner';
    let pollMs = 4000;
    try { pollMs = (await api('/api/config')).poll_interval_ms || pollMs; } catch { /* default */ }

    $('logout').addEventListener('click', PC.logout);
    $('sound').addEventListener('click', () => {
      if (!Sound.enable()) return toast('This browser does not support sound alerts.', true);
      $('sound').textContent = 'Sound on';
      $('sound').className = 'btn btn-sm btn-on-dark';
    });
    ['live', 'tables', 'history'].forEach((t) => $('t-' + t).addEventListener('click', () => setTab(t)));

    buildHistory();
    livePoll = poll(refreshLive, pollMs);
    tablesPoll = poll(refreshTables, pollMs);
    setInterval(tick, 15000);

    try {
      const { tables } = await api('/api/staff/tables', { staff: true });
      tableNumbers = tables.map((t) => t.number);
      tableNumbers.forEach((n) => histTable.append(h('option', { value: String(n), text: 'Table ' + n })));
    } catch { /* filter stays on "All tables" */ }
  }

  init();
})();
