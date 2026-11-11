// JOOLRY Order FMS v3.1 — Smart Hybrid + Refund + Due/Delay (Stage-based + Decision Tree)
(function () {
  'use strict';
  const C = window.Core;
  const rpc = C.rpc, getToken = C.getToken, setSession = C.setSession,
        clearSession = C.clearSession, getUser = C.getUser,
        fmtDate = C.fmtDate, money = C.money, $ = C.$, $$ = C.$$;

  let state = {
    user: null, orders: [], stages: [], allowedStages: [],
    view: 'dashboard', selected: null, loading: false
  };
  let pollTimer = null;

  const VIEW_TITLES = {
    dashboard: 'Dashboard', mywork: 'Pending Works',
    kanban: 'By Stages', due: 'Due Today', late: 'Late Orders',
    fms: 'All Orders', refund: 'Refunds'
  };

  // Stage display labels (match Process_Stages)
  const STAGE_LABELS = {
    NEW: 'New',
    STOCK_CHECK: 'Stock Check',
    VENDOR_CONTACT: 'Vendor Contact',
    VENDOR_ARRANGE: 'Vendor Arrange',
    VENDOR_FOLLOWUP: 'Vendor Follow-up',
    CLIENT_DECISION: 'Client Decision',
    READY_PACKING: 'Ready for Packing',
    PACKING: 'Packing',
    DISPATCH: 'Dispatch',
    TRACKING_UPDATE: 'Tracking Update',
    DISPATCHED: 'Dispatched',
    REFUND_PROCESS: 'Refund Process',
    REFUNDED: 'Refunded',
    DELAYED: 'Delayed',
    CANCELLED: 'Cancelled'
  };

  // Kanban columns order
  const KANBAN_STAGES = [
    'NEW', 'STOCK_CHECK', 'VENDOR_CONTACT', 'VENDOR_ARRANGE', 'VENDOR_FOLLOWUP',
    'CLIENT_DECISION', 'READY_PACKING', 'PACKING', 'DISPATCH', 'TRACKING_UPDATE'
  ];

  function role() { return String(state.user && state.user.role || '').toLowerCase(); }
  function isAdmin() { return role() === 'admin'; }
  function isViewer() { return role() === 'viewer'; }
  function isOps() { return role() === 'ops'; }

  function canDoStage(stageCode) {
    if (isAdmin()) return true;
    if (isViewer()) return false;
    const allowed = state.allowedStages || [];
    if (allowed.indexOf('ALL') !== -1) return true;
    return allowed.indexOf(String(stageCode || '').toUpperCase()) !== -1;
  }

  function hasAnyStage() {
    return isAdmin() || (state.allowedStages && state.allowedStages.length > 0);
  }

  function isOpen(o) {
    const s = String(o.overallStatus || '').toLowerCase();
    return s !== 'completed' && s !== 'refunded' && s !== 'cancelled';
  }

  function isTerminal(stage) {
    return ['DISPATCHED', 'REFUNDED', 'CANCELLED'].indexOf(String(stage || '').toUpperCase()) !== -1;
  }

  function stageLabel(code) {
    return STAGE_LABELS[String(code || '').toUpperCase()] || code || '—';
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
    el._t = setTimeout(() => { el.className = 'toast'; }, 2800);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ── Boot / Auth ─────────────────────────────────────────────────────── */

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
      const name = state.user.name || state.user.username || '—';
      const stages = isAdmin() ? 'all' : (state.allowedStages || []).join(', ') || 'none';
      if ($('#user-name')) $('#user-name').textContent = name;
      if ($('#user-role')) $('#user-role').textContent = (state.user.role || '') + ' · ' + stages;
      const av = $('#user-avatar');
      if (av) {
        const parts = String(name).trim().split(/\s+/);
        av.textContent = ((parts[0] && parts[0][0]) || 'U') + ((parts[1] && parts[1][0]) || '');
      }
    }
    applyNavAccess();
    startAutoRefresh();
    if (hasAnyStage() && !isAdmin() && !isViewer()) {
      setView('mywork');
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
    const bd = $('#sidebar-backdrop');
    if (sb) sb.classList.toggle('open');
    if (bd) bd.classList.toggle('open', sb && sb.classList.contains('open'));
  }

  function toggleCollapse() {
    const shell = $('#app-screen');
    if (!shell) return;
    shell.classList.toggle('collapsed');
    const btn = document.querySelector('.collapse-btn');
    if (btn) btn.textContent = shell.classList.contains('collapsed') ? '»' : '«';
  }

  function globalSearch() {
    const q = ($('#global-search') && $('#global-search').value || '').trim();
    if (!q) return;
    setView('fms');
    const fs = $('#fms-search');
    if (fs) { fs.value = q; renderFmsSheet(); }
  }

  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('joolry_fms_theme', t); } catch (e) {}
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t === 'dark' ? '#0f1218' : '#F7F4EE';
    const btn = $('#theme-btn');
    if (btn) btn.textContent = t === 'dark' ? '☀ Light' : '◐ Dark';
  }

  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  }

  function initTheme() {
    let t = 'light';
    try { t = localStorage.getItem('joolry_fms_theme') || 'light'; } catch (e) {}
    applyTheme(t);
  }

  function applyNavAccess() {
    const show = {
      dashboard: true,
      mywork: hasAnyStage() && !isViewer(),
      kanban: true,
      due: true,
      late: true,
      fms: true
    };
    $$('.nav-btn').forEach(btn => {
      const v = btn.dataset.view;
      if (!v) return;
      btn.style.display = (show[v] === false) ? 'none' : '';
    });
  }

  async function doLogin() {
    const u = $('#login-user').value.trim(), p = $('#login-pass').value;
    const err = $('#login-error'); err.textContent = '';
    if (!u || !p) { err.textContent = 'Enter email & password'; return; }
    const btn = $('#login-btn');
    btn.disabled = true; btn.textContent = 'Signing in…';
    const res = await rpc('login', [u, p]);
    btn.disabled = false; btn.textContent = '→ Sign In';
    if (!res || !res.success) { err.textContent = (res && res.error) || 'Login failed'; return; }
    setSession(res.token, res.user);
    state.user = res.user;
    state.allowedStages = res.user.allowedStages || [];
    showApp();
    await refresh();
  }

  function doLogout() {
    stopAutoRefresh();
    clearSession();
    state = { user: null, orders: [], stages: [], allowedStages: [], view: 'dashboard', selected: null, loading: false };
    showLogin();
  }

  /* ── Data ────────────────────────────────────────────────────────────── */

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
        state.stages = bootRes.stages || [];
        if (bootRes.user) {
          state.user = Object.assign({}, state.user, bootRes.user);
          state.allowedStages = bootRes.user.allowedStages || state.allowedStages || [];
        }
      } else {
        const st = await rpc('getStages', []);
        if (st && st.success) state.stages = st.stages || [];
      }
      applyNavAccess();
      renderAll();
    } finally {
      if (!silent) setLoading(false);
    }
  }

  function renderAll() {
    renderCurrentView();
  }

  function renderCurrentView() {
    const v = state.view || 'dashboard';
    if (v === 'dashboard') renderDashboard();
    else if (v === 'mywork') renderMyWork();
    else if (v === 'kanban') renderKanban();
    else if (v === 'refund') renderRefund();
    else if (v === 'due') renderDue();
    else if (v === 'late') renderLate();
    else if (v === 'fms') renderFmsSheet();
  }

  function setView(v) {
    if (v === 'mywork' && (isViewer() || !hasAnyStage())) {
      toast('No tasks for you', 'error'); return;
    }
    state.view = v;
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
    ['dashboard', 'mywork', 'kanban', 'due', 'late', 'refund', 'fms'].forEach(id => {
      const el = $('#view-' + id);
      if (el) el.style.display = id === v ? 'block' : 'none';
    });
    const title = $('#topbar-title');
    if (title) title.textContent = VIEW_TITLES[v] || v;
    const sb = $('#sidebar');
    if (sb) sb.classList.remove('open');
    const bd = $('#sidebar-backdrop');
    if (bd) bd.classList.remove('open');
    renderCurrentView();
  }

  /* ── Helpers ─────────────────────────────────────────────────────────── */

  function delayVal(o) {
    const d = parseFloat(o.delayOfficeHrs);
    return isNaN(d) ? 0 : d;
  }

  function shortDate(s) {
    if (!s) return '—';
    const t = String(s).replace('T', ' ');
    return t.length > 16 ? t.slice(5, 16) : t.slice(0, 16);
  }

  function orderNeedsMyAction(o) {
    if (!isOpen(o) || isViewer()) return false;
    const stage = String(o.currentStage || '').toUpperCase();
    return canDoStage(stage) && !isTerminal(stage);
  }

  function filteredOrders(filter, searchQ, stageFilter) {
    let list = state.orders || [];
    const q = (searchQ || '').toLowerCase().trim();

    if (filter === 'open') list = list.filter(isOpen);
    else if (filter === 'mine') list = list.filter(orderNeedsMyAction);
    else if (filter === 'late') list = list.filter(o => isOpen(o) && delayVal(o) > 0);
    else if (filter === 'completed') list = list.filter(o => String(o.overallStatus || '').toLowerCase() === 'completed');
    else if (filter === 'refunded') list = list.filter(o => String(o.overallStatus || '').toLowerCase() === 'refunded');

    if (stageFilter) {
      list = list.filter(o => String(o.currentStage || '').toUpperCase() === stageFilter.toUpperCase());
    }

    if (q) {
      list = list.filter(o => {
        const hay = [
          o.orderId, o.shopifyNo, o.clientName, o.city, o.phone,
          o.currentStage, o.overallStatus, o.notes
        ].join(' ').toLowerCase();
        return hay.indexOf(q) !== -1;
      });
    }
    return list;
  }

  /* ── Dashboard ───────────────────────────────────────────────────────── */

  function renderDashboard() {
    const open = (state.orders || []).filter(isOpen);
    const late = open.filter(o => delayVal(o) > 0);
    const mine = open.filter(orderNeedsMyAction);
    const refunded = (state.orders || []).filter(o => String(o.overallStatus || '').toLowerCase() === 'refunded');

    const greeting = $('#greeting');
    if (greeting) {
      const hour = new Date().getHours();
      const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
      const name = (state.user && (state.user.name || state.user.username)) || '';
      greeting.textContent = hello + (name ? ', ' + name.split(' ')[0] : '') + ' 👋';
    }

    const stats = $('#stats-row');
    if (stats) {
      stats.innerHTML = `
        <div class="stat-card"><div class="stat-n">${open.length}</div><div class="stat-l">Open</div></div>
        <div class="stat-card late"><div class="stat-n">${late.length}</div><div class="stat-l">Late</div></div>
        <div class="stat-card"><div class="stat-n">${mine.length}</div><div class="stat-l">My Work</div></div>
        <div class="stat-card"><div class="stat-n">${refunded.length}</div><div class="stat-l">Refunded</div></div>
      `;
    }

    // Stage counts
    const stageCounts = {};
    KANBAN_STAGES.forEach(s => stageCounts[s] = 0);
    open.forEach(o => {
      const s = String(o.currentStage || '').toUpperCase();
      if (stageCounts[s] !== undefined) stageCounts[s]++;
      else stageCounts[s] = (stageCounts[s] || 0) + 1;
    });

    const chartStages = $('#chart-stages');
    if (chartStages) {
      const rows = KANBAN_STAGES.map(s => ({
        l: stageLabel(s).replace('Vendor ', 'V. ').replace('Client ', 'C. '),
        v: stageCounts[s] || 0,
        c: (stageCounts[s] || 0) > 5 ? 'hot' : ''
      })).filter(r => r.v > 0);
      chartStages.innerHTML = barHtml(rows);
    }

    // Delay overview
    const chartDelay = $('#chart-delay');
    if (chartDelay) {
      const buckets = { 'On time': 0, '1-9 hrs late': 0, '10-45 hrs': 0, '45+ hrs': 0 };
      open.forEach(o => {
        const d = delayVal(o);
        if (d <= 0) buckets['On time']++;
        else if (d < 10) buckets['1-9 hrs late']++;
        else if (d < 45) buckets['10-45 hrs']++;
        else buckets['45+ hrs']++;
      });
      chartDelay.innerHTML = barHtml(Object.keys(buckets).map(k => ({
        l: k, v: buckets[k], c: k === 'On time' ? 'ok' : 'hot'
      })));
    }

    // My workload
    const chartMine = $('#chart-mine');
    if (chartMine) {
      const mineByStage = {};
      mine.forEach(o => {
        const s = String(o.currentStage || 'OTHER').toUpperCase();
        mineByStage[s] = (mineByStage[s] || 0) + 1;
      });
      const rows = Object.keys(mineByStage).map(s => ({
        l: stageLabel(s), v: mineByStage[s]
      }));
      chartMine.innerHTML = rows.length ? barHtml(rows) : '<div class="empty-hint">No pending work for you</div>';
    }

    // Value by stage
    const chartValue = $('#chart-value');
    if (chartValue) {
      const valBy = {};
      open.forEach(o => {
        const s = String(o.currentStage || 'OTHER').toUpperCase();
        valBy[s] = (valBy[s] || 0) + (parseFloat(o.orderValue) || 0);
      });
      const rows = Object.keys(valBy).map(s => ({
        l: stageLabel(s).slice(0, 12), v: Math.round(valBy[s] / 1000)
      })).sort((a, b) => b.v - a.v).slice(0, 6);
      chartValue.innerHTML = barHtml(rows);
    }

    // Needs attention
    const att = $('#attention-list');
    if (att) {
      const urgent = open.filter(o => delayVal(o) > 0)
        .sort((a, b) => delayVal(b) - delayVal(a)).slice(0, 8);
      att.innerHTML = urgent.length ? urgent.map(o => `
        <div class="mini-row" onclick="App.openDetail('${esc(o.orderId)}')">
          <span class="mini-id">${esc(o.orderId)}</span>
          <span class="mini-name">${esc(o.clientName || '')}</span>
          <span class="mini-stage">${esc(stageLabel(o.currentStage))}</span>
          <span class="mini-delay late">+${delayVal(o).toFixed(0)}h</span>
        </div>`).join('') : '<div class="empty-hint">Nothing urgent 🎉</div>';
    }

    // Recent open
    const recent = $('#recent-list');
    if (recent) {
      const rec = open.slice().sort((a, b) => String(b.entryTime).localeCompare(String(a.entryTime))).slice(0, 8);
      recent.innerHTML = rec.map(o => `
        <div class="mini-row" onclick="App.openDetail('${esc(o.orderId)}')">
          <span class="mini-id">${esc(o.orderId)}</span>
          <span class="mini-name">${esc(o.clientName || '')}</span>
          <span class="mini-stage">${esc(stageLabel(o.currentStage))}</span>
          <span class="mini-val">${money(o.orderValue)}</span>
        </div>`).join('');
    }
  }

  function barHtml(rows) {
    if (!rows || !rows.length) return '<div class="empty-hint">No data</div>';
    const max = Math.max(1, ...rows.map(r => r.v));
    return rows.map(r => `
      <div class="bar-row"><span>${esc(r.l)}</span>
      <div class="bar-track"><div class="bar-fill ${r.c || ''}" style="width:${(r.v / max) * 100}%"></div></div>
      <span>${r.v}</span></div>`).join('');
  }

  /* ── My Work ─────────────────────────────────────────────────────────── */

  function renderMyWork() {
    const list = filteredOrders('mine');
    const el = $('#mywork-list');
    if (!el) return;
    if (!list.length) {
      el.innerHTML = '<div class="empty-hint">No pending work assigned to you right now.</div>';
      return;
    }
    el.innerHTML = list.map(o => workCard(o)).join('');
  }

  function workCard(o) {
    const late = delayVal(o) > 0;
    return `
      <div class="work-card ${late ? 'late' : ''}" onclick="App.openDetail('${esc(o.orderId)}')">
        <div class="wc-top">
          <span class="wc-id">${esc(o.orderId)}</span>
          <span class="wc-stage">${esc(stageLabel(o.currentStage))}</span>
        </div>
        <div class="wc-name">${esc(o.clientName || '—')}</div>
        <div class="wc-meta">
          <span>${money(o.orderValue)}</span>
          <span>${esc(o.city || '')}</span>
          ${late ? `<span class="late-badge">+${delayVal(o).toFixed(0)}h late</span>` : ''}
        </div>
      </div>`;
  }

  /* ── Kanban ──────────────────────────────────────────────────────────── */

  function renderKanban() {
    const filter = ($('#kanban-filter') && $('#kanban-filter').value) || 'open';
    const q = ($('#kanban-search') && $('#kanban-search').value) || '';
    let list = filteredOrders(filter === 'mine' ? 'mine' : filter, q);

    const board = $('#kanban-board');
    if (!board) return;

    board.innerHTML = KANBAN_STAGES.map(stage => {
      const colOrders = list.filter(o => String(o.currentStage || '').toUpperCase() === stage);
      return `
        <div class="kanban-col">
          <div class="kanban-col-head">
            <span>${esc(stageLabel(stage))}</span>
            <span class="count">${colOrders.length}</span>
          </div>
          <div class="kanban-cards">
            ${colOrders.map(o => `
              <div class="kanban-card ${delayVal(o) > 0 ? 'late' : ''}" onclick="App.openDetail('${esc(o.orderId)}')">
                <div class="kc-id">${esc(o.orderId)}</div>
                <div class="kc-name">${esc(o.clientName || '')}</div>
                <div class="kc-meta">${money(o.orderValue)} · ${esc(o.city || '')}</div>
                ${delayVal(o) > 0 ? `<div class="kc-late">+${delayVal(o).toFixed(0)}h</div>` : ''}
              </div>`).join('') || '<div class="empty-hint small">Empty</div>'}
          </div>
        </div>`;
    }).join('');
  }

  /* ── Due / Late ──────────────────────────────────────────────────────── */

  
  function renderRefund() {
    const q = ($('#refund-search') && $('#refund-search').value) || '';
    let list = (state.orders || []).filter(o => {
      const st = String(o.currentStage || '').toUpperCase();
      const ov = String(o.overallStatus || '').toLowerCase();
      return st === 'REFUND_PROCESS' || st === 'REFUNDED' || ov === 'refunded';
    });
    if (q) {
      const qq = q.toLowerCase();
      list = list.filter(o =>
        String(o.orderId || '').toLowerCase().includes(qq) ||
        String(o.clientName || '').toLowerCase().includes(qq) ||
        String(o.phone || '').includes(qq)
      );
    }
    list.sort((a, b) => String(b.entryTime || '').localeCompare(String(a.entryTime || '')));

    const el = $('#refund-list');
    if (!el) return;
    if (!list.length) {
      el.innerHTML = '<div class="empty-hint">No refund orders 🎉</div>';
      return;
    }
    el.innerHTML = list.map(o => {
      const st = String(o.currentStage || '').toUpperCase();
      const isDone = st === 'REFUNDED' || String(o.overallStatus || '').toLowerCase() === 'refunded';
      return `
        <div class="work-card ${isDone ? 'done' : ''}" onclick="App.openDetail('${esc(o.orderId)}')">
          <div class="wc-top">
            <span class="wc-id">${esc(o.orderId)}</span>
            <span class="wc-stage">${esc(stageLabel(o.currentStage))}</span>
          </div>
          <div class="wc-name">${esc(o.clientName || '')}</div>
          <div class="wc-meta">${money(o.orderValue)} · ${esc(o.city || '')} · ${esc(o.phone || '')}</div>
          <div class="wc-status">${isDone ? '✅ Refunded' : '⏳ Processing'}</div>
        </div>`;
    }).join('');
  }


  function renderDue() {
    const today = (window.Core && todayApprox()) || new Date().toISOString().slice(0, 10);
    const list = (state.orders || []).filter(o => {
      if (!isOpen(o)) return false;
      const due = String(o.nextActionDue || '').slice(0, 10);
      if (due && due <= today) return true;
      // fallback: show late orders even if nextActionDue is empty
      return delayVal(o) > 0;
    }).sort((a, b) => delayVal(b) - delayVal(a));

    const el = $('#due-list');
    if (!el) return;
    el.innerHTML = list.length ? list.map(workCard).join('') : '<div class="empty-hint">Nothing due today.</div>';
  }

  function todayApprox() {
    try {
      return new Date().toLocaleString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 10);
    } catch (e) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  function renderLate() {
    const list = filteredOrders('late').sort((a, b) => delayVal(b) - delayVal(a));
    const el = $('#late-list');
    if (!el) return;
    el.innerHTML = list.length ? list.map(workCard).join('') : '<div class="empty-hint">No late orders 🎉</div>';
  }

  /* ── All Orders (FMS table) ──────────────────────────────────────────── */

  function renderFmsSheet() {
    const filter = ($('#fms-filter') && $('#fms-filter').value) || 'open';
    const stage = ($('#fms-stage') && $('#fms-stage').value) || '';
    const q = ($('#fms-search') && $('#fms-search').value) || '';
    const list = filteredOrders(filter, q, stage);

    const summary = $('#fms-summary');
    if (summary) {
      summary.textContent = list.length + ' order' + (list.length === 1 ? '' : 's');
    }

    const body = $('#fms-body');
    if (!body) return;

    body.innerHTML = list.map(o => {
      const late = delayVal(o) > 0;
      return `<tr class="${late ? 'row-late' : ''}" onclick="App.openDetail('${esc(o.orderId)}')">
        <td class="sticky-col"><strong>${esc(o.orderId)}</strong></td>
        <td>${esc(o.clientName || '')}</td>
        <td>${money(o.orderValue)}</td>
        <td>${esc(o.city || '')}</td>
        <td><span class="stage-pill">${esc(stageLabel(o.currentStage))}</span></td>
        <td>${esc(o.stockStatus || '—')}</td>
        <td>${esc(o.vendorStatus || '—')}</td>
        <td>${esc(o.clientDecision || '—')}</td>
        <td>${esc(o.overallStatus || '')}</td>
        <td class="${late ? 'late' : ''}">${delayVal(o) > 0 ? '+' + delayVal(o).toFixed(0) + 'h' : '—'}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="10" class="empty-hint">No orders match</td></tr>';
  }

  /* ── Detail Drawer ───────────────────────────────────────────────────── */

  async function openDetail(orderId) {
    setLoading(true);
    try {
      const res = await rpc('getOrderDetail', [orderId], 45000);
      if (!res || !res.success) {
        toast((res && res.error) || 'Could not load order', 'error');
        return;
      }
      state.selected = res.order;
      renderDetail(res.order);
      $('#detail-overlay').style.display = 'block';
      $('#detail-panel').classList.add('open');
    } finally {
      setLoading(false);
    }
  }

  function closeDetail() {
    $('#detail-overlay').style.display = 'none';
    $('#detail-panel').classList.remove('open');
    state.selected = null;
  }

  function renderDetail(o) {
    if (!o) return;
    $('#d-title').textContent = o.orderId || 'Order';

    const info = $('#d-info');
    if (info) {
      info.innerHTML = `
        <div class="info-item"><label>Client</label><div>${esc(o.clientName || '—')}</div></div>
        <div class="info-item"><label>Phone</label><div>${esc(o.phone || '—')}</div></div>
        <div class="info-item"><label>City</label><div>${esc(o.city || '—')}</div></div>
        <div class="info-item"><label>Value</label><div>${money(o.orderValue)}</div></div>
        <div class="info-item"><label>Stage</label><div><strong>${esc(stageLabel(o.currentStage))}</strong></div></div>
        <div class="info-item"><label>Status</label><div>${esc(o.overallStatus || '—')}</div></div>
        <div class="info-item"><label>Stock</label><div>${esc(o.stockStatus || '—')}</div></div>
        <div class="info-item"><label>Vendor</label><div>${esc(o.vendorStatus || '—')}</div></div>
        <div class="info-item"><label>Client Decision</label><div>${esc(o.clientDecision || '—')}</div></div>
        <div class="info-item"><label>Delay</label><div class="${delayVal(o) > 0 ? 'late' : ''}">${delayVal(o) > 0 ? '+' + delayVal(o).toFixed(1) + ' hrs' : 'On time'}</div></div>
        <div class="info-item wide"><label>Address</label><div>${esc(o.address || '—')}</div></div>
        <div class="info-item wide"><label>Notes</label><div>${esc(o.notes || '—')}</div></div>
      `;
    }

    // Admin edit
    const adminEdit = $('#d-admin-edit');
    if (adminEdit) {
      adminEdit.style.display = isAdmin() ? 'block' : 'none';
      if (isAdmin()) {
        if ($('#e-client')) $('#e-client').value = o.clientName || '';
        if ($('#e-phone')) $('#e-phone').value = o.phone || '';
        if ($('#e-city')) $('#e-city').value = o.city || '';
        if ($('#e-value')) $('#e-value').value = o.orderValue || '';
        if ($('#e-notes')) $('#e-notes').value = o.notes || '';
        if ($('#e-status')) $('#e-status').value = o.overallStatus || '';
      }
    }

    // Items
    const itemsEl = $('#d-items');
    if (itemsEl) {
      const items = o.items || [];
      itemsEl.innerHTML = items.length ? items.map(it => `
        <div class="item-row">
          <span>${esc(it.productName || it.product || '')}</span>
          <span>×${esc(it.qty || 1)}</span>
          <span>${money(it.value)}</span>
        </div>`).join('') : '<div class="empty-hint">No items</div>';
    }

    // Decision / Action area (core of new flow)
    renderActions(o);

    // Events timeline
    renderEvents(o);

    // Courier
    if ($('#d-courier')) $('#d-courier').value = o.courier || '';
    if ($('#d-awb')) $('#d-awb').value = o.awb || '';
    if ($('#d-auto')) $('#d-auto').value = (String(o.courierAutoUpdate || '').toLowerCase() === 'yes') ? 'Yes' : 'No';
  }

  function renderActions(o) {
    const box = $('#d-boxes');
    if (!box) return;

    const stage = String(o.currentStage || '').toUpperCase();
    const canAct = canDoStage(stage) && isOpen(o) && !isTerminal(stage);

    let html = `<div class="action-current">Current: <strong>${esc(stageLabel(stage))}</strong></div>`;

    if (!canAct) {
      if (isTerminal(stage)) {
        html += `<div class="empty-hint">Order is ${esc(stageLabel(stage))} — no further actions.</div>`;
      } else {
        html += `<div class="empty-hint">You are not assigned to act on this stage.</div>`;
      }
      box.innerHTML = html;
      return;
    }

    // Decision buttons based on current stage
    html += '<div class="action-buttons">';

    if (stage === 'STOCK_CHECK') {
      html += `
        <button class="btn primary" onclick="App.doDecision('READY_PACKING','Available')">✓ Stock Available</button>
        <button class="btn warn" onclick="App.doDecision('VENDOR_CONTACT','Not Available')">✗ Not Available → Vendor</button>`;
    }
    else if (stage === 'VENDOR_CONTACT') {
      html += `
        <button class="btn primary" onclick="App.doDecision('VENDOR_ARRANGE','Within_1_Week')">Within 1 week</button>
        <button class="btn warn" onclick="App.doDecision('CLIENT_DECISION','More_Than_1_Week')">More than 1 week</button>
        <button class="btn danger" onclick="App.doDecision('CLIENT_DECISION','Unavailable')">Unavailable</button>`;
    }
    else if (stage === 'VENDOR_ARRANGE') {
      html += `
        <button class="btn primary" onclick="App.doDecision('READY_PACKING','Arranged')">Product Arranged → Packing</button>
        <button class="btn" onclick="App.doDecision('VENDOR_FOLLOWUP','')">Move to Follow-up</button>`;
    }
    else if (stage === 'VENDOR_FOLLOWUP') {
      html += `
        <button class="btn primary" onclick="App.doDecision('READY_PACKING','Received')">✓ Product Received</button>
        <button class="btn" onclick="App.doDecision('VENDOR_FOLLOWUP','')">Log Follow-up (still waiting)</button>
        <button class="btn warn" onclick="App.doDecision('CLIENT_DECISION','')">Back to Client Decision</button>`;
    }
    else if (stage === 'CLIENT_DECISION') {
      html += `
        <button class="btn primary" onclick="App.doDecision('READY_PACKING','Similar_Product')">Similar Product Accepted</button>
        <button class="btn danger" onclick="App.doDecision('REFUND_PROCESS','Refund')">Request Refund</button>
        <button class="btn" onclick="App.doDecision('VENDOR_FOLLOWUP','Wait')">Client Will Wait</button>`;
    }
    else if (stage === 'READY_PACKING') {
      html += `<button class="btn primary" onclick="App.doDecision('PACKING','')">Start Packing</button>`;
    }
    else if (stage === 'PACKING') {
      html += `<button class="btn primary" onclick="App.doDecision('DISPATCH','')">Packed → Dispatch</button>`;
    }
    else if (stage === 'DISPATCH') {
      html += `<button class="btn primary" onclick="App.doDecision('TRACKING_UPDATE','')">Dispatched → Update Tracking</button>`;
    }
    else if (stage === 'TRACKING_UPDATE') {
      html += `<button class="btn primary" onclick="App.doDecision('DISPATCHED','')">Mark Completed</button>`;
    }
    else if (stage === 'REFUND_PROCESS') {
      html += `<button class="btn danger" onclick="App.doDecision('REFUNDED','Processed')">Refund Done</button>`;
    }
    else if (stage === 'DELAYED') {
      html += `<button class="btn" onclick="App.doDecision('CLIENT_DECISION','')">Contact Client</button>`;
    }

    html += '</div>';

    // Notes input for the action
    html += `
      <div class="action-notes">
        <input id="action-notes" type="text" placeholder="Optional notes for this action…" />
        <input id="action-related" type="text" placeholder="Related info (vendor name / similar product / amount)…" />
      </div>`;

    box.innerHTML = html;
  }

  function renderEvents(o) {
    // We put timeline under d-boxes or a dedicated area if present
    let timeline = $('#d-timeline');
    if (!timeline) {
      // create if missing
      const parent = $('#detail-panel .drawer-body');
      if (parent) {
        const h = document.createElement('h3');
        h.textContent = 'History';
        timeline = document.createElement('div');
        timeline.id = 'd-timeline';
        timeline.className = 'timeline';
        parent.appendChild(h);
        parent.appendChild(timeline);
      }
    }
    if (!timeline) return;

    const events = o.events || [];
    if (!events.length) {
      timeline.innerHTML = '<div class="empty-hint">No events yet</div>';
      return;
    }
    timeline.innerHTML = events.map(ev => `
      <div class="tl-item">
        <div class="tl-time">${esc(shortDate(ev.eventTimestamp))}</div>
        <div class="tl-body">
          <strong>${esc(ev.fromStage || '—')} → ${esc(ev.toStage || '—')}</strong>
          ${ev.decisionOrOutcome ? `<span class="tl-decision">${esc(ev.decisionOrOutcome)}</span>` : ''}
          <div class="tl-meta">${esc(ev.doneBy || '')} ${ev.notes ? '· ' + esc(ev.notes) : ''}</div>
        </div>
      </div>`).join('');
  }

  /* ── Actions ─────────────────────────────────────────────────────────── */

  async function doDecision(toStage, decisionOrOutcome) {
    const o = state.selected;
    if (!o) return;
    const notes = ($('#action-notes') && $('#action-notes').value) || '';
    const related = ($('#action-related') && $('#action-related').value) || '';

    const label = stageLabel(toStage) + (decisionOrOutcome ? ' (' + decisionOrOutcome + ')' : '');
    if (!confirm('Confirm: move to ' + label + '?')) return;

    setLoading(true);
    try {
      const res = await rpc('recordStageEvent', [
        o.orderId,
        toStage,
        decisionOrOutcome || '',
        notes,
        related
      ], 45000);

      if (!res || !res.success) {
        toast((res && res.error) || 'Action failed', 'error');
        return;
      }
      toast('Updated → ' + stageLabel(toStage), 'ok');
      await refresh(true);
      // reload detail
      await openDetail(o.orderId);
    } finally {
      setLoading(false);
    }
  }

  async function saveCourier() {
    const o = state.selected;
    if (!o) return;
    const courier = $('#d-courier') ? $('#d-courier').value : '';
    const awb = $('#d-awb') ? $('#d-awb').value : '';
    const auto = $('#d-auto') ? $('#d-auto').value : 'No';

    setLoading(true);
    try {
      const res = await rpc('updateCourier', [o.orderId, courier, awb, auto]);
      if (!res || !res.success) {
        toast((res && res.error) || 'Save failed', 'error');
        return;
      }
      toast('Courier saved', 'ok');
      await refresh(true);
      await openDetail(o.orderId);
    } finally {
      setLoading(false);
    }
  }

  async function saveOrderEdit() {
    if (!isAdmin() || !state.selected) return;
    const fields = {
      clientName: $('#e-client') ? $('#e-client').value : undefined,
      phone: $('#e-phone') ? $('#e-phone').value : undefined,
      city: $('#e-city') ? $('#e-city').value : undefined,
      orderValue: $('#e-value') ? $('#e-value').value : undefined,
      notes: $('#e-notes') ? $('#e-notes').value : undefined,
      overallStatus: $('#e-status') ? $('#e-status').value : undefined
    };
    setLoading(true);
    try {
      const res = await rpc('updateOrder', [state.selected.orderId, fields]);
      if (!res || !res.success) {
        toast((res && res.error) || 'Save failed', 'error');
        return;
      }
      toast('Order updated', 'ok');
      await refresh(true);
      await openDetail(state.selected.orderId);
    } finally {
      setLoading(false);
    }
  }

  function onCourierChange() { /* optional hook */ }

  /* ── Public API ──────────────────────────────────────────────────────── */

  window.App = {
    boot, doLogin, doLogout, refresh, setView,
    toggleSidebar, toggleCollapse, toggleTheme, globalSearch,
    openDetail, closeDetail, doDecision,
    saveCourier, saveOrderEdit, onCourierChange,
    renderKanban, renderFmsSheet, renderRefund
  };

  // Init
  document.addEventListener('DOMContentLoaded', function () {
    initTheme();
    boot();
  });
})();
