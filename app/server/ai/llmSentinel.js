// ============================================================
// server/ai/llmSentinel.js — v18.7 AI ENGINE SENTINEL
// ------------------------------------------------------------
// THE "AI language engines offline" KILLER.
//
// Every language engine (gemini / groq / cerebras / openrouter /
// huggingface / nvidia + keyless LOCAL ollama) gets a health
// record here: consecutive failures, last error, and a cooldown
// (circuit breaker). What that buys:
//
//   • FAST-FAIL   — a provider in cooldown is SKIPPED instantly on
//     the next chat. No more paying a 30s timeout to a dead
//     provider on EVERY message (the reason "engines offline"
//     felt permanent AND slow).
//   • AUTO-RECOVER — cooldown expiry = half-open circuit: the very
//     next chat retries the engine by itself. Transient 429s /
//     5xx / DNS blips heal without any restart. POST
//     /api/ai/engines/recheck clears cooldowns NOW (UI button).
//   • HONEST STATUS — engineSnapshot() powers GET /api/ai/engines
//     and the degraded-mode "ENGINE STATUS" line: the user finally
//     SEES why an engine is offline (429? bad key? no key?) and
//     what to do about it.
//   • KEYLESS LOCAL — ollamaProbe() detects a local Ollama install
//     (127.0.0.1:11434) with a 2.5s bound + 90s cache. When
//     present it joins the chain as a REAL language engine with
//     zero cloud keys — the desk chat keeps its LLM prose even
//     with every cloud provider down.
//
// PURITY: no provider is CALLED here (except the local ollama
// /api/tags liveness probe). Success/failure is REPORTED to the
// sentinel by the agent loops via engineOk()/engineTrack(). All
// state is in-module and resettable for tests. Never throws.
// ============================================================

const OLLAMA_BASE = (process.env.OLLAMA_BASE || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';
// v20.6.1: deep-analysis model. Scan uses OLLAMA_MODEL (fast, small — qwen3:8b);
// deep single-symbol analysis uses OLLAMA_DEEP_MODEL (slower, larger — deepseek-r1:14b).
// On a 16GB laptop with OLLAMA_MAX_LOADED_MODELS=1, Ollama auto-evicts the scan
// model and loads the deep model when a deep call lands, then re-loads the scan
// model when the next scan call lands. Cost: ~30-60s model swap per transition
// (disk read + CUDA init). The scan path NEVER triggers a swap; only the deep
// path does. Leave OLLAMA_DEEP_MODEL unset → deep path falls back to OLLAMA_MODEL
// (same model, no swap, but less reasoning depth).
const OLLAMA_DEEP_MODEL = process.env.OLLAMA_DEEP_MODEL || '';

/** All engines the sentinel tracks (order = chain preference). */
export const SENTINEL_PROVIDERS = ['gemini', 'groq', 'cerebras', 'openrouter', 'huggingface', 'nvidia', 'ollama'];

const ERR_TRUNC = 120;

const _state = {
  engines: new Map(), // name → { consecFails, lastErr, lastErrAt, cooldownUntil, lastOkAt, calls }
  ollama: { reachable: false, checkedAt: 0, checking: null, models: [], model: OLLAMA_MODEL },
};

function _rec(name) {
  if (!_state.engines.has(name)) {
    _state.engines.set(name, { consecFails: 0, lastErr: null, lastErrAt: 0, cooldownUntil: 0, lastOkAt: 0, calls: 0 });
  }
  return _state.engines.get(name);
}

// ---------------- circuit breaker core ----------------

/** True when the provider is cooling down and must be SKIPPED fast. */
export function engineSkip(provider, now = Date.now()) {
  const r = _state.engines.get(provider);
  return !!(r && r.cooldownUntil > now);
}

/** Report a SUCCESS — resets the breaker, marks ready. */
export function engineOk(provider, now = Date.now()) {
  const r = _rec(provider);
  r.consecFails = 0;
  r.cooldownUntil = 0;
  r.lastOkAt = now;
}

/**
 * Report a FAILURE. Cooldown ladder (armed on the 2nd consecutive
 * failure — one transient blip never parks an engine):
 *   401/403 (bad key)      → 15 min  (the key won't heal itself)
 *   429     (rate limit)   → 90 s    (provider-quota, comes back)
 *   network / 5xx / other  → 30s → 60s → 120s → 300s (cap)
 */
export function engineTrack(provider, err, now = Date.now()) {
  const r = _rec(provider);
  r.calls++;
  r.lastErrAt = now;
  r.lastErr = String(err?.message || err || 'error').slice(0, ERR_TRUNC);
  r.consecFails++;
  if (r.consecFails >= 2) {
    const msg = r.lastErr;
    const coolMs = /\b(401|403)\b/.test(msg) ? 900_000
      : /\b429\b/.test(msg) ? 90_000
        : [30_000, 60_000, 120_000, 300_000][Math.min(r.consecFails - 2, 3)];
    r.cooldownUntil = now + coolMs;
  }
  return { cooldownMs: Math.max(0, r.cooldownUntil - now) };
}

/** Clear ALL cooldowns (the RECHECK button) — engines half-open now. */
export function engineClearCooldowns() {
  for (const r of _state.engines.values()) r.cooldownUntil = 0;
}

// ---------------- views (NEVER leak key material) ----------------

/**
 * Masked per-engine health view for GET /api/ai/engines and the
 * /api/ai/status `engines` block. `KEYS` is only read for BOOLEAN
 * presence — key values never leave this module.
 */
export function engineSnapshot(KEYS = {}, now = Date.now()) {
  return SENTINEL_PROVIDERS.map((name) => {
    const r = _state.engines.get(name);
    const configured = name === 'ollama' ? !!_state.ollama.reachable : !!(KEYS && KEYS[name]);
    const cooling = !!(r && r.cooldownUntil > now);
    const state = !configured ? 'no-key'
      : cooling ? 'cooldown'
        : r?.lastOkAt ? 'ready'
          : r?.lastErrAt ? 'tried' : 'idle';
    return {
      provider: name,
      configured,
      state,
      lastError: r?.lastErr || null,
      cooldownRemainSec: cooling ? Math.ceil((r.cooldownUntil - now) / 1000) : 0,
      lastOkAgeSec: r?.lastOkAt ? Math.max(0, Math.round((now - r.lastOkAt) / 1000)) : null,
      consecFails: r?.consecFails || 0,
    };
  });
}

/**
 * One compact Hinglish line for the deterministic-mode answer
 * footer — makes "engines offline" actionable instead of scary.
 */
export function engineStatusLine(KEYS = {}, now = Date.now()) {
  const parts = [];
  for (const e of engineSnapshot(KEYS, now)) {
    if (e.provider === 'ollama') {
      if (e.configured) parts.push('ollama (local) READY');
      continue;
    }
    if (!e.configured) continue;
    if (e.state === 'cooldown') parts.push(`${e.provider}: ${e.cooldownRemainSec}s cooldown auto-retry (${e.lastError || 'fail'})`);
    else if (e.state === 'ready') parts.push(`${e.provider}: ONLINE`);
    else if (e.state === 'tried') parts.push(`${e.provider}: ${e.lastError || 'no response'}`);
    else parts.push(`${e.provider}: armed`);
  }
  if (!parts.length) {
    return 'koi cloud engine key configured nahi — Settings > AI Keys me free Gemini ya Groq key daalo, ya Ollama install karo (localhost:11434, keyless local engine)';
  }
  return `${parts.join(' | ')} — RECHECK button dabao ya key save karte hi auto-engaged`;
}

// ---------------- local ollama engine (keyless) ----------------

/**
 * Liveness probe for a local Ollama install. 2.5s bound, 90s
 * positive AND negative cache, single-flight. Caches the first
 * available model name when present.
 */
export async function ollamaProbe(force = false, now = Date.now()) {
  if (!force && _state.ollama.checkedAt && now - _state.ollama.checkedAt < 90_000) {
    return _state.ollama.reachable;
  }
  if (_state.ollama.checking) return _state.ollama.checking;
  _state.ollama.checking = (async () => {
    try {
      const r = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(2500) });
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        const names = (j?.models || []).map(m => String(m?.name || '')).filter(Boolean);
        _state.ollama.models = names;
        _state.ollama.model = names.includes(OLLAMA_MODEL) ? OLLAMA_MODEL : (names[0] || OLLAMA_MODEL);
        _state.ollama.reachable = true;
      } else {
        _state.ollama.reachable = false;
      }
    } catch {
      _state.ollama.reachable = false;
    }
    _state.ollama.checkedAt = Date.now();
    _state.ollama.checking = null;
    return _state.ollama.reachable;
  })();
  return _state.ollama.checking;
}

