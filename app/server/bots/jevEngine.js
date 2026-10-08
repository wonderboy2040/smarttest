// ============================================================
// server/bots/jevEngine.js — Jev Bot Lab v20.8.0
// ------------------------------------------------------------
// Jev (TypeSafe System One) client — plan §8, contract-faithful:
//
//   POST https://api.typesafe.ai/v1/systemone
//   { model, state, questions: { action: {type:'choice',...}, ... } }
//   -> { answers: { action: { choice, confidence, probabilities } }, usage }
//
// DECISION RULES (plan §8.2 — code-enforced, not prompt-enforced):
//   • chosen = answers.action.choice
//   • p = probabilities[chosen]          <- gate on THIS, NOT
//     `confidence` (repo found confidence inversely correlated
//     with outcome in one case — probabilities[chosen] is the
//     honest number)
//   • entry needs p >= threshold (default 0.30, sweep 0.20-0.60)
//   • chosen != proposed side -> WAIT (side flip KABHI nahi)
//   • parse/timeout/error -> WAIT (fallback). 'rule' fallback only
//     via conscious config.
//   • Jev only ever sees ENTRY decisions on flat positions.
//
// Ops (plan §8.3 + llmSentinel pattern):
//   • JSONL response cache keyed by sha256(payload) — backtests
//     cost cents, replays cost nothing
//   • retry w/ exponential backoff on 429/5xx/network only
//   • BREAKER: after `breakerThreshold` consecutive failures Jev
//     is marked down for `breakerCooldownMs` — no timeout storms
//   • stats: calls, cacheHits, errors, latency p50/p95, usage
// ============================================================
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone';

export const JEV_DEFAULTS = {
  model: 'jev-latest',
  threshold: 0.30,
  cachePath: 'cache/jev_cache.jsonl',
  timeoutMs: 4000,
  retries: 3,
  fallback: 'wait',            // 'wait' | 'rule'
  breakerThreshold: 4,         // consecutive fails -> open breaker
  breakerCooldownMs: 10 * 60 * 1000,
  maxCacheEntries: 20000,
};

/** Env-driven config with sane defaults (plan §17). */
export function jevConfig(env = process.env) {
  return {
    ...JEV_DEFAULTS,
    model: env.JEV_MODEL || JEV_DEFAULTS.model,
    threshold: numOr(env.JEV_THRESHOLD, JEV_DEFAULTS.threshold),
    fallback: env.JEV_FALLBACK === 'rule' ? 'rule' : 'wait',
    apiKey: env.TYPESAFE_API_KEY || '',
  };
}

