// ============================================================
// server/ai/llmChain.js — v18.8 · THE ONE SHARED LLM PROVIDER CHAIN
// ------------------------------------------------------------
// v11.0: extracted from signals.js so the Global Market Council can
// ride the SAME chain without a circular import (signals ↔ council).
// v18.7: sentinel-aware (cooldown fast-fail + auto half-open retry),
// extended to huggingface + nvidia.
//
// v18.8 ENGINE CHAIN UNIFICATION (the "AI language engines offline"
// superintelligence patch):
//   • KEYLESS LOCAL OLLAMA joins THIS chain too — the council, the
//     LLM second-opinion validator, the weekly review and the AI
//     Council seat used to stop at 4-6 cloud engines and degrade to
//     "engines offline" while a perfectly good local Ollama sat
//     UNUSED on 127.0.0.1:11434. Now it answers with ZERO cloud keys.
//   • PROVIDER-AWARE TIMEOUT — cloud engines keep the 15s bound; the
//     local ollama engine gets 90s (a CPU-only llama3.1:8b can take
//     30-60s for a 2k-token JSON verdict — the old shared 15s bound
//     made it ALWAYS time out on CPU machines).
//   • aiKeysPresent now counts ALL SIX cloud engines (a saved HF or
//     NVIDIA key no longer reads as "offline"), and the new async
//     aiEnginesOnline() also counts a reachable local ollama — the
//     gate the council/validator use to decide LLM availability.
//   • signals.js's private 4-provider copy is DELETED — one chain,
//     one health ledger, one place to fix (the exact drift that let
//     the desk agents get the v18.7 upgrade while the board's AI
//     Council seat silently stayed on the old ladder).
// ============================================================
import {
  engineSkip, engineTrack, engineOk, ollamaProbe, ollamaCompatCfg,
} from './llmSentinel.js';

const CLOUD_TIMEOUT_MS = 15_000;   // GPU cloud engines — fast fail
const OLLAMA_TIMEOUT_MS = 90_000;  // CPU-local llama can be slow (first prompt esp.)

function tryParseJson(text) {
  const cleaned = String(text).replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

/** Sync gate: ANY of the six cloud engine keys present? */
export function aiKeysPresent(KEYS) {
  return !!(KEYS && (
    KEYS.gemini || KEYS.groq || KEYS.cerebras
    || KEYS.openrouter || KEYS.huggingface || KEYS.nvidia
  ));
}

/** v18.8 async gate: cloud keys OR a reachable local ollama. */
export async function aiEnginesOnline(KEYS) {
  if (aiKeysPresent(KEYS)) return true;
  try { return !!(await ollamaProbe()); } catch { return false; }
}

async function askGemini(prompt, KEYS) {
  const models = ['gemini-2.5-flash', 'gemini-2.0-flash'];
  for (const model of models) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEYS.gemini}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
        }),
        signal: AbortSignal.timeout(CLOUD_TIMEOUT_MS),
      });
      if (!r.ok) continue;
      const j = await r.json();
      const text = j?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
      const parsed = tryParseJson(text);
      if (parsed) return parsed;
    } catch { /* next model */ }
  }
  return null;
}

