/* Kitchen display: accepted-and-later orders, oldest first, large cards. No prices, no cancel, no bills. */
(function () {
  const { h, api, toast, poll, waitText, Sound } = PC;
  const $ = (id) => document.getElementById(id);
  const LABEL = { accepted: 'New', preparing: 'Preparing', ready: 'Ready' };
  const TITLE = 'Kitchen | P Cube Charcoal Food Den';

  let warnMinutes = 10; // overwritten from /api/config (KITCHEN_WAIT_WARN_MINUTES in server/settings.js)
  let known = null; // ids already seen; null until the first load
  let sig = '';
  let boardPoll;

  async function move(path, button) {
    button.disabled = true;
    try {
      await api(path, { method: 'POST', staff: true });
    } catch (e) {
      toast(e.message, true);
    }
    boardPoll.now();
  }

  function card(o) {
    let action = null;
    if (o.status === 'accepted') {
      action = h('button', { class: 'btn', type: 'button', text: 'Start Preparing', onclick: (e) => move(`/api/kitchen/orders/${o.id}/start`, e.currentTarget) });
    } else if (o.status === 'preparing') {
      action = h('button', { class: 'btn btn-success', type: 'button', text: 'Mark Ready', onclick: (e) => move(`/api/kitchen/orders/${o.id}/ready`, e.currentTarget) });
    }
    const ready = o.status === 'ready';
    return h('article', { class: 'k-card is-' + o.status, dataset: { accepted: o.accepted_at, status: o.status } },
      h('div', { class: 'k-head' },
        h('span', { class: 'k-table', text: 'Table ' + o.table_number }),
        h('span', { class: 'k-no', text: 'Order ' + o.order_no }),
        h('span', { class: 'pill ' + o.status, text: LABEL[o.status] })),
      h('div', { class: 'k-head' },
        h('span', { class: 'k-wait', dataset: { since: ready ? o.ready_at : o.accepted_at, prefix: ready ? 'Ready for ' : 'Waiting ' }, text: (ready ? 'Ready for ' : 'Waiting ') + waitText(ready ? o.ready_at : o.accepted_at) }),
        h('span', { class: 'k-late', hidden: true, text: `Over ${warnMinutes} min` })),
      h('ul', { class: 'k-items' }, o.items.map((i) => h('li', {},
        h('span', { class: 'k-qty', text: i.qty + ' ×' }),
        h('span', {}, i.name, i.portion_label === 'Regular' ? null : h('span', { class: 'k-portion', text: ` (${i.portion_label})` }),
          i.note ? h('span', { class: 'o-note', text: 'Note: ' + i.note }) : null)))),
      o.overall_note ? h('div', { class: 'o-overall', text: 'Order note: ' + o.overall_note }) : null,
      action || h('p', { class: 'muted', text: 'Ready — waiting to be served.' }));
  }

  /** Update clocks and the "over N minutes" highlight without rebuilding the cards. */
  function updateTimers() {
    document.querySelectorAll('[data-since]').forEach((el) => { el.textContent = (el.dataset.prefix || '') + waitText(el.dataset.since); });
    document.querySelectorAll('.k-card').forEach((c) => {
      const active = c.dataset.status === 'accepted' || c.dataset.status === 'preparing';
      const late = active && Date.now() - new Date(c.dataset.accepted).getTime() > warnMinutes * 60000;
      c.classList.toggle('is-late', late);
      const badge = c.querySelector('.k-late');
      if (badge) badge.hidden = !late;
    });
  }

  async function refresh() {
    const { orders, waiting_count } = await api('/api/kitchen/orders', { staff: true });
    const ids = orders.map((o) => o.id);
    if (known && ids.some((id) => !known.has(id))) Sound.beep();
    known = new Set(ids);
    document.title = (waiting_count ? `(${waiting_count}) ` : '') + TITLE;

    const s = JSON.stringify(orders.map((o) => [o.id, o.status, o.overall_note]));
    if (s === sig) return;
    sig = s;
    $('board').replaceChildren(orders.length
      ? h('div', { class: 'k-grid' }, orders.map(card))
      : h('div', { class: 's-empty', text: 'No orders in the kitchen right now.' }));
    updateTimers();
  }

  async function init() {
    const user = await PC.requireStaff(['kitchen', 'owner']);
    $('who').textContent = `${user.name} (${user.role})`;
    let pollMs = 4000;
    try {
      const cfg = await api('/api/config');
      pollMs = cfg.poll_interval_ms || pollMs;
      warnMinutes = cfg.kitchen_wait_warn_minutes || warnMinutes;
    } catch { /* defaults */ }

    $('logout').addEventListener('click', PC.logout);
    $('sound').addEventListener('click', () => {
      if (!Sound.enable()) return toast('This browser does not support sound alerts.', true);
      $('sound').textContent = 'Sound on';
      $('sound').className = 'btn btn-sm btn-on-dark';
    });
    boardPoll = poll(refresh, pollMs);
    setInterval(updateTimers, 10000);
  }

  init();
})();