function numOr(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

const keyOf = (p) => crypto.createHash('sha256').update(JSON.stringify(p)).digest('hex').slice(0, 32);

/** Build the exact payload Jev expects from a snapshot + prompt. */
export function buildPayload({ model, snap, prompt }) {
  return {
    model,
    state: (snap.contextLines || []).join('\n'),
    questions: {
      action: { type: 'choice', instructions: prompt.instructions, criteria: prompt.criteria },
      ...(prompt.extra || {}),
    },
  };
}

/**
 * Create a Jev decider. `decide(snap, prompt)` -> verdict object.
 * @param {object} opts JEV_DEFAULTS overrides + apiKey + fetchImpl
 *   (tests inject fetchImpl; production uses global fetch)
 */
export function createJev(opts = {}) {
  const cfg = { ...JEV_DEFAULTS, ...opts };
  const apiKey = cfg.apiKey || '';
  const doFetch = cfg.fetchImpl || ((...a) => fetch(...a));
  const cache = new Map();
  let cacheDirty = false;

  // ---- load cache (best-effort) ----
  const cacheFile = () => cfg.cachePath;
  try {
    if (cfg.cachePath && fs.existsSync(cfg.cachePath)) {
      const lines = fs.readFileSync(cfg.cachePath, 'utf8').split('\n');
      for (const line of lines) {
        const s = line.trim();
        if (!s) continue;
        try {
          const r = JSON.parse(s);
          if (r?.key && r?.response) cache.set(r.key, r.response);
        } catch { /* skip corrupt line */ }
      }
    }
  } catch { /* read-only fs etc: cache is an optimization, not a dependency */ }

  const stats = {
    calls: 0, cacheHits: 0, errors: 0,
    latencies: [], usage: { inputTokens: 0, outputTokens: 0 },
    breaker: { fails: 0, openedAt: null, trips: 0 },
  };
  const pushLat = (ms) => {
    stats.latencies.push(ms);
    if (stats.latencies.length > 500) stats.latencies.shift();
  };
  const pct = (q) => {
    if (!stats.latencies.length) return null;
    const s = [...stats.latencies].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(q * s.length))];
  };

  const breakerOpen = () => {
    if (stats.breaker.openedAt == null) return false;
    if (Date.now() - stats.breaker.openedAt >= cfg.breakerCooldownMs) {
      stats.breaker.openedAt = null; stats.breaker.fails = 0; // half-open: retry
      return false;
    }
    return true;
  };
  const breakerFail = () => {
    stats.breaker.fails++;
    if (stats.breaker.fails >= cfg.breakerThreshold) {
      stats.breaker.openedAt = Date.now();
      stats.breaker.trips++;
    }
  };
  const breakerOk = () => { stats.breaker.fails = 0; stats.breaker.openedAt = null; };

  async function post(payload) {
    for (let i = 0; i <= cfg.retries; i++) {
      try {
        const r = await doFetch(JEV_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(cfg.timeoutMs),
        });
        if (r.status === 429 || r.status >= 500) throw Object.assign(new Error(`HTTP ${r.status}`), { retryable: true, status: r.status });
        if (!r.ok) return { ok: false, fatal: true, status: r.status };  // 4xx won't heal by retrying
        const j = await r.json();
        return { ok: true, json: j };
      } catch (e) {
        if (i === cfg.retries) return { ok: false, error: String(e?.message || e) };
        await new Promise((res) => setTimeout(res, 300 * 2 ** i));
      }
    }
    return { ok: false, error: 'unreachable' };
  }

  function persistCache() {
    if (!cacheDirty || !cfg.cachePath) return;
    try {
      fs.mkdirSync(path.dirname(cfg.cachePath), { recursive: true });
      // rewrite bounded (Map preserves insertion; drop oldest beyond cap)
      const entries = Array.from(cache.entries()).slice(-cfg.maxCacheEntries);
      // v20.9.1 [L]: ATOMIC write (tmp + rename) — repo-wide convention hai;
      // direct writeFileSync crash-mid-write pe corrupt JSONL chhod deta
      // tha (loader bad lines skip karta hai, par purane verdicts silently
      // jaate the + agle writes bhi fail ho sakte the partial line pe).
      const tmp = `${cfg.cachePath}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, entries.map(([k, v]) => JSON.stringify({ key: k, response: v })).join('\n') + '\n');
      fs.renameSync(tmp, cfg.cachePath);
      cacheDirty = false;
    } catch { /* cache write failure must never break trading */ }
  }

  // v20.8.1 FIX (H3 — event-loop): the full cache file (up to 20k
  // entries, potentially MBs) was rewritten SYNCHRONOUSLY on every
  // successful Jev call. Persistence is now debounced (30s dirty
  // timer + flush on break) — the hot path stays non-blocking.
  let _persistTimer = null;
  const persistCacheDebounced = () => {
    if (_persistTimer != null) return;
    _persistTimer = setTimeout(() => {
      _persistTimer = null;
      persistCache();
    }, 30_000);
    if (typeof _persistTimer.unref === 'function') _persistTimer.unref();
  };
  // v20.8.4 FIX (L — flush-on-exit): the debounce comment promised "flush
  // on break" but no shutdown hook ever existed — the last ≤30s of cache
  // entries were lost on every exit (re-fetched at real cost on restart).
  // process.once('exit') fires on normal exit AND on SIGINT/SIGTERM handled
  // by the parent's graceful-shutdown path; persistCache is fully sync.
  process.once('exit', () => {
    try {
      if (_persistTimer != null) { clearTimeout(_persistTimer); _persistTimer = null; }
      if (cacheDirty) persistCache();
    } catch { /* never fatal */ }
  });

  /**
   * THE DECIDER. snap: { proposed: 'enter_long'|'enter_short',
   * contextLines, features }. prompt: strategy.jevPrompt().
   */
  async function decide(snap, prompt) {
    const payload = buildPayload({ model: cfg.model, snap, prompt });
    const key = keyOf(payload);
    const t0 = Date.now();

    // ---- breaker: fail fast while Jev is down ----
    if (breakerOpen()) {
      return { action: cfg.fallback === 'rule' ? snap.proposed : 'wait', note: 'breaker_open', cached: false, latencyMs: 0 };
    }

    let resp = cache.get(key);
    let cached = !!resp;
    const wire = !resp;
    if (!resp) {
      if (!apiKey) {
        // No key configured: WAIT with an explicit note. A missing key is
        // NOT a signal to trade (plan: koi parse/timeout/error -> WAIT).
        return { action: 'wait', note: 'no_api_key', cached: false, latencyMs: 0 };
      }
      stats.calls++;
      const r = await post(payload);
      if (!r.ok) {
        stats.errors++;
        breakerFail();
        return {
          action: cfg.fallback === 'rule' ? snap.proposed : 'wait',
          note: r.fatal ? `http_${r.status}` : 'network_error',
          cached: false, latencyMs: Date.now() - t0,
        };
      }
      resp = r.json;
      // v20.8.1 FIX (M): only WELL-FORMED responses are cached — a
      // garbage-but-200 body used to be served from cache on every
      // identical future payload (a permanent no_answer wait).
      const a0 = resp?.answers?.action;
      const p0 = a0?.probabilities?.[a0?.choice];
      const wellFormed = !!a0?.choice && Number.isFinite(Number(p0));
      if (wellFormed) {
        cache.set(key, resp);
        // v20.8.2 FIX (M — the Map trim was a placebo): __trim existed but
        // NOTHING called it in the hot path (only the file write was
        // bounded) — the in-memory Map grew without limit in a
        // long-lived process.
        trimCache();
        cacheDirty = true;
        persistCacheDebounced();
      }
      breakerOk();
      const u = resp?.usage;
      if (u) {
        stats.usage.inputTokens += Number(u.input_tokens || 0) || 0;
        stats.usage.outputTokens += Number(u.output_tokens || 0) || 0;
      }
    } else {
      stats.cacheHits++;
    }
    // v20.8.1 FIX (M): latency stats only for WIRE calls — ~0ms cache
    // hits used to skew p50/p95 toward zero.
    if (wire) pushLat(Date.now() - t0);

    // ---- decision rules (plan §8.2, code-enforced) ----
    const a = resp?.answers?.action;
    if (!a?.choice) {
      // v20.8.1 FIX (M): malformed answers count as breaker failures —
      // a persistently broken endpoint must trip the breaker, not fail
      // silently forever.
      breakerFail();
      return { action: 'wait', note: 'no_answer', probs: a?.probabilities || null, cached, latencyMs: Date.now() - t0 };
    }
    const p = Number(a.probabilities?.[a.choice] ?? NaN);
    if (!Number.isFinite(p)) {
      breakerFail();
      return { action: 'wait', note: 'no_probability', probs: a.probabilities || null, cached, latencyMs: Date.now() - t0 };
    }

    if (a.choice !== 'wait') {
      // gate on probabilities[chosen], NOT confidence (plan §1)
      if (p < cfg.threshold) {
        return { action: 'wait', note: `below_threshold(${p.toFixed(2)})`, probs: a.probabilities, confidence: a.confidence, cached, latencyMs: Date.now() - t0 };
      }
      // side flip is BANNED: Jev disagreeing with the proposed side = WAIT
      if (a.choice !== snap.proposed) {
        return { action: 'wait', note: 'disagreed_side', probs: a.probabilities, confidence: a.confidence, cached, latencyMs: Date.now() - t0 };
      }
    }
    return {
      action: a.choice,
      probs: a.probabilities,
      confidence: a.confidence,
      aux: resp.answers,
      cached,
      latencyMs: Date.now() - t0,
    };
  }

  decide.stats = () => ({
    ...stats,
    latencies: undefined,
    p50: pct(0.5), p95: pct(0.95),
    cacheSize: cache.size,
    breakerOpen: breakerOpen(),
    threshold: cfg.threshold,
    model: cfg.model,
    fallback: cfg.fallback,
    hasKey: !!apiKey,
  });
  decide.config = () => ({ ...cfg, apiKey: apiKey ? '***' : '' });
  decide.__cache = cache;   // test hook
  decide.__breakerFail = breakerFail; // test hook
  decide.__persist = persistCache;
  // v20.8.1 FIX (M): the in-memory Map is TRIMMED beyond the cap (only
  // the file write was bounded before — slow memory growth in a
  // long-lived process). v20.8.2 FIX (M): now actually CALLED on every
  // cache.set (see trimCache() above).
  const trimCache = () => {
    if (cache.size > cfg.maxCacheEntries) {
      const excess = cache.size - cfg.maxCacheEntries;
      const it = cache.keys();
      for (let i = 0; i < excess; i++) { const k = it.next().value; cache.delete(k); }
    }
  };
  decide.__trim = trimCache;
  return decide;
}

/**
 * JEV PING (plan §4.2 smoke): one real call, full response printed.
 */
export async function jevPing({ apiKey, fetchImpl } = {}) {
  const key = apiKey || process.env.TYPESAFE_API_KEY || '';
  if (!key) return { name: 'jev_ping', status: 'SKIPPED', reason: 'no TYPESAFE_API_KEY in .env' };
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  const t0 = Date.now();
  try {
    const r = await doFetch(JEV_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'jev-latest',
        state: 'Test: NIFTY broke above the 15-minute opening range with volume 1.4x average. ATR range 0.9. Trend up.',
        questions: {
          action: {
            type: 'choice',
            instructions: 'Should the breakout long be taken?',
            criteria: { enter_long: 'Take the long breakout', wait: 'Stand aside' },
          },
        },
      }),
      signal: AbortSignal.timeout(8000),
    });
    const j = await r.json().catch(() => null);
    return {
      name: 'jev_ping', status: r.ok ? 'PASS' : 'FAIL',
      http: r.status, latencyMs: Date.now() - t0,
      choice: j?.answers?.action?.choice ?? null,
      probabilities: j?.answers?.action?.probabilities ?? null,
      usage: j?.usage ?? null,
    };
  } catch (e) {
    return { name: 'jev_ping', status: 'FAIL', error: String(e?.message || e), latencyMs: Date.now() - t0 };
  }
}
