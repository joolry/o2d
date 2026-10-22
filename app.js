// JOOLRY Order FMS — full UI
(function () {
  'use strict';
  const { rpc, getToken, setSession, clearSession, getUser, fmtDate, money, toast, $, $$ } = window.Core;

  let state = {
    user: null,
    orders: [],
    view: 'dashboard',
    selected: null
  };

  const BOX_COLS = [
    { key: 'box2', n: 2, label: 'Availability' },
    { key: 'box3', n: 3, label: 'Pack & Dispatch' },
    { key: 'box4', n: 4, label: 'Client Update' },
    { key: 'box5', n: 5, label: 'Shopify Fulfil' },
    { key: 'done', n: 0, label: 'Done / Closed' }
  ];

  async function boot() {
    if (!getToken()) { showLogin(); return; }
    state.user = getUser();
    showApp();
    await loadOrders();
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
    await loadOrders();
  }

  function doLogout() {
    clearSession();
    state = { user: null, orders: [], view: 'dashboard', selected: null };
    showLogin();
  }

  async function loadOrders() {
    const res = await rpc('getOrders', ['all']);
    if (!res || !res.success) {
      toast((res && res.error) || 'Failed to load orders', 'error');
      return;
    }
    state.orders = res.orders || [];
    renderAll();
  }

  function renderAll() {
    renderDashboard();
    renderKanban();
    renderTable();
  }

  function setView(v) {
    state.view = v;
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
    ['dashboard', 'kanban', 'table'].forEach(id => {
      const el = $('#view-' + id);
      if (el) el.style.display = id === v ? 'block' : 'none';
    });
  }

  // ── Stats helpers ──────────────────────────────────────────────────────
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
    // infer from blank actuals
    if (!o.box2 || !o.box2.actual) return 'box2';
    if (!o.box3 || !o.box3.actual) return 'box3';
    if (!o.box4 || !o.box4.actual) return 'box4';
    if (!o.box5 || !o.box5.actual) return 'box5';
    return 'done';
  }

  function renderDashboard() {
    const open = state.orders.filter(isOpen);
    const late = open.filter(o => worstDelay(o) > 0);
    const value = open.reduce((s, o) => s + (parseFloat(o.orderValue) || 0), 0);

    $('#stats-row').innerHTML = `
      <div class="stat-card"><div class="label">Open orders</div><div class="value">${open.length}</div></div>
      <div class="stat-card late"><div class="label">Late</div><div class="value">${late.length}</div></div>
      <div class="stat-card gold"><div class="label">Open value</div><div class="value" style="font-size:22px">${money(value)}</div></div>
      <div class="stat-card ok"><div class="label">Total orders</div><div class="value">${state.orders.length}</div></div>
    `;

    const counts = { box2: 0, box3: 0, box4: 0, box5: 0, done: 0 };
    state.orders.forEach(o => { counts[currentStage(o)] = (counts[currentStage(o)] || 0) + 1; });
    const maxC = Math.max(1, ...Object.values(counts));
    const stageLabels = { box2: 'Availability', box3: 'Pack/Dispatch', box4: 'Client update', box5: 'Shopify', done: 'Done' };
    const colors = { box2: '', box3: 'gold', box4: 'rose', box5: 'ok', done: 'ok' };
    $('#chart-stages').innerHTML = Object.keys(stageLabels).map(k => `
      <div class="bar-row">
        <span>${stageLabels[k]}</span>
        <div class="bar-track"><div class="bar-fill ${colors[k]}" style="width:${(counts[k] / maxC) * 100}%"></div></div>
        <span>${counts[k]}</span>
      </div>
    `).join('');

    const delayBuckets = { ontime: 0, mild: 0, high: 0 };
    open.forEach(o => {
      const d = worstDelay(o);
      if (d <= 0) delayBuckets.ontime++;
      else if (d < 9) delayBuckets.mild++;
      else delayBuckets.high++;
    });
    const maxD = Math.max(1, delayBuckets.ontime, delayBuckets.mild, delayBuckets.high);
    $('#chart-delay').innerHTML = `
      <div class="bar-row"><span>On time</span><div class="bar-track"><div class="bar-fill ok" style="width:${(delayBuckets.ontime/maxD)*100}%"></div></div><span>${delayBuckets.ontime}</span></div>
      <div class="bar-row"><span>&lt; 1 day late</span><div class="bar-track"><div class="bar-fill gold" style="width:${(delayBuckets.mild/maxD)*100}%"></div></div><span>${delayBuckets.mild}</span></div>
      <div class="bar-row"><span>≥ 1 day late</span><div class="bar-track"><div class="bar-fill late" style="width:${(delayBuckets.high/maxD)*100}%"></div></div><span>${delayBuckets.high}</span></div>
    `;

    const attn = open.filter(o => worstDelay(o) > 0)
      .sort((a, b) => worstDelay(b) - worstDelay(a))
      .slice(0, 8);
    $('#attention-list').innerHTML = attn.length
      ? attn.map(o => `
        <div class="mini-item" onclick="App.openOrder('${esc(o.orderId)}')">
          <span><strong>${esc(o.orderId)}</strong> · ${esc(o.clientName || '')}</span>
          <span class="badge late">+${worstDelay(o).toFixed(1)}h</span>
        </div>`).join('')
      : '<div class="empty">No delayed orders 🎉</div>';
  }

  function renderKanban() {
    const q = (($('#kanban-search') && $('#kanban-search').value) || '').toLowerCase();
    const filter = ($('#kanban-filter') && $('#kanban-filter').value) || 'open';
    let list = state.orders.slice();
    if (filter === 'open') list = list.filter(isOpen);
    if (q) {
      list = list.filter(o =>
        String(o.orderId).toLowerCase().indexOf(q) >= 0 ||
        String(o.clientName || '').toLowerCase().indexOf(q) >= 0 ||
        String(o.shopifyNo || '').toLowerCase().indexOf(q) >= 0
      );
    }
    const buckets = { box2: [], box3: [], box4: [], box5: [], done: [] };
    list.forEach(o => {
      const s = currentStage(o);
      (buckets[s] || buckets.done).push(o);
    });

    $('#kanban-board').innerHTML = BOX_COLS.map(col => {
      const cards = buckets[col.key] || [];
      return `
        <div class="kanban-col">
          <div class="kanban-col-head">
            <span>${col.label}</span>
            <span class="count">${cards.length}</span>
          </div>
          <div class="kanban-col-body">
            ${cards.map(o => {
              const d = worstDelay(o);
              return `
                <div class="k-card ${d > 0 ? 'late' : ''}" onclick="App.openOrder('${esc(o.orderId)}')">
                  <div class="k-id">${esc(o.orderId)} <span style="font-weight:400;color:var(--muted)">${esc(o.shopifyNo || '')}</span></div>
                  <div class="k-client">${esc(o.clientName || '—')}</div>
                  <div class="k-meta">
                    <span>${money(o.orderValue)}</span>
                    <span>${d > 0 ? '+' + d.toFixed(1) + 'h' : (o.city || '')}</span>
                  </div>
                </div>`;
            }).join('') || '<div class="empty" style="padding:20px 8px">Empty</div>'}
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
    if (q) {
      list = list.filter(o =>
        String(o.orderId).toLowerCase().indexOf(q) >= 0 ||
        String(o.clientName || '').toLowerCase().indexOf(q) >= 0 ||
        String(o.shopifyNo || '').toLowerCase().indexOf(q) >= 0
      );
    }
    const stageLabels = { box2: 'Availability', box3: 'Pack/Dispatch', box4: 'Client update', box5: 'Shopify', done: 'Done' };
    $('#table-body').innerHTML = list.map(o => {
      const d = worstDelay(o);
      const st = currentStage(o);
      return `
        <tr onclick="App.openOrder('${esc(o.orderId)}')">
          <td><strong>${esc(o.orderId)}</strong><br><small style="color:var(--muted)">${esc(o.shopifyNo || '')}</small></td>
          <td>${esc(o.clientName || '—')}</td>
          <td>${money(o.orderValue)}</td>
          <td>${esc(o.city || '—')}</td>
          <td>${stageLabels[st] || st}</td>
          <td>${esc(o.overallStatus || '—')}</td>
          <td>${d > 0 ? '<span class="badge late">+' + d.toFixed(1) + 'h</span>' : '<span class="badge ok">OK</span>'}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="7" class="empty">No orders</td></tr>';
  }

  // ── Detail ─────────────────────────────────────────────────────────────
  async function openOrder(orderId) {
    const res = await rpc('getOrderDetail', [orderId]);
    if (!res || !res.success) {
      toast((res && res.error) || 'Could not load order', 'error');
      return;
    }
    state.selected = res.order;
    renderDetail(res.order);
    $('#detail-overlay').classList.add('open');
    $('#detail-panel').classList.add('open');
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
      return `
        <div class="box-row ${isDone ? 'done' : ''} ${delay > 0 ? 'late' : ''}">
          <div class="box-head">
            <span>Box ${b.n} — ${b.label}</span>
            <span style="font-weight:400;color:var(--muted)">${isDone ? 'Done' : (d.status || 'Open')}</span>
          </div>
          <div class="box-meta">
            <span>Planned: ${fmtDate(d.planned)}</span>
            <span>Actual: ${fmtDate(d.actual)}</span>
            <span>${d.doneBy ? 'By: ' + esc(d.doneBy) : ''}</span>
            <span class="${delay > 0 ? 'late' : ''}">${delayTxt}</span>
          </div>
          ${!isDone ? `<button class="btn-done" onclick="App.markDone(${b.n})">Mark Done</button>` : ''}
        </div>`;
    }).join('');

    $('#d-courier').value = o.courier || '';
    $('#d-awb').value = o.awb || '';
    $('#d-auto').value = String(o.courierAutoUpdate || '').toLowerCase() === 'yes' ? 'Yes' : 'No';
  }

  async function markDone(boxNo) {
    if (!state.selected) return;
    if (!confirm('Mark Box ' + boxNo + ' as Done?')) return;
    const res = await rpc('markBoxDone', [state.selected.orderId, boxNo, '']);
    if (!res || !res.success) {
      toast((res && res.error) || 'Failed', 'error');
      return;
    }
    toast('Box ' + boxNo + ' marked Done', 'ok');
    await openOrder(state.selected.orderId);
    await loadOrders();
  }

  async function saveCourier() {
    if (!state.selected) return;
    const res = await rpc('updateCourier', [
      state.selected.orderId,
      $('#d-courier').value.trim(),
      $('#d-awb').value.trim(),
      $('#d-auto').value
    ]);
    if (!res || !res.success) {
      toast((res && res.error) || 'Failed', 'error');
      return;
    }
    toast('Courier saved', 'ok');
  }

  async function forceSync() {
    toast('Syncing…');
    try {
      const secret = prompt('Enter SYNC_SECRET to force cache clear + rebuild:');
      if (!secret) return;
      const r = await fetch('/api/sync?secret=' + encodeURIComponent(secret) + '&full=1&force=1');
      const j = await r.json();
      if (j && j.success) {
        toast('Cache cleared · ' + (j.counts && j.counts.orders) + ' orders', 'ok');
        await loadOrders();
      } else {
        toast((j && j.error) || 'Sync failed', 'error');
      }
    } catch (e) {
      toast(e.message || 'Sync failed', 'error');
    }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // toast override with classes
  const _toast = toast;
  window.Core.toast = function (msg, type) {
    const el = $('#toast');
    if (!el) return _toast(msg, type);
    el.textContent = msg;
    el.className = 'toast show' + (type === 'error' ? ' error' : type === 'ok' ? ' ok' : '');
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = 'toast'; }, 2800);
  };

  window.App = {
    boot, doLogin, doLogout, loadOrders, setView,
    openOrder, closeDetail, markDone, saveCourier,
    renderKanban, renderTable, forceSync
  };

  document.addEventListener('DOMContentLoaded', boot);
})();
