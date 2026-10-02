// ============================================================
// src/components/aitrading/deepAnalysisExtras.tsx — v20.7.5
// ------------------------------------------------------------
// THE DEEP ENSEMBLE ANALYSIS ACCURACY UPGRADE (the user's "deep
// analysis galat / purana info dikhati hai" fix, superintelligence
// edition). Three pieces, shared by BOTH desks' deep modals:
//
//  1. useDeepAutoRecheck — while the modal is open, the analysis
//     RE-RUNS ITSELF every 15s (cache-riding, the user's "every
//     15 sec recheck" ask applied to the open analysis itself).
//     Grade/side/confidence transitions land in a visible log —
//     "STRONG LONG 82% → ACTION LONG 71%" is now SEEN, not felt.
//  2. DeepFreshnessChip — "RECHECKED Xs ago · AUTO 15s" — the
//     data's age is a first-class citizen (the #1 source of
//     "inaccurate" reads was a 30s-old answer next to a live
//     price, with no way to tell).
//  3. DeepIndicatorGrid — the FULL transparency snapshot: the
//     classic stack (RSI/ADX/MACD/EMA/Bollinger/ATR/VWAP/…) AND
//     the v20.7.4 confluence stack (Fib golden pocket · Volume
//     Profile POC/VAH/VAL · chart patterns · supply/demand zones
//     · price-action stats · EMA100/200). Every number the 12
//     committee seats voted on, on the table.
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AISignal } from './types';
import type { DeepSignalResult } from './useAITrading';

export const DEEP_RECHECK_SEC = 15;

export interface DeepModalState {
  loading: boolean;
  signal?: AISignal;
  indicators?: Record<string, unknown>;
  narrative?: DeepSignalResult['narrative'];
  ltf?: DeepSignalResult['ltf'];
  edge?: DeepSignalResult['edge'];
  error?: string;
  /** v20.7.5: server compute stamp of the payload being viewed. */
  recheckedAt?: number | null;
}

export interface DeepLogEntry { at: number; note: string; tone: 'bad' | 'good' | 'info'; }

const GRADE_RANK: Record<string, number> = { NEUTRAL: 0, WATCH: 1, ACTION: 2, STRONG: 3 };
const num = (v: unknown): number | null => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
const fmt = (v: number | null | undefined, d = 2): string => (v == null ? '—' : v.toFixed(d));

/**
 * The 15s self-recheck of an OPEN deep modal.
 * - ticks a 1s countdown for the chip
 * - every 15s re-fetches the analysis (server cache rides ~50% of
 *   calls; the other half is a fresh ensemble run)
 * - side/grade/confidence transitions append to the visible log
 * - a stale response (modal closed / re-opened mid-flight) is dropped
 *   by the SAME request-token discipline the manual open uses
 */
