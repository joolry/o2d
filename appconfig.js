// ════════════════════════════════════════════════════════════════════════════
// appconfig.js — Joolry Order FMS
// ─────────────────────────────────────────────────────────────────────────
// SIRF YAHAN CHANGE KARO — index.html / app.js mein kuch nahi
// ════════════════════════════════════════════════════════════════════════════

window.APP_CONFIG = {

  // ── API (Vercel) ────────────────────────────────────────────────────────
  // Browser ab seedha /api/rpc se baat karta hai (GAS_URL yahan use nahi hota)
  API_BASE: '',   // empty = same origin (Vercel). Agar alag domain ho to full URL daalo

  // ── App Info ────────────────────────────────────────────────────────────
  APP_NAME:    'Joolry Order FMS',
  APP_VERSION: '1.0',
  APP_COMPANY: 'Joolry',

  // ── Session ─────────────────────────────────────────────────────────────
  SESSION_KEY:     'joolry_orderfms_session_v1',
  SESSION_HOURS:   12,

  // ── API Timeouts ────────────────────────────────────────────────────────
  DEFAULT_TIMEOUT: 30000,
  LONG_TIMEOUT:    60000,

  // ── Polling ─────────────────────────────────────────────────────────────
  POLL_INTERVAL:   45000,   // 45s for open orders refresh

};

window.GAS_URL = ''; // not used — all traffic goes through /api/rpc
