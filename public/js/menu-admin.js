/* Menu management (owner / manager): list by category, quick toggles, add/edit/soft-delete items, categories. */
(function () {
  const { h, api, fmtINR, toast } = PC;
  const $ = (id) => document.getElementById(id);

  let cats = [];
  let q = '';

  const call = (path, method, body) => api('/api/staff/menu' + path, { method, body, staff: true });
  const priceText = (it) => it.portions.map((p) => (it.portions.length === 1 && p.label === 'Regular' ? '' : p.label + ' ') + (Number.isInteger(p.price) ? fmtINR(p.price) : 'Price to be confirmed')).join(' / ');

  async function load() {
    try {
      ({ categories: cats } = await call('', 'GET'));
      $('err').hidden = true;
      render();
    } catch (e) {
      $('err').textContent = 'Could not load the menu. ' + e.message;
      $('err').hidden = false;
    }
  }

  async function run(fn, okMsg) {
    try {
      await fn();
      if (okMsg) toast(okMsg);
    } catch (e) {
      toast(e.message, true);
    }
    await load();
  }

  // ---------- list ----------
  function toggle(it, key, label) {
    const input = h('input', { type: 'checkbox', checked: it[key], 'aria-label': `${label}: ${it.name}` });
    input.addEventListener('change', async () => {
      const want = input.checked;
      input.disabled = true;
      try {
        await call('/items/' + it.id, 'PATCH', { [key]: want });
        it[key] = want;
      } catch (e) {
        input.checked = !want;
        toast(e.message, true);
      }
      input.disabled = false;
      render();
    });
    return h('label', { class: 'ma-toggle' }, input, label);
  }

  function row(it) {
    return h('div', { class: 'ma-row' + (it.available ? '' : ' is-off') },
      h('div', { class: 'ma-name' },
        h('span', { class: 'vn ' + (it.is_veg ? 'veg' : 'nonveg'), role: 'img', 'aria-label': it.is_veg ? 'Veg' : 'Non-veg' }),
        h('span', { text: it.name }),
        it.subcategory ? h('span', { class: 'ma-sub', text: it.subcategory }) : null),
      h('div', { class: 'ma-price', text: priceText(it) }),
      h('div', { class: 'ma-controls' }, toggle(it, 'available', 'Available'), toggle(it, 'special', 'Special'),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Edit', onclick: () => openItemForm(it) })));
  }

  function render() {
    const term = q.trim().toLowerCase();
    const out = [];
    cats.forEach((c, i) => {
      const items = c.items.filter((it) => !term || (it.name + ' ' + it.subcategory + ' ' + c.name).toLowerCase().includes(term));
      if (term && !items.length) return;
      out.push(h('section', { class: 'ma-cat' },
        h('div', { class: 'ma-cat-head' },
          h('h2', { text: `${c.name} (${c.items.length})` }),
          h('div', { class: 'ma-cat-tools' },
            h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: '↑', title: 'Move up', 'aria-label': 'Move ' + c.name + ' up', disabled: i === 0, onclick: () => run(() => call(`/categories/${c.id}/move`, 'POST', { direction: 'up' })) }),
            h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: '↓', title: 'Move down', 'aria-label': 'Move ' + c.name + ' down', disabled: i === cats.length - 1, onclick: () => run(() => call(`/categories/${c.id}/move`, 'POST', { direction: 'down' })) }),
            h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Rename', onclick: () => categoryDialog(c) }))),
        items.length ? items.map(row) : h('div', { class: 's-empty', text: 'No items in this category.' })));
    });
    $('list').replaceChildren(...(out.length ? out : [h('div', { class: 's-empty', text: term ? 'No items match your search.' : 'The menu is empty. Add a category first.' })]));
  }

  // ---------- category dialog (add / rename) ----------
  function categoryDialog(cat) {
    const input = h('input', { class: 'input', maxlength: '60', value: cat ? cat.name : '', 'aria-label': 'Category name' });
    const err = h('p', { class: 'notice notice-error', role: 'alert', hidden: true });
    const save = h('button', { class: 'btn', type: 'button', text: 'Save' });
    const dlg = h('dialog', { 'aria-label': cat ? 'Rename category' : 'Add category' },
      h('h2', { text: cat ? 'Rename category' : 'Add category' }), input, err,
      h('div', { class: 'dialog-actions' }, h('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: () => dlg.close() }), save));
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        if (cat) await call('/categories/' + cat.id, 'PUT', { name: input.value });
        else await call('/categories', 'POST', { name: input.value });
        dlg.close();
        load();
      } catch (e) {
        err.textContent = e.message; err.hidden = false; save.disabled = false;
      }
    });
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    input.focus();
  }

  // ---------- item form (add / edit) ----------
  function openItemForm(it) {
    if (!cats.length) return toast('Add a category first.', true);
    const isNew = !it;
    const item = it || { name: '', description: '', category_id: cats[0].id, subcategory: '', is_veg: true, portions: [{ label: 'Regular', price: '' }], image_url: '', special: false, available: true };

    const name = h('input', { class: 'input', id: 'f-name', maxlength: '100', value: item.name, required: true });
    const desc = h('textarea', { class: 'textarea', id: 'f-desc', maxlength: '500' }, item.description);
    const cat = h('select', { class: 'select', id: 'f-cat' }, cats.map((c) => h('option', { value: String(c.id), text: c.name, selected: c.id === item.category_id })));
    const subList = h('datalist', { id: 'f-sub-list' });
    const sub = h('input', { class: 'input', id: 'f-sub', maxlength: '60', value: item.subcategory, list: 'f-sub-list', placeholder: 'e.g. Veg, Non-veg' });
    const fillSubs = () => {
      const c = cats.find((x) => String(x.id) === cat.value);
      subList.replaceChildren(...[...new Set((c ? c.items : []).map((i) => i.subcategory).filter(Boolean))].map((v) => h('option', { value: v })));
    };
    cat.addEventListener('change', fillSubs);
    fillSubs();

    const veg = h('input', { type: 'radio', name: 'veg', value: 'veg', checked: item.is_veg });
    const nonveg = h('input', { type: 'radio', name: 'veg', value: 'nonveg', checked: !item.is_veg });
    const image = h('input', { class: 'input', id: 'f-img', type: 'url', maxlength: '500', value: item.image_url, placeholder: 'https://… (optional)' });
    const special = h('input', { type: 'checkbox', checked: item.special });
    const available = h('input', { type: 'checkbox', checked: item.available });

    const portionBox = h('div');
    const portions = item.portions.map((p) => ({ label: p.label, price: p.price == null ? '' : String(p.price) }));
    function renderPortions() {
      portionBox.replaceChildren(...portions.map((p, i) => h('div', { class: 'ma-portion' },
        h('input', { class: 'input', value: p.label, maxlength: '30', placeholder: 'Label (e.g. Single)', 'aria-label': 'Portion label', oninput: (e) => { p.label = e.target.value; } }),
        h('input', { class: 'input', type: 'number', min: '0', step: '1', inputmode: 'numeric', value: p.price, placeholder: '₹ price', 'aria-label': 'Price in rupees', oninput: (e) => { p.price = e.target.value; } }),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Remove', disabled: portions.length === 1, onclick: () => { portions.splice(i, 1); renderPortions(); } }))));
    }
    renderPortions();

    const err = h('p', { class: 'notice notice-error', role: 'alert', hidden: true });
    const save = h('button', { class: 'btn', type: 'button', text: isNew ? 'Add item' : 'Save changes' });
    const del = isNew ? null : h('button', { class: 'btn btn-outline-danger', type: 'button', text: 'Delete' });
    const dlg = h('dialog', { class: 'sheet', 'aria-label': isNew ? 'Add item' : 'Edit item' },
      h('div', { class: 'sheet-head' }, h('h2', { text: isNew ? 'Add item' : 'Edit item' }),
        h('button', { class: 'close-x', type: 'button', 'aria-label': 'Close', text: '×', onclick: () => dlg.close() })),
      h('div', { class: 'sheet-body ma-form' },
        h('div', { class: 'field' }, h('label', { for: 'f-name', text: 'Name' }), name),
        h('div', { class: 'field' }, h('label', { for: 'f-desc', text: 'Description (optional)' }), desc),
        h('div', { class: 'field' }, h('label', { for: 'f-cat', text: 'Category' }), cat),
        h('div', { class: 'field' }, h('label', { for: 'f-sub', text: 'Subcategory (optional)' }), sub, subList),
        h('div', { class: 'field' }, h('label', { text: 'Type' }),
          h('div', { class: 'ma-radios' }, h('label', {}, veg, h('span', { class: 'vn veg' }), ' Veg'), h('label', {}, nonveg, h('span', { class: 'vn nonveg' }), ' Non-veg'))),
        h('div', { class: 'field' }, h('label', { text: 'Portions and prices (leave price empty for "Price to be confirmed")' }), portionBox,
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Add portion', onclick: () => { if (portions.length < 6) { portions.push({ label: '', price: '' }); renderPortions(); } } })),
        h('div', { class: 'field' }, h('label', { for: 'f-img', text: 'Image URL' }), image),
        h('div', { class: 'ma-checks' }, h('label', { class: 'ma-toggle' }, special, 'Special'), h('label', { class: 'ma-toggle' }, available, 'Available')),
        err),
      h('div', { class: 'sheet-foot ma-form-foot' }, save, del, h('span', { class: 'grow' }),
        h('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: () => dlg.close() })));

    save.addEventListener('click', async () => {
      save.disabled = true;
      err.hidden = true;
      const body = {
        name: name.value, description: desc.value, category_id: Number(cat.value), subcategory: sub.value, is_veg: veg.checked,
        portions: portions.map((p) => ({ label: p.label, price: p.price === '' ? null : Number(p.price) })),
        image_url: image.value, special: special.checked, available: available.checked,
      };
      try {
        if (isNew) await call('/items', 'POST', body);
        else await call('/items/' + item.id, 'PUT', body);
        dlg.close();
        toast(isNew ? 'Item added.' : 'Item saved.');
        load();
      } catch (e) {
        err.textContent = e.message; err.hidden = false; save.disabled = false;
      }
    });
    if (del) {
      del.addEventListener('click', () => {
        const ok = h('button', { class: 'btn btn-danger', type: 'button', text: 'Delete item' });
        const c = h('dialog', { 'aria-label': 'Confirm delete' },
          h('h2', { text: `Delete "${item.name}"?` }),
          h('p', { class: 'muted', text: 'It disappears from every menu. Orders already placed are not changed.' }),
          h('div', { class: 'dialog-actions' }, h('button', { class: 'btn btn-ghost', type: 'button', text: 'Keep', onclick: () => c.close() }), ok));
        ok.addEventListener('click', async () => {
          ok.disabled = true;
          try { await call('/items/' + item.id, 'DELETE'); c.close(); dlg.close(); toast('Item deleted.'); load(); }
          catch (e) { toast(e.message, true); ok.disabled = false; }
        });
        c.addEventListener('close', () => c.remove());
        document.body.append(c);
        c.showModal();
      });
    }
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  async function init() {
    const user = await PC.requireStaff(['owner', 'manager']);
    $('who').textContent = `${user.name} (${user.role})`;
    $('logout').addEventListener('click', PC.logout);
    $('q').addEventListener('input', (e) => { q = e.target.value; render(); });
    $('add-item').addEventListener('click', () => openItemForm(null));
    $('add-cat').addEventListener('click', () => categoryDialog(null));
    load();
  }

  init();
})();
