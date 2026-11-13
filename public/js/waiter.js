/* Waiter screen: all open requests (one waiter serves every table). Acknowledge, then Complete. */
(function () {
  const { h, api, toast, poll, waitText, Sound } = PC;
  const $ = (id) => document.getElementById(id);
  const LABEL = { requested: 'Requested', acknowledged: 'Acknowledged' };
  const TITLE = 'Waiter | P Cube Charcoal Food Den';

  let known = null; // ids already seen; null until the first load
  let sig = '';
  let boardPoll;

  async function act(path, button) {
    button.disabled = true;
    try {
      await api(path, { method: 'POST', staff: true });
    } catch (e) {
      toast(e.message, true);
    }
    boardPoll.now();
  }

  function card(r) {
    const base = `/api/waiter/requests/${r.id}`;
    return h('article', { class: 'w-card is-' + r.status },
      h('div', { class: 'k-head' },
        h('span', { class: 'k-table', text: 'Table ' + r.table_number }),
        h('span', { class: 'pill ' + r.status, text: LABEL[r.status] })),
      h('div', { class: 'k-wait', dataset: { since: r.created_at, prefix: 'Waiting ' }, text: 'Waiting ' + waitText(r.created_at) }),
      h('div', { class: 'o-actions' },
        r.status === 'requested' ? h('button', { class: 'btn', type: 'button', text: 'Acknowledge', onclick: (e) => act(base + '/acknowledge', e.currentTarget) }) : null,
        h('button', { class: 'btn btn-success', type: 'button', text: 'Complete', onclick: (e) => act(base + '/complete', e.currentTarget) })));
  }

  const tick = () => document.querySelectorAll('[data-since]').forEach((el) => { el.textContent = (el.dataset.prefix || '') + waitText(el.dataset.since); });

  async function refresh() {
    let requests;
    try {
      ({ requests } = await api('/api/waiter/requests', { staff: true }));
      $('err').hidden = true;
    } catch (e) {
      $('err').textContent = e.message;
      $('err').hidden = false;
      throw e;
    }
    const ids = requests.map((r) => r.id);
    if (known && ids.some((id) => !known.has(id))) Sound.beep();
    known = new Set(ids);
    const open = requests.filter((r) => r.status === 'requested').length;
    document.title = (open ? `(${open}) ` : '') + TITLE;

    const s = JSON.stringify(requests.map((r) => [r.id, r.status]));
    if (s === sig) return;
    sig = s;
    $('board').replaceChildren(requests.length
      ? h('div', { class: 'k-grid' }, requests.map(card))
      : h('div', { class: 's-empty', text: 'No open requests. Nobody is calling the waiter.' }));
  }

  async function init() {
    const user = await PC.requireStaff(['waiter']);
    $('who').textContent = `${user.name} (${user.role})`;
    let pollMs = 4000;
    try { pollMs = (await api('/api/config')).poll_interval_ms || pollMs; } catch { /* default */ }
    $('logout').addEventListener('click', PC.logout);
    $('sound').addEventListener('click', () => {
      if (!Sound.enable()) return toast('This browser does not support sound alerts.', true);
      $('sound').textContent = 'Sound on';
      $('sound').className = 'btn btn-sm btn-on-dark';
    });
    boardPoll = poll(refresh, pollMs);
    setInterval(tick, 15000);
  }

  init();
})();
