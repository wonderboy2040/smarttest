// ============================================================
// server/bots/layaAutoLink.js — v21.9.0 LAYA AUTO-LINK RESCUE
// ------------------------------------------------------------
// THE INCIDENT: user ka laya-serve BACKGROUND me chal raha tha, phir
// bhi Bot Lab har tick pe `arm_fallback · no_laya_instance` daal raha
// tha aur Superintelligence Signal Board ka AI-confirm layer silent
// no-op tha. ROOT CAUSE: provider availability ek PURE-CONFIG check
// hai — `LAYA_ENABLED === '1'` + `LAYA_API_KEY` non-empty, BOOT pe
// process.env se, aur Bot Lab ka registry ek frozen singleton hai.
// `.env.example` LAYA_API_KEY= KHALI ship karta hai — user ne .env
// banaya, key khali rahi (ya .env hi nahi bana) → provider kabhi
// nahi bana → "Laya running hai par site ko dikhta hi nahi".
//
// YE LAYER kya karta hai (background self-heal, ~30s cadence):
//   1. ENV-CONFIGURED hai (key set) → kuch nahi (purana flow untouched).
//   2. LAYA_ENABLED=0 → 'off' (explicit opt-out respected).
//   3. GET {LAYA_BASE_URL}/health (default http://127.0.0.1:8000) —
//      loopback-only security (sidecar convention). Refused → 'down'.
//   4. KEY LADDER: [env key, persisted autolink key, documented
//      default 'smartai-laya-local', no-auth] — har candidate se ek
//      REAL minimal POST /v1/systemone. 200 → KEY FOUND (persist to
//      stateDir/laya_autolink.json). 401/403 → next candidate.
//      Timeout ≠ 401 (auth middleware inference se PEHLE chalta hai)
//      → auth pass samajh ke 'linked (warmup timeout)'.
//   5. Linked → buildProviders ab persisted key se provider banata
//      hai (aiProviders.js v21.9.0) → runner.attachAiProviders()
//      HOT-SWAP + boardAiConfirmRefresh() — RESTART KE BINA Bot Lab
//      arms + Signal Board AI chips turant live.
//   6. Sab 401 → 'key_mismatch' (UI hint: .env me sahi key daalo).
//
// Manual trigger: POST /api/bots/ai/laya-relink (UI "RECONNECT LAYA"
// button). Status: GET /api/bots/ai/laya-status + SSE status frames
// ka `layaAutoLink` field.
//
// Env knobs: LAYA_AUTOLINK=0 (off) · LAYA_AUTOLINK_MS=30000 (probe
// cadence) · LAYA_AUTOLINK_TTL_MS=604800000 (persisted key freshness,
// 7 din) · LAYA_AUTOLINK_KEY (extra ladder candidate, optional).
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { createJev, providerConfig, resolveProviderEndpoint } from './jevEngine.js';

const AUTOLINK_FILE = 'laya_autolink.json';
export const LAYA_DEFAULT_KEY = 'smartai-laya-local';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

const _int = (v, def, min, max) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : def;
};
const maskKey = (k) => !k ? '' : String(k).length <= 6 ? '***' : `${String(k).slice(0, 3)}…${String(k).slice(-2)} (${String(k).length}ch)`;

// ---------------- persisted autolink record ----------------
/** stateDir/laya_autolink.json → { key, baseUrl, at } | null (stale/absent). */
export function readLayaAutoLink(stateDir, { maxAgeMs } = {}) {
  try {
    const ttl = maxAgeMs ?? _int(process.env.LAYA_AUTOLINK_TTL_MS, 7 * 24 * 3600_000, 60_000, 365 * 24 * 3600_000);
    const p = path.join(String(stateDir || '.'), AUTOLINK_FILE);
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const key = typeof j?.key === 'string' ? j.key : '';
    const at = Number(j?.at) || 0;
    if (!key || !(at > 0) || Date.now() - at > ttl) return null;
    return { key, baseUrl: typeof j.baseUrl === 'string' ? j.baseUrl : '', at };
  } catch { return null; }
}
export function writeLayaAutoLink(stateDir, rec) {
  try {
    const dir = String(stateDir || '.');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, AUTOLINK_FILE), JSON.stringify({ ...rec, at: Date.now() }, null, 2));
    return true;
  } catch { return false; }
}
/** Test hook — hermetic suites persisted record hata sakte hain. */
export function __clearLayaAutoLinkForTest(stateDir) {
  try { fs.rmSync(path.join(String(stateDir || '.'), AUTOLINK_FILE), { force: true }); } catch { /* noop */ }
}

