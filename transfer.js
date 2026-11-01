/* Progress transfer via URL hash (#import=...). Pure helpers, no server. */
(function (root) {
  'use strict';

  const K_PROG = 'rta-q-progress-v1';
  const K_TS = 'rta-q-progress-ts-v1';
  const K_KNOWN = 'rta-vocab-known-v1';
  const K_LEARN = 'rta-vocab-learning-v1';
  const CORE = [K_PROG, K_TS, K_KNOWN, K_LEARN];
  const PREFIX = 'rta-';

  function readJson(storage, key, fallback) {
    try {
      const raw = storage.getItem(key);
      if (raw == null) return fallback;
      const v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch (_) {
      return fallback;
    }
  }

  function allKeys(storage) {
    const out = [];
    try {
      for (let i = 0; i < storage.length; i++) out.push(storage.key(i));
    } catch (_) {}
    return out;
  }

  // ---- state <-> storage ----
  function readState(storage) {
    const prog = readJson(storage, K_PROG, {});
    const ts = readJson(storage, K_TS, {});
    const known = readJson(storage, K_KNOWN, []);
    const learning = readJson(storage, K_LEARN, []);
    const extra = {};
    allKeys(storage).forEach((k) => {
      if (k && k.indexOf(PREFIX) === 0 && CORE.indexOf(k) < 0) {
        const v = storage.getItem(k);
        if (v != null) extra[k] = v;
      }
    });
    return {
      prog: prog && typeof prog === 'object' && !Array.isArray(prog) ? prog : {},
      ts: ts && typeof ts === 'object' && !Array.isArray(ts) ? ts : {},
      known: Array.isArray(known) ? known.map(String) : [],
      learning: Array.isArray(learning) ? learning.map(String) : [],
      extra,
    };
  }

  function writeState(storage, st) {
    storage.setItem(K_PROG, JSON.stringify(st.prog));
    storage.setItem(K_TS, JSON.stringify(st.ts));
    storage.setItem(K_KNOWN, JSON.stringify(st.known));
    storage.setItem(K_LEARN, JSON.stringify(st.learning));
    Object.keys(st.extra || {}).forEach((k) => {
      if (k.indexOf(PREFIX) === 0 && CORE.indexOf(k) < 0) storage.setItem(k, st.extra[k]);
    });
  }

  // ---- compact payload ----
  function toPayload(st) {
    const c = [];
    const w = [];
    Object.keys(st.prog).forEach((id) => {
      if (st.prog[id] === 'correct') c.push(Number(id));
      else if (st.prog[id] === 'wrong') w.push(Number(id));
    });
    const tsIds = Object.keys(st.ts).filter((id) => st.prog[id] && Number(st.ts[id]) > 0);
    let base = 0;
    tsIds.forEach((id) => {
      const m = Math.floor(Number(st.ts[id]) / 60000);
      if (!base || m < base) base = m;
    });
    const t = {};
    tsIds.forEach((id) => {
      t[id] = (Math.floor(Number(st.ts[id]) / 60000) - base).toString(36);
    });
    const p = { v: 1, c, w };
    if (tsIds.length) {
      p.tb = base;
      p.t = t;
    }
    if (st.known.length) p.k = st.known;
    if (st.learning.length) p.l = st.learning;
    if (Object.keys(st.extra || {}).length) p.x = st.extra;
    return p;
  }

  function fromPayload(p) {
    if (!p || typeof p !== 'object' || p.v !== 1) throw new Error('bad payload');
    const prog = {};
    const ts = {};
    (Array.isArray(p.c) ? p.c : []).forEach((id) => {
      prog[String(id)] = 'correct';
    });
    (Array.isArray(p.w) ? p.w : []).forEach((id) => {
      prog[String(id)] = 'wrong';
    });
    if (p.t && typeof p.t === 'object') {
      const base = Number(p.tb) || 0;
      Object.keys(p.t).forEach((id) => {
        const m = parseInt(p.t[id], 36);
        if (!isNaN(m) && prog[id]) ts[id] = (base + m) * 60000;
      });
    }
    const extra = {};
    if (p.x && typeof p.x === 'object') {
      Object.keys(p.x).forEach((k) => {
        if (k.indexOf(PREFIX) === 0 && typeof p.x[k] === 'string') extra[k] = p.x[k];
      });
    }
    return {
      prog,
      ts,
      known: Array.isArray(p.k) ? p.k.map(String) : [],
      learning: Array.isArray(p.l) ? p.l.map(String) : [],
      extra,
    };
  }

  // ---- merge ----
  function mergeState(local, inc) {
    const prog = {};
    const ts = {};
    const ids = new Set(Object.keys(local.prog).concat(Object.keys(inc.prog)));
    ids.forEach((id) => {
      const a = local.prog[id];
      const b = inc.prog[id];
      const ta = Number(local.ts[id]) || 0;
      const tb = Number(inc.ts[id]) || 0;
      let pick;
      let pts;
      if (a && !b) { pick = a; pts = ta; }
      else if (b && !a) { pick = b; pts = tb; }
      else if (a === b) { pick = a; pts = Math.max(ta, tb); }
      else if (ta && tb && ta !== tb) {
        // both have timestamps: latest answer wins
        if (tb > ta) { pick = b; pts = tb; } else { pick = a; pts = ta; }
      } else {
        // no usable timestamps: correct wins
        pick = 'correct';
        pts = Math.max(ta, tb);
      }
      prog[id] = pick;
      if (pts) ts[id] = pts;
    });
    const known = new Set(local.known.concat(inc.known));
    const learning = new Set(local.learning.concat(inc.learning));
    known.forEach((t) => learning.delete(t)); // known wins
    const extra = Object.assign({}, inc.extra, local.extra); // local wins on conflicts
    return { prog, ts, known: [...known], learning: [...learning], extra };
  }

  // ---- base64url + compression ----
  function bytesToB64url(bytes) {
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlToBytes(s) {
    let b = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    const bin = atob(b);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function streamBytes(stream, bytes) {
    const writer = stream.writable.getWriter();
    writer.write(bytes).catch(() => {});
    writer.close().catch(() => {});
    const buf = await new Response(stream.readable).arrayBuffer();
    return new Uint8Array(buf);
  }

  async function pack(payload) {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    if (typeof CompressionStream !== 'undefined') {
      try {
        const z = await streamBytes(new CompressionStream('deflate-raw'), bytes);
        return 'z' + bytesToB64url(z);
      } catch (_) {}
    }
    return 'j' + bytesToB64url(bytes);
  }

  async function unpack(str) {
    const kind = str.charAt(0);
    const body = str.slice(1);
    let bytes = b64urlToBytes(body);
    if (kind === 'z') {
      if (typeof DecompressionStream === 'undefined') throw new Error('no DecompressionStream');
      bytes = await streamBytes(new DecompressionStream('deflate-raw'), bytes);
    } else if (kind !== 'j') {
      throw new Error('bad format');
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  async function buildLink(storage, base) {
    const st = readState(storage);
    const data = await pack(toPayload(st));
    return { url: base + '#import=' + data, state: st };
  }

  async function parseHash(hash) {
    const m = /^#?import=([A-Za-z0-9_-]+)$/.exec(hash || '');
    if (!m) return null;
    return fromPayload(await unpack(m[1]));
  }

  function replaceState(storage, st) {
    CORE.concat(allKeys(storage).filter((k) => k && k.indexOf(PREFIX) === 0)).forEach((k) => {
      try { storage.removeItem(k); } catch (_) {}
    });
    writeState(storage, st);
  }

  const api = {
    readState, writeState, toPayload, fromPayload, mergeState,
    pack, unpack, buildLink, parseHash, replaceState, CORE,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RTATransfer = api;
})(typeof window !== 'undefined' ? window : globalThis);
