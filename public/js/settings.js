/* Settings (owner): restaurant details and tax / service charge. Empty percent = none; nothing is assumed. */
(function () {
  const { h, api, toast } = PC;
  const $ = (id) => document.getElementById(id);

  function fieldEl(id, label, value, attrs, hint) {
    const input = h('input', { class: 'input', id, value: value ?? '', ...attrs });
    return { input, el: h('div', { class: 'field' }, h('label', { for: id, text: label }), input, hint ? h('span', { class: 'muted', text: hint }) : null) };
  }

  async function init() {
    const user = await PC.requireStaff(['owner']);
    $('who').textContent = `${user.name} (${user.role})`;
    $('logout').addEventListener('click', PC.logout);
    let s;
    try {
      ({ settings: s } = await api('/api/staff/settings', { staff: true }));
    } catch (e) {
      $('root').replaceChildren();
      $('err').textContent = 'Could not load settings. ' + e.message;
      $('err').hidden = false;
      return;
    }
    const f = {
      restaurant_name: fieldEl('s-name', 'Restaurant name', s.restaurant_name, { maxlength: '100', required: true }),
      address: fieldEl('s-addr', 'Address', s.address, { maxlength: '300', required: true }),
      phone: fieldEl('s-phone', 'Phone', s.phone, { maxlength: '40' }),
      gstin: fieldEl('s-gstin', 'GSTIN', s.gstin, { maxlength: '30' }, 'Printed on every receipt. Replace the placeholder with the real GSTIN.'),
      tax_percent: fieldEl('s-tax', 'Tax percent', s.tax_percent ?? '', { type: 'number', min: '0', max: '100', step: '0.01', inputmode: 'decimal', placeholder: 'Empty = no tax' }, 'Charged on subtotal plus service charge. Leave empty for none.'),
      service_charge_percent: fieldEl('s-sc', 'Service charge percent', s.service_charge_percent ?? '', { type: 'number', min: '0', max: '100', step: '0.01', inputmode: 'decimal', placeholder: 'Empty = no service charge' }, 'Charged on the subtotal. Leave empty for none.'),
    };
    const save = h('button', { class: 'btn', type: 'submit', text: 'Save settings' });
    const msg = h('p', { class: 'notice', hidden: true, role: 'status' });
    const form = h('form', { class: 'card b-form b-card', novalidate: true }, Object.values(f).map((x) => x.el), msg, save,
      h('p', { class: 'muted', text: 'Changes apply to new bills only. Bills already issued never change.' }));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      save.disabled = true;
      msg.hidden = true;
      try {
        const body = Object.fromEntries(Object.entries(f).map(([k, x]) => [k, x.input.value]));
        await api('/api/staff/settings', { method: 'PUT', staff: true, body });
        toast('Settings saved.');
      } catch (e) {
        msg.className = 'notice notice-error';
        msg.textContent = e.message;
        msg.hidden = false;
      }
      save.disabled = false;
    });
    $('root').replaceChildren(h('h1', { text: 'Settings' }), form);
  }

  init();
})();
