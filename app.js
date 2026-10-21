// app.js — Joolry Order FMS main logic
(function () {
  'use strict';

  const { rpc, getToken, setSession, clearSession, getUser, fmtDate, money, toast, $, $$ } = window.Core;

  let state = {
    user: null,
    orders: [],
    filter: 'open',
    selected: null
  };

  // ── Boot ───────────────────────────────────────────────────────────────
  async function boot() {
    const token = getToken();
    if (!token) {
      showLogin();
      return;
    }
    state.user = getUser();
    showApp();
    await loadOrders();
  }

  // ── Login ──────────────────────────────────────────────────────────────
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
    if (!u || !p) return toast('Username aur password daalo', 'error');

    $('#login-btn').disabled = true;
    $('#login-btn').textContent = 'Logging in…';

    const res = await rpc('login', [u, p]);
    $('#login-btn').disabled = false;
    $('#login-btn').textContent = 'Login';

    if (!res || !res.success) {
      toast(res?.error || 'Login failed', 'error');
      return;
    }
    setSession(res.token, res.user);
    state.user = res.user;
    showApp();
    await loadOrders();
  }

  function doLogout() {
    clearSession();
    state = { user: null, orders: [], filter: 'open', selected: null };
    showLogin();
  }

  // ── Orders ─────────────────────────────────────────────────────────────
  async function loadOrders() {
    const list = $('#orders-list');
    list.innerHTML = '<div class="loading">Loading orders…</div>';

    const res = await rpc('getOrders', [state.filter]);
    if (!res || !res.success) {
      list.innerHTML = '<div class="empty">Error: ' + (res?.error || 'Failed') + '</div>';
      return;
    }
    state.orders = res.orders || [];
    renderOrders();
  }

  function renderOrders() {
    const list = $('#orders-list');
    if (!state.orders.length) {
      list.innerHTML = '<div class="empty">No orders found</div>';
      return;
    }

    list.innerHTML = state.orders.map(o => {
      const delay = getWorstDelay(o);
      const delayClass = delay > 0 ? 'late' : (delay < 0 ? 'early' : '');
      return `
        <div class="order-card" data-id="${esc(o.orderId)}" onclick="App.openOrder('${esc(o.orderId)}')">
          <div class="oc-top">
            <span class="oc-id">${esc(o.orderId)}</span>
            <span class="oc-shopify">${esc(o.shopifyNo || '')}</span>
          </div>
          <div class="oc-client">${esc(o.clientName || '—')}</div>
          <div class="oc-meta">
            <span>${money(o.orderValue)}</span>
            <span>${esc(o.city || '')}</span>
            <span class="badge ${delayClass}">${esc(o.currentBox || o.overallStatus || '—')}</span>
          </div>
        </div>`;
    }).join('');
  }

  function getWorstDelay(o) {
    let worst = 0;
    [o.box2, o.box3, o.box4, o.box5].forEach(b => {
      if (b && b.delay !== '' && b.delay !== null && b.delay !== undefined) {
        const d = parseFloat(b.delay);
        if (!isNaN(d) && d > worst) worst = d;
      }
    });
    return worst;
  }

  // ── Order Detail ───────────────────────────────────────────────────────
  async function openOrder(orderId) {
    const res = await rpc('getOrderDetail', [orderId]);
    if (!res || !res.success) {
      toast(res?.error || 'Could not load order', 'error');
      return;
    }
    state.selected = res.order;
    renderDetail(res.order);
    $('#detail-panel').classList.add('open');
  }

  function closeDetail() {
    $('#detail-panel').classList.remove('open');
    state.selected = null;
  }

  function renderDetail(o) {
    $('#d-title').textContent = o.orderId + '  ' + (o.shopifyNo || '');
    $('#d-client').textContent = o.clientName || '—';
    $('#d-phone').textContent = o.phone || '—';
    $('#d-address').textContent = o.address || '—';
    $('#d-value').textContent = money(o.orderValue);
    $('#d-payment').textContent = o.paymentMode || '—';
    $('#d-status').textContent = o.overallStatus || '—';
    $('#d-current').textContent = o.currentBox || '—';

    // Items
    const itemsEl = $('#d-items');
    if (o.items && o.items.length) {
      itemsEl.innerHTML = o.items.map(it =>
        `<div class="item-row"><span>${esc(it.product)}</span><span>×${it.qty}</span><span>${money(it.value)}</span></div>`
      ).join('');
    } else {
      itemsEl.innerHTML = '<div class="muted">No items</div>';
    }

    // Boxes
    const boxesEl = $('#d-boxes');
    const boxes = [
      { n: 2, label: 'Availability', data: o.box2 },
      { n: 3, label: 'Pack & Dispatch', data: o.box3 },
      { n: 4, label: 'Client Update', data: o.box4 },
      { n: 5, label: 'Shopify Fulfil', data: o.box5 }
    ];

    boxesEl.innerHTML = boxes.map(b => {
      const d = b.data || {};
      const status = (d.status || '').toLowerCase();
      const isDone = status === 'done';
      const delay = d.delay !== '' && d.delay != null ? parseFloat(d.delay) : null;
      let delayTxt = '';
      if (delay != null && !isNaN(delay)) {
        delayTxt = delay > 0 ? `+${delay.toFixed(1)}h late` : (delay < 0 ? `${Math.abs(delay).toFixed(1)}h left` : 'on time');
      }
      return `
        <div class="box-row ${isDone ? 'done' : ''}">
          <div class="box-head">
            <strong>Box ${b.n}</strong> — ${b.label}
            <span class="box-status">${isDone ? 'Done' : (d.status || 'Open')}</span>
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

    // Courier section
    $('#d-courier').value = o.courier || '';
    $('#d-awb').value = o.awb || '';
    $('#d-auto').value = (o.courierAutoUpdate || '').toLowerCase() === 'yes' ? 'Yes' : 'No';
  }

  async function markDone(boxNo) {
    if (!state.selected) return;
    if (!confirm('Mark Box ' + boxNo + ' as Done?')) return;

    const res = await rpc('markBoxDone', [state.selected.orderId, boxNo, '']);
    if (!res || !res.success) {
      toast(res?.error || 'Failed', 'error');
      return;
    }
    toast('Box ' + boxNo + ' marked Done', 'ok');
    await openOrder(state.selected.orderId); // refresh detail
    await loadOrders(); // refresh list
  }

  async function saveCourier() {
    if (!state.selected) return;
    const courier = $('#d-courier').value.trim();
    const awb = $('#d-awb').value.trim();
    const auto = $('#d-auto').value;

    const res = await rpc('updateCourier', [state.selected.orderId, courier, awb, auto]);
    if (!res || !res.success) {
      toast(res?.error || 'Failed', 'error');
      return;
    }
    toast('Courier updated', 'ok');
  }

  // ── Filter ─────────────────────────────────────────────────────────────
  function setFilter(f) {
    state.filter = f;
    $$('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === f));
    loadOrders();
  }

  // ── Utils ──────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Public API ─────────────────────────────────────────────────────────
  window.App = {
    boot, doLogin, doLogout, loadOrders, openOrder, closeDetail,
    markDone, saveCourier, setFilter
  };

  // Auto-start
  document.addEventListener('DOMContentLoaded', boot);
})();