/** OpenAI-compat cfg for the local ollama engine (chain runner arg).
 *  v20.6.1: opts.deep = true → returns the deep-analysis model (if
 *  OLLAMA_DEEP_MODEL is set, falls back to OLLAMA_MODEL otherwise).
 *  The scan path always passes opts.deep=false (or nothing) → uses
 *  OLLAMA_MODEL. The deep path (getDeepSignal → aiCouncilVerify →
 *  councilAskDeep) passes opts.deep=true → uses OLLAMA_DEEP_MODEL.
 *  On a 16GB laptop with OLLAMA_MAX_LOADED_MODELS=1, Ollama auto-
 *  evicts + re-loads on the model swap (cost ~30-60s per transition).
 */
export function ollamaCompatCfg(opts = {}) {
  const defModel = _state.ollama.model || OLLAMA_MODEL;
  const deepModel = OLLAMA_DEEP_MODEL || defModel;  // graceful fallback
  return {
    url: `${OLLAMA_BASE}/v1/chat/completions`,
    defModel: opts.deep ? deepModel : defModel,
    deepModel,  // surfaced for /api/ai/engines + tests
  };
}

/** View for /api/ai/engines. */
export function ollamaStatus() {
  return { base: OLLAMA_BASE, reachable: !!_state.ollama.reachable, model: _state.ollama.model || OLLAMA_MODEL, models: (_state.ollama.models || []).slice(0, 8), checkedAgeSec: _state.ollama.checkedAt ? Math.max(0, Math.round((Date.now() - _state.ollama.checkedAt) / 1000)) : null };
}

// ---------------- test hooks ----------------
export function __resetSentinelForTests() {
  _state.engines.clear();
  _state.ollama = { reachable: false, checkedAt: 0, checking: null, models: [], model: OLLAMA_MODEL };
}
