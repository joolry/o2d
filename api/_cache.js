// api/_cache.js — Secondary per-fn cache (Order FMS)
const crypto = require('crypto');
let _db = null, _inc = null;
let defer = async (p) => { await p; };
try {
  const { waitUntil } = require('@vercel/functions');
  defer = async (p) => { try { waitUntil(p); } catch (e) { await p; } };
} catch (e) {}

function db() {
  if (_db) return _db;
  const { initializeApp, cert, getApps } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT || '';
  if (raw[0] !== '{') raw = Buffer.from(raw, 'base64').toString();
  const sa = JSON.parse(raw);
  if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  if (!getApps().length) initializeApp({ credential: cert(sa) });
  return (_db = getFirestore());
}
const inc = (n) => (_inc ? _inc(n) : require('firebase-admin/firestore').FieldValue.increment(n));

const STATIC = {
  getSteps: 600, getConfig: 600
};
const DYN = {
  getBootData: 60, getOrders: 30, getOrderDetail: 30, getSnapshot: 30
};

const STALE = {
  getBootData: 300, getOrders: 120, getSteps: 3600, getConfig: 3600
};
const istDay = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);

const enabled = () => process.env.SNAPSHOT === 'on';
const ttlOf = (fn) => STATIC[fn] || DYN[fn] || 0;
let verMem = { v: 0, t: 0 };

async function ver(force) {
  if (!force && Date.now() - verMem.t < 1500) return verMem.v;
  const d = await db().doc('_meta/orderfms_state').get();
  verMem = { v: (d.exists && d.data().ver) || 0, t: Date.now() };
  return verMem.v;
}

async function bump() {
  if (!enabled()) return;
  try {
    await db().doc('_meta/orderfms_state').set({ ver: inc(1), ts: Date.now() }, { merge: true });
    verMem.t = 0;
  } catch (e) {}
}

async function wrap(fn, args, email, loader, meta) {
  meta = meta || {};
  const ttl = ttlOf(fn);
  if (!enabled() || !ttl) { meta.cache = 'OFF'; return loader(); }
  let v0 = 0, ref;
  try {
    const key = crypto.createHash('sha1')
      .update(fn + '|' + istDay() + '|' + email + '|' + JSON.stringify(args)).digest('hex');
    ref = db().doc('_orderfms_snap/' + key);
    const both = await Promise.all([ver(), ref.get()]);
    v0 = both[0];
    const s = both[1];
    if (s.exists) {
      const d = s.data();
      if (Date.now() - d.ts < ttl * 1000 && (STATIC[fn] || d.ver === v0)) {
        meta.cache = 'HIT';
        return JSON.parse(d.json);
      }
      if (STALE[fn] && Date.now() - d.ts < STALE[fn] * 1000) {
        meta.cache = 'STALE';
        await defer((async () => {
          try {
            const o = await loader();
            if (o && o.success !== false) {
              const j = JSON.stringify(o);
              if (j.length < 900000) {
                await ref.set({
                  fn, ver: v0, ts: Date.now(), json: j,
                  exp: new Date(Date.now() + 36 * 3600e3)
                });
              }
            }
          } catch (e) {}
        })());
        return JSON.parse(d.json);
      }
    }
  } catch (e) {
    meta.cache = 'ERR';
    return loader();
  }
  meta.cache = 'MISS';
  const out = await loader();
  try {
    const json = JSON.stringify(out);
    if (ref && out && out.success !== false && json.length < 900000) {
      await defer(ref.set({
        fn, ver: v0, ts: Date.now(), json,
        exp: new Date(Date.now() + 36 * 3600e3)
      }));
    }
  } catch (e) {}
  return out;
}

module.exports = { wrap, bump, ver, enabled, _set: (d, i) => { _db = d; _inc = i; } };
