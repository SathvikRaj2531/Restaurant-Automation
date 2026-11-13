/* Receipt: on-screen slip, Print (80 mm thermal layout via the browser print dialog) and Download PDF. Reprints allowed. */
(function () {
  const { h, api, fmtINR, toast } = PC;
  const $ = (id) => document.getElementById(id);
  const billNo = decodeURIComponent(location.pathname.split('/')[3] || '');
  const METHOD = { cash: 'Cash', upi: 'UPI', card: 'Card' };
  const when = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  const row = (l, r, cls) => h('div', { class: 'r' + (cls ? ' ' + cls : '') }, h('span', { text: l }), h('span', { text: r }));

  function receipt(b) {
    const hd = b.header;
    return h('div', { class: 'receipt', id: 'receipt' },
      h('div', { class: 'c name', text: hd.restaurant_name }),
      h('div', { class: 'c', text: hd.address }),
      hd.phone ? h('div', { class: 'c', text: 'Ph: ' + hd.phone }) : null,
      hd.gstin ? h('div', { class: 'c', text: 'GSTIN: ' + hd.gstin }) : null,
      h('hr', { class: 'solid' }),
      row('Bill: ' + b.bill_no, 'Table ' + b.table_number),
      h('div', { text: when.format(new Date(b.paid_at)) }),
      h('hr'),
      row('Item', 'Amount'),
      h('hr'),
      b.lines.map((l) => h('div', {},
        row(l.name + (l.portion_label === 'Regular' ? '' : ` (${l.portion_label})`), fmtINR(l.amount)),
        h('div', { class: 'sub', text: `${l.qty} x ${fmtINR(l.unit_price)}` }))),
      h('hr'),
      row('Subtotal', fmtINR(b.subtotal)),
      b.service_charge_percent ? row(`Service charge (${b.service_charge_percent}%)`, fmtINR(b.service_charge)) : null,
      b.tax_percent ? row(`Tax (${b.tax_percent}%)`, fmtINR(b.tax)) : null,
      h('hr', { class: 'solid' }),
      row('TOTAL', fmtINR(b.total), 'total'),
      h('hr', { class: 'solid' }),
      row('Payment', `${METHOD[b.payment_method]} - ${b.payment_status.toUpperCase()}`),
      b.payment_reference ? h('div', { text: 'Ref: ' + b.payment_reference }) : null,
      h('p', { class: 'c', text: 'Thank you! Visit again.' }));
  }

  async function downloadPdf(button) {
    button.disabled = true;
    try {
      const res = await fetch(`/api/staff/bills/${encodeURIComponent(billNo)}/pdf`, { headers: { Authorization: 'Bearer ' + PC.getToken() } });
      if (!res.ok) throw new Error('Could not create the PDF.');
      const url = URL.createObjectURL(await res.blob());
      const a = h('a', { href: url, download: billNo + '.pdf' });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      toast(e.message || 'Could not create the PDF.', true);
    }
    button.disabled = false;
  }

  async function init() {
    const user = await PC.requireStaff(['owner', 'manager']);
    $('who').textContent = `${user.name} (${user.role})`;
    $('logout').addEventListener('click', PC.logout);
    document.title = `Bill ${billNo} | P Cube Charcoal Food Den`;
    try {
      const { bill } = await api(`/api/staff/bills/${encodeURIComponent(billNo)}`, { staff: true });
      const paid = new URLSearchParams(location.search).get('paid') === '1';
      $('root').replaceChildren(
        paid ? h('p', { class: 'notice notice-success no-print', text: `Payment recorded. Table ${bill.table_number} is free for the next guests.` }) : null,
        h('div', { class: 'b-actions no-print' },
          h('button', { class: 'btn', type: 'button', text: 'Bill (Print)', onclick: () => window.print() }),
          h('button', { class: 'btn btn-outline', type: 'button', text: 'Download PDF', onclick: (e) => downloadPdf(e.currentTarget) }),
          h('a', { class: 'btn btn-ghost', href: '/staff/bills', text: 'Bill history' }),
          h('a', { class: 'btn btn-ghost', href: '/staff', text: 'Back to orders' })),
        receipt(bill));
    } catch (e) {
      $('root').replaceChildren();
      $('err').textContent = e.status === 404 ? 'Bill not found.' : 'Could not load the bill. ' + e.message;
      $('err').hidden = false;
    }
  }

  init();
})();
