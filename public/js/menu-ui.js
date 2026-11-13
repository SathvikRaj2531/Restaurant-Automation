/* Menu component shared by the public website (browse) and QR ordering (order).
   MenuUI.mount(root, { mode: 'browse' | 'order', onAdd(item, categoryName) }) -> { reload(), getItem(id) } */
(function () {
  const { h, api, fmtINR } = PC;

  function portionNodes(item) {
    const single = item.portions.length === 1 && item.portions[0].label === 'Regular';
    return item.portions.map((p) => {
      const priced = Number.isInteger(p.price);
      return h('span', { class: 'portion' + (priced ? '' : ' tbc') },
        single ? null : h('span', { class: 'portion-label', text: p.label + ' ' }),
        h('span', { class: 'portion-price', text: priced ? fmtINR(p.price) : 'Price to be confirmed' }));
    });
  }

  function mount(root, opts = {}) {
    const mode = opts.mode || 'browse';
    const state = { menu: null, q: '', veg: 'all', cat: 'all' };
    const byId = new Map();
    let lastJson = '';

    const search = h('input', { class: 'input', type: 'search', placeholder: 'Search dishes', 'aria-label': 'Search dishes', autocomplete: 'off' });
    const vegBar = h('div', { class: 'chips', role: 'group', 'aria-label': 'Veg or non-veg filter' });
    const tabs = h('div', { class: 'tabs', role: 'group', 'aria-label': 'Categories' });
    const controls = h('div', { class: 'menu-controls' }, search, vegBar, tabs);
    const list = h('div', { class: 'menu-list', 'aria-live': 'polite' });

    function chip(parent, label, active, onClick, extra) {
      const b = h('button', { type: 'button', class: 'chip' + (extra ? ' ' + extra : ''), 'aria-pressed': active ? 'true' : 'false', onclick: onClick, text: label });
      parent.append(b);
      return b;
    }

    function renderControls() {
      vegBar.replaceChildren();
      [['all', 'All', ''], ['veg', 'Veg', 'veg'], ['nonveg', 'Non-veg', 'nonveg']].forEach(([val, label, cls]) => {
        const b = h('button', { type: 'button', class: 'chip ' + cls, 'aria-pressed': state.veg === val ? 'true' : 'false', onclick: () => { state.veg = val; renderControls(); renderList(); } },
          cls ? h('span', { class: 'vn ' + cls }) : null, label);
        vegBar.append(b);
      });
      tabs.replaceChildren();
      chip(tabs, 'All', state.cat === 'all', () => { state.cat = 'all'; renderControls(); renderList(); });
      state.menu.categories.forEach((c) => chip(tabs, c.name, state.cat === String(c.id), () => { state.cat = String(c.id); renderControls(); renderList(); }));
    }

    function itemEl(item, catName) {
      const showAdd = mode === 'order' && item.orderable;
      const thumb = h('img', { class: 'menu-thumb', src: item.image_url || '/img/art/generic.svg', alt: item.name, width: '96', height: '96', loading: 'lazy', decoding: 'async' });
      thumb.addEventListener('error', () => { if (!thumb.dataset.fb) { thumb.dataset.fb = '1'; thumb.src = '/img/art/generic.svg'; } });
      return h('article', { class: 'menu-item' + (item.available ? '' : ' is-unavailable') },
        thumb,
        h('div', { class: 'menu-item-main' },
          h('div', { class: 'menu-item-name' },
            h('span', { class: 'vn ' + (item.is_veg ? 'veg' : 'nonveg'), title: item.is_veg ? 'Veg' : 'Non-veg', role: 'img', 'aria-label': item.is_veg ? 'Veg' : 'Non-veg' }),
            h('span', { text: item.name })),
          item.description ? h('p', { class: 'menu-item-desc muted', text: item.description }) : null,
          h('div', { class: 'portions' }, portionNodes(item)),
          item.available ? null : h('span', { class: 'badge-unavailable', text: 'Currently unavailable' })),
        showAdd ? h('button', { type: 'button', class: 'btn btn-sm add-btn', onclick: () => opts.onAdd && opts.onAdd(item, catName), 'aria-label': 'Add ' + item.name, text: 'Add' }) : null);
    }

    function renderList() {
      const q = state.q.trim().toLowerCase();
      list.replaceChildren();
      let shown = 0;
      for (const cat of state.menu.categories) {
        if (state.cat !== 'all' && state.cat !== String(cat.id)) continue;
        const items = cat.items.filter((it) =>
          (state.veg === 'all' || (state.veg === 'veg') === it.is_veg) &&
          (!q || (it.name + ' ' + it.description + ' ' + cat.name).toLowerCase().includes(q)));
        if (!items.length) continue;
        shown += items.length;
        const section = h('section', { class: 'menu-cat' }, h('h2', { text: cat.name }));
        const subs = [...new Set(items.map((i) => i.subcategory))];
        for (const sub of subs) {
          if (subs.length > 1 && sub) section.append(h('h3', { class: 'menu-sub', text: sub }));
          section.append(h('div', { class: 'menu-items' }, items.filter((i) => i.subcategory === sub).map((i) => itemEl(i, cat.name))));
        }
        list.append(section);
      }
      if (!shown) list.append(h('p', { class: 'notice', text: 'No dishes match your search.' }));
    }

    /** quiet = background refresh: no "Loading" flash, errors ignored, redraws only if the menu changed. */
    async function load(quiet) {
      if (quiet !== true) list.replaceChildren(h('p', { class: 'muted', text: 'Loading menu…' }));
      let fresh;
      try {
        fresh = await api('/api/menu');
      } catch (e) {
        if (quiet === true) return;
        list.replaceChildren(h('p', { class: 'notice notice-error', text: 'Could not load the menu. ' }, h('button', { class: 'btn btn-sm', type: 'button', text: 'Try again', onclick: () => load() })));
        return;
      }
      const json = JSON.stringify(fresh);
      if (quiet === true && json === lastJson) return;
      lastJson = json;
      state.menu = fresh;
      byId.clear();
      state.menu.categories.forEach((c) => c.items.forEach((i) => byId.set(i.id, i)));
      if (state.cat !== 'all' && !state.menu.categories.some((c) => String(c.id) === state.cat)) state.cat = 'all';
      renderControls();
      renderList();
      if (opts.onLoad) opts.onLoad(controller);
    }

    search.addEventListener('input', () => { state.q = search.value; if (state.menu) renderList(); });
    const controller = { reload: () => load(), getItem: (id) => byId.get(id) };
    // Changes made by staff show up within seconds: refetch every 30 s and whenever the tab regains focus.
    setInterval(() => { if (!document.hidden) load(true); }, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(true); });
    window.addEventListener('focus', () => load(true));
    root.replaceChildren(controls, list);
    load();
    return controller;
  }

  window.MenuUI = { mount };
})();
