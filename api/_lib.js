// api/_lib.js — Order FMS: READ = Firestore snapshot | WRITE = GAS then rebuild
const crypto = require('crypto');
const cache = require('./_cache');
const store = require('./_store');
const { fromSnapshot } = require('./_snapServe');

const isRead = (fn) => /^(get|validate)/.test(fn);

const ALLOWED = new Set([
  'login', 'validateSession',
  'getBootData', 'getOrders', 'getOrderDetail',
  'getSteps', 'getConfig', 'getSnapshot',
  'markBoxDone', 'updateCourier',
  'syncFromShopify', 'clientForceSync'
]);

const SNAPSHOT_READS = new Set([
  'getBootData', 'getOrders', 'getOrderDetail',
  'getSteps', 'getConfig', 'getSnapshot'
]);

const b64 = (b) => Buffer.from(b).toString('base64url');

function sign(payload) {
  const body = b64(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}

function verify(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  const exp = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(exp);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p && p.username && Date.now() < p.exp ? p : null;
  } catch (e) { return null; }
}

async function callGas(action, args, retry) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 55000);
  try {
    const r = await fetch(process.env.GAS_URL, {
      method: 'POST', redirect: 'follow', signal: ctl.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, args, secret: process.env.GAS_SECRET })
    });
    return await r.json();
  } catch (e) {
    if (retry !== false) return callGas(action, args, false);
    return {
      success: false,
      error: 'Server busy. Refresh karke dekh lo entry save hui ya nahi.'
    };
  } finally { clearTimeout(t); }
}

let waitUntil = (p) => { p.catch(() => {}); };
try { waitUntil = require('@vercel/functions').waitUntil || waitUntil; } catch (e) {}

const MAX_LOOPS = 3;
let _syncTimer = null;

async function acquireSync() {
  const ref = store.metaRef('sync');
  return store.db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const s = snap.exists ? snap.data() : {};
    const now = Date.now();
    const leaseAlive = s.syncing && (now - (s.syncStartedAt || 0) < store.LEASE_MS);
    if (leaseAlive) {
      tx.set(ref, { dirty: true }, { merge: true });
      return false;
    }
    tx.set(ref, { syncing: true, syncStartedAt: now, dirty: false, lastError: '' }, { merge: true });
    return true;
  });
}

async function releaseSync() {
  const ref = store.metaRef('sync');
  return store.db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const s = snap.exists ? snap.data() : {};
    if (s.dirty) {
      tx.set(ref, { dirty: false, syncStartedAt: Date.now() }, { merge: true });
      return true;
    }
    tx.set(ref, { syncing: false, lastSyncAt: Date.now(), lastError: '' }, { merge: true });
    return false;
  });
}

async function runSync() {
  let stage = 'acquire';
  let acquired = false;
  let loops = 0;
  try {
    if (!(await acquireSync())) return { ran: false, queued: true };
    acquired = true;
    for (;;) {
      loops++;
      stage = 'getSnapshot';
      const snap = await callGas('getSnapshot', [], false);
      stage = 'validate';
      if (!snap || snap.success === false) {
        throw new Error((snap && snap.error) || 'getSnapshot failed');
      }
      stage = 'save';
      await store.saveSnapshot(snap);
      stage = 'release';
      if (!(await releaseSync())) break;
      if (loops >= MAX_LOOPS) {
        await store.metaRef('sync').set({ syncing: false, dirty: true }, { merge: true });
        break;
      }
    }
    return { ran: true, loops };
  } catch (e) {
    e.stage = stage;
    if (acquired) {
      await store.metaRef('sync').set({
        syncing: false,
        lastError: stage + ': ' + String(e.message || e)
      }, { merge: true }).catch(() => {});
    }
    throw e;
  }
}

function scheduleSync() {
  if (_syncTimer) clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => {
    _syncTimer = null;
    runSync().catch((e) => console.error('bg sync', e.message));
  }, 3000);
  waitUntil(new Promise((r) => setTimeout(r, 3500)));
}

async function rebuildAfterWrite() {
  try {
    await store.metaRef('sync').set({
      syncing: true, syncStartedAt: Date.now(), dirty: false, lastError: ''
    }, { merge: true });
  } catch (e) {}
  try {
    const snap = await callGas('getSnapshot', [], false);
    if (!snap || snap.success === false) {
      throw new Error((snap && snap.error) || 'getSnapshot failed');
    }
    if (!(snap.orders || []).length && !(snap.users || []).length) {
      throw new Error('getSnapshot returned empty — keeping previous SNAP');
    }
    await store.saveSnapshot(snap);
    await store.metaRef('sync').set({
      syncing: false, dirty: false, lastSyncAt: Date.now(), lastError: ''
    }, { merge: true });
  } catch (e) {
    console.error('rebuildAfterWrite', e.message);
    try {
      await store.metaRef('sync').set({
        syncing: false, dirty: true, lastError: String(e.message || e)
      }, { merge: true });
    } catch (e2) {}
  }
}

async function handle(fn, args, token, meta) {
  meta = meta || {};
  args = args || [];

  if (!ALLOWED.has(fn)) {
    return { success: false, error: 'Unknown function' };
  }

  // login is special — no token required
  if (fn === 'login') {
    const out = await callGas('login', args, true);
    if (out && out.success && out.user) {
      // re-sign with our SESSION_SECRET so Vercel owns the session
      const payload = {
        username: out.user.username,
        name: out.user.name,
        role: out.user.role,
        exp: Date.now() + 12 * 3600 * 1000
      };
      out.token = sign(payload);
    }
    return out;
  }

  const user = verify(token);
  if (!user && fn !== 'clientForceSync') {
    return { success: false, error: 'Session expired. Please login again.' };
  }

  // Snapshot path for hot reads
  if (process.env.SNAPSHOT === 'on' && SNAPSHOT_READS.has(fn)) {
    try {
      const m = await store.getMeta();
      if (m) {
        const snap = await store.loadSnapshot(m);
        const filtered = fromSnapshot(snap, fn, args, user);
        if (filtered) {
          meta.cache = 'SNAP';
          meta.gasMs = 0;
          return filtered;
        }
      }
    } catch (e) {
      console.error('snap read', e.message);
    }
  }

  // Live GAS (or cache wrap)
  const t0 = Date.now();
  const loader = () => callGas(fn, args, true);
  let out;

  if (isRead(fn)) {
    out = await cache.wrap(fn, args, user ? user.username : '', loader, meta);
  } else {
    out = await loader();
    meta.cache = 'WRITE';
  }
  meta.gasMs = Date.now() - t0;

  // After successful write → rebuild snapshot in background
  if (!isRead(fn) && out && out.success !== false) {
    waitUntil(rebuildAfterWrite());
  }

  return out;
}

module.exports = { handle, ALLOWED, runSync, store };
