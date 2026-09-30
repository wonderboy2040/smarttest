// ============================================================
// src/components/aitrading/SelfImprovementPanel.tsx — v19.0
// SELF-IMPROVEMENT ENGINE console (Phases 1-5)
// ------------------------------------------------------------
// The closed loop, visible in ONE panel:
//   ┌ STAGE LADDER    NO FUEL → MEASURING → LEARNING → EVOLVING
//   ├ PHASE 1 DATA    outcome dataset (n / winRate / avgR / verdict)
//   ├ PHASE 1 DRIFT   vote PSI + calibration + performance verdicts
//   ├ PHASE 2 LEARN   retrain bridge + champion/challenger shadow
//   ├ PHASE 3 EVOLVE  lessons learned (versioned) + strategy evolution
//   ├ PHASE 4 SELF    evolution ledger timeline (SHA-256 chain)
//   └ PHASE 5 GOVERN  proposals — APPROVE / REJECT / ROLLBACK
//
// Actions (all real API calls, no local fakery):
//   HARVEST · DRIFT CHECK · RUN LESSONS · RETRAIN · GATE-TUNE ·
//   EVOLVE STRATEGIES · SELF-REPAIR
//
// Polls GET /api/ai/self/status every 60s (refresh-on-action too).
// Honest states everywhere: "NOT ENOUGH DATA" is a VERDICT, not an
// error — the engine refuses to learn on noise (same culture as the
// rest of the desk).
// ============================================================
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, getProxyBase } from '../../utils/api';

type Dict = Record<string, unknown>;
const asDict = (v: unknown): Dict => (v && typeof v === 'object' ? (v as Dict) : {});
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asNum = (v: unknown): number | null => (Number.isFinite(Number(v)) ? Number(v) : null);
const asStr = (v: unknown, fb = '—'): string => (v == null || v === '' ? fb : String(v));

const POLL_MS = 60_000;

const VERDICT_STYLE: Record<string, string> = {
  STABLE: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  'LEARNING READY': 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  DRIFTING: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  'NOT ENOUGH DATA': 'bg-slate-600/20 text-slate-400 border-slate-600/30',
  'NO DATA': 'bg-slate-600/20 text-slate-400 border-slate-600/30',
  ALARM: 'bg-red-500/15 text-red-300 border-red-500/40',
};
const verdictChip = (v: string) =>
  `px-2 py-0.5 rounded-lg border text-[10px] font-black font-mono ${VERDICT_STYLE[v] || 'bg-slate-600/20 text-slate-400 border-slate-600/30'}`;

