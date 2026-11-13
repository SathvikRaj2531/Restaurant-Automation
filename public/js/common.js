/* Shared helpers: DOM builder, API client, staff session, formatting, sound alert, polling. */
(function () {
  const TOKEN_KEY = 'pcube_staff_token';
  const USER_KEY = 'pcube_staff_user';
  const TZ = 'Asia/Kolkata';

  // ---- DOM builder (text is always inserted as text, never as HTML) ----
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid);
    }
    return el;
  }

  // ---- Staff session (localStorage may be unavailable; fail soft) ----
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };
  const getToken = () => store.get(TOKEN_KEY);
  function getUser() { try { return JSON.parse(store.get(USER_KEY) || 'null'); } catch { return null; } }
  function saveSession(token, user) { store.set(TOKEN_KEY, token); store.set(USER_KEY, JSON.stringify(user)); }
  function clearSession() { store.del(TOKEN_KEY); store.del(USER_KEY); }
  const homeForRole = (role) => (role === 'kitchen' ? '/kitchen' : role === 'waiter' ? '/waiter' : role === 'owner' || role === 'manager' ? '/staff' : null);

  // ---- API ----
  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const token = opts.staff ? getToken() : null;
    if (token) headers.Authorization = 'Bearer ' + token;
    let res;
    try {
      res = await fetch(path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    } catch {
      const err = new Error('Network problem. Please check your connection.');
      err.network = true;
      throw err;
    }
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok) {
      if (res.status === 401 && opts.staff) { clearSession(); location.href = '/staff/login'; }
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /** Page guard for staff screens. Redirects to login if not signed in or role not allowed. */
  async function requireStaff(roles) {
    if (!getToken()) { location.href = '/staff/login'; return new Promise(() => {}); }
    const { user } = await api('/api/auth/me', { staff: true });
    saveSession(getToken(), user);
    if (user.must_change_password) { location.href = '/staff/change-password'; return new Promise(() => {}); }
    if (roles && !roles.includes(user.role)) {
      const home = homeForRole(user.role);
      location.href = home || '/staff/login';
      return new Promise(() => {});
    }
    return user;
  }

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST', staff: true }); } catch { /* ignore */ }
    clearSession();
    location.href = '/staff/login';
  }

  // ---- Formatting (INR whole rupees, Asia/Kolkata) ----
  const fmtINR = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
  const timeFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true });
  const dateTimeFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
  const fmtTime = (iso) => (iso ? timeFmt.format(new Date(iso)) : '');
  const fmtDateTime = (iso) => (iso ? dateTimeFmt.format(new Date(iso)) : '');
  const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
  const minutesSince = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  function waitText(iso) {
    const m = minutesSince(iso);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
  }

  // ---- Toast ----
  function toast(message, isError) {
    const el = h('div', { class: 'toast' + (isError ? ' error' : ''), role: 'status', text: message });
    document.body.append(el);
    setTimeout(() => el.remove(), 3500);
  }

  // ---- Sound alert (needs one tap per page load because browsers block autoplay) ----
  const Sound = {
    ctx: null,
    enabled: false,
    enable() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = this.ctx || new AC();
      this.ctx.resume();
      this.enabled = true;
      this.beep();
      return true;
    },
    beep() {
      if (!this.enabled || !this.ctx) return;
      const t0 = this.ctx.currentTime;
      [880, 1175, 880].forEach((freq, i) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.frequency.value = freq;
        osc.connect(gain); gain.connect(this.ctx.destination);
        const start = t0 + i * 0.22;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
        osc.start(start); osc.stop(start + 0.21);
      });
    },
  };

  /** Calls fn now and every ms; never overlaps runs. Returns stop(). */
  function poll(fn, ms) {
    let running = false;
    const run = async () => {
      if (running) return;
      running = true;
      try { await fn(); } catch { /* keep polling; next tick retries */ } finally { running = false; }
    };
    run();
    const id = setInterval(run, ms);
    return { stop: () => clearInterval(id), now: run };
  }

  /** Reason dialog: resolves to trimmed text, or null if dismissed. Reason is required. */
  function askReason(title, confirmLabel) {
    return new Promise((resolve) => {
      const ta = h('textarea', { class: 'textarea', maxlength: '300', required: true, 'aria-label': 'Reason' });
      const err = h('p', { class: 'notice notice-error', hidden: true, text: 'Please enter a reason.' });
      const dlg = h('dialog', {},
        h('h2', { text: title }), ta, err,
        h('div', { class: 'dialog-actions' },
          h('button', { class: 'btn btn-ghost', type: 'button', text: 'Back', onclick: () => dlg.close('') }),
          h('button', { class: 'btn btn-danger', type: 'button', text: confirmLabel || 'Confirm', onclick: () => {
            if (!ta.value.trim()) { err.hidden = false; ta.focus(); return; }
            dlg.close(ta.value.trim());
          } })));
      dlg.addEventListener('close', () => { const v = dlg.returnValue || ''; dlg.remove(); resolve(v || null); });
      document.body.append(dlg);
      dlg.showModal();
      ta.focus();
    });
  }

  window.PC = { h, store, api, getToken, getUser, saveSession, clearSession, homeForRole, requireStaff, logout,
    fmtINR, fmtTime, fmtDateTime, todayIST, minutesSince, waitText, toast, Sound, poll, askReason };
})();
