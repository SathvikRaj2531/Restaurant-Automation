/* Table detail: the open visit, all non-cancelled orders combined, running total (not a bill), Record Payment. */
(function () {
  const { h, api, fmtINR, fmtTime, toast, poll } = PC;
  const $ = (id) => document.getElementById(id);
  const number = decodeURIComponent(location.pathname.split('/')[3] || '');
  const LABEL = { new: 'New', accepted: 'Accepted', preparing: 'Preparing', ready: 'Ready', served: 'Served', completed: 'Completed' };
  const METHODS = [['cash', 'Cash'], ['upi', 'UPI'], ['card', 'Card']];

  let detail = null;
  let sig = '';
  let method = 'cash';
  let paying = false;
  const summary = h('div');
  const payBox = h('div');
  const ref = h('input', { class: 'input', id: 'ref', maxlength: '60', placeholder: 'Transaction / approval reference (optional)', autocomplete: 'off' });
  const refField = h('div', { class: 'field', hidden: true }, h('label', { for: 'ref', text: 'Reference (optional)' }), ref);
  const payBtn = h('button', { class: 'btn btn-block', type: 'button', text: 'Record payment' });
  const payNote = h('p', { class: 'notice', hidden: true });

  function sumRows(p) {
    const rows = [h('div', { class: 'row' }, h('span', { text: 'Subtotal' }), h('span', { text: fmtINR(p.subtotal) }))];
    if (p.service_charge_percent) rows.push(h('div', { class: 'row' }, h('span', { text: `Service charge (${p.service_charge_percent}%)` }), h('span', { text: fmtINR(p.service_charge) })));
    if (p.tax_percent) rows.push(h('div', { class: 'row' }, h('span', { text: `Tax (${p.tax_percent}%)` }), h('span', { text: fmtINR(p.tax) })));
    return rows;
  }

  function renderSummary() {
    const d = detail;
    if (!d.visit || !d.orders.length) {
      summary.replaceChildren(h('div', { class: 's-empty', text: 'No open orders for this table.' }));
      return;
    }
    summary.replaceChildren(
      h('div', { class: 'card b-card' },
        h('h2', { text: 'Running total (not a bill)' }),
        h('div', { class: 'b-orders' }, d.orders.map((o) => h('span', { class: 'pill ' + o.status, text: `${o.order_no} · ${LABEL[o.status]}` }))),
        h('table', { class: 'b-lines' },
          h('thead', {}, h('tr', {}, h('th', { text: 'Item' }), h('th', { class: 'num', text: 'Qty' }), h('th', { class: 'num', text: 'Amount' }))),
          h('tbody', {}, d.lines.map((l) => h('tr', {},
            h('td', { text: l.name + (l.portion_label === 'Regular' ? '' : ` (${l.portion_label})`) }),
            h('td', { class: 'num', text: l.qty }),
            h('td', { class: 'num', text: fmtINR(l.amount) }))))),
        h('div', { class: 'b-sum' }, h('div', { class: 'row grand' }, h('span', { text: 'Running total' }), h('span', { text: fmtINR(d.running_total) }))),
        h('p', { class: 'muted', text: `Opened ${fmtTime(d.visit.opened_at)} · ${d.orders.length} order${d.orders.length === 1 ? '' : 's'} (cancelled orders are not counted)` })));
  }

  function renderPay() {
    const d = detail;
    const can = d.visit && d.orders.length && !d.new_count;
    payBox.hidden = !(d.visit && d.orders.length);
    payBtn.disabled = !can || paying;
    payNote.hidden = !d.new_count;
    payNote.className = 'notice notice-warning';
    payNote.textContent = d.new_count ? 'A new order is waiting to be accepted. Accept or reject it on the Orders screen before taking payment.' : '';
    $('amount').replaceChildren(...sumRows(d.payable), h('div', { class: 'row grand' }, h('span', { text: 'Amount to collect' }), h('span', { text: fmtINR(d.payable.total) })));
  }

  async function refresh() {
    const d = await api(`/api/staff/tables/${encodeURIComponent(number)}/detail`, { staff: true });
    const s = JSON.stringify(d);
    if (s === sig) return;
    sig = s;
    detail = d;
    renderSummary();
    renderPay();
  }

  function confirmDialog(title, lines, confirmLabel, danger) {
    return new Promise((resolve) => {
      const ok = h('button', { class: danger ? 'btn btn-danger' : 'btn', type: 'button', text: confirmLabel });
      const dlg = h('dialog', { 'aria-label': title }, h('h2', { text: title }), lines.map((t) => h('p', { text: t })),
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn btn-ghost', type: 'button', text: 'Back', onclick: () => dlg.close('') }), ok));
      ok.addEventListener('click', () => dlg.close('yes'));
      dlg.addEventListener('close', () => { const v = dlg.returnValue === 'yes'; dlg.remove(); resolve(v); });
      document.body.append(dlg);
      dlg.showModal();
    });
  }

  async function pay() {
    if (paying) return;
    const label = METHODS.find((m) => m[0] === method)[1];
    const go = await confirmDialog('Record payment?', [`Table ${number} · ${label}`, `Amount: ${fmtINR(detail.payable.total)}`, 'This creates the bill, closes the table visit and completes its orders. It cannot be undone.'], 'Confirm payment');
    if (!go) return;
    paying = true;
    payBtn.disabled = true;
    let confirmUnserved = false;
    for (;;) {
      try {
        const { bill } = await api(`/api/staff/tables/${encodeURIComponent(number)}/pay`, { method: 'POST', staff: true, body: { method, reference: ref.value, confirm_unserved: confirmUnserved } });
        location.href = `/staff/bill/${encodeURIComponent(bill.bill_no)}?paid=1`;
        return;
      } catch (e) {
        if (e.status === 409 && /not served yet/.test(e.message) && !confirmUnserved) {
          if (await confirmDialog('Some orders are not served yet', ['Take payment anyway? Unserved orders will be marked completed.'], 'Take payment anyway', true)) { confirmUnserved = true; continue; }
        } else {
          toast(e.message, true);
        }
        break;
      }
    }
    paying = false;
    await refresh().catch(() => {});
    if (detail) renderPay();
  }

  async function init() {
    const user = await PC.requireStaff(['owner', 'manager']);
    $('who').textContent = `${user.name} (${user.role})`;
    $('logout').addEventListener('click', PC.logout);
    document.title = `Table ${number} | P Cube Charcoal Food Den`;
    let pollMs = 4000;
    try { pollMs = (await api('/api/config')).poll_interval_ms || pollMs; } catch { /* default */ }

    const methodBox = h('div', { class: 'b-methods', role: 'radiogroup', 'aria-label': 'Payment method' }, METHODS.map(([v, l]) =>
      h('label', {}, h('input', { type: 'radio', name: 'method', value: v, checked: v === method, onchange: () => { method = v; refField.hidden = v === 'cash'; } }), l)));
    payBtn.addEventListener('click', pay);
    payBox.append(h('div', { class: 'card b-card' }, h('h2', { text: 'Record payment' }), h('div', { class: 'b-sum', id: 'amount' }), h('hr'), methodBox, refField, payNote, payBtn));
    payBox.hidden = true;

    $('root').replaceChildren(h('h1', { text: 'Table ' + number }), h('a', { class: 'b-back', href: '/staff', text: '← Back to tables' }), summary, payBox);
    try { await refresh(); } catch (e) { $('err').textContent = e.status === 404 ? 'Table not found.' : e.message; $('err').hidden = false; return; }
    poll(() => refresh().catch(() => {}), pollMs);
  }

  init();
})();