// ---------------- the auto-link service ----------------
/**
 * createLayaAutoLink({ env, stateDir, log, onLinked, fetchImpl })
 *   status() → { phase, baseUrl, keyMasked, source, at, attempts, lastError, warmupTimeout }
 *     phase: 'env-linked' | 'linked' | 'down' | 'key_mismatch' | 'off' | 'probing'
 *   relink() → Promise<status> — manual ya scheduled cycle (single-flight)
 *   start()  → background timer (unref'd) — sirf unlinked phases retry
 */
export function createLayaAutoLink({
  env = process.env,
  stateDir = '.',
  log = null,
  onLinked = null,
  fetchImpl = null,
} = {}) {
  const f = fetchImpl || ((u, o) => fetch(u, o));
  const say = (level, msg) => { try { (log?.[level] || log)?.(msg); } catch { /* never fatal */ } };
  let _phase = 'probing';
  let _lastError = '';
  let _attempts = 0;
  let _keyMasked = '';
  let _source = '';
  let _warmupTimeout = false;
  let _inflight = null;
  let _timer = null;
  let _lastTryAt = 0;

  const baseUrl = () => String(env.LAYA_BASE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
  const isLoopback = (u) => { try { return LOOPBACK_HOSTS.has(new URL(u).hostname); } catch { return false; } };
  const status = () => ({
    phase: _phase, baseUrl: baseUrl(), keyMasked: _keyMasked, source: _source,
    at: new Date().toISOString(), attempts: _attempts, lastError: _lastError,
    warmupTimeout: _warmupTimeout,
  });

  async function _healthProbe(base) {
    try {
      const r = await f(`${base}/health`, { signal: AbortSignal.timeout(2500) });
      return r.status > 0 && r.status < 500; // sidecar convention: <500 = alive
    } catch { return false; }
  }

  /** Ek candidate key se real systemone POST. Return: 'ok' | 'auth' | 'down' | 'timeout'. */
  async function _tryKey(base, key, timeoutMs) {
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers.Authorization = `Bearer ${key}`;
    const body = {
      state: 'Auto-link probe: site↔laya-serve handshake. Always wait.',
      questions: {
        action: {
          type: 'choice',
          instructions: 'Handshake self-check — always wait.',
          criteria: { enter_long: 'Take long', enter_short: 'Take short', wait: 'Stand aside' },
        },
      },
    };
    try {
      const r = await f(`${base}/v1/systemone`, {
        method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
      });
      if (r.status === 401 || r.status === 403) return 'auth';
      if (r.status >= 200 && r.status < 300) return 'ok';
      if (r.status >= 500) return 'down'; // server-side trouble, key verdict unknown
      return 'auth'; // other 4xx = contract mismatch, treat as soft-reject
    } catch (e) {
      const msg = String(e?.message || e);
      if (/aborted|timeout|timed out/i.test(msg)) return 'timeout';
      return 'down';
    }
  }

  async function _cycle() {
    // 1. explicit off
    if (String(env.LAYA_AUTOLINK ?? '') === '0') { _phase = 'off'; _lastError = 'LAYA_AUTOLINK=0'; return status(); }
    // 2. env-configured provider (purana flow) — autolink ki zaroorat nahi
    const envEnabled = String(env.LAYA_ENABLED ?? '').trim() === '1';
    const envKey = String(env.LAYA_API_KEY || '').trim();
    if (envEnabled && envKey) {
      _phase = 'env-linked'; _source = 'env'; _keyMasked = maskKey(envKey); _lastError = '';
      return status();
    }
    if (String(env.LAYA_ENABLED ?? '').trim() === '0') { _phase = 'off'; _lastError = 'LAYA_ENABLED=0'; return status(); }
    _attempts += 1; _lastTryAt = Date.now();
    const base = baseUrl();
    // 3. loopback-only (security: sidecar convention — remote Laya nahi)
    if (!isLoopback(`${base}/`)) {
      _phase = 'key_mismatch'; _lastError = `LAYA_BASE_URL ${base} loopback nahi hai — auto-link sirf 127.0.0.1 pe`;
      return status();
    }
    // 4. health probe
    if (!(await _healthProbe(base))) {
      _phase = 'down'; _lastError = `${base}/health unreachable — laya-serve chalu hai?`;
      say?.('info', `[laya-autolink] down: ${base}/health unreachable`);
      return status();
    }
    // 5. key ladder — env-extra → persisted → documented default → no-auth
    const persisted = readLayaAutoLink(stateDir);
    const candidates = [];
    const push = (k, src) => { const t = String(k || '').trim(); if (t && !candidates.some((c) => c.key === t)) candidates.push({ key: t, src }); };
    push(env.LAYA_AUTOLINK_KEY, 'env-extra');
    if (persisted?.baseUrl === base) push(persisted.key, 'persisted');
    push(LAYA_DEFAULT_KEY, 'default');
    candidates.push({ key: '', src: 'no-auth' });
    for (const c of candidates) {
      const verdict = await _tryKey(base, c.key, 6000);
      if (verdict === 'ok') {
        return _linked(base, c.key, c.src, false);
      }
      if (verdict === 'timeout') {
        // auth inference se PEHLE fail hota hai — timeout = key pass +
        // model cold. Ek lamba warmup retry, phir bhi timeout = linked
        // (warmupTimeout honest flag).
        const v2 = await _tryKey(base, c.key, _int(env.LAYA_WARMUP_TIMEOUT_MS, 30_000, 5000, 120_000));
        if (v2 === 'ok') return _linked(base, c.key, c.src, false);
        if (v2 === 'timeout') return _linked(base, c.key, c.src, true);
        if (v2 === 'auth') continue;
        _phase = 'down'; _lastError = 'probe network drop mid-ladder';
        return status();
      }
      // 'auth' → next candidate; 'down' → server gaya
      if (verdict === 'down') {
        _phase = 'down'; _lastError = `${base} connection dropped mid-probe`;
        return status();
      }
    }
    _phase = 'key_mismatch';
    _lastError = 'laya-serve zinda hai par har candidate key 401/403 lauta — .env me LAYA_API_KEY = wahi key daalo jisse laya-serve chala hai, phir RECONNECT dabao';
    say?.('warn', `[laya-autolink] key_mismatch (server alive, ${candidates.length} candidates tried)`);
    return status();
  }

  function _linked(base, key, src, warmupTimeout) {
    writeLayaAutoLink(stateDir, { key, baseUrl: base });
    _phase = 'linked'; _source = src; _keyMasked = maskKey(key);
    _lastError = ''; _warmupTimeout = warmupTimeout;
    say?.('info', `[laya-autolink] LINKED via ${src}${warmupTimeout ? ' (warmup timeout — model thanda tha, pehle decisions slow)' : ''}`);
    try { onLinked?.({ key, baseUrl: base, source: src }); } catch (e) { say?.('error', `[laya-autolink] onLinked hook failed: ${String(e?.message || e)}`); }
    return status();
  }

  async function relink() {
    if (_inflight) return _inflight;
    _inflight = (async () => {
      try { return await _cycle(); } finally { _inflight = null; }
    })();
    return _inflight;
  }

  function start() {
    if (_timer) return;
    const ms = _int(env.LAYA_AUTOLINK_MS, 30_000, 5000, 600_000);
    _timer = setInterval(async () => {
      if (_inflight) return;
      // linked phases par re-probe nahi (provider + breaker khud sambhalte
      // hain); down/key_mismatch/probing par har beat retry.
      if (_phase === 'linked' || _phase === 'env-linked' || _phase === 'off') return;
      if (Date.now() - _lastTryAt < ms - 500) return;
      try { await relink(); } catch { /* never fatal */ }
    }, ms);
    if (typeof _timer.unref === 'function') _timer.unref();
    // boot pe ek turant cycle (fire-and-forget — server start block nahi)
    const boot = relink().catch(() => { /* never fatal */ });
    if (boot && typeof boot.finally === 'function') boot.finally(() => { /* noop */ });
    return status();
  }
  function stop() { if (_timer) { clearInterval(_timer); _timer = null; } }

  return { status, relink, start, stop, _i: { readLayaAutoLink, writeLayaAutoLink } };
}

/** v21.9.0: sirf LAYA provider rebuild (jev untouched) — hot-swap path. */
export function buildLayaProviderOnly(env = process.env, { stateDir } = {}) {
  const dir = stateDir || '.';
  const lcfg = providerConfig('laya', env);
  let key = lcfg.apiKey;
  if (!key) {
    const auto = readLayaAutoLink(dir);
    if (auto?.key) key = auto.key;
  }
  if (!key) return null;
  return createJev({ ...lcfg, apiKey: key, cachePath: path.join(dir, 'laya_cache.jsonl') });
}

export { resolveProviderEndpoint };
