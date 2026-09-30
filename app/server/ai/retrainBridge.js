// ============================================================
// server/ai/retrainBridge.js — v19.0 SELF-IMPROVEMENT ENGINE
// ------------------------------------------------------------
// PHASE 2 — RETRAIN BRIDGE + CHAMPION/CHALLENGER SHADOW.
//
// The ml-service already owns: POST /train (signal + target +
// regime models + walk-forward backtest) and POST /meta-ensemble.
// The retrain_scheduler.py daemon existed but was NEVER wired into
// the Node app (store/models was empty). This bridge:
//
//   triggerRetrain(reason)   ONE guarded POST /train call
//     - single-flight (concurrent triggers coalesce)
//     - 4h cooldown (never hammer the Python trainer)
//     - SELFIMPROVE_AUTO_RETRAIN=true → drift ALARM may auto-fire
//       it (default FALSE: manual/API-triggered only — safe-first)
//     - result stamped on the evolution ledger ('retrain'), even
//       on failure (honest "retrain failed: ml-service down")
//
//   shadowPredict(votes)     CHAMPION/CHALLENGER bookkeeping:
//     records what the CURRENT meta-learner answers on real board
//     votes. When a NEW model file lands (post-retrain mtime bump),
//     the NEXT 200 predictions become the CHALLENGER window; the
//     book compares challenger hit-direction vs champion on the
//     same inputs → promote verdict (recorded, never auto-swaps
//     anything — the in-process ensemble stays authoritative until
//     a human approves via selfCouncil).
//
//   retrainStatus()          ops view for selfStatus + routes.
//
// Honesty rules: ml-service unreachable → verdict 'unreachable',
// NEVER a fake success. Metrics unavailable → recorded as null.
// ============================================================
import { recordChange } from './evolutionLedger.js';
import { loadJSON, saveJSON } from '../lib/store.js';

const STATE_FILE = 'ai-retrain-state.json';
const COOLDOWN_MS = 4 * 3600000;
const SHADOW_CAP = 200;

const ML_SERVICE_BASE = () => String(process.env.ML_SERVICE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const AUTO_RETRAIN_ON = () => String(process.env.SELFIMPROVE_AUTO_RETRAIN || '').toLowerCase() === 'true';

const r2 = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : null);

function load() {
  return loadJSON(STATE_FILE, {
    lastRetrainAt: null, lastResult: null, inFlight: false, inFlightAt: null,
    champion: { since: null, predictions: 0, agreed: 0 },
    challenger: { since: null, modelMtime: null, predictions: 0, agreed: 0 },
    history: [],
  });
}
function save(s) { return saveJSON(STATE_FILE, s); }

/** A crash mid-train leaves inFlight=true on disk forever (the state
 * file survives restarts). Stale-flight guard: >10min old = dead run. */
function clearStaleFlight(s) {
  if (s.inFlight && (!s.inFlightAt || Date.now() - s.inFlightAt > 10 * 60000)) {
    s.inFlight = false;
    s.inFlightAt = null;
  }
  return s;
}

/**
 * Fire ONE ml-service /train round. Single-flight + cooldown.
 * @param {string} reason  'manual' | 'drift-alarm' | 'scheduled'
 * @param {object} [evidence] drift report slice for the ledger entry
 */
export async function triggerRetrain(reason = 'manual', evidence = {}) {
  const s = clearStaleFlight(load());
  if (s.inFlight) return { ok: false, status: 'already-running', note: 'ek retrain pehle se chal raha hai — coalesced' };
  if (s.lastRetrainAt && Date.now() - s.lastRetrainAt < COOLDOWN_MS) {
    const leftMin = Math.ceil((COOLDOWN_MS - (Date.now() - s.lastRetrainAt)) / 60000);
    return { ok: false, status: 'cooldown', note: `retrain cooldown — ${leftMin}m baaki (4h floor, Python trainer kabhi hammer nahi hota)` };
  }
  // drift-alarm auto path is opt-in ONLY
  if (reason === 'drift-alarm' && !AUTO_RETRAIN_ON()) {
    return { ok: false, status: 'auto-disabled', note: 'SELFIMPROVE_AUTO_RETRAIN=false — drift alarm retrain propose karta hai, khud fire nahi karta' };
  }
  s.inFlight = true;
  s.inFlightAt = Date.now();
  save(s);
  try {
    const r = await fetch(`${ML_SERVICE_BASE()}/train`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.ML_API_TOKEN ? { 'X-API-Key': process.env.ML_API_TOKEN } : {}),
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(5 * 60000), // training is heavy — 5min budget
    });
    if (!r.ok) throw new Error(`ml-service /train ${r.status}`);
    const j = await r.json().catch(() => ({}));
    const res = {
      ok: true, status: 'retrained', reason,
      at: Date.now(),
      signalModel: j?.results?.signal_model ? { trained: true } : null,
      walkForward: j?.results?.backtest || null,
    };
    const s2 = load();
    s2.lastRetrainAt = Date.now();
    s2.lastResult = res;
    s2.history.unshift({ at: res.at, reason, ok: true, walkForward: res.walkForward ? 'reported' : 'n/a' });
    s2.history = s2.history.slice(0, 20);
    // a fresh model landed → challenger window opens
    s2.challenger = { since: Date.now(), modelMtime: Date.now(), predictions: 0, agreed: 0 };
    s2.inFlight = false;
    save(s2);
    recordChange('retrain', `ml-service retrain (${reason}) COMPLETE — challenger window khula`, {
      reason, walkForward: res.walkForward ? 'reported' : 'unavailable',
    });
    return res;
  } catch (e) {
    const s2 = load();
    s2.lastRetrainAt = Date.now(); // failed attempt still counts for cooldown (no hammering a down service)
    s2.lastResult = { ok: false, status: 'failed', reason, error: String(e?.message || e).slice(0, 200), at: Date.now() };
    s2.history.unshift({ at: s2.lastResult.at, reason, ok: false, error: s2.lastResult.error });
    s2.history = s2.history.slice(0, 20);
    s2.inFlight = false;
    save(s2);
    recordChange('retrain', `ml-service retrain (${reason}) FAILED — ${s2.lastResult.error}`, { reason, error: s2.lastResult.error });
    return s2.lastResult;
  }
}

