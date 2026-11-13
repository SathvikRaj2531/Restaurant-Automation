/* Customer QR ordering: menu, add-to-cart, cart, confirm + submit, live order status. */
(function () {
  const { h, api, fmtINR, fmtTime, toast, poll } = PC;
  const token = decodeURIComponent(location.pathname.split('/')[2] || '');
  const CART_KEY = 'pcube_cart_' + token;
  const MAX_QTY = 20;

  const STATUS = {
    new: ['Waiting', 'Waiting for the restaurant to accept your order'],
    accepted: ['Accepted', 'The restaurant has accepted your order'],
    preparing: ['Preparing', 'Your order is being prepared'],
    ready: ['Ready', 'Your order is ready'],
    served: ['Served', 'Your order has been served'],
    completed: ['Completed', 'This order is complete'],
    cancelled: ['Cancelled', 'This order was cancelled by the restaurant'],
  };

  const $ = (id) => document.getElementById(id);
  let table = null;
  let menuCtl = null;
  let cart = [];
  let overallNote = '';
  let orders = [];
  let visitTotal = 0;
  let lastOrdersJson = '';
  let tab = 'menu';
  let pendingKey = null;
  let placing = false;
  let hasTaxOrService = false;
  let cartDialog = null;
  let renderCart = null;
  let waiterReq = null; // { id, status } or null
  let lastWaiterStatus = null;

  // ---------- cart ----------
  function loadCart() {
    try {
      const d = JSON.parse(PC.store.get(CART_KEY) || 'null');
      if (d && Array.isArray(d.cart)) {
        cart = d.cart.filter((l) => l && Number.isInteger(l.item_id) && Number.isInteger(l.qty) && l.qty >= 1 && l.qty <= MAX_QTY &&
          typeof l.name === 'string' && typeof l.portion_label === 'string' && Number.isInteger(l.unit_price));
        overallNote = typeof d.note === 'string' ? d.note : '';
      }
    } catch { /* ignore */ }
  }
  const saveCart = () => PC.store.set(CART_KEY, JSON.stringify({ cart, note: overallNote }));
  const cartCount = () => cart.reduce((n, l) => n + l.qty, 0);
  const cartTotal = () => cart.reduce((n, l) => n + l.qty * l.unit_price, 0);
  const lineKey = (l) => `${l.item_id}|${l.portion_label}|${l.note.trim().toLowerCase()}`;

  function updateCartBar() {
    const bar = $('cart-bar');
    bar.hidden = !(cart.length && tab === 'menu');
    $('cart-bar-left').textContent = `View cart · ${cartCount()} item${cartCount() === 1 ? '' : 's'}`;
    $('cart-bar-right').textContent = fmtINR(cartTotal());
  }

  function addToCart(line) {
    const existing = cart.find((l) => lineKey(l) === lineKey(line));
    if (existing) existing.qty = Math.min(MAX_QTY, existing.qty + line.qty);
    else cart.push(line);
    saveCart();
    updateCartBar();
  }

  /** After the menu (re)loads: drop lines that can no longer be ordered, refresh prices. */
  function reconcile(ctl) {
    menuCtl = ctl;
    let removed = 0;
    cart = cart.filter((l) => {
      const item = ctl.getItem(l.item_id);
      const p = item && item.available && item.portions.find((x) => x.label === l.portion_label && Number.isInteger(x.price));
      if (!p) { removed++; return false; }
      l.unit_price = p.price;
      l.name = item.name;
      return true;
    });
    if (removed) toast(`${removed} item${removed === 1 ? ' is' : 's are'} no longer available and ${removed === 1 ? 'was' : 'were'} removed from your cart.`, true);
    saveCart();
    updateCartBar();
    if (renderCart) renderCart();
  }

  // ---------- add-to-cart sheet ----------
  function stepper(get, set, min, max) {
    const value = h('span', { class: 'qty-value', 'aria-live': 'polite' });
    const minus = h('button', { type: 'button', 'aria-label': 'Decrease quantity', text: '−' });
    const plus = h('button', { type: 'button', 'aria-label': 'Increase quantity', text: '+' });
    const sync = () => { value.textContent = get(); minus.disabled = get() <= min; plus.disabled = get() >= max; };
    minus.addEventListener('click', () => { set(get() - 1); sync(); });
    plus.addEventListener('click', () => { set(get() + 1); sync(); });
    sync();
    return { el: h('div', { class: 'stepper' }, minus, value, plus), sync };
  }

  function openAddSheet(item) {
    let portion = item.portions.find((p) => Number.isInteger(p.price));
    let qty = 1;
    const note = h('input', { class: 'input', maxlength: '200', placeholder: 'e.g. Make it more spicy, Add lemon', 'aria-label': 'Note for this dish (optional)' });
    const addBtn = h('button', { class: 'btn btn-block', type: 'button' });
    const refresh = () => { addBtn.textContent = `Add to cart · ${fmtINR(portion.price * qty)}`; };

    const picker = h('div', { class: 'portion-picker', role: 'radiogroup', 'aria-label': 'Choose portion' },
      item.portions.map((p) => {
        const priced = Number.isInteger(p.price);
        const input = h('input', { type: 'radio', name: 'portion', disabled: !priced, checked: p === portion,
          onchange: () => { portion = p; refresh(); } });
        return h('label', { class: 'portion-option' + (priced ? '' : ' is-disabled') }, input,
          h('span', { text: p.label }),
          h('span', { class: 'price', text: priced ? fmtINR(p.price) : 'Price to be confirmed' }));
      }));

    const step = stepper(() => qty, (v) => { qty = v; refresh(); }, 1, MAX_QTY);
    const dlg = h('dialog', { class: 'sheet', 'aria-label': 'Add ' + item.name },
      h('div', { class: 'sheet-head' },
        h('h2', {}, h('span', { class: 'vn ' + (item.is_veg ? 'veg' : 'nonveg') }), ' ', item.name),
        h('span', { class: 'table-badge', text: 'Table ' + table.number }),
        h('button', { class: 'close-x', type: 'button', 'aria-label': 'Close', text: '×', onclick: () => dlg.close() })),
      h('div', { class: 'sheet-body' },
        item.description ? h('p', { class: 'muted', text: item.description }) : null,
        picker,
        h('div', { class: 'row-between' }, h('strong', { text: 'Quantity' }), step.el),
        h('div', { class: 'field', style: 'margin-top:1rem' }, h('label', { text: 'Note for this dish (optional)' }), note)),
      h('div', { class: 'sheet-foot' }, addBtn));
    addBtn.addEventListener('click', () => {
      addToCart({ item_id: item.id, name: item.name, is_veg: item.is_veg, portion_label: portion.label, unit_price: portion.price, qty, note: note.value.trim() });
      dlg.close();
      toast(`Added ${item.name}`);
    });
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    refresh();
    dlg.showModal();
  }

  // ---------- cart drawer + confirm + submit ----------
  function openCart() {
    const notice = h('p', { class: 'notice notice-error', role: 'alert', hidden: true });
    const body = h('div', { class: 'sheet-body' });
    const placeBtn = h('button', { class: 'btn btn-block', type: 'button', text: 'Place order' });
    const foot = h('div', { class: 'sheet-foot' }, placeBtn);
    const dlg = h('dialog', { class: 'sheet', 'aria-label': 'Your cart' },
      h('div', { class: 'sheet-head' },
        h('h2', { text: 'Your cart' }),
        h('span', { class: 'table-badge', text: 'Table ' + table.number }),
        h('button', { class: 'close-x', type: 'button', 'aria-label': 'Close cart', text: '×', onclick: () => dlg.close() })),
      body, foot);

    function render() {
      body.replaceChildren(notice);
      if (!cart.length) {
        body.append(h('p', { class: 'empty-state muted', text: 'Your cart is empty.' }));
        foot.hidden = true;
        return;
      }
      foot.hidden = false;
      cart.forEach((l) => {
        const qtyStep = stepper(() => l.qty, (v) => { l.qty = v; saveCart(); render(); updateCartBar(); }, 1, MAX_QTY);
        body.append(h('div', { class: 'cart-line' },
          h('div', { class: 'row-between' },
            h('div', { class: 'cart-line-name' },
              h('span', { class: 'vn ' + (l.is_veg ? 'veg' : 'nonveg') }),
              h('span', { text: l.name + (l.portion_label === 'Regular' ? '' : ` (${l.portion_label})`) })),
            h('strong', { text: fmtINR(l.qty * l.unit_price) })),
          h('input', { class: 'input line-note', maxlength: '200', value: l.note, placeholder: 'Note for this dish (optional)', 'aria-label': 'Note for ' + l.name,
            oninput: (e) => { l.note = e.target.value; saveCart(); } }),
          h('div', { class: 'row-between' }, qtyStep.el,
            h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Remove', onclick: () => {
              cart = cart.filter((x) => x !== l); saveCart(); render(); updateCartBar();
            } }))));
      });
      body.append(
        h('div', { class: 'field', style: 'margin-top:1rem' },
          h('label', { for: 'overall-note', text: 'Note for the whole order (optional)' }),
          h('textarea', { class: 'textarea', id: 'overall-note', maxlength: '500', placeholder: 'e.g. Please bring everything together',
            oninput: (e) => { overallNote = e.target.value; saveCart(); } }, overallNote)),
        h('div', { class: 'cart-total' }, h('span', { text: 'Grand total' }), h('span', { text: fmtINR(cartTotal()) })),
        hasTaxOrService ? h('p', { class: 'muted', text: 'Service charge and taxes, if any, are added to the final bill.' }) : null);
    }

    placeBtn.addEventListener('click', () => confirmOrder(dlg, notice));
    dlg.addEventListener('close', () => { dlg.remove(); cartDialog = null; renderCart = null; });
    cartDialog = dlg;
    renderCart = render;
    document.body.append(dlg);
    render();
    dlg.showModal();
  }

  function confirmOrder(cartDlg, cartNotice) {
    const err = h('p', { class: 'notice notice-error', role: 'alert', hidden: true });
    const back = h('button', { class: 'btn btn-ghost', type: 'button', text: 'Back', onclick: () => dlg.close() });
    const ok = h('button', { class: 'btn', type: 'button', text: 'Confirm order' });
    const dlg = h('dialog', { 'aria-label': 'Confirm order' },
      h('h2', { text: 'Place your order?' }),
      h('p', {}, h('strong', { text: 'Table ' + table.number }), ` · ${cartCount()} item${cartCount() === 1 ? '' : 's'} · `, h('strong', { text: fmtINR(cartTotal()) })),
      h('p', { class: 'muted', text: 'Once placed, only the restaurant staff can cancel an order.' }),
      err,
      h('div', { class: 'dialog-actions' }, back, ok));

    ok.addEventListener('click', async () => {
      if (placing) return; // duplicate-tap guard
      placing = true;
      ok.disabled = true; back.disabled = true;
      ok.textContent = 'Placing…';
      err.hidden = true;
      pendingKey = pendingKey || (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
      try {
        await api(`/api/t/${encodeURIComponent(token)}/orders`, {
          method: 'POST',
          body: {
            idempotency_key: pendingKey,
            overall_note: overallNote,
            items: cart.map((l) => ({ item_id: l.item_id, portion_label: l.portion_label, qty: l.qty, note: l.note })),
          },
        });
        cart = []; overallNote = ''; pendingKey = null; saveCart(); updateCartBar();
        dlg.close(); cartDlg.close();
        setTab('orders');
        refreshOrders(true);
        toast('Order placed. Waiting for the restaurant to accept it.');
      } catch (ex) {
        if (!ex.network) pendingKey = null; // a network error keeps the key so a retry cannot create a duplicate
        if (ex.status === 409) {
          dlg.close();
          cartNotice.textContent = ex.message + ' Your cart has been updated; please review it.';
          cartNotice.hidden = false;
          if (menuCtl) menuCtl.reload();
        } else {
          err.textContent = ex.message;
          err.hidden = false;
          ok.disabled = false; back.disabled = false; ok.textContent = 'Try again';
        }
      } finally {
        placing = false;
      }
    });
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  // ---------- my orders (live status) ----------
  function renderOrders() {
    const box = $('view-orders');
    const count = orders.length;
    $('orders-count').textContent = count ? `(${count})` : '';
    if (!count) {
      box.replaceChildren(h('div', { class: 'empty-state' },
        h('p', { class: 'muted', text: 'No orders yet from this table.' }),
        h('button', { class: 'btn', type: 'button', text: 'Browse the menu', onclick: () => setTab('menu') })));
      return;
    }
    box.replaceChildren(
      h('div', { class: 'orders-list' }, orders.map((o) => h('article', { class: 'card order-card is-' + o.status },
        h('div', { class: 'order-head' },
          h('span', { class: 'order-no', text: 'Order ' + o.order_no }),
          h('span', { class: 'pill ' + o.status, text: STATUS[o.status][0] })),
        h('p', { class: 'muted', text: fmtTime(o.created_at) }),
        h('p', { class: 'status-msg', text: STATUS[o.status][1] }),
        o.status === 'cancelled' && o.cancelled_reason ? h('p', { class: 'muted', text: 'Reason: ' + o.cancelled_reason }) : null,
        h('ul', {}, o.items.map((i) => h('li', {},
          h('span', {}, `${i.qty} × ${i.name}${i.portion_label === 'Regular' ? '' : ` (${i.portion_label})`}`,
            i.note ? h('span', { class: 'item-note', text: 'Note: ' + i.note }) : null),
          h('span', { text: fmtINR(i.line_total) })))),
        o.overall_note ? h('p', { class: 'muted', text: 'Order note: ' + o.overall_note }) : null,
        h('div', { class: 'row-between' }, h('span', { class: 'muted', text: 'Order total' }), h('strong', { text: fmtINR(o.subtotal) }))))),
      h('div', { class: 'table-total' }, h('span', { text: 'Table total so far' }), h('span', { text: fmtINR(visitTotal) })),
      h('button', { class: 'btn btn-block', type: 'button', text: 'Order more', onclick: () => setTab('menu') }));
  }

  async function refreshOrders(force) {
    if (document.hidden && !force) return;
    const d = await api(`/api/t/${encodeURIComponent(token)}/orders`);
    const json = JSON.stringify(d);
    if (json === lastOrdersJson) return;
    lastOrdersJson = json;
    orders = d.orders;
    visitTotal = d.visit_total;
    renderOrders();
  }

  // ---------- call waiter (B1) ----------
  const WAITER_LABEL = {
    requested: 'Waiter requested…',
    acknowledged: 'Waiter is on the way',
    completed: 'Waiter request completed ✓',
  };
  const WAITER_MSG = {
    requested: 'Your request has been sent. Waiting for the waiter to acknowledge it.',
    acknowledged: 'The waiter has seen your request and is coming to your table.',
    completed: 'The waiter has attended to your table.',
  };

  function renderWaiterFab() {
    const fab = $('waiter-fab');
    fab.hidden = false;
    fab.className = 'waiter-fab' + (waiterReq ? ' is-' + waiterReq.status : '');
    fab.textContent = waiterReq ? WAITER_LABEL[waiterReq.status] : '🔔 Call Waiter';
  }

  async function refreshWaiter() {
    if (document.hidden) return;
    const { request } = await api(`/api/t/${encodeURIComponent(token)}/waiter`);
    const status = request ? request.status : null;
    if (status === 'completed' && lastWaiterStatus && lastWaiterStatus !== 'completed') toast('Your waiter request is complete.');
    lastWaiterStatus = status;
    waiterReq = request;
    renderWaiterFab();
  }

  function openWaiterDialog() {
    const err = h('p', { class: 'notice notice-error', role: 'alert', hidden: true });
    let dlg;
    if (waiterReq && waiterReq.status !== 'completed') {
      // Already requested or acknowledged: never create another, just show where it stands.
      dlg = h('dialog', { 'aria-label': 'Waiter request' },
        h('h2', { text: 'Table ' + table.number }),
        h('p', {}, h('span', { class: 'pill ' + waiterReq.status, text: waiterReq.status === 'requested' ? 'Requested' : 'Acknowledged' })),
        h('p', { text: WAITER_MSG[waiterReq.status] }),
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', text: 'OK', onclick: () => dlg.close() })));
    } else {
      const yes = h('button', { class: 'btn', type: 'button', text: 'Yes' });
      const no = h('button', { class: 'btn btn-ghost', type: 'button', text: 'No', onclick: () => dlg.close() });
      dlg = h('dialog', { 'aria-label': 'Call the waiter' },
        h('h2', { text: 'Do you want to call the waiter to your table?' }),
        h('p', { class: 'muted', text: 'Table ' + table.number }),
        err,
        h('div', { class: 'dialog-actions' }, no, yes));
      yes.addEventListener('click', async () => {
        yes.disabled = true; no.disabled = true; // duplicate-tap guard
        err.hidden = true;
        try {
          const { request } = await api(`/api/t/${encodeURIComponent(token)}/waiter`, { method: 'POST' });
          waiterReq = request; lastWaiterStatus = request.status;
          renderWaiterFab();
          dlg.close();
          toast('The waiter has been called.');
        } catch (ex) {
          err.textContent = ex.message;
          err.hidden = false;
          yes.disabled = false; no.disabled = false;
        }
      });
    }
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  // ---------- tabs + startup ----------
  function setTab(name) {
    tab = name;
    $('view-menu').hidden = name !== 'menu';
    $('view-orders').hidden = name !== 'orders';
    $('tab-menu').setAttribute('aria-selected', String(name === 'menu'));
    $('tab-orders').setAttribute('aria-selected', String(name === 'orders'));
    updateCartBar();
    window.scrollTo({ top: 0 });
  }

  function showNotFound() {
    document.body.replaceChildren(h('main', { class: 'auth-wrap' },
      h('div', { class: 'card auth-card' }, h('h1', { text: 'Table not found' }),
        h('p', { class: 'muted', text: 'This QR code is not valid. Please ask a member of staff for help.' }))));
  }

  async function init() {
    const topbar = document.querySelector('.order-top');
    const setTopHeight = () => document.documentElement.style.setProperty('--order-top-h', topbar.offsetHeight + 'px');
    setTopHeight();
    window.addEventListener('resize', setTopHeight);

    let info;
    try {
      info = await api(`/api/t/${encodeURIComponent(token)}`);
    } catch (e) {
      if (e.status === 404) return showNotFound();
      $('fatal').textContent = e.message;
      $('fatal').hidden = false;
      return;
    }
    table = info.table;
    $('brand').textContent = info.restaurant_name;
    $('table-badge').textContent = 'Table ' + table.number;
    document.title = `Table ${table.number} | ${info.restaurant_name}`;
    setTopHeight();

    let pollMs = 4000;
    try {
      const cfg = await api('/api/config');
      pollMs = cfg.poll_interval_ms || pollMs;
      hasTaxOrService = !!cfg.has_tax_or_service;
    } catch { /* defaults */ }

    loadCart();
    $('tab-menu').addEventListener('click', () => setTab('menu'));
    $('tab-orders').addEventListener('click', () => { setTab('orders'); refreshOrders(true).catch(() => {}); });
    $('open-cart').addEventListener('click', openCart);
    menuCtl = MenuUI.mount($('menu-root'), { mode: 'order', onAdd: openAddSheet, onLoad: reconcile });
    renderOrders();
    poll(refreshOrders, pollMs);
    $('waiter-fab').addEventListener('click', openWaiterDialog);
    poll(refreshWaiter, pollMs);
  }

  init();
})();