const STAGE_META: Record<number, { label: string; cls: string }> = {
  0: { label: 'STAGE 0 · NO FUEL', cls: 'bg-slate-600/20 text-slate-300 border-slate-600/30' },
  1: { label: 'STAGE 1 · MEASURING', cls: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40' },
  2: { label: 'STAGE 2 · LEARNING', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40' },
  3: { label: 'STAGE 3 · EVOLVING', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' },
};

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-[10px] text-slate-500 font-mono">{label}</span>
      <span className="text-[11px] text-slate-200 font-mono font-bold text-right" title={hint}>{value}</span>
    </div>
  );
}

function SelfImprovementPanelInner() {
  const [view, setView] = useState<Dict | null>(null);
  const [proposals, setProposals] = useState<Dict | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([
        apiFetch(`${getProxyBase()}/api/ai/self/status?t=${Date.now()}`, { signal: AbortSignal.timeout(12000) }).then(r => r.json()),
        apiFetch(`${getProxyBase()}/api/ai/self/proposals?t=${Date.now()}`, { signal: AbortSignal.timeout(12000) }).then(r => r.json()),
      ]);
      if (!alive.current) return;
      setView(asDict(s));
      setProposals(asDict(p));
      setErr(null);
    } catch {
      if (alive.current) setErr('self status poll failed — 60s me auto-retry');
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    refresh();
    // v20.2 D16: visibility-gated — hidden tab pe network poll band.
    const t = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
    return () => { alive.current = false; clearInterval(t); };
  }, [refresh]);

  const act = useCallback(async (key: string, path: string, label: string) => {
    setBusy(key); setMsg(null); setErr(null);
    try {
      const r = await apiFetch(`${getProxyBase()}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(90000),
      });
      const j = await r.json().catch(() => ({}));
      if (!alive.current) return;
      if (!r.ok) setErr(`${label}: ${asStr(asDict(j).error, asStr(asDict(j).note, `HTTP ${r.status}`))}`);
      else setMsg(`${label}: ${asStr(asDict(j).note ?? asDict(j).verdict ?? asStr(asDict(j).status, 'done'), 'done')}`);
      await refresh();
    } catch (e) {
      if (alive.current) setErr(`${label} failed — ${String((e as Error)?.message || e).slice(0, 80)}`);
    } finally {
      if (alive.current) setBusy(null);
    }
  }, [refresh]);

  const decide = useCallback(async (id: string, verb: 'approve' | 'reject' | 'rollback') => {
    setBusy(`${verb}-${id}`); setMsg(null); setErr(null);
    try {
      const base = `${getProxyBase()}/api/ai/self/proposal/${encodeURIComponent(id)}`;
      const r = verb === 'approve'
        ? await apiFetch(`${base}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15000) })
        : verb === 'reject'
          ? await apiFetch(`${base}/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15000) })
          : await apiFetch(`${base}/rollback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15000) });
      const j = await r.json().catch(() => ({}));
      if (!alive.current) return;
      if (!r.ok || asDict(j).ok === false) setErr(asStr(asDict(j).note ?? asDict(j).error, `HTTP ${r.status}`));
      else setMsg(`proposal ${verb}: ${asStr(asDict(j).note, 'done')}`);
      await refresh();
    } catch (e) {
      if (alive.current) setErr(`proposal ${verb} failed — ${String((e as Error)?.message || e).slice(0, 80)}`);
    } finally {
      if (alive.current) setBusy(null);
    }
  }, [refresh]);

  const phases = asDict(view?.phases);
  const data = asDict(phases.data);
  const drift = asDict(phases.drift);
  const learning = asDict(phases.learning);
  const lessons = asDict(phases.lessons);
  const evolution = asDict(phases.evolution);
  const governance = asDict(phases.governance);
  const stage = asDict(view?.stage);
  const stageMeta = STAGE_META[asNum(stage.stage) ?? 0] || STAGE_META[0];
  const govCounts = asDict(governance.counts);
  const pendingProposals = asArr(asDict(proposals).proposals).filter(p => asDict(p).status === 'pending');
  const recentChanges = asArr(view?.recentChanges).slice().reverse().slice(0, 12);

  const btn = (key: string, path: string, label: string, cls = '') => (
    <button
      disabled={busy !== null}
      onClick={() => act(key, path, label)}
      className={`px-2.5 py-1 rounded-lg text-[10px] font-black font-mono border disabled:opacity-40 ${cls || 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40 hover:bg-cyan-500/25'}`}
    >
      {busy === key ? '…' : label}
    </button>
  );

  return (
    <div className="quantum-panel rounded-2xl p-4 bg-gradient-to-r from-fuchsia-500/[0.06] via-transparent to-cyan-500/[0.06]">
      {/* header */}
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <span className="text-2xl">🧬</span>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-black gradient-text-cyan tracking-wide">SELF-IMPROVEMENT ENGINE</h3>
            <span className="quantum-badge">v19.0</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            harvest → drift → learn → propose → approve — tamper-evident evolution ledger ke saath (har self-modification SHA-256 chained)
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className={`px-2.5 py-1 rounded-lg border text-[10px] font-black font-mono ${stageMeta.cls}`}>{stageMeta.label}</span>
        </div>
      </div>

      {/* stage note */}
      <div className="mb-3 rounded-lg border border-white/5 bg-black/25 px-3 py-2 text-[10px] text-slate-400 font-mono leading-relaxed">
        {asStr(stage.note, 'stage compute pending — pehla poll aane do')}
      </div>

      {/* actions */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {btn('harvest', '/api/ai/self/harvest', 'HARVEST OUTCOMES')}
        {btn('drift', '/api/ai/self/drift', 'DRIFT CHECK')}
        {btn('lessons', '/api/ai/self/lessons/run', 'RUN LESSONS', 'bg-amber-500/15 text-amber-300 border-amber-500/40 hover:bg-amber-500/25')}
        {btn('retrain', '/api/ai/self/retrain', 'ML RETRAIN', 'bg-violet-500/15 text-violet-300 border-violet-500/40 hover:bg-violet-500/25')}
        {btn('gatetune', '/api/ai/self/gate-tune', 'GATE-TUNE (PROPOSAL)', 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/25')}
        {btn('evolve', '/api/ai/self/evolve', 'EVOLVE STRATEGIES', 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/40 hover:bg-fuchsia-500/25')}
        {btn('repair', '/api/ai/self/repair', 'SELF-REPAIR', 'bg-orange-500/15 text-orange-300 border-orange-500/40 hover:bg-orange-500/25')}
      </div>

      {(msg || err) && (
        <div className={`mb-3 rounded-lg border px-3 py-1.5 text-[10px] font-mono ${err ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}>
          {err || msg}
        </div>
      )}

      {/* phase grid */}
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {/* PHASE 1 — DATA */}
        <div className="rounded-xl border border-white/5 bg-black/25 p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-black text-slate-300 font-mono tracking-wide">1 · OUTCOME DATASET</span>
            <span className={verdictChip(asStr(data.verdict, 'NO DATA'))}>{asStr(data.verdict, 'NO DATA')}</span>
          </div>
          <Row label="settled rows" value={asStr(asNum(data.n) ?? 0)} hint="ledger ke settled trades se harvester ne banaye (min 40 = learning-ready)" />
          <Row label="win rate" value={asNum(data.winRate) != null ? `${asNum(data.winRate)}%` : '—'} />
          <Row label="expectancy" value={asNum(data.expectancyR) != null ? `${asNum(data.expectancyR)}R` : '—'} />
          <Row label="freshness" value={asNum(data.freshnessHours) != null ? `${asNum(data.freshnessHours)}h` : '—'} />
          <div className="mt-1 text-[9px] text-slate-500 font-mono leading-relaxed">{asStr(data.note, '')}</div>
        </div>

        {/* PHASE 1 — DRIFT */}
        <div className="rounded-xl border border-white/5 bg-black/25 p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-black text-slate-300 font-mono tracking-wide">1 · DRIFT WATCH</span>
            <span className={verdictChip(asStr(drift.verdict, '…'))}>{asStr(drift.verdict, '…')}</span>
          </div>
          <Row label="vote drift (PSI)" value={asStr(asDict(drift.voteDrift).verdict, '—')} hint="per-model vote distribution old vs new half — PSI industry buckets" />
          <Row label="calibration" value={asStr(asDict(drift.calibrationDrift).verdict, '—')} hint="claimed vs realized confidence + Brier" />
          <Row label="performance" value={asStr(asDict(drift.performanceDrift).verdict, '—')} hint="30d vs 90d model hit-rate windows" />
          <div className="mt-1 text-[9px] text-slate-500 font-mono leading-relaxed">{asStr(drift.summary, '')}</div>
        </div>

        {/* PHASE 2 — LEARNING */}
        <div className="rounded-xl border border-white/5 bg-black/25 p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-black text-slate-300 font-mono tracking-wide">2 · RETRAIN + SHADOW</span>
            <span className={`px-2 py-0.5 rounded-lg border text-[10px] font-black font-mono ${asDict(learning.challenger).predictions ? 'bg-violet-500/15 text-violet-300 border-violet-500/40' : 'bg-slate-600/20 text-slate-400 border-slate-600/30'}`}>
              {asDict(learning.challenger).predictions ? 'CHALLENGER LIVE' : 'NO RETRAIN YET'}
            </span>
          </div>
          <Row label="auto-retrain" value={learning.autoRetrainEnabled ? 'ON (drift-alarm fires)' : 'OFF (manual)'} hint="SELFIMPROVE_AUTO_RETRAIN" />
          <Row label="last retrain" value={asNum(learning.lastRetrainAt) ? new Date(asNum(learning.lastRetrainAt)!).toLocaleString('en-IN', { hour12: false }) : 'kabhi nahi'} />
          <Row label="champion agree" value={asNum(asDict(learning.champion).agreementPct) != null ? `${asNum(asDict(learning.champion).agreementPct)}%` : '—'} />
          <Row label="challenger agree" value={asNum(asDict(learning.challenger).agreementPct) != null ? `${asNum(asDict(learning.challenger).agreementPct)}% (${asNum(asDict(learning.challenger).predictions) ?? 0}/200)` : '—'} />
          <div className="mt-1 text-[9px] text-slate-500 font-mono leading-relaxed">{asStr(learning.note, '')}</div>
        </div>

        {/* PHASE 3a — LESSONS */}
        <div className="rounded-xl border border-white/5 bg-black/25 p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-black text-slate-300 font-mono tracking-wide">3 · LESSONS LEARNED</span>
            <span className="px-2 py-0.5 rounded-lg border text-[10px] font-black font-mono bg-amber-500/15 text-amber-300 border-amber-500/40">
              v{asStr(lessons.version, '0')} · {asStr(String(asNum(lessons.count) ?? 0), '0')} lessons
            </span>
          </div>
          <div className="mt-1 space-y-1 max-h-28 overflow-y-auto scroll-thin">
            {!asNum(lessons.count) && (
              <div className="text-[9px] text-slate-500 font-mono">abhi koi lesson nahi — RUN LESSONS dabao (settled trades ≥ 20 hone par LLM narrates, warna deterministic)</div>
            )}
            {/* lessons list fetched from /api/ai/self/lessons lazily below */}
            <LessonsList />
          </div>
        </div>

        {/* PHASE 4 — EVOLUTION LEDGER */}
        <div className="rounded-xl border border-white/5 bg-black/25 p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-black text-slate-300 font-mono tracking-wide">4 · EVOLUTION LEDGER</span>
            <span className={`px-2 py-0.5 rounded-lg border text-[10px] font-black font-mono ${evolution.verified ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' : 'bg-red-500/15 text-red-300 border-red-500/40'}`}>
              {evolution.verified ? 'CHAIN VERIFIED' : 'CHAIN BROKEN'}
            </span>
          </div>
          <Row label="total changes" value={asStr(asNum(evolution.total) ?? 0)} />
          <Row label="last 24h" value={asStr(asNum(evolution.last24h) ?? 0)} />
          <div className="mt-1.5 space-y-0.5 max-h-24 overflow-y-auto scroll-thin">
            {recentChanges.map((c, i) => {
              const ce = asDict(c);
              return (
                <div key={i} className="text-[9px] text-slate-500 font-mono truncate" title={asStr(ce.summary)}>
                  <span className="text-slate-600">{new Date(asNum(ce.ts) ?? Date.now()).toLocaleTimeString('en-IN', { hour12: false })}</span>{' '}
                  <span className="text-cyan-400/80">[{asStr(ce.kind)}]</span> {asStr(ce.summary)}
                </div>
              );
            })}
            {!recentChanges.length && <div className="text-[9px] text-slate-500 font-mono">ledger khali — pehli harvest/lesson/retrain se shuru hoga</div>}
          </div>
        </div>

        {/* PHASE 5 — GOVERNANCE */}
        <div className="rounded-xl border border-white/5 bg-black/25 p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-black text-slate-300 font-mono tracking-wide">5 · SELF-COUNCIL</span>
            <span className={`px-2 py-0.5 rounded-lg border text-[10px] font-black font-mono ${asDict(governance.killSwitch).enabled === false ? 'bg-red-500/15 text-red-300 border-red-500/40' : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'}`}>
              {asDict(governance.killSwitch).enabled === false ? 'KILL-SWITCH ON' : 'LIVE'}
            </span>
          </div>
          <Row label="auto-tune (safe tier)" value={asDict(governance.autoTune).enabled ? 'ON — 24h rule' : 'OFF — manual approve'} hint="SELFIMPROVE_AUTO_TUNE" />
          <Row label="proposals" value={`pending ${asStr(asNum(govCounts.pending) ?? 0)} · applied ${asStr(asNum(govCounts.applied) ?? 0)} · rejected ${asStr(asNum(govCounts.rejected) ?? 0)} · rolled-back ${asStr(asNum(govCounts.rolledBack) ?? 0)}`} />
          <div className="mt-1.5 space-y-1.5 max-h-32 overflow-y-auto scroll-thin">
            {pendingProposals.map((p) => {
              const pe = asDict(p);
              const id = asStr(pe.id);
              return (
                <div key={id} className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-2 py-1.5">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-black font-mono ${pe.tier === 'risky' ? 'bg-red-500/15 text-red-300 border border-red-500/30' : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'}`}>
                      {asStr(pe.tier, '?').toUpperCase()}
                    </span>
                    <span className="text-[9px] text-slate-400 font-mono">{asStr(pe.kind)}</span>
                  </div>
                  <div className="text-[10px] text-slate-300 font-mono leading-snug mb-1">{asStr(pe.summary)}</div>
                  <div className="flex gap-1.5">
                    <button disabled={busy !== null} onClick={() => decide(id, 'approve')}
                      className="px-2 py-0.5 rounded text-[9px] font-black font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/25 disabled:opacity-40">
                      {busy === `approve-${id}` ? '…' : 'APPROVE'}
                    </button>
                    <button disabled={busy !== null} onClick={() => decide(id, 'reject')}
                      className="px-2 py-0.5 rounded text-[9px] font-black font-mono bg-red-500/15 text-red-300 border border-red-500/40 hover:bg-red-500/25 disabled:opacity-40">
                      {busy === `reject-${id}` ? '…' : 'REJECT'}
                    </button>
                  </div>
                </div>
              );
            })}
            {!pendingProposals.length && <div className="text-[9px] text-slate-500 font-mono">koi pending proposal nahi — gate-tune/evolution se naye aayenge (risky tier hamesha human-approved)</div>}
          </div>
        </div>
      </div>

      {/* applied (rollback-able) */}
      {asArr(asDict(proposals).proposals).some(p => asDict(p).status === 'applied') && (
        <div className="mt-2.5 rounded-xl border border-white/5 bg-black/25 p-3">
          <div className="text-[10px] font-black text-slate-300 font-mono tracking-wide mb-1.5">APPLIED — ROLLBACK AVAILABLE</div>
          <div className="space-y-1">
            {asArr(asDict(proposals).proposals).filter(p => asDict(p).status === 'applied').slice(0, 5).map((p) => {
              const pe = asDict(p);
              const id = asStr(pe.id);
              return (
                <div key={id} className="flex items-center gap-2 justify-between">
                  <div className="text-[10px] text-slate-400 font-mono truncate" title={asStr(pe.summary)}>{asStr(pe.summary)}</div>
                  <button disabled={busy !== null} onClick={() => decide(id, 'rollback')}
                    className="px-2 py-0.5 rounded text-[9px] font-black font-mono bg-orange-500/15 text-orange-300 border border-orange-500/40 hover:bg-orange-500/25 disabled:opacity-40 shrink-0">
                    {busy === `rollback-${id}` ? '…' : 'ROLLBACK'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="mt-2.5 text-[9px] text-slate-500 font-mono leading-relaxed">
        SAFETY: proposals only — safe tier (gate numerics) 24h baad auto sirf SELFIMPROVE_AUTO_TUNE=true par; risky tier (desks/scope) HAMESHA human-approved · har change evolution-ledger me SHA-256 chained · 1-click ROLLBACK · kill-switch SELFIMPROVE_ENABLED=false ·
        auto-trading scope: FUTURES (USDT) + EQUITY SIM (USDC) — SPOT auto-entry OFF
      </p>
    </div>
  );
}

/** Lazy lessons list (separate small fetch — panel status me sirf meta hai). */
function LessonsList() {
  const [items, setItems] = useState<unknown[]>([]);
  useEffect(() => {
    let alive = true;
    apiFetch(`${getProxyBase()}/api/ai/self/lessons?t=${Date.now()}`, { signal: AbortSignal.timeout(10000) })
      .then(r => r.json())
      .then(j => { if (alive) setItems(asArr(asDict(j).lessons)); })
      .catch(() => { /* honest empty */ });
    return () => { alive = false; };
  }, []);
  if (!items.length) return null;
  return (
    <>
      {items.map((l, i) => {
        const le = asDict(l);
        const sev = asStr(le.severity, 'info');
        return (
          <div key={i} className={`rounded-lg border px-2 py-1 text-[9px] font-mono leading-snug ${sev === 'critical' ? 'border-red-500/30 bg-red-500/[0.06] text-red-300' : sev === 'warn' ? 'border-amber-500/30 bg-amber-500/[0.06] text-amber-300' : 'border-cyan-500/30 bg-cyan-500/[0.06] text-cyan-300'}`}>
            <span className="font-black">[{sev.toUpperCase()}]</span> {asStr(le.title)} — {asStr(le.rule)}
          </div>
        );
      })}
    </>
  );
}

export const SelfImprovementPanel = memo(SelfImprovementPanelInner);
export default SelfImprovementPanel;
