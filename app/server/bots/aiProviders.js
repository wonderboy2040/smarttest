// ============================================================
// server/bots/aiProviders.js — v21.2.0 (dual-provider plan Step-2)
// ------------------------------------------------------------
// AI provider REGISTRY: Jev (TypeSafe cloud) + Laya (local,
// open-weight) dono ek hi createJev engine se bante hain — bas
// url/model/threshold/timeouts alag hote hain (providerConfig).
//
//   buildProviders(env, { stateDir }) -> { jev, laya }
//     jev : createJev instance | null   (TYPESAFE_API_KEY na ho to null)
//     laya: createJev instance | null   (LAYA_ENABLED!=1 ya key nahi to null)
//
// Nulls kabhi silent nahi rehte — botRunner availability-resolve
// arm_fallback event file me daalta hai, routes 409 dete hain.
//
// Ground rules (dual-provider plan §3.1) jo YE layer enforce karta hai:
//   • AI sirf ENTRY decisions pe (flat position), side flip / sizing /
//     SL/TP kabhi nahi — createJev ke andar code-enforced hai
//   • har provider ka apna threshold (confidence formulas alag hain)
//   • provider-wise cache file (jev_cache.jsonl / laya_cache.jsonl) —
//     replay free (Laya) / sasta (Jev)
// ============================================================
import path from 'node:path';
import { createJev, providerConfig, jevPing } from './jevEngine.js';
import { readLayaAutoLink } from './layaAutoLink.js';

/**
 * Build the provider registry from env.
 * @param {object} env process.env (ya test env object)
 * @param {object} opts { stateDir } — cache files yahan banti hain
 */
export function buildProviders(env = process.env, { stateDir } = {}) {
  const out = { jev: null, laya: null };
  const dir = stateDir || '.';
  const jcfg = providerConfig('jev', env);
  if (jcfg.apiKey) {
    out.jev = createJev({ ...jcfg, cachePath: path.join(dir, 'jev_cache.jsonl') });
  }
  // Laya opt-in hai: LAYA_ENABLED=1 + LAYA_API_KEY dono chahiye. Yaad rakho —
  // Laya local hai; laptop band = provider down = breaker open = auto-arm
  // failover / single-arm WAIT (kabhi "AI ke bina trade" nahi).
  //
  // v21.9.0 AUTOLINK RESCUE: "laya-serve background me chal raha hai par
  // no_laya_instance" incident. .env.example LAYA_API_KEY= KHALI ship karta
  // hai — provider kabhi nahi banta tha. Ab:
  //   • LAYA_ENABLED=0 → explicit off (kuch nahi)
  //   • LAYA_ENABLED=1 + env key → purana flow (source 'env')
  //   • env key khali/unset PAR stateDir/laya_autolink.json me FRESH
  //     auto-detected key hai (layaAutoLink.js ne ek REAL successful
  //     /v1/systemone handshake ke baad hi likhi hai) → provider banta
  //     hai (source 'autolink'). Ek stray file kabhi flip nahi kar sakti
  //     — sirf validated handshake key persist hoti hai.
  const layaEnabledRaw = String(env.LAYA_ENABLED ?? '').trim();
  if (layaEnabledRaw !== '0') {
    const lcfg = providerConfig('laya', env);
    let key = lcfg.apiKey || '';
    const auto = key ? null : readLayaAutoLink(dir);
    if (!key && auto?.key) key = auto.key;
    if (key && (layaEnabledRaw === '1' || auto?.key)) {
      out.laya = createJev({ ...lcfg, apiKey: key, cachePath: path.join(dir, 'laya_cache.jsonl') });
    }
  }
  return out;
}

/**
 * AI mode config (dual-provider plan §4): AI_PRIMARY / AI_SHADOW /
 * AI_CONSENSUS_ON_DOWN. Invalid values safe defaults pe girti hain.
 */
export function aiModeConfig(env = process.env) {
  const primary = String(env.AI_PRIMARY || 'laya') === 'jev' ? 'jev' : 'laya';
  const shadowRaw = String(env.AI_SHADOW || 'off').toLowerCase();
  const shadow = (shadowRaw === 'laya' || shadowRaw === 'jev') ? shadowRaw : 'off';
  const onDown = String(env.AI_CONSENSUS_ON_DOWN || 'wait').toLowerCase() === 'single' ? 'single' : 'wait';
  return { primary, shadow, onDown };
}

/** One provider's health block (for GET /api/bots/ai/health + healthMonitor). */
function _oneHealth(p) {
  if (!p || typeof p !== 'function' || typeof p.stats !== 'function') {
    return { configured: false, reachable: false, breakerOpen: false, rejects: 0 };
  }
  const s = p.stats();
  const breakerOpen = s.breakerOpen === true;
  return {
    configured: true,
    // honest definition: instance hai + breaker open nahi. (Live ping nahi —
    // health endpoint har request pe paid call jala dega; breaker hi
    // "real failures" ka accumulated signal hai.)
    reachable: !breakerOpen,
    breakerOpen,
    p50: s.p50 ?? null,
    p95: s.p95 ?? null,
    calls: s.calls ?? 0,
    cacheHits: s.cacheHits ?? 0,
    errors: s.errors ?? 0,
    rejects: s.rejects ?? 0,
    model: s.model ?? '',
    urlHost: s.url ?? '',
    threshold: s.threshold ?? null,
    name: s.name ?? null,
    // v21.5.0 (laya fast): FIFO gate telemetry — OpsHealthStrip AI chip me
    // dikhta hai (queueWaits badhta hai par breakerOpen false = healthy).
    queueWaits: s.queueWaits ?? 0,
    concurrency: s.concurrency ?? 0,
  };
}

/**
 * Per-provider health snapshot.
 * @param {object} providers { jev, laya } (instances ya null)
 */
export function providerHealth(providers = {}) {
  return {
    jev: _oneHealth(providers?.jev),
    laya: _oneHealth(providers?.laya),
    at: new Date().toISOString(),
  };
}

/**
 * Laya ping (plan §4.2 parity with jevPing): one real call, Laya-shaped
 * endpoint pe — answers.action.probabilities + latency verify karta hai.
 */
export async function layaPing({ env = process.env, fetchImpl } = {}) {
  const cfg = providerConfig('laya', env);
  if (String(env.LAYA_ENABLED) !== '1' || !cfg.apiKey) {
    return { name: 'laya_ping', status: 'SKIPPED', reason: 'LAYA_ENABLED=1 + LAYA_API_KEY .env me nahi (local laya-serve off?)' };
  }
  return jevPing({ apiKey: cfg.apiKey, url: cfg.url, model: cfg.model, name: 'laya_ping', fetchImpl });
}