export function useDeepAutoRecheck(
  deep: DeepModalState | null,
  setDeep: (d: DeepModalState | null) => void,
  fetchDeep: (symbol: string, market: 'INDIA' | 'CRYPTO' | 'FUTURES' | 'GLOBALFUTURES', opts?: { fresh?: boolean }) => Promise<DeepSignalResult>,
  reqRef: React.MutableRefObject<number>,
  market: 'INDIA' | 'CRYPTO' | 'FUTURES' | 'GLOBALFUTURES',
) {
  const [log, setLog] = useState<DeepLogEntry[]>([]);
  const [nextInS, setNextInS] = useState<number | null>(null);
  const [rechecks, setRechecks] = useState(0);
  const openedAt = useRef<number>(0);
  const sig = deep?.signal && !deep.loading ? deep.signal : null;

  // reset when a NEW analysis opens
  useEffect(() => {
    if (deep?.loading) { openedAt.current = Date.now(); setLog([]); setRechecks(0); setNextInS(null); }
  }, [deep?.loading, sig?.symbol, sig?.market]); // eslint-disable-line react-hooks/exhaustive-deps

  const appendLog = useCallback((note: string, tone: DeepLogEntry['tone']) => {
    setLog(l => [{ at: Date.now(), note, tone }, ...l].slice(0, 5));
  }, []);

  useEffect(() => {
    if (!sig) return;
    const symbol = sig.symbol;
    let cancelled = false;
    let elapsed = 0;
    // the recheck pass (fires immediately when the countdown hits 0)
    const run = async () => {
      const id = reqRef.current;
      const r = await fetchDeep(symbol, market, { fresh: false });
      if (cancelled || reqRef.current !== id || !r.ok || !r.signal) return;
      const prev = sig;
      const now = r.signal;
      // transitions the user should SEE (the "wrong info" complaint was
      // often the analysis silently drifting while the modal sat open)
      if (prev.side !== now.side) {
        appendLog(`SIDE FLIP: ${prev.side} → ${now.side} ${now.grade} ${now.confidence ?? '?'}%`, now.side === prev.side ? 'info' : 'bad');
      } else {
        const pr = GRADE_RANK[prev.grade] ?? 0, nr = GRADE_RANK[now.grade] ?? 0;
        if (nr < pr) appendLog(`GRADE ↓ ${prev.grade} ${prev.confidence ?? '?'}% → ${now.grade} ${now.confidence ?? '?'}%`, 'bad');
        else if (nr > pr) appendLog(`GRADE ↑ ${prev.grade} → ${now.grade} ${now.confidence ?? '?'}%`, 'good');
        else if (Math.abs((now.confidence ?? 0) - (prev.confidence ?? 0)) >= 8) {
          appendLog(`conf ${prev.confidence ?? '?'}% → ${now.confidence ?? '?'}%`, (now.confidence ?? 0) < (prev.confidence ?? 0) ? 'info' : 'good');
        }
      }
      setRechecks(n => n + 1);
      setDeep({ loading: false, signal: now, indicators: r.indicators, narrative: r.narrative, ltf: r.ltf, edge: r.edge, recheckedAt: r.recheckedAt ?? Date.now() });
    };
    // 1s ticker: countdown chip + fires the pass at each 15s boundary
    const timer = setInterval(() => {
      elapsed += 1;
      const rem = DEEP_RECHECK_SEC - (elapsed % DEEP_RECHECK_SEC);
      setNextInS(rem);
      if (elapsed % DEEP_RECHECK_SEC === 0) { run().catch(() => {}); }
    }, 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [sig?.symbol, sig?.market, sig?.side, sig?.grade, market, fetchDeep, setDeep, appendLog]); // eslint-disable-line react-hooks/exhaustive-deps

  return { log, nextInS, rechecks };
}

/** "RECHECKED Xs ago · AUTO 15s" — freshness as a first-class chip. */
export function DeepFreshnessChip({ recheckedAt, nextInS, rechecks }: { recheckedAt?: number | null; nextInS: number | null; rechecks: number }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const ageS = recheckedAt ? Math.max(0, Math.round((Date.now() - recheckedAt) / 1000)) : null;
  return (
    <div className="flex items-center gap-1.5" title="Deep ensemble analysis khud ko har 15s me recheck karti hai — fresh ensemble run + live transitions ka log. Data ki age hamesha visible hai.">
      <span className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-black border bg-cyan-500/10 text-cyan-300 border-cyan-500/30">
        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
        AUTO-RECHECK 15s{nextInS != null ? ` · next ${nextInS}s` : ''}
      </span>
      {ageS != null && (
        <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black border ${ageS <= 20 ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : ageS <= 60 ? 'bg-amber-500/10 text-amber-300 border-amber-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30'}`}>
          DATA {ageS}s old
        </span>
      )}
      {rechecks > 0 && <span className="px-2 py-0.5 rounded-lg text-[9px] font-black border bg-slate-600/20 text-slate-400 border-slate-600/30">↻ {rechecks}</span>}
    </div>
  );
}

/** The visible transition history of the open analysis. */
export function DeepTransitionLog({ log }: { log: DeepLogEntry[] }) {
  if (!log.length) return null;
  const toneCls = (t: DeepLogEntry['tone']) => t === 'bad' ? 'text-red-300' : t === 'good' ? 'text-emerald-300' : 'text-cyan-300';
  return (
    <div className="mt-3 bg-black/25 rounded-xl p-2.5" aria-label="auto-recheck transitions">
      <div className="text-[10px] font-black text-slate-500 tracking-wider mb-1.5">AUTO-RECHECK TRANSITIONS — khud badla hua analysis, live dikhta hai</div>
      <ul className="space-y-1">
        {log.map((l, i) => (
          <li key={`${l.at}-${i}`} className="flex items-center gap-2 text-[10px] font-mono">
            <span className="text-slate-600">{new Date(l.at).toLocaleTimeString('en-IN', { hour12: false })}</span>
            <span className={toneCls(l.tone)}>{l.note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------- the full transparency grid ----------------
type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : null);

function Cell({ k, v, tone }: { k: string; v: string; tone?: 'good' | 'bad' | 'warn' }) {
  const cls = tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-red-300' : tone === 'warn' ? 'text-amber-300' : 'text-slate-200';
  return (
    <div className="flex justify-between bg-black/30 rounded px-2 py-1 gap-1.5">
      <span className="text-slate-500 uppercase truncate">{k}</span>
      <span className={`${cls} text-right`}>{v}</span>
    </div>
  );
}

/**
 * EVERY indicator the committee seats read — the classic stack +
 * the v20.7.4 confluence stack (Fib · Volume Profile · patterns ·
 * S/D zones · price action · EMA100/200). Missing fields render
 * an honest '—' (feed-level honesty, never a fake number).
 */
export function DeepIndicatorGrid({ ind }: { ind?: Record<string, unknown> | null }) {
  if (!ind) return null;
  const i = ind;
  const adx = asRec(i.adx);
  const st = asRec(i.stochastic);
  const macd = asRec(i.macd);
  const bb = asRec(i.bollinger);
  const superTrend = asRec(i.supertrend);
  const fib = asRec(i.fib);
  const vp = asRec(i.volumeProfile);
  const sd = asRec(i.supplyDemand);
  const pa = asRec(i.priceAction);
  const patterns = Array.isArray(i.chartPatterns) ? (i.chartPatterns as Rec[]) : [];
  const rsi = num(i.rsi);
  const ema = (k: string) => num(i[k]);
  const emaStack = [ema('ema10'), ema('ema20'), ema('ema50'), ema('ema100'), ema('ema200')];
  const stackKnown = emaStack.filter(v => v != null).length >= 3;
  const stackBull = stackKnown && emaStack.slice(0, 3).every((v, idx, arr) => v != null && (arr[idx - 1] == null || v < (arr[idx - 1] as number))) && (ema('ema10') ?? 0) > (ema('ema20') ?? 0) && (ema('ema20') ?? 0) > (ema('ema50') ?? 0);
  const stackBear = stackKnown && (ema('ema10') ?? 0) < (ema('ema20') ?? 0) && (ema('ema20') ?? 0) < (ema('ema50') ?? 0);

  return (
    <div className="mt-3 bg-black/25 rounded-xl p-3">
      <div className="text-[10px] font-black text-slate-500 tracking-wider mb-2">FULL INDICATOR SNAPSHOT — jo committee ne padha, wahi aap padho</div>

      {/* classic momentum/trend block */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[10px] font-mono">
        <Cell k="rsi" v={rsi == null ? '—' : fmt(rsi, 1)} tone={rsi == null ? undefined : rsi >= 70 ? 'warn' : rsi <= 30 ? 'warn' : undefined} />
        <Cell k="adx" v={adx ? `${fmt(num(adx.adx), 1)}` : '—'} tone={adx && (num(adx.adx) ?? 0) >= 25 ? 'good' : undefined} />
        <Cell k="di" v={adx && num(adx.plusDI) != null ? `+${fmt(num(adx.plusDI), 1)}/−${fmt(num(adx.minusDI), 1)}` : '—'} />
        <Cell k="macd-h" v={macd && num(macd.hist) != null ? fmt(num(macd.hist), 4) : '—'} tone={macd && (num(macd.hist) ?? 0) > 0 ? 'good' : macd && (num(macd.hist) ?? 0) < 0 ? 'bad' : undefined} />
        <Cell k="stoch" v={st && num(st.k) != null ? `${fmt(num(st.k), 0)}/${fmt(num(st.d), 0)}` : '—'} />
        <Cell k="atr" v={fmt(num(i.atr), 4)} />
        <Cell k="vwap" v={fmt(num(i.vwap), 2)} />
        <Cell k="supertrend" v={superTrend ? (num(superTrend.direction) === 1 ? 'BULL' : num(superTrend.direction) === -1 ? 'BEAR' : '—') : '—'} tone={superTrend && num(superTrend.direction) === 1 ? 'good' : superTrend && num(superTrend.direction) === -1 ? 'bad' : undefined} />
        <Cell k="bb %b" v={(() => { const b = num(bb?.percentB); return b == null ? '—' : `${fmt(b * 100, 0)}%`; })()} />
        <Cell k="mfi" v={fmt(num(i.mfi), 0)} />
        <Cell k="obv-slope" v={num(i.obvSlope) == null ? '—' : (num(i.obvSlope) as number) > 0 ? '↗ accum' : '↘ dist'} tone={num(i.obvSlope) == null ? undefined : (num(i.obvSlope) as number) > 0 ? 'good' : 'bad'} />
        <Cell k="rel-vol" v={num(i.relVolume) == null ? '—' : `${fmt(num(i.relVolume), 2)}×`} tone={num(i.relVolume) != null && (num(i.relVolume) as number) >= 1.5 ? 'good' : undefined} />
        <Cell k="ema10/20" v={ema('ema10') != null && ema('ema20') != null ? `${fmt(ema('ema10'), 2)}/${fmt(ema('ema20'), 2)}` : '—'} />
        <Cell k="ema50" v={fmt(ema('ema50'), 2)} />
        <Cell k="ema100" v={fmt(ema('ema100'), 2)} />
        <Cell k="ema200" v={fmt(ema('ema200'), 2)} />
        <Cell k="ema-stack" v={stackBull ? 'BULL 10>20>50' : stackBear ? 'BEAR 10<20<50' : stackKnown ? 'MIXED' : '—'} tone={stackBull ? 'good' : stackBear ? 'bad' : undefined} />
        <Cell k="roc-10" v={fmt(num(i.roc), 2) + '%'} tone={num(i.roc) == null ? undefined : (num(i.roc) as number) > 0 ? 'good' : 'bad'} />
      </div>

      {/* v20.7.4 confluence stack — the deep in "deep ensemble analysis" */}
      <div className="text-[10px] font-black text-amber-400/80 tracking-wider mt-3 mb-1.5">CONFLUENCE STACK — Fib · Volume Profile · Patterns · S/D · Price Action</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[10px] font-mono">
        <Cell
          k="fib swing"
          v={fib ? `${String(fib.direction).toUpperCase()} · ${fmt(num(fib.positionPct), 0)}%` : '—'}
          tone={fib ? (String(fib.direction) === 'up' ? 'good' : 'bad') : undefined}
        />
        <Cell
          k="golden pocket"
          v={fib && asRec(fib.goldenPocket) ? `${fmt(num(asRec(fib.goldenPocket)?.low), 2)}–${fmt(num(asRec(fib.goldenPocket)?.high), 2)}` : '—'}
          tone={fib?.inGoldenPocket ? 'warn' : undefined}
        />
        <Cell k="in-gp" v={fib ? (fib.inGoldenPocket ? 'YES ✓' : 'no') : '—'} tone={fib?.inGoldenPocket ? 'warn' : undefined} />
        <Cell k="fib bias" v={fib ? (num(fib.bias) === 1 ? 'BULL' : num(fib.bias) === -1 ? 'BEAR' : 'neutral') : '—'} tone={num(fib?.bias) === 1 ? 'good' : num(fib?.bias) === -1 ? 'bad' : undefined} />
        <Cell k="vp poc" v={fmt(num(vp?.poc), 2)} tone={vp ? (vp.priceVsPoc === 'above' ? 'good' : 'bad') : undefined} />
        <Cell k="vp va" v={vp ? `${fmt(num(vp.vah), 2)} / ${fmt(num(vp.val), 2)}` : '—'} />
        <Cell k="price vs poc" v={vp ? String(vp.priceVsPoc).toUpperCase() : '—'} tone={vp?.priceVsPoc === 'above' ? 'good' : vp?.priceVsPoc === 'below' ? 'bad' : undefined} />
        <Cell k="in value-area" v={vp ? (vp.inValueArea ? 'YES ✓' : 'no') : '—'} />
        {patterns.length > 0 ? patterns.slice(0, 2).map((p, idx) => (
          <Cell key={`pat-${idx}`} k={idx === 0 ? 'pattern' : '+'} v={`${String(p.name)} · ${num(p.confidence) ?? '?'}%`} tone={num(p.dir) === 1 ? 'good' : 'bad'} />
        )) : <Cell k="patterns" v="—" />}
        {patterns.length > 0 && patterns.length < 2 && <Cell k="patterns" v="1 found" />}
        <Cell
          k="demand zone"
          v={sd && asRec(sd.demand) ? `${fmt(num(asRec(sd.demand)?.bottom), 2)}–${fmt(num(asRec(sd.demand)?.top), 2)}${asRec(sd.demand)?.inZone ? ' · IN' : ` · ${fmt(num(asRec(sd.demand)?.nearPct), 1)}%`}` : '—'}
          tone={asRec(sd?.demand)?.inZone ? 'good' : undefined}
        />
        <Cell
          k="supply zone"
          v={sd && asRec(sd.supply) ? `${fmt(num(asRec(sd.supply)?.bottom), 2)}–${fmt(num(asRec(sd.supply)?.top), 2)}${asRec(sd.supply)?.inZone ? ' · IN' : ` · ${fmt(num(asRec(sd.supply)?.nearPct), 1)}%`}` : '—'}
          tone={asRec(sd?.supply)?.inZone ? 'bad' : undefined}
        />
        <Cell k="sd zones" v={sd ? `${String(sd.count)} scanned` : '—'} />
        <Cell k="pa clv" v={pa ? fmt(num(pa.clv), 2) : '—'} tone={pa && (num(pa.clv) ?? 0) > 0.3 ? 'good' : pa && (num(pa.clv) ?? 0) < -0.3 ? 'bad' : undefined} />
        <Cell k="pa bars" v={pa ? `${String(pa.upBars)}↑ / ${String(pa.downBars)}↓` : '—'} />
        <Cell k="pa body" v={(() => { const b = num(pa?.bodyRatio); return b == null ? '—' : `${fmt(b * 100, 0)}%`; })()} />
        <Cell k="pa range-pos" v={pa ? `${fmt(num(pa.rangePositionPct), 0)}%` : '—'} tone={pa && (num(pa.rangePositionPct) ?? 50) >= 70 ? 'good' : pa && (num(pa.rangePositionPct) ?? 50) <= 30 ? 'bad' : undefined} />
        <Cell k="pa bias" v={pa ? (num(pa.trendBias) === 1 ? 'BULL' : num(pa.trendBias) === -1 ? 'BEAR' : 'flat') : '—'} tone={num(pa?.trendBias) === 1 ? 'good' : num(pa?.trendBias) === -1 ? 'bad' : undefined} />
      </div>
      <div className="text-[9px] text-slate-600 mt-2 leading-relaxed">
        Ye values wahi hain jo 12+ committee models (TrendMatrix · Momentum · Volume · SMC · StructurePro · Tape …) ne vote dete waqt padhi thin. Model-wise reasoning signal card ke votes section me hai.
      </div>
    </div>
  );
}
