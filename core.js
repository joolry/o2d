// core.js — shared utilities for Joolry Order FMS
(function () {
  'use strict';

  const CFG = window.APP_CONFIG || {};

  // ── Session ────────────────────────────────────────────────────────────
  function getToken() {
    try {
      const raw = localStorage.getItem(CFG.SESSION_KEY || 'joolry_orderfms_session_v1');
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !obj.token || Date.now() > (obj.exp || 0)) {
        localStorage.removeItem(CFG.SESSION_KEY);
        return null;
      }
      return obj.token;
    } catch (e) { return null; }
  }

  function setSession(token, user) {
    const exp = Date.now() + (CFG.SESSION_HOURS || 12) * 3600 * 1000;
    localStorage.setItem(CFG.SESSION_KEY, JSON.stringify({ token, user, exp }));
  }

  function clearSession() {
    localStorage.removeItem(CFG.SESSION_KEY);
  }

  function getUser() {
    try {
      const raw = localStorage.getItem(CFG.SESSION_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return obj && obj.user ? obj.user : null;
    } catch (e) { return null; }
  }

  // ── RPC ────────────────────────────────────────────────────────────────
  async function rpc(fn, args, timeout) {
    const token = getToken();
    const ctl = new AbortController();
    const ms = timeout || CFG.DEFAULT_TIMEOUT || 45000;
    const t = setTimeout(() => ctl.abort(), ms);

    try {
      const base = (CFG.API_BASE || '').replace(/\/$/, '');
      const url = base + '/api/rpc';
      const r = await fetch(url, {
        method: 'POST',
        signal: ctl.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {})
        },
        body: JSON.stringify({ fn, args: args || [] })
      });
      if (!r.ok) {
        return { success: false, error: 'Server error ' + r.status + ' — try again' };
      }
      let data;
      try {
        data = await r.json();
      } catch (parseErr) {
        return { success: false, error: 'Invalid response from server' };
      }
      if (data && data.error === 'Session expired. Please login again.') {
        clearSession();
        location.reload();
      }
      return data;
    } catch (e) {
      if (e.name === 'AbortError') {
        return { success: false, error: 'Timeout — network slow, please retry' };
      }
      return { success: false, error: e.message || 'Network error — check internet' };
    } finally {
      clearTimeout(t);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────
  function fmtDate(s) {
    if (!s) return '—';
    return String(s).replace('T', ' ').slice(0, 19);
  }

  function money(n) {
    if (n === null || n === undefined || n === '') return '—';
    return '₹' + Number(n).toLocaleString('en-IN');
  }

  function toast(msg, type) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:12px 20px;border-radius:10px;color:#fff;font-size:14px;z-index:9999;max-width:90%;text-align:center;opacity:0;transition:opacity .25s';
      document.body.appendChild(el);
    }
    el.style.background = type === 'error' ? '#c0392b' : (type === 'ok' ? '#27ae60' : '#2c3e50');
    el.textContent = msg;
    el.style.opacity = '1';
    setTimeout(() => { el.style.opacity = '0'; }, 2800);
  }

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

  window.Core = {
    getToken, setSession, clearSession, getUser,
    rpc, fmtDate, money, toast, $, $$
  };
})();
