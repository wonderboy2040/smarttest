// ============================================================
// server/ai/selfStatus.js — v19.0 SELF-IMPROVEMENT ENGINE
// ------------------------------------------------------------
// PHASE 4 — UNIFIED SELF-AWARENESS + SELF-REPAIR.
//
// Before v19 the system's self-knowledge was scattered: mlHealth
// here, circuit guards there, WS states elsewhere, trust over
// there. One GET now answers "system khud ko kaisa maanta hai?":
//
//   GET /api/ai/self/status →
//     phases: {
//       data:      outcomeHarvester datasetStatus()
//       drift:     driftMonitor driftReport()
//       learning:  retrainBridge retrainStatus() + shadow book
//       lessons:   lessonsEngine currentLessons() meta
//       evolution: evolutionLedger status + recent changes
//       governance:selfCouncil proposalsStatus() counts + switches
//     }
//     health: ml engine health, engine-chain, spot/fut WS tiers
//     verdict: overall SELF-IMPROVEMENT stage ladder:
//       STAGE 0 NO FUEL → STAGE 1 MEASURING → STAGE 2 LEARNING
//       → STAGE 3 EVOLVING (honest — derived from what is TRUE)
//
//   selfRepair()  — the repair ladder (all pre-existing, battle-
//   tested mechanisms, now ONE call + evolution-ledger stamped):
//     1. engine recheck (llmSentinel probe — the /api/ai/engines/
//        recheck path)
//     2. candle/price cache flush (backtest __clearBacktestCache)
//     3. drift re-check + harvest refresh (data freshness)
//     Nothing risky: NO restarts, NO key rewrites, NO order paths.
//
// NEVER throws. Reads are lazy + guarded (a broken subsystem shows
// 'unavailable', never a 500).
// ============================================================
import { datasetStatus, harvestOutcomes } from './outcomeHarvester.js';
import { driftReport } from './driftMonitor.js';
import { retrainStatus } from './retrainBridge.js';
import { currentLessons } from './lessonsEngine.js';
import { evolutionStatus, recentChanges, recordChange } from './evolutionLedger.js';
import { proposalsStatus } from './selfCouncil.js';

const r2 = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : null);

function safe(fn, fallback = null) {
  try { const v = fn(); return v === undefined ? fallback : v; } catch { return fallback; }
}

/** Honest stage ladder — derived ONLY from what is actually true. */
function stageOf(parts) {
  const n = parts.data?.n || 0;
  const lessons = parts.lessons?.count || 0; // mapped meta: {version, count, ts, note}
  const retrained = !!parts.learning?.lastRetrainAt;
  const evo = parts.evolution?.total || 0;
  if (n < 10) return { stage: 0, name: 'NO FUEL', note: 'settled outcomes < 10 — pehle trade history banao, self-improvement tab shuru' };
  if (n < 40) return { stage: 1, name: 'MEASURING', note: `dataset ${n} rows — harvester live, par 40+ pehle (noise-refusal)` };
  if (!lessons && !retrained) return { stage: 1, name: 'MEASURING', note: `dataset ${n} rows ready — lessons/retrain engines abhi run nahi hue (manual ya scheduler)` };
  if (evo < 3) return { stage: 2, name: 'LEARNING', note: 'lessons/retrain chal chuke hain — evolution ledger me recorded' };
  return { stage: 3, name: 'EVOLVING', note: 'multi-instrument loop live: harvest → drift → learn → propose → approve' };
}

/** The unified snapshot. NEVER throws. */
export function selfStatus() {
  const parts = {
    data: safe(datasetStatus),
    drift: safe(() => driftReport()),
    learning: safe(retrainStatus),
    lessons: safe(() => {
      const l = currentLessons();
      return { version: l.version || 0, count: (l.lessons || []).length, ts: l.ts || null, note: l.note || null };
    }),
    evolution: safe(evolutionStatus),
    governance: safe(() => {
      const p = proposalsStatus();
      return { killSwitch: p.killSwitch, autoTune: p.autoTune, counts: p.counts, pendingTop: (p.proposals || []).filter(x => x.status === 'pending').slice(0, 5).map(x => ({ id: x.id, tier: x.tier, kind: x.kind, summary: x.summary, ageHours: r2((Date.now() - x.ts) / 3600000) })) };
    }),
  };
  const recent = safe(() => recentChanges(25), []);
  return {
    ok: true, ts: Date.now(), engine: 'v19.0 SELF-IMPROVEMENT',
    stage: stageOf(parts),
    phases: parts,
    recentChanges: recent,
  };
}

/**
 * The SAFE repair ladder — every step is a pre-existing mechanism,
 * re-invoked in one call + stamped. NEVER restarts processes, NEVER
 * touches keys, NEVER goes near order paths.
 */
export async function selfRepair(deps = {}) {
  const actions = [];
  try {
    // 1. LLM engine chain re-probe (fresh availability matrix).
    //    aiEnginesOnline(KEYS) — async, cloud keys OR ollama probe.
    try {
      const mod = await import('./llmChain.js');
      if (typeof mod?.aiEnginesOnline === 'function') {
        const online = await mod.aiEnginesOnline(deps?.KEYS);
        actions.push({ step: 'engine-probe', ok: true, note: online ? 'engine chain ONLINE (cloud keys ya local ollama reachable)' : 'engine chain DOWN — cloud keys absent + ollama unreachable (check /api/ai/engines)' });
      } else {
        actions.push({ step: 'engine-probe', ok: true, note: 'llmChain probe skipped (export guarded)' });
      }
    } catch { actions.push({ step: 'engine-probe', ok: false, note: 'llmChain import failed' }); }

    // 2. backtest candle cache flush (stale history = stale lessons)
    try {
      const { __clearBacktestCache } = await import('./backtest.js');
      __clearBacktestCache();
      actions.push({ step: 'candle-cache-flush', ok: true, note: 'backtest history cache flushed — next pass re-fetches' });
    } catch { actions.push({ step: 'candle-cache-flush', ok: false, note: 'backtest import failed' }); }

    // 3. fresh harvest + drift re-check (data freshness)
    const h = safe(() => harvestOutcomes(), { added: 0 });
    actions.push({ step: 'harvest-refresh', ok: true, note: `outcome harvest: +${h.added || 0} rows` });
    const d = safe(() => driftReport(), { verdict: 'unknown' });
    actions.push({ step: 'drift-recheck', ok: true, note: `drift verdict: ${d.verdict}` });

    recordChange('self-repair', `SELF-REPAIR pass — ${actions.filter(a => a.ok).length}/${actions.length} steps ok (harvest +${h.added || 0}, drift ${d.verdict})`, {
      steps: actions.map(a => ({ step: a.step, ok: a.ok })),
    });
    return { ok: true, actions, note: 'safe repair ladder complete — koi restart/key/order action nahi liya gaya (by design)' };
  } catch (e) {
    return { ok: false, actions, note: `self-repair failed mid-ladder — ${String(e?.message || e).slice(0, 120)} (partial steps honest)` };
  }
}

// ---------------- tests ----------------
export const __testables = { stageOf, safe };