/**
 * Champion/challenger shadow bookkeeping. Callers pass the board's
 * votes + the FINAL ensemble direction that actually got executed/
 * displayed (the champion = the authoritative in-process weighted
 * ensemble). The Python meta-learner's answer is queried; we track
 * whether the meta answer AGREED with the realized champion call
 * across its window. Bounded, best-effort, NEVER blocks the caller
 * (2.5s timeout, catch-all).
 * @returns {Promise<null|{metaDir:number, agreedChampion:boolean}>}
 */
export async function shadowPredict(votes, championDir) {
  if (!Array.isArray(votes) || !votes.length) return null;
  const s = load();
  const book = s.challenger.since && (!s.champion.since || s.challenger.since > s.champion.since)
    ? s.challenger
    : s.champion;
  if ((book.predictions || 0) >= SHADOW_CAP) return null; // window closed — evidence locked
  try {
    const r = await fetch(`${ML_SERVICE_BASE()}/meta-ensemble`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.ML_API_TOKEN ? { 'X-API-Key': process.env.ML_API_TOKEN } : {}),
      },
      body: JSON.stringify({ votes: votes.slice(0, 40), regime: 'NEUTRAL' }),
      signal: AbortSignal.timeout(2500),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const metaDir = Number(j?.dir ?? j?.direction ?? j?.meta?.dir);
    if (!Number.isFinite(metaDir) || metaDir === 0) return null;
    const agreedChampion = Math.sign(metaDir) === Math.sign(Number(championDir) || 0);
    book.predictions = (book.predictions || 0) + 1;
    if (agreedChampion) book.agreed = (book.agreed || 0) + 1;
    save(s);
    // promotion verdict when the challenger window just filled
    if (book === s.challenger && book.predictions === SHADOW_CAP) {
      const agreePct = r2((book.agreed / book.predictions) * 100);
      const promote = agreePct !== null && agreePct >= 70;
      recordChange('shadow-promote', `challenger window COMPLETE — ${agreePct}% champion-agreement (${book.agreed}/${book.predictions}) — verdict: ${promote ? 'PROMOTE-ELIGIBLE (human approval pending)' : 'KEEP CHAMPION'}`, {
        agreePct, n: book.predictions, verdict: promote ? 'promote-eligible' : 'keep-champion',
      });
    }
    return { metaDir, agreedChampion };
  } catch {
    return null; // ml-service down → shadow book silently skips (honest: no data)
  }
}

/** Ops view. */
export function retrainStatus() {
  try {
    const s = load();
    const pct = (b) => (b && b.predictions > 0 ? r2((b.agreed / b.predictions) * 100) : null);
    return {
      autoRetrainEnabled: AUTO_RETRAIN_ON(),
      lastRetrainAt: s.lastRetrainAt,
      lastResult: s.lastResult ? { ok: s.lastResult.ok, status: s.lastResult.status, reason: s.lastResult.reason, error: s.lastResult.error || null } : null,
      cooldownHours: COOLDOWN_MS / 3600000,
      inFlight: s.inFlight,
      champion: { ...s.champion, agreementPct: pct(s.champion) },
      challenger: { ...s.challenger, agreementPct: pct(s.challenger), windowCap: SHADOW_CAP },
      history: (s.history || []).slice(0, 10),
      note: s.lastRetrainAt ? null : 'retrain abhi kabhi nahi hua — ml-service ke store/models khali the (v19.0 se bridge live hai)',
    };
  } catch {
    return { autoRetrainEnabled: AUTO_RETRAIN_ON(), lastRetrainAt: null, note: 'retrain state unavailable' };
  }
}

// ---------------- tests ----------------
export function __setRetrainStateForTests(s) { save(s || load()); }
export function __retrainRaw() { return load(); }
export const __testables = { COOLDOWN_MS, SHADOW_CAP, ML_SERVICE_BASE };
