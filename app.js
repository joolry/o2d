// JOOLRY Order FMS v2.1
(function () {
  'use strict';
  const C = window.Core;
  const rpc = C.rpc, getToken = C.getToken, setSession = C.setSession,
        clearSession = C.clearSession, getUser = C.getUser,
        fmtDate = C.fmtDate, money = C.money, $ = C.$, $$ = C.$$;

  let state = {
    user: null,
    orders: [],
    steps: [],
    allowedBoxes: [],
    view: 'dashboard',
    selected: null,
    loading: false
  };

  const BOX_COLS = [
    { key: 'box2', n: 2, label: 'Availability' },
    { key: 'box3', n: 3, label: 'Pack & Dispatch' },
    { key: 'box4', n: 4, label: 'Client Update' },
    { key: 'box5', n: 5, label: 'Shopify Fulfil' },
    { key: 'done', n: 0, label: 'Done / Closed' }
  ];

  function isAdmin() {
    return state.user && String(state.user.role || '').toLowerCase() === 'admin';
  }

  function canDoBox(n) {
    if (isAdmin()) return true;
    return state.allowedBoxes.indexOf(Number(n)) !== -1;
  }

  function setLoading(on) {
    state.loading = on;
    const el = $('#global-loading');
    const btn = $('#btn-refresh');
    if (el) el.style.display = on ? 'block' : 'none';
    if (btn) { btn.disabled = on; btn.textContent = on ? '…' : '↻ Refresh'; }
  }

  function toast(msg, type) {
    const el = $('#toast');
    if (!el) return;
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
    $('#app-screen').style.display = 'block';
    if (state.user) {
      $('#user-name').textContent = state.user.name || state.user.username;
      $('#user-role').textContent = state.user.role || '';
    }
    $$('.admin-only').forEach(el => { el.style.display = isAdmin() ? '' : 'none'; });
  }

  async function doLogin() {
    const u = $('#login-user').value.trim();
    const p = $('#login-pass').value;
    const err = $('#login-error');
    err.textContent = '';
    if (!u || !p) { err.textContent = 'Enter username & password'; return; }
    const btn = $('#login-btn');
    btn.disabled = true; btn.textContent = 'Signing in…';
    const res = await rpc('login', [u, p]);
    btn.disabled = false; btn.textContent = 'Sign in';
    if (!res || !res.success) {
      err.textContent = (res && res.error) || 'Login failed';
      return;
    }
    setSession(res.token, res.user);
    state.user = res.user;
    showApp();
    await refresh();
  }

  function doLogout() {
    clearSession();
    state = { user: null, orders: [], steps: [], allowedBoxes: [], view: 'dashboard', selected: null, loading: false };
    showLogin();
  }

  /** One-tap refresh — no secret prompt */
  async function refresh() {
    setLoading(true);
    try {
      const [ordRes, bootRes] = await Promise.all([
        rpc('getOrders', ['all']),
        rpc('getBootData', [])
      ]);
      if (ordRes && ordRes.success) state.orders = ordRes.orders || [];
      else toast((ordRes && ordRes.error) || 'Load failed', 'error');

      if (bootRes && bootRes.success) {
        state.steps = (bootRes.steps) || [];
        computeAllowed();
      } else {
        // fallback: getSteps
        const st = await rpc('getSteps', []);
        if (st && st.success) state.steps = st.steps || [];
        computeAllowed();
      }
      renderAll();
    } finally {
      setLoading(false);
    }
  }

  function computeAllowed() {
    if (isAdmin()) {
      state.allowedBoxes = [2, 3, 4, 5];
      return;
    }
    const uname = String(state.user && state.user.username || '').toLowerCase();
    const set = {};
    (state.steps || []).forEach(s => {
      const list = String(s.allowed || '').toLowerCase().split(',');
      list.forEach(x => {
        if (x.trim() === uname) set[parseInt(s.boxNo, 10)] = true;
      });
    });
    state.allowedBoxes = Object.keys(set).map(Number).filter(n => n >= 2 && n <= 5);
  }

  function renderAll() {
    renderDashboard();
    renderMyWork();
    renderKanban();
    renderTable();
    renderAnalytics();
    if (isAdmin()) renderAdmin();
  }

  function setView(v) {
    state.view = v;
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
    ['dashboard', 'mywork', 'kanban', 'table', 'analytics', 'admin'].forEach(id => {
      const el = $('#view-' + id);
      if (el) el.style.display = id === v ? 'block' : 'none';
    });
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
    if (!o.box4 || !o.box4.actual) return 'box4';
    if (!o.box5 || !o.box5.actual) return 'box5';
    return 'done';
  }
  function orderNeedsMyBox(o) {
    if (!isOpen(o)) return false;
    const st = currentStage(o);
    const n = { box2: 2, box3: 3, box4: 4, box5: 5 }[st];
    return n && canDoBox(n);
  }

  function barHtml(rows) {
    const max = Math.max(1, ...rows.map(r => r.v));
    return rows.map(r => `
      <div class="bar-row">
        <span>${esc(r.l)}</span>
        <div class="bar-track"><div class="bar-fill ${r.c || ''}" style="width:${(r.v / max) * 100}%"></div></div>
        <span>${r.v}${r.sfx || ''}</span>
      </div>`).join('');
  }

  function renderDashboard() {
    const open = state.orders.filter(isOpen);
    const late = open.filter(o => worstDelay(o) > 0);
    const value = open.reduce((s, o) => s + (parseFloat(o.orderValue) || 0), 0);
    const mine = open.filter(orderNeedsMyBox);

    $('#stats-row').innerHTML = `
      <div class="stat-card"><div class="label">Open</div><div class="value">${open.length}</div></div>
      <div class="stat-card late"><div class="label">Late</div><div class="value">${late.length}</div></div>
      <div class="stat-card gold"><div class="label">My work</div><div class="value">${mine.length}</div></div>
      <div class="stat-card ok"><div class="label">Open value</div><div class="value" style="font-size:20px">${money(value)}</div></div>
    `;

    const counts = { box2: 0, box3: 0, box4: 0, box5: 0, done: 0 };
    state.orders.forEach(o => { counts[currentStage(o)]++; });
    $('#chart-stages').innerHTML = barHtml([
      { l: 'Availability', v: counts.box2 },
      { l: 'Pack/Dispatch', v: counts.box3, c: 'gold' },
      { l: 'Client update', v: counts.box4, c: 'rose' },
      { l: 'Shopify', v: counts.box5, c: 'ok' },
      { l: 'Done', v: counts.done, c: 'ok' }
    ]);

    let ontime = 0, mild = 0, high = 0;
    open.forEach(o => {
      const d = worstDelay(o);
      if (d <= 0) ontime++; else if (d < 9) mild++; else high++;
    });
    $('#chart-delay').innerHTML = barHtml([
      { l: 'On time', v: ontime, c: 'ok' },
      { l: '< 1 day late', v: mild, c: 'gold' },
      { l: '≥ 1 day late', v: high, c: 'late' }
    ]);

    const pay = {};
    open.forEach(o => {
      const k = String(o.paymentMode || 'Unknown') || 'Unknown';
      pay[k] = (pay[k] || 0) + 1;
    });
    $('#chart-pay').innerHTML = barHtml(Object.keys(pay).map(k => ({ l: k, v: pay[k], c: 'gold' })));

    const city = {};
    open.forEach(o => {
      const k = String(o.city || '—').trim() || '—';
      city[k] = (city[k] || 0) + 1;
    });
    const topCity = Object.keys(city).map(k => ({ l: k, v: city[k] })).sort((a, b) => b.v - a.v).slice(0, 6);
    $('#chart-city').innerHTML = barHtml(topCity.map((x, i) => ({ ...x, c: i === 0 ? 'gold' : '' })));

    const attn = open.filter(o => worstDelay(o) > 0).sort((a, b) => worstDelay(b) - worstDelay(a)).slice(0, 10);
    $('#attention-list').innerHTML = attn.length
      ? attn.map(o => `
        <div class="mini-item" onclick="App.openOrder('${esc(o.orderId)}')">
          <span><strong>${esc(o.orderId)}</strong> · ${esc(o.clientName || '')}</span>
          <span class="badge late">+${worstDelay(o).toFixed(1)}h</span>
        </div>`).join('')
      : '<div class="empty">No delayed orders 🎉</div>';
  }

  function renderMyWork() {
    const list = state.orders.filter(orderNeedsMyBox);
    if (!list.length) {
      $('#mywork-list').innerHTML = '<div class="empty">No tasks assigned to you right now</div>';
      return;
    }
    const stageLabels = { box2: 'Availability', box3: 'Pack & Dispatch', box4: 'Client Update', box5: 'Shopify Fulfil' };
    $('#mywork-list').innerHTML = list.map(o => {
      const st = currentStage(o);
      const n = { box2: 2, box3: 3, box4: 4, box5: 5 }[st];
      const d = worstDelay(o);
      return `
        <div class="work-card ${d > 0 ? 'late' : ''}">
          <div class="work-main" onclick="App.openOrder('${esc(o.orderId)}')">
            <div class="k-id">${esc(o.orderId)} <span class="muted">${esc(o.shopifyNo || '')}</span></div>
            <div class="k-client">${esc(o.clientName || '—')} · ${money(o.orderValue)}</div>
            <div class="k-meta">${stageLabels[st] || st} ${d > 0 ? '· <span class="badge late">+' + d.toFixed(1) + 'h</span>' : ''}</div>
          </div>
          ${n && canDoBox(n) ? `<button class="btn-done" onclick="event.stopPropagation();App.quickDone('${esc(o.orderId)}',${n})">Mark Box ${n} Done</button>` : ''}
        </div>`;
    }).join('');
  }

  function renderKanban() {
    const q = (($('#kanban-search') && $('#kanban-search').value) || '').toLowerCase();
    const filter = ($('#kanban-filter') && $('#kanban-filter').value) || 'open';
    let list = state.orders.slice();
    if (filter === 'open') list = list.filter(isOpen);
    if (filter === 'mine') list = list.filter(orderNeedsMyBox);
    if (q) {
      list = list.filter(o =>
        String(o.orderId).toLowerCase().indexOf(q) >= 0 ||
        String(o.clientName || '').toLowerCase().indexOf(q) >= 0 ||
        String(o.shopifyNo || '').toLowerCase().indexOf(q) >= 0
      );
    }
    const buckets = { box2: [], box3: [], box4: [], box5: [], done: [] };
    list.forEach(o => { (buckets[currentStage(o)] || buckets.done).push(o); });

    $('#kanban-board').innerHTML = BOX_COLS.map(col => {
      const cards = buckets[col.key] || [];
      return `
        <div class="kanban-col">
          <div class="kanban-col-head"><span>${col.label}</span><span class="count">${cards.length}</span></div>
          <div class="kanban-col-body">
            ${cards.map(o => {
              const d = worstDelay(o);
              return `
                <div class="k-card ${d > 0 ? 'late' : ''}" onclick="App.openOrder('${esc(o.orderId)}')">
                  <div class="k-id">${esc(o.orderId)}</div>
                  <div class="k-client">${esc(o.clientName || '—')}</div>
                  <div class="k-meta"><span>${money(o.orderValue)}</span><span>${d > 0 ? '+' + d.toFixed(1) + 'h' : esc(o.city || '')}</span></div>
                </div>`;
            }).join('') || '<div class="empty" style="padding:16px 8px">Empty</div>'}
          </div>
        </div>`;
    }).join('');
  }

  function renderTable() {
    const q = (($('#table-search') && $('#table-search').value) || '').toLowerCase();
    const filter = ($('#table-filter') && $('#table-filter').value) || 'open';
    let list = state.orders.slice();
    if (filter === 'open') list = list.filter(isOpen);
    if (filter === 'late') list = list.filter(o => isOpen(o) && worstDelay(o) > 0);
    if (filter === 'mine') list = list.filter(orderNeedsMyBox);
    if (q) {
      list = list.filter(o =>
        String(o.orderId).toLowerCase().indexOf(q) >= 0 ||
        String(o.clientName || '').toLowerCase().indexOf(q) >= 0
      );
    }
    const stageLabels = { box2: 'Availability', box3: 'Pack/Dispatch', box4: 'Client update', box5: 'Shopify', done: 'Done' };
    $('#table-body').innerHTML = list.map(o => {
      const d = worstDelay(o);
      const st = currentStage(o);
      return `<tr onclick="App.openOrder('${esc(o.orderId)}')">
        <td><strong>${esc(o.orderId)}</strong><br><small class="muted">${esc(o.shopifyNo || '')}</small></td>
        <td>${esc(o.clientName || '—')}</td>
        <td>${money(o.orderValue)}</td>
        <td>${esc(o.city || '—')}</td>
        <td>${stageLabels[st] || st}</td>
        <td>${esc(o.overallStatus || '—')}</td>
        <td>${d > 0 ? '<span class="badge late">+' + d.toFixed(1) + 'h</span>' : '<span class="badge ok">OK</span>'}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="7" class="empty">No orders</td></tr>';
  }

  function renderAnalytics() {
    const open = state.orders.filter(isOpen);
    const closed = state.orders.filter(o => !isOpen(o));
    const totalVal = state.orders.reduce((s, o) => s + (parseFloat(o.orderValue) || 0), 0);
    $('#analytics-stats').innerHTML = `
      <div class="stat-card"><div class="label">Total orders</div><div class="value">${state.orders.length}</div></div>
      <div class="stat-card"><div class="label">Open</div><div class="value">${open.length}</div></div>
      <div class="stat-card ok"><div class="label">Closed</div><div class="value">${closed.length}</div></div>
      <div class="stat-card gold"><div class="label">Total value</div><div class="value" style="font-size:20px">${money(totalVal)}</div></div>
    `;
    const counts = { box2: 0, box3: 0, box4: 0, box5: 0, done: 0 };
    const vals = { box2: 0, box3: 0, box4: 0, box5: 0, done: 0 };
    state.orders.forEach(o => {
      const st = currentStage(o);
      counts[st]++;
      vals[st] += parseFloat(o.orderValue) || 0;
    });
    $('#an-pipeline').innerHTML = barHtml([
      { l: 'Availability', v: counts.box2 }, { l: 'Pack', v: counts.box3, c: 'gold' },
      { l: 'Client', v: counts.box4, c: 'rose' }, { l: 'Shopify', v: counts.box5, c: 'ok' },
      { l: 'Done', v: counts.done, c: 'ok' }
    ]);
    $('#an-value').innerHTML = barHtml([
      { l: 'Avail', v: Math.round(vals.box2), c: '', sfx: '' },
      { l: 'Pack', v: Math.round(vals.box3), c: 'gold' },
      { l: 'Client', v: Math.round(vals.box4), c: 'rose' },
      { l: 'Shopify', v: Math.round(vals.box5), c: 'ok' },
      { l: 'Done', v: Math.round(vals.done), c: 'ok' }
    ]);
    // boxes marked done in current data
    let b2 = 0, b3 = 0, b4 = 0, b5 = 0;
    state.orders.forEach(o => {
      if (o.box2 && String(o.box2.status).toLowerCase() === 'done') b2++;
      if (o.box3 && String(o.box3.status).toLowerCase() === 'done') b3++;
      if (o.box4 && String(o.box4.status).toLowerCase() === 'done') b4++;
      if (o.box5 && String(o.box5.status).toLowerCase() === 'done') b5++;
    });
    $('#an-done').innerHTML = barHtml([
      { l: 'Box 2 done', v: b2 }, { l: 'Box 3 done', v: b3, c: 'gold' },
      { l: 'Box 4 done', v: b4, c: 'rose' }, { l: 'Box 5 done', v: b5, c: 'ok' }
    ]);
  }

  function renderAdmin() {
    // users from last boot if any — show from orders doneBy unique as fallback
    const names = {};
    state.orders.forEach(o => {
      [o.box2, o.box3, o.box4, o.box5].forEach(b => {
        if (b && b.doneBy) names[b.doneBy] = true;
      });
    });
    $('#admin-users').innerHTML = `
      <div class="mini-item"><span>Logged in as <strong>${esc(state.user.username)}</strong> (${esc(state.user.role)})</span></div>
      <div class="mini-item"><span>Allowed boxes: Admin = all (2–5)</span></div>
      <div class="view-hint">Users tab in sheet is source of truth for login & roles.</div>
    `;
    const open = state.orders.filter(isOpen);
    $('#admin-orders').innerHTML = open.slice(0, 30).map(o => `
      <div class="mini-item" onclick="App.openOrder('${esc(o.orderId)}')">
        <span><strong>${esc(o.orderId)}</strong> · ${esc(o.clientName || '')} · ${money(o.orderValue)}</span>
        <span class="badge">${esc(o.overallStatus || 'Open')}</span>
      </div>
    `).join('') || '<div class="empty">No open orders</div>';
  }

  async function openOrder(orderId) {
    setLoading(true);
    try {
      const res = await rpc('getOrderDetail', [orderId]);
      if (!res || !res.success) {
        toast((res && res.error) || 'Could not load', 'error');
        return;
      }
      state.selected = res.order;
      renderDetail(res.order);
      $('#detail-overlay').classList.add('open');
      $('#detail-panel').classList.add('open');
    } finally {
      setLoading(false);
    }
  }

  function closeDetail() {
    $('#detail-overlay').classList.remove('open');
    $('#detail-panel').classList.remove('open');
    state.selected = null;
  }

  function renderDetail(o) {
    $('#d-title').textContent = o.orderId + '  ' + (o.shopifyNo || '');
    $('#d-info').innerHTML = `
      <div><label>Client</label><div>${esc(o.clientName || '—')}</div></div>
      <div><label>Phone</label><div>${esc(o.phone || '—')}</div></div>
      <div class="full"><label>Address</label><div>${esc(o.address || '—')}</div></div>
      <div><label>Value</label><div>${money(o.orderValue)}</div></div>
      <div><label>Payment</label><div>${esc(o.paymentMode || '—')}</div></div>
      <div><label>Status</label><div>${esc(o.overallStatus || '—')}</div></div>
      <div><label>Current</label><div>${esc(o.currentBox || '—')}</div></div>
    `;

    const adminEdit = $('#d-admin-edit');
    if (isAdmin()) {
      adminEdit.style.display = 'block';
      $('#e-client').value = o.clientName || '';
      $('#e-phone').value = o.phone || '';
      $('#e-city').value = o.city || '';
      $('#e-value').value = o.orderValue || '';
      $('#e-notes').value = o.notes || '';
      $('#e-status').value = o.overallStatus || '';
    } else {
      adminEdit.style.display = 'none';
    }

    const items = o.items || [];
    $('#d-items').innerHTML = items.length
      ? items.map(it => `<div class="item-row"><span>${esc(it.product)}</span><span>×${it.qty}</span><span>${money(it.value)}</span></div>`).join('')
      : '<div class="empty">No items</div>';

    const boxes = [
      { n: 2, label: 'Availability', data: o.box2 },
      { n: 3, label: 'Pack & Dispatch', data: o.box3 },
      { n: 4, label: 'Client Update', data: o.box4 },
      { n: 5, label: 'Shopify Fulfil', data: o.box5 }
    ];
    $('#d-boxes').innerHTML = boxes.map(b => {
      const d = b.data || {};
      const isDone = String(d.status || '').toLowerCase() === 'done';
      const delay = d.delay !== '' && d.delay != null ? parseFloat(d.delay) : null;
      let delayTxt = '';
      if (delay != null && !isNaN(delay)) {
        delayTxt = delay > 0 ? `+${delay.toFixed(1)}h late` : (delay < 0 ? `${Math.abs(delay).toFixed(1)}h left` : 'on time');
      }
      const can = canDoBox(b.n);
      return `
        <div class="box-row ${isDone ? 'done' : ''} ${delay > 0 ? 'late' : ''}">
          <div class="box-head">
            <span>Box ${b.n} — ${b.label}</span>
            <span class="muted">${isDone ? 'Done' : (d.status || 'Open')}</span>
          </div>
          <div class="box-meta">
            <span>Planned: ${fmtDate(d.planned)}</span>
            <span>Actual: ${fmtDate(d.actual)}</span>
            <span>${d.doneBy ? 'By: ' + esc(d.doneBy) : ''}</span>
            <span class="${delay > 0 ? 'late' : ''}">${delayTxt}</span>
          </div>
          ${!isDone && can ? `<button class="btn-done" onclick="App.markDone(${b.n})">Mark Done</button>` : ''}
          ${!isDone && !can ? `<div class="muted" style="font-size:11px;margin-top:6px">No access to complete this box</div>` : ''}
        </div>`;
    }).join('');

    // courier: admin or anyone on box 3/4 style — allow if admin or has any box access
    const canCourier = isAdmin() || state.allowedBoxes.length > 0;
    $('#d-courier').value = o.courier || '';
    $('#d-awb').value = o.awb || '';
    $('#d-auto').value = String(o.courierAutoUpdate || '').toLowerCase() === 'yes' ? 'Yes' : 'No';
    $('#d-courier').disabled = !canCourier;
    $('#d-awb').disabled = !canCourier;
    $('#d-auto').disabled = !canCourier;
    $('#btn-save-courier').style.display = canCourier ? '' : 'none';
  }

  async function markDone(boxNo) {
    if (!state.selected) return;
    if (!canDoBox(boxNo)) { toast('No access for Box ' + boxNo, 'error'); return; }
    if (!confirm('Mark Box ' + boxNo + ' as Done?')) return;
    setLoading(true);
    try {
      const res = await rpc('markBoxDone', [state.selected.orderId, boxNo, '']);
      if (!res || !res.success) { toast((res && res.error) || 'Failed', 'error'); return; }
      toast('Box ' + boxNo + ' done', 'ok');
      await openOrder(state.selected.orderId);
      await refresh();
    } finally { setLoading(false); }
  }

  async function quickDone(orderId, boxNo) {
    if (!canDoBox(boxNo)) { toast('No access', 'error'); return; }
    if (!confirm('Mark Box ' + boxNo + ' Done for ' + orderId + '?')) return;
    setLoading(true);
    try {
      const res = await rpc('markBoxDone', [orderId, boxNo, '']);
      if (!res || !res.success) { toast((res && res.error) || 'Failed', 'error'); return; }
      toast('Done', 'ok');
      await refresh();
    } finally { setLoading(false); }
  }

  async function saveCourier() {
    if (!state.selected) return;
    setLoading(true);
    try {
      const res = await rpc('updateCourier', [
        state.selected.orderId,
        $('#d-courier').value.trim(),
        $('#d-awb').value.trim(),
        $('#d-auto').value
      ]);
      if (!res || !res.success) { toast((res && res.error) || 'Failed', 'error'); return; }
      toast('Courier saved', 'ok');
    } finally { setLoading(false); }
  }

  async function saveOrderEdit() {
    if (!state.selected || !isAdmin()) return;
    setLoading(true);
    try {
      const res = await rpc('updateOrder', [
        state.selected.orderId,
        {
          clientName: $('#e-client').value.trim(),
          phone: $('#e-phone').value.trim(),
          city: $('#e-city').value.trim(),
          orderValue: $('#e-value').value,
          notes: $('#e-notes').value.trim(),
          overallStatus: $('#e-status').value
        }
      ]);
      if (!res || !res.success) { toast((res && res.error) || 'Failed — deploy latest Code.gs', 'error'); return; }
      toast('Order updated', 'ok');
      await openOrder(state.selected.orderId);
      await refresh();
    } finally { setLoading(false); }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  window.App = {
    boot, doLogin, doLogout, refresh, setView,
    openOrder, closeDetail, markDone, quickDone, saveCourier, saveOrderEdit,
    renderKanban, renderTable
  };

  document.addEventListener('DOMContentLoaded', boot);
})();
