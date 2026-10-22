// JOOLRY Order FMS v2.7 — Sidebar + auto-refresh + insights
(function () {
  'use strict';
  const C = window.Core;
  const rpc = C.rpc, getToken = C.getToken, setSession = C.setSession,
        clearSession = C.clearSession, getUser = C.getUser,
        fmtDate = C.fmtDate, money = C.money, $ = C.$, $$ = C.$$;

  let state = {
    user: null, orders: [], steps: [], allowedBoxes: [],
    view: 'dashboard', selected: null, loading: false
  };
  let pollTimer = null;
  const VIEW_TITLES = {
    dashboard: 'Dashboard', mywork: 'Pending Works', kanban: 'By Stages',
    fms: 'All Orders', late: 'Late Orders'
  };

  const BOX_COLS = [
    { key: 'box2', n: 2, label: '1. Availability Check' },
    { key: 'box3', n: 3, label: '2. Pack & Dispatch' },
    { key: 'box4', n: 4, label: '3. Client Update' },
    { key: 'box5', n: 5, label: '4. Shopify Status' },
    { key: 'done', n: 0, label: 'Done' }
  ];
  const STAGE_LABELS = {
    box2: 'Availability Check', box3: 'Pack & Dispatch',
    box4: 'Client Update', box5: 'Shopify Status', done: 'Done'
  };
  const BOX_FULL = {
    2: 'Product Availability Check (Inventory Audit)',
    3: 'Order Packing and Dispatch',
    4: 'Client Update (Tracking)',
    5: 'Update Delivery Status in Shopify'
  };

  function role() { return String(state.user && state.user.role || '').toLowerCase(); }
  function isAdmin() { return role() === 'admin'; }
  function isViewer() { return role() === 'viewer'; }
  function isOps() { return role() === 'ops'; }
  function isOpsOrAdmin() { return isAdmin() || isOps(); }
  function hasAnyBox() { return isAdmin() || (state.allowedBoxes && state.allowedBoxes.length > 0); }
  function canDoBox(n) {
    if (isAdmin()) return true;
    if (isViewer()) return false;
    return state.allowedBoxes.indexOf(Number(n)) !== -1;
  }
  function canCourier() { return isAdmin() || (isOps() && hasAnyBox()); }
  function canManual() { return isAdmin() || isOps(); }

  /** Sequential gate: Box N only if previous box is Done */
  function isBoxDone(o, n) {
    if (!o) return false;
    const b = o['box' + n];
    return b && String(b.status || '').toLowerCase() === 'done';
  }
  function isPrevDone(o, n) {
    if (n <= 2) return true; // Box 2 has no previous
    return isBoxDone(o, n - 1);
  }
  function canActOnBox(o, n) {
    return canDoBox(n) && isPrevDone(o, n) && !isBoxDone(o, n);
  }

  function setLoading(on) {
    state.loading = on;
    const el = $('#global-loading'), btn = $('#btn-refresh');
    if (el) el.style.display = on ? 'block' : 'none';
    if (btn) { btn.disabled = on; btn.textContent = on ? '…' : '↻'; }
  }
  function toast(msg, type) {
    const el = $('#toast'); if (!el) return;
    el.textContent = msg;
    el.className = 'toast show' + (type === 'error' ? ' error' : type === 'ok' ? ' ok' : '');
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = 'toast'; }, 2600);
  }

  async function boot() {
    if (!getToken()) { showLogin(); return; }
    state.user = getUser();
    showApp();
    await refresh();
  }
  function showLogin() {
    $('#login-screen').style.display = 'flex';
    $('#app-screen').style.display = 'none';
  }
  function showApp() {
    $('#login-screen').style.display = 'none';
    $('#app-screen').style.display = 'flex';
    if (state.user) {
      const name = state.user.name || state.user.username || state.user.email || '—';
      const boxes = isAdmin() ? 'all' : (state.allowedBoxes || []).join(',') || 'none';
      const roleTxt = (state.user.role || '') + ' · ' + boxes;
      if ($('#user-name')) $('#user-name').textContent = name;
      if ($('#user-role')) $('#user-role').textContent = roleTxt;
      const av = $('#user-avatar');
      if (av) {
        const parts = String(name).trim().split(/\s+/);
        av.textContent = ((parts[0] && parts[0][0]) || 'U') + ((parts[1] && parts[1][0]) || '');
      }
    }
    applyNavAccess();
    startAutoRefresh();
    if (hasAnyBox() && !isAdmin() && !isViewer()) {
      setView('kanban');
    } else {
      setView('dashboard');
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    const sec = (window.APP_CONFIG && window.APP_CONFIG.POLL_INTERVAL) || 45000;
    pollTimer = setInterval(() => {
      if (!state.loading && getToken()) refresh(true);
    }, sec);
    const badge = $('#auto-badge');
    if (badge) { badge.textContent = '● Live'; badge.classList.remove('off'); }
  }
  function stopAutoRefresh() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }
  function toggleSidebar() {
    const sb = $('#sidebar');
    if (sb) sb.classList.toggle('open');
  }

  /** Strict nav: only show tabs the user actually needs */
  function applyNavAccess() {
    const show = {
      dashboard: true,
      mywork: hasAnyBox() && !isViewer(),
      kanban: true,
      late: true,
      fms: true
    };
    $$('.nav-btn').forEach(btn => {
      const v = btn.dataset.view;
      if (!v) return;
      btn.style.display = show[v] !== false ? '' : 'none';
      if (show[v] === false) btn.style.display = 'none';
      else btn.style.display = '';
    });
  }

  async function doLogin() {
    const u = $('#login-user').value.trim(), p = $('#login-pass').value;
    const err = $('#login-error'); err.textContent = '';
    if (!u || !p) { err.textContent = 'Enter email & password'; return; }
    const btn = $('#login-btn');
    btn.disabled = true; btn.textContent = 'Signing in…';
    const res = await rpc('login', [u, p]);
    btn.disabled = false; btn.textContent = 'Sign in';
    if (!res || !res.success) { err.textContent = (res && res.error) || 'Login failed'; return; }
    setSession(res.token, res.user);
    state.user = res.user;
    state.allowedBoxes = res.user.allowedBoxes || [];
    showApp();
    await refresh();
  }
  function doLogout() {
    stopAutoRefresh();
    clearSession();
    state = { user: null, orders: [], steps: [], allowedBoxes: [], view: 'dashboard', selected: null, loading: false };
    showLogin();
  }

  async function refresh(silent) {
    if (!silent) setLoading(true);
    try {
      const [ordRes, bootRes] = await Promise.all([
        rpc('getOrders', ['all'], 60000),
        rpc('getBootData', [], 45000)
      ]);
      if (ordRes && ordRes.success) state.orders = ordRes.orders || [];
      else toast((ordRes && ordRes.error) || 'Load failed', 'error');
      if (bootRes && bootRes.success) {
        state.steps = bootRes.steps || [];
        if (bootRes.user) {
          state.user = Object.assign({}, state.user, bootRes.user);
          state.allowedBoxes = bootRes.user.allowedBoxes || state.allowedBoxes || [];
        }
        computeAllowed();
      } else {
        const st = await rpc('getSteps', []);
        if (st && st.success) state.steps = st.steps || [];
        computeAllowed();
      }
      applyNavAccess();
      renderAll();
          } finally { if (!silent) setLoading(false); }
  }

  function computeAllowed() {
    if (isAdmin()) { state.allowedBoxes = [2, 3, 4, 5]; return; }
    if (state.user && state.user.allowedBoxes && state.user.allowedBoxes.length) {
      state.allowedBoxes = state.user.allowedBoxes.map(Number).filter(n => n >= 2 && n <= 5);
      return;
    }
    const uname = String(state.user && state.user.username || '').toLowerCase();
    const set = {};
    (state.steps || []).forEach(s => {
      String(s.allowed || '').toLowerCase().split(',').forEach(x => {
        if (x.trim() === uname) set[parseInt(s.boxNo, 10)] = true;
      });
    });
    state.allowedBoxes = Object.keys(set).map(Number).filter(n => n >= 2 && n <= 5);
  }

  function renderAll() {
    renderDashboard();
    renderFmsSheet();
    if (hasAnyBox() && !isViewer()) renderMyWork();
    renderKanban();
    renderLate();
  }

  function setView(v) {
    if (v === 'mywork' && (isViewer() || !hasAnyBox())) { toast('No tasks for you', 'error'); return; }
    state.view = v;
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
    ['dashboard','fms','mywork','kanban','late'].forEach(id => {
      const el = $('#view-' + id);
      if (el) el.style.display = id === v ? 'block' : 'none';
    });
    const title = $('#topbar-title');
    if (title) title.textContent = VIEW_TITLES[v] || v;
    // close mobile sidebar
    const sb = $('#sidebar');
    if (sb) sb.classList.remove('open');
    if (v === 'fms') renderFmsSheet();
    if (v === 'late') renderLate();
    if (v === 'mywork') renderMyWork();
    if (v === 'kanban') {
      const filterEl = $('#kanban-filter');
      if (filterEl && hasAnyBox() && !isAdmin() && !filterEl._touched) {
        filterEl.value = 'mine';
        filterEl._touched = true;
      }
      renderKanban();
    }
    if (v === 'dashboard') renderDashboard();
  }

  function isOpen(o) {
    const s = String(o.overallStatus || '').toLowerCase();
    return s !== 'closed' && s !== 'done';
  }
  function worstDelay(o) {
    let w = 0;
    [o.box2, o.box3, o.box4, o.box5].forEach(b => {
      if (b && b.delay !== '' && b.delay != null) {
        const d = parseFloat(b.delay);
        if (!isNaN(d) && d > w) w = d;
      }
    });
    return w;
  }
  function currentStage(o) {
    if (!isOpen(o)) return 'done';
    const cb = String(o.currentBox || '').toLowerCase();
    if (cb.indexOf('2') >= 0) return 'box2';
    if (cb.indexOf('3') >= 0) return 'box3';
    if (cb.indexOf('4') >= 0) return 'box4';
    if (cb.indexOf('5') >= 0) return 'box5';
    if (!o.box2 || !o.box2.actual) return 'box2';
    if (!o.box3 || !o.box3.actual) return 'box3';
    const auto = String(o.courierAutoUpdate || '').toLowerCase() === 'yes';
    if (!auto && (!o.box4 || !o.box4.actual)) return 'box4';
    if (!o.box5 || !o.box5.actual) return 'box5';
    return 'done';
  }
  function orderNeedsMyBox(o) {
    if (!isOpen(o) || isViewer()) return false;
    const st = currentStage(o);
    const n = { box2: 2, box3: 3, box4: 4, box5: 5 }[st];
    return n && canDoBox(n);
  }
  function shortDate(s) {
    if (!s) return '—';
    const t = String(s).replace('T', ' ');
    return t.length > 16 ? t.slice(5, 16) : t.slice(0, 16);
  }
  function boxCell(b, isAct) {
    if (!b) return { txt: '—', cls: '' };
    const val = isAct ? b.actual : b.planned;
    const done = String(b.status || '').toLowerCase() === 'done';
    const delay = b.delay !== '' && b.delay != null ? parseFloat(b.delay) : null;
    let cls = '';
    if (isAct) {
      if (done) cls = delay > 0 ? 'cell-late' : 'cell-ok';
      else if (delay > 0) cls = 'cell-late';
      else cls = 'cell-pending';
    }
    return { txt: shortDate(val), cls: cls };
  }

  function barHtml(rows) {
    const max = Math.max(1, ...rows.map(r => r.v));
    return rows.map(r => `
      <div class="bar-row"><span>${esc(r.l)}</span>
      <div class="bar-track"><div class="bar-fill ${r.c || ''}" style="width:${(r.v/max)*100}%"></div></div>
      <span>${r.v}</span></div>`).join('');
  }

  function filteredList(filterSel, searchSel) {
    const q = ((searchSel && $(searchSel) && $(searchSel).value) || '').toLowerCase();
    const filter = (filterSel && $(filterSel) && $(filterSel).value) || 'open';
    let list = state.orders.slice();
    if (filter === 'open') list = list.filter(isOpen);
    if (filter === 'late') list = list.filter(o => isOpen(o) && worstDelay(o) > 0);
    if (filter === 'mine') list = list.filter(orderNeedsMyBox);
    if (q) list = list.filter(o =>
      String(o.orderId).toLowerCase().indexOf(q) >= 0 ||
      String(o.clientName || '').toLowerCase().indexOf(q) >= 0 ||
      String(o.city || '').toLowerCase().indexOf(q) >= 0 ||
      String(o.shopifyNo || '').toLowerCase().indexOf(q) >= 0);
    return list;
  }

  // ── DASHBOARD: simplified for non-admin ──
  function renderDashboard() {
    const open = state.orders.filter(isOpen);
    const late = open.filter(o => worstDelay(o) > 0);
    const mine = open.filter(orderNeedsMyBox);
    const value = open.reduce((s, o) => s + (parseFloat(o.orderValue) || 0), 0);

    // Staff: focus on My work + Late. Admin: full stats
    if (isAdmin()) {
      $('#stats-row').innerHTML = `
        <div class="stat-card"><div class="label">Open</div><div class="value">${open.length}</div></div>
        <div class="stat-card late"><div class="label">Late</div><div class="value">${late.length}</div></div>
        <div class="stat-card gold"><div class="label">My work</div><div class="value">${mine.length}</div></div>
        <div class="stat-card ok"><div class="label">Open value</div><div class="value" style="font-size:20px">${money(value)}</div></div>`;
    } else if (hasAnyBox()) {
      $('#stats-row').innerHTML = `
        <div class="stat-card gold"><div class="label">My pending</div><div class="value">${mine.length}</div></div>
        <div class="stat-card late"><div class="label">Late (mine)</div><div class="value">${mine.filter(o => worstDelay(o) > 0).length}</div></div>
        <div class="stat-card"><div class="label">All open</div><div class="value">${open.length}</div></div>
        <div class="stat-card ok"><div class="label">All late</div><div class="value">${late.length}</div></div>`;
    } else {
      // Viewer
      $('#stats-row').innerHTML = `
        <div class="stat-card"><div class="label">Open</div><div class="value">${open.length}</div></div>
        <div class="stat-card late"><div class="label">Late</div><div class="value">${late.length}</div></div>
        <div class="stat-card ok"><div class="label">Open value</div><div class="value" style="font-size:20px">${money(value)}</div></div>`;
    }

    const counts = { box2: 0, box3: 0, box4: 0, box5: 0, done: 0 };
    state.orders.forEach(o => { counts[currentStage(o)]++; });
    $('#chart-stages').innerHTML = barHtml([
      { l: 'Availability', v: counts.box2 }, { l: 'Pack/Dispatch', v: counts.box3, c: 'gold' },
      { l: 'Client', v: counts.box4, c: 'rose' }, { l: 'Shopify', v: counts.box5, c: 'ok' },
      { l: 'Done', v: counts.done, c: 'ok' }
    ]);

    let ontime = 0, mild = 0, high = 0;
    open.forEach(o => {
      const d = worstDelay(o);
      if (d <= 0) ontime++; else if (d < 9) mild++; else high++;
    });
    $('#chart-delay').innerHTML = barHtml([
      { l: 'On time', v: ontime, c: 'ok' }, { l: '< 1d late', v: mild, c: 'gold' },
      { l: '≥ 1d late', v: high, c: 'late' }
    ]);

    // Attention: for staff prefer their late work
    const attnSrc = hasAnyBox() && !isAdmin()
      ? open.filter(orderNeedsMyBox).filter(o => worstDelay(o) > 0)
      : open.filter(o => worstDelay(o) > 0);
    const attn = attnSrc.sort((a, b) => worstDelay(b) - worstDelay(a)).slice(0, 10);
    const attnEl = $('#attention-list');
    if (attnEl) attnEl.innerHTML = attn.length
      ? attn.map(o => `<div class="mini-item" onclick="App.openOrder('${esc(o.orderId)}')">
          <span><strong>${esc(o.orderId)}</strong> · ${esc(o.clientName || '')}</span>
          <span class="badge late">+${worstDelay(o).toFixed(1)}h</span></div>`).join('')
      : '<div class="empty">No delayed work 🎉</div>';

    // My Workload chart
    const mineEl = $('#chart-mine');
    if (mineEl) {
      const mineOpen = open.filter(orderNeedsMyBox);
      const mineLate = mineOpen.filter(o => worstDelay(o) > 0);
      mineEl.innerHTML = barHtml([
        { l: 'My pending', v: mineOpen.length, c: 'gold' },
        { l: 'My late', v: mineLate.length, c: 'late' },
        { l: 'Others open', v: Math.max(0, open.length - mineOpen.length) }
      ]);
    }

    // Value by stage
    const valEl = $('#chart-value');
    if (valEl) {
      const valBy = { box2: 0, box3: 0, box4: 0, box5: 0 };
      open.forEach(o => {
        const st = currentStage(o);
        if (valBy[st] !== undefined) valBy[st] += parseFloat(o.orderValue) || 0;
      });
      valEl.innerHTML = barHtml([
        { l: 'Availability', v: Math.round(valBy.box2 / 1000), c: '' },
        { l: 'Pack (₹k)', v: Math.round(valBy.box3 / 1000), c: 'gold' },
        { l: 'Client (₹k)', v: Math.round(valBy.box4 / 1000), c: 'rose' },
        { l: 'Shopify (₹k)', v: Math.round(valBy.box5 / 1000), c: 'ok' }
      ]);
    }

    // Recent open orders
    const recentEl = $('#recent-list');
    if (recentEl) {
      const recent = open.slice().sort((a, b) => String(b.entryTime || '').localeCompare(String(a.entryTime || ''))).slice(0, 8);
      recentEl.innerHTML = recent.length
        ? recent.map(o => `<div class="mini-item" onclick="App.openOrder('${esc(o.orderId)}')">
            <span><strong>${esc(o.orderId)}</strong> · ${esc(o.clientName || '')}</span>
            <span class="badge">${esc(STAGE_LABELS[currentStage(o)] || '')}</span></div>`).join('')
        : '<div class="empty">No open orders</div>';
    }

    // Greeting
    const g = $('#greeting');
    if (g) {
      const hr = new Date().getHours();
      const hello = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
      const nm = (state.user && (state.user.name || state.user.username)) || '';
      g.textContent = hello + (nm ? ', ' + nm.split(' ')[0] : '') + ' 👋';
    }
  }

  // ── FMS SHEET ──
  function renderFmsSheet() {
    // Staff default filter = mine if they have boxes
    const filterEl = $('#fms-filter');
    if (filterEl && hasAnyBox() && !isAdmin() && !filterEl._touched) {
      // leave as-is (user can change); don't force
    }
    const list = filteredList('#fms-filter', '#fms-search');
    const body = $('#fms-body'); if (!body) return;
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="13" class="empty">No orders</td></tr>';
      return;
    }
    body.innerHTML = list.map(o => {
      const b2p = boxCell(o.box2, false), b2a = boxCell(o.box2, true);
      const b3p = boxCell(o.box3, false), b3a = boxCell(o.box3, true);
      const b4p = boxCell(o.box4, false), b4a = boxCell(o.box4, true);
      const b5p = boxCell(o.box5, false), b5a = boxCell(o.box5, true);
      const d = worstDelay(o);
      const mine = orderNeedsMyBox(o);
      return `<tr class="${d > 0 ? 'row-late' : ''} ${mine ? 'row-mine' : ''}" onclick="App.openOrder('${esc(o.orderId)}')">
        <td class="sticky-col"><strong>${esc(o.orderId)}</strong><br><small class="muted">${esc(o.shopifyNo || '')}</small></td>
        <td>${esc(o.clientName || '—')}</td>
        <td>${money(o.orderValue)}</td>
        <td>${esc(o.city || '—')}</td>
        <td class="${b2p.cls}">${b2p.txt}</td><td class="${b2a.cls}">${b2a.txt}</td>
        <td class="${b3p.cls}">${b3p.txt}</td><td class="${b3a.cls}">${b3a.txt}</td>
        <td class="${b4p.cls}">${b4p.txt}</td><td class="${b4a.cls}">${b4a.txt}</td>
        <td class="${b5p.cls}">${b5p.txt}</td><td class="${b5a.cls}">${b5a.txt}</td>
        <td>${esc(o.overallStatus || '—')}</td>
      </tr>`;
    }).join('');
  }

  function renderMyWork() {
    const list = state.orders.filter(orderNeedsMyBox);
    const el = $('#mywork-list'); if (!el) return;
    if (!list.length) {
      el.innerHTML = '<div class="empty">Aapke liye koi pending kaam nahi hai</div>';
      return;
    }
    el.innerHTML = list.map(o => {
      const st = currentStage(o);
      const n = { box2: 2, box3: 3, box4: 4, box5: 5 }[st];
      const d = worstDelay(o);
      const showBtn = n && canActOnBox(o, n);
      return `<div class="work-card ${d > 0 ? 'late' : ''}">
        <div class="work-main" onclick="App.openOrder('${esc(o.orderId)}')">
          <div class="k-id">${esc(o.orderId)} <span class="muted">${esc(o.shopifyNo || '')}</span></div>
          <div class="k-client">${esc(o.clientName || '—')} · ${money(o.orderValue)}</div>
          <div class="k-meta">${STAGE_LABELS[st] || st} ${d > 0 ? '· <span class="badge late">+' + d.toFixed(1) + 'h</span>' : ''}</div>
        </div>
        ${showBtn ? `<button class="btn-done" onclick="event.stopPropagation();App.quickDone('${esc(o.orderId)}',${n})">Mark Done</button>` : ''}
      </div>`;
    }).join('');
  }

  function renderKanban() {
    const list = filteredList('#kanban-filter', '#kanban-search');
    const buckets = { box2: [], box3: [], box4: [], box5: [], done: [] };
    list.forEach(o => { (buckets[currentStage(o)] || buckets.done).push(o); });

    // Strict column visibility:
    // - Admin / Viewer → all columns
    // - Ops → only their allowed boxes + Done
    let cols = BOX_COLS;
    if (!isAdmin() && !isViewer()) {
      cols = BOX_COLS.filter(c => c.key === 'done' || canDoBox(c.n));
    }

    const board = $('#kanban-board');
    if (!board) return;

    board.innerHTML = cols.map(col => {
      const cards = buckets[col.key] || [];
      const colCanAct = col.key !== 'done' && canDoBox(col.n);

      return `<div class="kanban-col ${colCanAct ? 'can-act' : ''}">
        <div class="kanban-col-head">
          <span>${col.label}</span>
          <span class="count">${cards.length}</span>
        </div>
        <div class="kanban-col-body">
          ${cards.length ? cards.map(o => {
            const d = worstDelay(o);
            const isMine = orderNeedsMyBox(o);
            const showBtn = col.key !== 'done' && canActOnBox(o, col.n);
            return `<div class="k-card ${d > 0 ? 'late' : ''} ${isMine ? 'mine' : ''}" onclick="App.openOrder('${esc(o.orderId)}')">
              <div class="k-id">
                ${esc(o.orderId)}
                ${isMine ? '<span class="badge gold">Yours</span>' : ''}
              </div>
              <div class="k-client">${esc(o.clientName || '—')}</div>
              <div class="k-meta">
                <span>${money(o.orderValue)}</span>
                <span>${d > 0 ? '<span class="badge late">+' + d.toFixed(1) + 'h</span>' : esc(o.city || '')}</span>
              </div>
              ${showBtn ?
                `<button class="btn-done" onclick="event.stopPropagation();App.quickDone('${esc(o.orderId)}',${col.n})">Mark Done</button>`
                : (col.key !== 'done' && isMine && !isPrevDone(o, col.n) ?
                  `<div class="step-locked">🔒 Prev step pending</div>` : '')}
            </div>`;
          }).join('') : '<div class="empty" style="padding:16px 8px">Empty</div>'}
        </div>
      </div>`;
    }).join('');
  }

  function renderLate() {
    // Staff: their late work first; Admin/Viewer: all late
    let list = state.orders.filter(o => isOpen(o) && worstDelay(o) > 0)
      .sort((a, b) => worstDelay(b) - worstDelay(a));
    if (hasAnyBox() && !isAdmin()) {
      const mine = list.filter(orderNeedsMyBox);
      const other = list.filter(o => !orderNeedsMyBox(o));
      list = mine.concat(other);
    }
    const el = $('#late-list'); if (!el) return;
    if (!list.length) { el.innerHTML = '<div class="empty">No late orders 🎉</div>'; return; }
    el.innerHTML = list.map(o => {
      const st = currentStage(o);
      const n = { box2: 2, box3: 3, box4: 4, box5: 5 }[st];
      const d = worstDelay(o);
      const mine = orderNeedsMyBox(o);
      const showBtn = mine && n && canActOnBox(o, n);
      return `<div class="work-card late">
        <div class="work-main" onclick="App.openOrder('${esc(o.orderId)}')">
          <div class="k-id">${esc(o.orderId)} ${mine ? '<span class="badge gold">Yours</span>' : ''} <span class="muted">${esc(o.shopifyNo || '')}</span></div>
          <div class="k-client">${esc(o.clientName || '—')} · ${money(o.orderValue)}</div>
          <div class="k-meta">${STAGE_LABELS[st] || st} · <span class="badge late">+${d.toFixed(1)}h</span></div>
        </div>
        ${showBtn ? `<button class="btn-done" onclick="event.stopPropagation();App.quickDone('${esc(o.orderId)}',${n})">Mark Done</button>` : ''}
      </div>`;
    }).join('');
  }

  function renderAdmin() {
    $('#admin-users').innerHTML = `
      <div class="mini-item"><span><strong>${esc(state.user.username)}</strong> · ${esc(state.user.role)}</span></div>
      <div class="mini-item"><span>Boxes: <strong>all (2–5)</strong></span></div>
      <div class="view-hint" style="margin-top:8px">Users sheet → Email, Role (Admin/Ops/Viewer), Col H = Allowed Boxes</div>`;
    const open = state.orders.filter(isOpen);
    $('#admin-orders').innerHTML = open.slice(0, 25).map(o => `
      <div class="mini-item" onclick="App.openOrder('${esc(o.orderId)}')">
        <span><strong>${esc(o.orderId)}</strong> · ${esc(o.clientName || '')}</span>
        <span class="badge">${esc(o.overallStatus || 'Open')}</span>
      </div>`).join('') || '<div class="empty">No open</div>';
  }

  async function loadActivity() {
    if (!isAdmin()) return;
    const res = await rpc('getActivityLog', [80]);
    if (!res || !res.success) {
      $('#activity-body').innerHTML = '<tr><td colspan="6" class="empty">' + esc((res && res.error) || 'Failed') + '</td></tr>';
      return;
    }
    const rows = res.rows || [];
    $('#activity-body').innerHTML = rows.length
      ? rows.map(r => `<tr><td>${esc(r.timestamp)}</td><td>${esc(r.username)}</td><td>${esc(r.action)}</td>
          <td>${esc(r.orderId)}</td><td>${esc(r.box)}</td><td>${esc(r.details)}</td></tr>`).join('')
      : '<tr><td colspan="6" class="empty">No activity</td></tr>';
  }

  async function createManualOrder() {
    if (!canManual()) { toast('No access', 'error'); return; }
    const client = ($('#m-client').value || '').trim();
    if (!client) { toast('Client name required', 'error'); return; }
    const payload = {
      clientName: client, phone: ($('#m-phone').value || '').trim(),
      email: ($('#m-email').value || '').trim(), city: ($('#m-city').value || '').trim(),
      pincode: ($('#m-pincode').value || '').trim(), address: ($('#m-address').value || '').trim(),
      orderValue: $('#m-value').value || 0, paymentMode: $('#m-pay').value || 'Prepaid',
      notes: ($('#m-notes').value || '').trim(), items: []
    };
    const prod = ($('#m-product').value || '').trim();
    if (prod) payload.items.push({ product: prod, qty: Number($('#m-qty').value) || 1, value: Number(payload.orderValue) || 0 });
    setLoading(true);
    try {
      const res = await rpc('createManualOrder', [payload]);
      if (!res || !res.success) { toast((res && res.error) || 'Failed', 'error'); return; }
      toast('Created: ' + res.orderId, 'ok');
      ['m-client','m-phone','m-email','m-city','m-pincode','m-address','m-value','m-notes','m-product'].forEach(id => {
        const el = $('#' + id); if (el) el.value = '';
      });
      await refresh();
      if (res.orderId) openOrder(res.orderId);
    } finally { setLoading(false); }
  }

  async function openOrder(orderId) {
    setLoading(true);
    try {
      const res = await rpc('getOrderDetail', [orderId], 45000);
      if (!res || !res.success) {
        toast((res && res.error) || 'Could not load order', 'error');
        return;
      }
      state.selected = res.order;
      renderDetail(res.order);
      $('#detail-overlay').classList.add('open');
      $('#detail-panel').classList.add('open');
    } finally { setLoading(false); }
  }
  function closeDetail() {
    $('#detail-overlay').classList.remove('open');
    $('#detail-panel').classList.remove('open');
    state.selected = null;
  }

  /** Detail: only show actions user can perform */
  function renderDetail(o) {
    const stage = currentStage(o);
    $('#d-title').textContent = o.orderId + (o.shopifyNo ? '  ·  ' + o.shopifyNo : '');
    $('#d-info').innerHTML = `
      <div><label>Client</label><div>${esc(o.clientName || '—')}</div></div>
      <div><label>Phone</label><div>${esc(o.phone || '—')}</div></div>
      <div class="full"><label>Address</label><div>${esc(o.address || '—')}</div></div>
      <div><label>City</label><div>${esc(o.city || '—')}</div></div>
      <div><label>Value</label><div>${money(o.orderValue)}</div></div>
      <div><label>Payment</label><div>${esc(o.paymentMode || '—')}</div></div>
      <div><label>Status</label><div>${esc(o.overallStatus || '—')}</div></div>
      <div><label>Current Step</label><div><strong>${esc(STAGE_LABELS[stage] || o.currentBox || '—')}</strong></div></div>
      <div><label>Entry</label><div>${fmtDate(o.entryTime)}</div></div>
      <div class="full"><label>Notes</label><div>${esc(o.notes || '—')}</div></div>`;

    // Admin edit — only Admin
    const adminEdit = $('#d-admin-edit');
    if (isAdmin()) {
      adminEdit.style.display = 'block';
      $('#e-client').value = o.clientName || ''; $('#e-phone').value = o.phone || '';
      $('#e-city').value = o.city || ''; $('#e-value').value = o.orderValue || '';
      $('#e-notes').value = o.notes || ''; $('#e-status').value = o.overallStatus || '';
    } else {
      adminEdit.style.display = 'none';
    }

    // Order Items — clear table style
    const items = o.items || [];
    if (items.length) {
      $('#d-items').innerHTML = `
        <div class="items-table">
          <div class="items-head"><span>Product / SKU</span><span>Qty</span><span>Value</span></div>
          ${items.map(it => `
            <div class="item-row">
              <span class="item-name">${esc(it.product || it.name || it.sku || '—')}</span>
              <span class="item-qty">×${it.qty || 1}</span>
              <span class="item-val">${money(it.value || it.price || 0)}</span>
            </div>`).join('')}
        </div>`;
    } else {
      $('#d-items').innerHTML = '<div class="empty">No line items</div>';
    }

    // Boxes: sequential — next step unlocks only after previous is Done
    const boxes = [
      { n: 2, label: BOX_FULL[2], data: o.box2, tat: '1 day TAT' },
      { n: 3, label: BOX_FULL[3], data: o.box3, tat: '1 day TAT' },
      { n: 4, label: BOX_FULL[4], data: o.box4, tat: 'Next day of dispatch' },
      { n: 5, label: BOX_FULL[5], data: o.box5, tat: '4–5 days post dispatch' }
    ];
    $('#d-boxes').innerHTML = boxes.map(b => {
      const d = b.data || {};
      const isDone = String(d.status || '').toLowerCase() === 'done';
      const delay = d.delay !== '' && d.delay != null ? parseFloat(d.delay) : null;
      let delayTxt = '';
      if (delay != null && !isNaN(delay))
        delayTxt = delay > 0 ? `+${delay.toFixed(1)}h late` : (delay < 0 ? `${Math.abs(delay).toFixed(1)}h left` : 'on time');

      const prevOk = isPrevDone(o, b.n);
      const can = canDoBox(b.n);
      const unlocked = canActOnBox(o, b.n);

      let actionHtml = '';
      if (isDone) {
        actionHtml = `<div class="step-status done">✓ Completed</div>`;
      } else if (unlocked) {
        actionHtml = `<button class="btn-done" onclick="App.markDone(${b.n})">Mark Done</button>`;
      } else if (!prevOk) {
        actionHtml = `<div class="step-status locked">🔒 Pehle Box ${b.n - 1} complete karo</div>`;
      } else if (hasAnyBox() && !can && !isViewer()) {
        actionHtml = `<div class="step-status locked">Aapke access mein nahi</div>`;
      } else if (!isViewer()) {
        actionHtml = `<div class="step-status locked">Waiting</div>`;
      }

      const isCurrent = !isDone && prevOk;
      return `<div class="box-row ${isDone ? 'done' : ''} ${isCurrent ? 'current' : ''} ${delay > 0 ? 'late' : ''}">
        <div class="box-head">
          <span>Step ${b.n - 1} — ${b.label}</span>
          <span class="muted">${isDone ? 'Done' : (isCurrent ? 'Current' : (d.status || 'Locked'))}</span>
        </div>
        <div class="box-meta">
          <span>TAT: ${b.tat}</span>
          <span>Planned: ${fmtDate(d.planned)}</span>
          <span>Actual: ${fmtDate(d.actual)}</span>
          <span>${d.doneBy ? 'By: ' + esc(d.doneBy) : ''}</span>
          <span class="${delay > 0 ? 'late' : ''}">${delayTxt}</span>
        </div>
        ${actionHtml}
      </div>`;
    }).join('');

    // Courier: only if canCourier
    const showCourier = canCourier();
    const courierSection = $('#btn-save-courier') && $('#btn-save-courier').closest('.form-grid');
    if (showCourier) {
      $('#d-courier').value = o.courier || '';
      $('#d-awb').value = o.awb || '';
      $('#d-auto').value = String(o.courierAutoUpdate || '').toLowerCase() === 'yes' ? 'Yes' : 'No';
      $('#d-courier').disabled = false;
      $('#d-awb').disabled = false;
      $('#d-auto').disabled = false;
      $('#btn-save-courier').style.display = '';
      // show the h3 + form
      const h3s = $$('#detail-panel h3');
      h3s.forEach(h => { if (h.textContent.trim() === 'Courier') h.style.display = ''; });
      if (courierSection) courierSection.style.display = '';
    } else {
      // hide courier edit for viewer / no-box users — still show values read-only if present
      $('#d-courier').value = o.courier || '—';
      $('#d-awb').value = o.awb || '—';
      $('#d-auto').value = String(o.courierAutoUpdate || '').toLowerCase() === 'yes' ? 'Yes' : 'No';
      $('#d-courier').disabled = true;
      $('#d-awb').disabled = true;
      $('#d-auto').disabled = true;
      $('#btn-save-courier').style.display = 'none';
    }
  }

  async function markDone(boxNo) {
    if (!state.selected) return;
    if (!canDoBox(boxNo)) { toast('No access for this step', 'error'); return; }
    if (!isPrevDone(state.selected, boxNo)) {
      toast('Pehle previous step complete karo (Box ' + (boxNo - 1) + ')', 'error');
      return;
    }
    if (isBoxDone(state.selected, boxNo)) { toast('Already done', 'ok'); return; }
    if (!confirm('Mark Step complete?\n' + (BOX_FULL[boxNo] || 'Box ' + boxNo))) return;
    setLoading(true);
    try {
      const res = await rpc('markBoxDone', [state.selected.orderId, boxNo, ''], 45000);
      if (!res || !res.success) {
        toast((res && res.error) || 'Failed — try again', 'error');
        return;
      }
      toast((BOX_FULL[boxNo] || 'Box ' + boxNo) + ' ✓ Done', 'ok');
      await openOrder(state.selected.orderId);
      await refresh();
    } finally { setLoading(false); }
  }
  async function quickDone(orderId, boxNo) {
    if (!canDoBox(boxNo)) { toast('No access', 'error'); return; }
    // For quick action from board, we still need sequential check
    const o = state.orders.find(x => String(x.orderId) === String(orderId));
    if (o && !isPrevDone(o, boxNo)) {
      toast('Pehle previous step complete karo', 'error');
      return;
    }
    if (o && isBoxDone(o, boxNo)) { toast('Already done', 'ok'); return; }
    if (!confirm('Mark Step complete?\n' + (BOX_FULL[boxNo] || 'Box ' + boxNo))) return;
    setLoading(true);
    try {
      const res = await rpc('markBoxDone', [orderId, boxNo, ''], 45000);
      if (!res || !res.success) {
        toast((res && res.error) || 'Failed — try again', 'error');
        return;
      }
      toast('Done ✓', 'ok');
      await refresh();
    } finally { setLoading(false); }
  }
  async function saveCourier() {
    if (!state.selected || !canCourier()) { toast('No access', 'error'); return; }
    setLoading(true);
    try {
      const res = await rpc('updateCourier', [
        state.selected.orderId, $('#d-courier').value.trim(),
        $('#d-awb').value.trim(), $('#d-auto').value
      ]);
      if (!res || !res.success) { toast((res && res.error) || 'Failed', 'error'); return; }
      toast('Courier saved', 'ok');
      await openOrder(state.selected.orderId);
      await refresh();
    } finally { setLoading(false); }
  }
  async function saveOrderEdit() {
    if (!state.selected || !isAdmin()) { toast('Admin only', 'error'); return; }
    setLoading(true);
    try {
      const res = await rpc('updateOrder', [state.selected.orderId, {
        clientName: $('#e-client').value.trim(), phone: $('#e-phone').value.trim(),
        city: $('#e-city').value.trim(), orderValue: $('#e-value').value,
        notes: $('#e-notes').value.trim(), overallStatus: $('#e-status').value
      }]);
      if (!res || !res.success) { toast((res && res.error) || 'Failed', 'error'); return; }
      toast('Updated', 'ok');
      await openOrder(state.selected.orderId);
      await refresh();
    } finally { setLoading(false); }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  window.App = {
    boot, doLogin, doLogout, refresh, setView, toggleSidebar,
    openOrder, closeDetail, markDone, quickDone, saveCourier, saveOrderEdit,
    renderKanban, renderFmsSheet
  };
  document.addEventListener('DOMContentLoaded', boot);
})();