async function askOpenAICompat(prompt, KEYS, OPENAI_COMPAT, provider, opts = {}) {
  // v18.8: opts.cfgOverride lets the keyless local ollama engine ride
  // this exact path (auth header inert for it); opts.timeoutMs makes
  // the local engine's longer budget explicit.
  const cfg = opts.cfgOverride || OPENAI_COMPAT?.[provider];
  const key = String(KEYS?.[provider] || 'local');
  const timeoutMs = opts.timeoutMs || CLOUD_TIMEOUT_MS;
  if (!cfg) return null;
  try {
    const r = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: cfg.defModel,
        messages: [
          { role: 'system', content: 'You are an elite trading desk analyst. Respond with STRICT JSON only.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 2048,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const text = j?.choices?.[0]?.message?.content || '';
    return tryParseJson(text);
  } catch { return null; }
}

/**
 * v20.6: env-driven chain order + local-only short-circuit.
 *   LLM_PRIORITY=ollama,groq,gemini,...  → comma-separated provider
 *     list in desired order. Cloud providers not in this list are
 *     skipped entirely (no key probe, no fetch).
 *   LLM_LOCAL_ONLY=1  → cloud providers are SKIPPED EVEN IF listed in
 *     LLM_PRIORITY; only the local ollama engine is tried. Designed
 *     for the user's 16GB laptop setup (Chrome + Node + Ollama all
 *     running locally; cloud calls add latency + cost + bandwidth).
 *   default LLM_PRIORITY (env unset): 'gemini,groq,cerebras,openrouter,
 *     huggingface,nvidia,ollama' (the historical order — backward
 *     compatible). To flip the priority to local-first, set
 *     LLM_PRIORITY=ollama,groq,gemini,... or just LLM_LOCAL_ONLY=1.
 */
function _chainOrder() {
  const envOrder = String(process.env.LLM_PRIORITY || '').split(',')
    .map(s => s.trim().toLowerCase()).filter(Boolean);
  if (envOrder.length) return envOrder;
  return ['gemini', 'groq', 'cerebras', 'openrouter', 'huggingface', 'nvidia', 'ollama'];
}
function _localOnly() {
  return String(process.env.LLM_LOCAL_ONLY || '').toLowerCase() === '1'
    || String(process.env.LLM_LOCAL_ONLY || '').toLowerCase() === 'true';
}

/**
 * One ask through the provider chain. Returns { json, model } or
 * { json: null, model: null } — never throws.
 * v18.7: sentinel-aware — cooled providers are skipped, results are
 * tracked (success resets the breaker, failure arms it).
 * v18.8: the chain ENDS at the keyless local ollama engine — with
 * every cloud engine down/unkeyed, an installed Ollama still answers
 * (long timeout, sentinel-tracked like any other engine).
 * v20.6: the chain order is now env-driven (LLM_PRIORITY) and the
 * cloud half can be short-circuited entirely (LLM_LOCAL_ONLY=1).
 */
export async function councilAsk(prompt, deps, opts = {}) {
  const { KEYS, OPENAI_COMPAT } = deps || {};
  let json = null, model = null;

  // v20.6.1: opts.deep = true → the ollama leg uses OLLAMA_DEEP_MODEL
  // (deepseek-r1:14b) instead of OLLAMA_MODEL (qwen3:8b). The scan
  // path always passes opts.deep=false (default); only the deep
  // single-symbol analysis path (getDeepSignal → councilAskDeep)
  // passes opts.deep=true. See ollamaCompatCfg({deep:true}).
  const deep = !!opts.deep;

  // v20.6: build the cloud-half attempts list from env order + skip
  // cloud entries entirely under LLM_LOCAL_ONLY=1.
  const localOnly = _localOnly();
  const order = _chainOrder();
  const cloudProviderAsk = {
    gemini: () => askGemini(prompt, KEYS),
    groq: () => askOpenAICompat(prompt, KEYS, OPENAI_COMPAT, 'groq'),
    cerebras: () => askOpenAICompat(prompt, KEYS, OPENAI_COMPAT, 'cerebras'),
    openrouter: () => askOpenAICompat(prompt, KEYS, OPENAI_COMPAT, 'openrouter'),
    huggingface: () => askOpenAICompat(prompt, KEYS, OPENAI_COMPAT, 'huggingface'),
    nvidia: () => askOpenAICompat(prompt, KEYS, OPENAI_COMPAT, 'nvidia'),
  };
  const attempts = localOnly
    ? []  // skip cloud entirely
    : order.filter(p => p !== 'ollama').map(p => [p, cloudProviderAsk[p]]).filter(([, fn]) => typeof fn === 'function');

  for (const [provider, ask] of attempts) {
    if (json) break;
    if (!KEYS?.[provider]) continue;
    if (engineSkip(provider)) continue; // cooldown — fast-fail, auto-retry on expiry
    try {
      json = await ask();
    } catch (e) {
      engineTrack(provider, e);
      continue;
    }
    if (json) { engineOk(provider); model = provider; }
    else { engineTrack(provider, new Error(`${provider} no-json response`)); model = null; }
  }

  // ---- v18.8 KEYLESS LOCAL ENGINE (last in the chain, or FIRST under LLM_LOCAL_ONLY=1) ----
  // v20.6: 'ollama' is now part of the LLM_PRIORITY list (defaults to
  // last); under LLM_LOCAL_ONLY=1 it's the ONLY engine tried.
  const tryOllama = !json && !engineSkip('ollama') && order.includes('ollama');
  if (tryOllama) {
    const reachable = await ollamaProbe().catch(() => false);
    if (reachable) {
      let threw = false;
      try {
        json = await askOpenAICompat(prompt, { ...(KEYS || {}), ollama: 'local' }, OPENAI_COMPAT, 'ollama', {
          cfgOverride: ollamaCompatCfg({ deep }),
          timeoutMs: OLLAMA_TIMEOUT_MS,
        });
      } catch (e) {
        threw = true;
        engineTrack('ollama', e);
      }
      if (json) { engineOk('ollama'); model = 'ollama'; }
      else if (!threw) { engineTrack('ollama', new Error('ollama no-json response')); }
    }
  }
  return { json, model };
}

/**
 * v20.6.1: deep-analysis variant of councilAsk. Identical to councilAsk
 * EXCEPT it uses OLLAMA_DEEP_MODEL (e.g. deepseek-r1:14b) instead of
 * OLLAMA_MODEL (e.g. qwen3:8b) for the local-engine leg. Designed for
 * the user's 16GB laptop setup:
 *   • scan path (signals.js board compute) → councilAsk → qwen3:8b
 *   • deep single-symbol analysis (getDeepSignal → /api/ai/deep/:sym)
 *     → councilAskDeep → deepseek-r1:14b (auto-swap on Ollama's side
 *     when OLLAMA_MAX_LOADED_MODELS=1; cost ~30-60s per transition).
 *
 * Cloud providers are tried FIRST (same chain as councilAsk) when
 * LLM_LOCAL_ONLY is unset. The deep-model swap only applies to the
 * local Ollama leg. The scan path NEVER triggers a swap → no perf hit.
 */
export async function councilAskDeep(prompt, deps) {
  return councilAsk(prompt, deps, { deep: true });
}

export const __testables = { tryParseJson, _chainOrder, _localOnly };
