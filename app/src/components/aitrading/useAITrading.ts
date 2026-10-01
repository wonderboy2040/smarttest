// ============================================================
// src/components/aitrading/useAITrading.ts — data hook
// ------------------------------------------------------------
// Polls the /api/ai/* endpoints on a staggered cadence and exposes
// execute / config / kill-switch / close actions with honest
// loading + error states. Signals refresh every 30s (active tab
// only), options desk on demand per index.
// v7.0.1: positions poll is now DYNAMIC — 10s while any position is
// OPEN (realtime LTP + uPnL feel, server caches make it cheap), 45s
// when flat. Open positions are exactly when the user is watching.
//
// v10.5.3 REALTIME POSITIONS: while any position is open the hook
// subscribes to /api/ai/positions/stream (SSE) and merges per-row
// {ltp, unrealizedPnl} deltas in place — the panel updates on every
// price tick, price-driven (the old 5s REST poll is kept ONLY as the
// disconnect fallback + 45s reconciliation while streaming).
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, getProxyBase, getSessionToken } from '../../utils/api';
import { createTickBatcher } from '../../utils/tickBatcher';
import { desktopNotify, desktopNotifyPermission } from '../../utils/desktopNotify';
import type { AISignal, OptionsDesk, OptionSignalsView, OptionsScanView, SignalBoard, TradingState, JournalPosition, JournalEntry, BacktestResult, StrategyLabResult, AlertsStatus, DhanStatus, SwingBoard, WhaleRadar, LedgerView, MorningBrief, OrderbookView, AgentView, WalletView, FuturesMarketsView, MarketKind, TrustView, PerfView, CorrView, SectorView, IncomeView, NextActionsView, NarrativeView, EdgeStats, LtfSnapshot, CouncilStatusView, CouncilStamp, CouncilCalibrationView, NearMissEntry } from './types';

export interface DeepSignalResult {
  ok: boolean;
  signal?: AISignal;
  indicators?: Record<string, unknown>;
  /** v6.11: rule-based regime story (glama explain_ticker). */
  narrative?: NarrativeView | null;
  /** v6.12: LTF (15m/1h) indicator snapshot + walk-forward edge stats. */
  ltf?: LtfSnapshot | null;
  edge?: EdgeStats | null;
  priceSource?: string | null;
  error?: string;
}

export interface ExecuteResult {
  ok: boolean;
  error?: string;
  mode?: string;
  orderId?: string | null;
  filled?: { qty: number; price: number; notionalINR: number; leverage?: number; marginINR?: number };
  position?: JournalPosition;
  /** v6.4: set when the ATR stop was auto-fitted to the risk cap. */
  fitted?: string;
  /** v7.0.2: notify-mode server note (alert-only — no order/position). */
  note?: string;
}

/** v6.6: sizing + leverage parameters for a ticket execute. */
export interface ExecuteOpts {
  /** crypto: the MARGIN you commit (₹); india: the capital budget (₹) */
  qtyINR?: number;
  /** crypto only — clamped server-side to config.cryptoLeverage */
  leverage?: number;
}

/** v10.5.3: how the positions panel is being fed right now —
 *  'stream' = SSE diff-push (live, price-driven), 'poll' = REST
 *  fallback (5s while open), null = flat / not connected. */
export type PositionsFeed = 'stream' | 'poll' | null;

/** A per-position delta pushed by /api/ai/positions/stream `tick`. */
interface PositionTick {
  id: string;
  ltp?: number | null;
  unrealizedPnlINR?: number | null;
  unrealizedPnlUSDT?: number | null;
  usdInr?: number | null;
  priceSource?: string | null;
  sl?: number | null;
  tp?: number | null;
  tp2?: number | null;
  trailing?: 'breakeven' | 'trail' | null;
  tp1Hit?: boolean;
  tp2Hit?: boolean;
  exitStage?: string | null;
  qty?: number;
  ts?: number;
}

export function useAITrading(active: boolean, scope?: { markets?: Array<'INDIA' | 'CRYPTO' | 'FUTURES' | 'GLOBALFUTURES'> }) {
  // v6.9: market-scoped loading — the India desk only pays for the India
  // board; the CoinDCX desk loads spot + futures. Default = all (legacy).
  const markets = scope?.markets ?? ['INDIA', 'CRYPTO', 'FUTURES'];
  const [india, setIndia] = useState<SignalBoard | null>(null);
  const [crypto, setCrypto] = useState<SignalBoard | null>(null);
  const [futures, setFutures] = useState<SignalBoard | null>(null);
  const [globalFut, setGlobalFut] = useState<SignalBoard | null>(null); // v10.4 GLOBAL equity futures SIM desk
  const [state, setState] = useState<TradingState | null>(null);
  const [positions, setPositions] = useState<JournalPosition[]>([]);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // v7.0.2: board fetch failure state — a dead API used to render NOTHING
  // between the section header and the next section (silent hole).
  const [boardError, setBoardError] = useState(false);
  // v10.5.3 REALTIME POSITIONS: feed mode + reconnect epoch
  const [positionsLive, setPositionsLive] = useState<PositionsFeed>(null);
  const [positionsEpoch, setPositionsEpoch] = useState(0);
  const activeRef = useRef(active);
  activeRef.current = active;
  // v10.18 (deep-recheck #3): positions request sequence guard. Up to four
  // uncoordinated callers race through loadPositions (the 45s SSE-live
  // reconciliation poll, the 5s fallback poll, closePos/executeSignal
  // refreshes, the visibility refresh) — a slow REST response landing
  // AFTER a newer one used to wholesale-revert the panel (and a poll
  // started BEFORE a close that resolved AFTER closePos's own refresh
  // resurrected the just-closed position as OPEN for up to 45s). Only
  // the LATEST request's response applies.
  const posSeqRef = useRef(0);

  const loadBoards = useCallback(async (opts?: { rescan?: boolean }) => {
    // v12.5 RESCAN: ?rescan=1 → server-side noCache — a FULL fresh
    // universe scan (single-flight on the server). Cold scans are
    // heavier than the 60s-cache read — the timeout widens so a slow
    // universe (India 500+ names / 100+ pairs) can never race the abort.
    const rescan = !!opts?.rescan;
    const timeoutMs = rescan ? 90_000 : 30_000;
    // v12.7 BANDWIDTH: the `t=${Date.now()}` cache-buster is GONE — every
    // 30s poll used to force a full re-download of the (identical)
    // 100-400KB board inside the server's 60s cache window. Without the
    // buster, Express's weak ETag answers 304 for the byte-identical
    // cached board (zero body transfer). RESCAN keeps a distinct URL
    // (&rescan=1) so it always bypasses caches — by design.
    const qs = (m: string) => `market=${m}&limit=10${rescan ? '&rescan=1' : ''}`;
    const jobs: Array<Promise<void>> = [];
    let anyOk = false;
    const markOk = () => { anyOk = true; };
    // v18.5 FIX: a 304 (ETag revalidation of the byte-identical cached
    // board) is NOT a failure — it means "board unchanged, server healthy".
    // The old `r.ok ? r.json() : null` treated 304 as an error: state was
    // kept but markOk() was skipped → the tab flipped to "Signal board
    // unreachable" for a minute after every reload/revalidation. Now:
    // 304 → keep state + mark healthy; 200 → parse + set + mark healthy.
    const boardJob = (m: string, setter: (b: unknown) => void) =>
      apiFetch(`${getProxyBase()}/api/ai/signals?${qs(m)}`, { signal: AbortSignal.timeout(timeoutMs) })
        .then(r => {
          if (r.status === 304) { markOk(); return null; }
          return r.ok ? r.json() : null;
        }).catch(() => null)
        .then(j => { if (j) { setter(j); markOk(); _notifyNewStrongs(m, j); } });
    if (markets.includes('INDIA')) jobs.push(boardJob('INDIA', setIndia as (b: unknown) => void));
    if (markets.includes('CRYPTO')) jobs.push(boardJob('CRYPTO', setCrypto as (b: unknown) => void));
    if (markets.includes('FUTURES')) jobs.push(boardJob('FUTURES', setFutures as (b: unknown) => void));
    if (markets.includes('GLOBALFUTURES')) jobs.push(boardJob('GLOBALFUTURES', setGlobalFut as (b: unknown) => void));
    await Promise.allSettled(jobs);
    setBoardError(!anyOk); // v7.0.2: every requested board failed
    setLoading(false);
  }, [markets.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // v12.5 RESCAN — the user's "button click → fresh top trade signals"
  // lever: busts the 60s server cache for every desk this hook serves
  // and re-runs the FULL ensemble scan (deep-AI agent, fresh prices,
  // fresh consensus, fresh guards). Guarded against double-fire (the
  // button disables itself while a scan runs — a cold India scan can
  // take tens of seconds).
  const [rescanning, setRescanning] = useState(false);
  const rescan = useCallback(async () => {
    if (rescanning) return;
    setRescanning(true);
    try { await loadBoards({ rescan: true }); }
    finally { setRescanning(false); }
  }, [rescanning, loadBoards]);

  const loadState = useCallback(async () => {
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/trading/state`, { signal: AbortSignal.timeout(10000) });
      if (r.ok) setState(await r.json());
    } catch { /* skip */ }
  }, []);

  const loadPositions = useCallback(async () => {
    const seq = ++posSeqRef.current;
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/positions`, { signal: AbortSignal.timeout(15000) });
      if (r.ok) {
        const j = await r.json();
        if (seq !== posSeqRef.current) return; // stale response — a newer load already landed
        setPositions(Array.isArray(j.positions) ? j.positions : []);
        setEntries(Array.isArray(j.entries) ? j.entries : []);
      }
    } catch { /* skip */ }
  }, []);

  // Boot + staggered polling (active tab only — background tabs cost zero).
  const hasOpen = positions.some(p => p.status === 'OPEN');
  useEffect(() => {
    if (!active) return;
    loadBoards();
    loadState();
    loadPositions();
  }, [active, loadBoards, loadState, loadPositions]);
  useEffect(() => {
    if (!active) return;
    // v20.5 LATENCY: 30s board polling (was 60s) so a fresh signal
    // surfaces within the user's 30s target. The server-side cache is
    // 60s so most polls answer 304-equivalent (cache hit) — bandwidth
    // stays low. The cache TTL > poll cadence is the intended pattern
    // (the panel re-renders with the SAME payload until the next
    // 60s server re-compute). Combined with the SSE tick re-rank in
    // signals.js / useIntradayStream the top-5 panel also moves on
    // live price between board cycles.
    const b = setInterval(() => { if (activeRef.current && !document.hidden) loadBoards(); }, 30_000);
    const s = setInterval(() => { if (activeRef.current && !document.hidden) loadState(); }, 30_000);
    return () => { clearInterval(b); clearInterval(s); };
  }, [active, loadBoards, loadState]);

  // -----------------------------------------------------------------
  // v10.5.3 REALTIME POSITIONS — SSE diff-push while positions are
  // open (the real "ULTRA STREAM"; the old path was a 5s REST poll).
  //   • `positions` event → full snapshot (connect + structural
  //     changes: open/close/partial) — replaces the rows wholesale.
  //   • `tick` event → { id, ltp, unrealizedPnl, ... } — buffered and
  //     applied in ONE batched state update every 800ms (v10.17 perf
  //     fix: the per-event setPositions re-rendered the whole tab
  //     5-15×/sec — the console "lag"). Only the LATEST delta per id
  //     survives in a flush window; hidden tabs render zero times.
  //     (SSE delivery is ordered — the structural `positions` event
  //     always precedes its own ticks, so unknown-id merges are a
  //     non-race; the 45s REST reconciliation covers any drift.)
  //   • onerror → EventSource auto-reconnects; until it does, the
  //     REST poll below drops back to its fast 5s fallback cadence.
  //   • visibility: returning to the tab forces an immediate flush +
  //     REST refresh + a fresh socket (prices moved while backgrounded).
  // -----------------------------------------------------------------
  useEffect(() => {
    if (!active || !hasOpen) {
      setPositionsLive(null);
      return;
    }
    const session = getSessionToken();
    const url = session
      ? `${getProxyBase()}/api/ai/positions/stream?session=${encodeURIComponent(session)}`
      : `${getProxyBase()}/api/ai/positions/stream`;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined; // v20.3: stale-token re-attach
    try { es = new EventSource(url); } catch { return; }
    const src = es;

    const batcher = createTickBatcher<PositionTick>((deltas) => {
      setPositions(prev => {
        const byId = new Map(deltas.map(d => [d.id, d]));
        let changed = false;
        const next = prev.map(p => {
          const d = byId.get(p.id);
          if (!d) return p;
          changed = true;
          return { ...p, ...d };
        });
        return changed ? next : prev;
      });
    }, { intervalMs: 800 });

    src.onopen = () => setPositionsLive('stream');
    src.addEventListener('positions', (e) => {
      try {
        const j = JSON.parse((e as MessageEvent).data);
        batcher.flushNow(); // structural snapshot replaces buffered ticks
        // v18.9: the SSE structural snapshot must WIN over any in-flight
        // older REST response — bump the sequence exactly like the REST
        // loader does (an agent-close at t1.0 used to get resurrected by
        // a stale REST read landing at t1.5 because SSE never bumped the
        // guard — the server only pushes on structural change, so it
        // wouldn't re-send either).
        posSeqRef.current += 1;
        if (Array.isArray(j.positions)) setPositions(j.positions);
        if (Array.isArray(j.entries)) setEntries(j.entries);
      } catch { /* malformed frame */ }
    });
    src.addEventListener('tick', (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as PositionTick;
        batcher.push(d);
      } catch { /* malformed frame */ }
    });
    src.onerror = () => {
      setPositionsLive('poll');
      // v20.3: EventSource's native reconnect re-tries the SAME stale-token
      // URL forever after a re-login. Close and re-attach with a FRESH
      // url (epoch re-runs this effect, rebuilding it) — the 5s fallback
      // poll covers the gap.
      try { src.close(); } catch { /* noop */ }
      if (!retryTimer) {
        retryTimer = setTimeout(() => { retryTimer = undefined; setPositionsEpoch(n => n + 1); }, 10_000);
      }
    };

    // Reconnect-on-visibility: force REST refresh + resubscribe when the
    // tab comes back (covers "prices moved a lot while backgrounded").
    const onVis = () => {
      if (!document.hidden) {
        batcher.flushNow();
        loadPositions();
        setPositionsEpoch(n => n + 1); // re-runs this effect → fresh socket
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      if (retryTimer) clearTimeout(retryTimer);
      batcher.dispose();
      try { src.close(); } catch { /* noop */ }
      setPositionsLive(null);
    };
  }, [active, hasOpen, positionsEpoch, loadPositions]);

  // REST poll — now the FALLBACK + reconciliation path: 5s while any
  // position is open AND the stream is down; relaxed to 45s while the
  // SSE stream is live (it pushes every change anyway; the periodic
  // REST pass only reconciles book-keeping the stream doesn't carry).
  useEffect(() => {
    if (!active) return;
    const fast = hasOpen && positionsLive !== 'stream';
    const p = setInterval(() => { if (activeRef.current && !document.hidden) loadPositions(); }, fast ? 5_000 : 45_000);
    return () => clearInterval(p);
  }, [active, loadPositions, hasOpen, positionsLive]);

  const executeSignal = useCallback(async (signal: AISignal, mode: 'paper' | 'live' | 'notify', opts?: ExecuteOpts): Promise<ExecuteResult> => {
    setBusy(true);
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: signal.symbol, side: signal.side, mode,
          ...(opts?.qtyINR != null ? { qtyINR: opts.qtyINR } : {}),
          ...(opts?.leverage != null ? { leverage: opts.leverage } : {}),
        }),
        signal: AbortSignal.timeout(40000),
      });
      const j = await r.json().catch(() => ({ ok: false, error: 'bad response' }));
      loadPositions(); loadState();
      return j;
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) };
    } finally { setBusy(false); }
  }, [loadPositions, loadState]);

  const updateConfig = useCallback(async (patch: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> => {
    setBusy(true);
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/trading/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
        signal: AbortSignal.timeout(15000),
      });
      const j = await r.json().catch(() => ({ ok: false, error: 'bad response' }));
      if (j.ok) loadState();
      return j;
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) };
    } finally { setBusy(false); }
  }, [loadState]);

  const killSwitch = useCallback(async (enabled: boolean) => updateConfig({ killSwitch: enabled }), [updateConfig]);

  const closePos = useCallback(async (id: string): Promise<{ ok: boolean; error?: string }> => {
    setBusy(true);
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/positions/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
        signal: AbortSignal.timeout(20000),
      });
      const j = await r.json().catch(() => ({ ok: false, error: 'bad response' }));
      loadPositions(); loadState();
      return j;
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) };
    } finally { setBusy(false); }
  }, [loadPositions, loadState]);

  // v6.3 PRO: deep single-symbol analysis (every model vote, fresh run,
  // AI Council note) — powers the 🔬 button on each signal card.
  const fetchDeep = useCallback(async (symbol: string, market: 'INDIA' | 'CRYPTO' | 'FUTURES' | 'GLOBALFUTURES'): Promise<DeepSignalResult> => {
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/deep/${encodeURIComponent(symbol)}?market=${market}&t=${Date.now()}`, {
        signal: AbortSignal.timeout(40000),
      });
      const j = await r.json().catch(() => ({ ok: false, error: 'bad response' }));
      return j;
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) };
    }
  }, []);

  // v6.5: India gauntlet execution (Dhan paper/live) — same flow shape
  // as the crypto execute so the cards can share one handler.
  const executeIndia = useCallback(async (signal: AISignal, mode: 'paper' | 'live' | 'notify', opts?: ExecuteOpts): Promise<ExecuteResult> => {
    setBusy(true);
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/india/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: signal.symbol, side: signal.side, mode, ...(opts?.qtyINR != null ? { qtyINR: opts.qtyINR } : {}) }),
        signal: AbortSignal.timeout(40000),
      });
      const j = await r.json().catch(() => ({ ok: false, error: 'bad response' }));
      loadPositions(); loadState();
      return j;
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) };
    } finally { setBusy(false); }
  }, [loadPositions, loadState]);

  // v6.5: walk-forward backtest (per desk).
  const runBacktest = useCallback(async (market: 'INDIA' | 'CRYPTO', minGrade = 'ACTION'): Promise<BacktestResult | null> => {
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/backtest?market=${market}&minGrade=${minGrade}&t=${Date.now()}`, {
        signal: AbortSignal.timeout(90000),
      });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }, []);

  // v10.8: NL Custom Strategy Lab — description → bounded rules → replay.
  const runStrategyLab = useCallback(async (
    description: string,
    market: 'INDIA' | 'CRYPTO' = 'CRYPTO',
  ): Promise<StrategyLabResult | null> => {
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/strategy-lab`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, market }),
        signal: AbortSignal.timeout(120000),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) return { ok: false, error: j?.error || `lab failed (${r.status})` } as StrategyLabResult;
      return j;
    } catch { return { ok: false, error: 'lab request failed — network/timeout' } as StrategyLabResult; }
  }, []);

  // v6.5: alerts + AI council keys.
  const fetchAlertsStatus = useCallback(async (): Promise<AlertsStatus | null> => {
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/alerts/config?t=${Date.now()}`, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }, []);

  const saveAlertsConfig = useCallback(async (patch: Record<string, string | null>): Promise<{ ok: boolean; error?: string; status?: AlertsStatus['status'] }> => {
    setBusy(true);
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/alerts/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
        signal: AbortSignal.timeout(15000),
      });
      return await r.json().catch(() => ({ ok: false, error: 'bad response' }));
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) };
    } finally { setBusy(false); }
  }, []);

  const testAlert = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    setBusy(true);
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/alerts/test`, { method: 'POST', signal: AbortSignal.timeout(20000) });
      return await r.json().catch(() => ({ ok: false, error: 'bad response' }));
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) };
    } finally { setBusy(false); }
  }, []);

  // v6.8: GLOBAL FUTURES gauntlet execution (CoinDCX USDT perps).
  const executeFutures = useCallback(async (signal: AISignal, mode: 'paper' | 'live' | 'notify', opts?: { qtyINR?: number; marginUSDT?: number; leverage?: number }): Promise<ExecuteResult> => {
    setBusy(true);
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/futures/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: signal.symbol, side: signal.side, mode,
          ...(opts?.qtyINR != null ? { qtyINR: opts.qtyINR } : {}),
          ...(opts?.marginUSDT != null ? { marginUSDT: opts.marginUSDT } : {}),
          ...(opts?.leverage != null ? { leverage: opts.leverage } : {}),
        }),
        signal: AbortSignal.timeout(45000),
      });
      const j = await r.json().catch(() => ({ ok: false, error: 'bad response' }));
      loadPositions(); loadState();
      return j;
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) };
    } finally { setBusy(false); }
  }, [loadPositions, loadState]);

  // v10.4: GLOBAL EQUITY FUTURES SIM desk execution (AAPL/MSFT/GOOGL/
  // AMZN/NVDA/TSLA/META + SPACEX — paper/notify only; the server rejects
  // LIVE honestly because CoinDCX par ye contracts listed nahi hain).
  const executeGlobal = useCallback(async (signal: AISignal, mode: 'paper' | 'live' | 'notify', opts?: { qtyINR?: number; marginUSDT?: number; leverage?: number }): Promise<ExecuteResult> => {
    setBusy(true);
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/global/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: signal.symbol, side: signal.side, mode, // 'live' server pe gate-0 REJECT hota hai with the honest SIM-desk reason
          ...(opts?.qtyINR != null ? { qtyINR: opts.qtyINR } : {}),
          ...(opts?.marginUSDT != null ? { marginUSDT: opts.marginUSDT } : {}),
          ...(opts?.leverage != null ? { leverage: opts.leverage } : {}),
        }),
        signal: AbortSignal.timeout(45000),
      });
      const j = await r.json().catch(() => ({ ok: false, error: 'bad response' }));
      loadPositions(); loadState();
      return j;
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) };
    } finally { setBusy(false); }
  }, [loadPositions, loadState]);

  // v6.5: Dhan broker connect/status.
  const fetchDhanStatus = useCallback(async (): Promise<DhanStatus | null> => {
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/dhan/status?t=${Date.now()}`, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }, []);

  const dhanConnect = useCallback(async (clientId: string, accessToken: string): Promise<{ ok: boolean; error?: string }> => {
    setBusy(true);
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/dhan/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, accessToken }),
        signal: AbortSignal.timeout(45000),
      });
      const j = await r.json().catch(() => ({ ok: false, error: 'bad response' }));
      if (j.ok) loadState();
      return j;
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) };
    } finally { setBusy(false); }
  }, [loadState]);

  const dhanDisconnect = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    setBusy(true);
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/dhan/disconnect`, { method: 'POST', signal: AbortSignal.timeout(15000) });
      const j = await r.json().catch(() => ({ ok: false, error: 'bad response' }));
      if (j.ok) loadState();
      return j;
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) };
    } finally { setBusy(false); }
  }, [loadState]);

  return {
    india, crypto, futures, globalFut, state, positions, entries, loading, busy, boardError,
    /** v10.5.3: 'stream' = SSE live push, 'poll' = REST fallback, null = flat. */
    positionsLive,
    refresh: loadBoards, executeSignal, updateConfig, killSwitch, closePos, fetchDeep,
    /** v12.5: RESCAN — full fresh universe scan (server cache bypassed);
     *  rescanning = a cold scan is in flight (button's busy state). */
    rescan, rescanning,
    /** v10.17: explicit positions/entries refetch (clear-closed button etc). */
    refreshPositions: loadPositions,
    executeIndia, runBacktest, runStrategyLab, fetchAlertsStatus, saveAlertsConfig, testAlert,
    fetchDhanStatus, dhanConnect, dhanDisconnect, executeFutures, executeGlobal,
  };
}

// Options desk fetch (per-index, on demand with 60s client cache).
const deskCache = new Map<string, { at: number; data: OptionsDesk }>();

// v20.2 DESKTOP PUSH — fires a native OS notification when a NEW
// STRONG/ELITE signal lands on any served board while the tab is
// hidden (the visible tab doesn't need a toast — it IS the display).
// Per (market:symbol:side) dedup — a 60s refresh of the same signal
// never re-pings. Permission must be granted via the AlertsPanel
// button (browser policy requires a user gesture).
const _seenStrongs = new Set<string>();
function _notifyNewStrongs(market: string, board: unknown): void {
  try {
    if (desktopNotifyPermission() !== 'granted') return;
    if (!document.hidden) return;
    const sigs = (board as { signals?: Array<{ symbol?: string; side?: string; grade?: string; superIntel?: { aiScore?: number }; confidence?: number; plan?: { entry?: number; stopLoss?: number } }> })?.signals;
    if (!Array.isArray(sigs) || sigs.length === 0) return;
    for (const s of sigs) {
      const strong = s?.grade === 'STRONG' || (s?.superIntel?.aiScore ?? 0) >= 80;
      if (!strong || !s?.symbol || !s?.side) continue;
      const key = `${market}:${s.symbol}:${s.side}`;
      if (_seenStrongs.has(key)) continue;
      _seenStrongs.add(key);
      // v20.3: bound the set — FIFO eviction of the OLDEST half. The old
      // bulk clear() forgot every key at once, so still-live signals
      // re-toasted for a whole board cycle right after the 400-key cap.
      if (_seenStrongs.size > 400) {
        const it = _seenStrongs.values();
        for (let k = 0; k < 200; k++) { const r = it.next(); if (r.done) break; _seenStrongs.delete(r.value); }
      }
      const ai = s.superIntel?.aiScore ?? s.confidence ?? 0;
      const body = `${s.side} · AI score ${Math.round(ai)} · conf ${Math.round(s.confidence ?? 0)}%`
        + (s.plan?.entry != null ? ` · entry ${s.plan.entry} · SL ${s.plan.stopLoss ?? '—'}` : '');
      desktopNotify(`⚡ ${s.symbol} — STRONG signal (${market})`, body);
      break; // one toast per board cycle (throttled 30s in desktopNotify)
    }
  } catch { /* notifications are always optional */ }
}
export async function fetchOptionsDesk(symbol: string, force = false): Promise<OptionsDesk | null> {
  const hit = deskCache.get(symbol);
  if (!force && hit && Date.now() - hit.at < 60_000) return hit.data;
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/options?symbol=${symbol}&t=${Date.now()}`, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return hit?.data || null;
    const data = await r.json();
    deskCache.set(symbol, { at: Date.now(), data });
    return data;
  } catch { return hit?.data || null; }
}

// v9.4 — F&O OPTION SIGNAL CARDS (NIFTY + SENSEX, one request, 60s
// client cache; server side is 30s cached anyway).
let _optSigCache: { at: number; data: OptionSignalsView } | null = null;
export async function fetchOptionSignals(force = false): Promise<OptionSignalsView | null> {
  if (!force && _optSigCache && Date.now() - _optSigCache.at < 60_000) return _optSigCache.data;
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/option-signals?t=${Date.now()}`, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return _optSigCache?.data || null;
    const data = await r.json();
    _optSigCache = { at: Date.now(), data };
    return data;
  } catch { return _optSigCache?.data || null; }
}

// v10.17 — WHOLE-F&O OPTIONS SCANNER (indices + top stock underlyings,
// one ranked view; server 90s cached, client 45s).
let _optScanCache: { at: number; data: OptionsScanView } | null = null;
export async function fetchOptionsScan(force = false): Promise<OptionsScanView | null> {
  if (!force && _optScanCache && Date.now() - _optScanCache.at < 45_000) return _optScanCache.data;
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/options-scan${force ? '?fresh=1' : ''}`, { signal: AbortSignal.timeout(45000) });
    if (!r.ok) return _optScanCache?.data || null;
    const data = await r.json();
    _optScanCache = { at: Date.now(), data };
    return data;
  } catch { return _optScanCache?.data || null; }
}

// v10.17 — CLEAR CLOSED POSITIONS (Execution Console button). Server
// purges CLOSED rows from the journal (the tamper-evident LEDGER keeps
// the permanent audit trail) and stamps a HOUSEKEEP entry.
export async function clearClosedPositions(): Promise<{ ok: boolean; removed?: number; error?: string }> {
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/positions/clear-closed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(15000),
    });
    return await r.json().catch(() => ({ ok: false, error: 'bad response' }));
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

// ---------------- v11.0: GLOBAL MARKET COUNCIL fetchers ----------------
// Module-level + client-cached (the fetchOptionsDesk pattern): the
// stamps themselves ride the signal BOARD (30s poll, zero extra cost);
// these fetchers cover status / near-miss / deep verdicts / calibration.
// Panels poll them on 60s+ cadences with document.hidden gates.
let _councilStatusCache: { at: number; data: CouncilStatusView } | null = null;
export async function fetchCouncilStatus(force = false): Promise<CouncilStatusView | null> {
  if (!force && _councilStatusCache && Date.now() - _councilStatusCache.at < 60_000) return _councilStatusCache.data;
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/council/status?t=${Date.now()}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return _councilStatusCache?.data || null;
    const data = await r.json();
    _councilStatusCache = { at: Date.now(), data };
    return data;
  } catch { return _councilStatusCache?.data || null; }
}

let _nearMissCache: { at: number; data: { ok: boolean; entries: NearMissEntry[]; stats: { total: number; last24h: number; byReason: [string, number][] } } } | null = null;
export async function fetchCouncilNearMiss(force = false, limit = 25): Promise<NearMissEntry[]> {
  if (!force && _nearMissCache && Date.now() - _nearMissCache.at < 60_000) return _nearMissCache.data?.entries || [];
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/council/near-miss?limit=${limit}&t=${Date.now()}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return _nearMissCache?.data?.entries || [];
    const data = await r.json();
    _nearMissCache = { at: Date.now(), data };
    return Array.isArray(data?.entries) ? data.entries : [];
  } catch { return _nearMissCache?.data?.entries || []; }
}

/** DEEP council verdict for ONE symbol (6 seats + debate + judge;
 *  user-initiated deep-dives only — ~9 LLM calls when uncached). */
export async function fetchCouncilVerdict(symbol: string, market: string, force = false): Promise<CouncilStamp | null> {
  const cacheKey = `v:${market}:${symbol}`;
  const hit = _verdictCache.get(cacheKey);
  if (!force && hit && Date.now() - hit.at < 90_000) return hit.data;
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/council/verdict/${encodeURIComponent(symbol)}?market=${encodeURIComponent(market)}${force ? '&fresh=1' : ''}`, { signal: AbortSignal.timeout(45000) });
    if (!r.ok) return hit?.data || null;
    const j = await r.json();
    const stamp = j?.stamp || null;
    if (stamp) _verdictCache.set(cacheKey, { at: Date.now(), data: stamp });
    return stamp;
  } catch { return hit?.data || null; }
}

let _councilCalCache: { at: number; data: CouncilCalibrationView } | null = null;
export async function fetchCouncilCalibration(force = false): Promise<CouncilCalibrationView | null> {
  if (!force && _councilCalCache && Date.now() - _councilCalCache.at < 60_000) return _councilCalCache.data;
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/council/calibration?t=${Date.now()}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return _councilCalCache?.data || null;
    const data = await r.json();
    _councilCalCache = { at: Date.now(), data };
    return data;
  } catch { return _councilCalCache?.data || null; }
}

const _verdictCache = new Map<string, { at: number; data: CouncilStamp }>();
if (typeof setInterval === 'function') {
  const t = setInterval(() => {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [k, v] of _verdictCache) if (v.at < cutoff) _verdictCache.delete(k);
  }, 5 * 60_000);
  t.unref?.();
}

// ---------------- v6.7: swing · whales · ledger · brief · orderbook ----------------
export async function fetchSwingBoard(market: MarketKind): Promise<SwingBoard | null> {
  const m = market === 'INDIA' ? 'INDIA' : 'CRYPTO'; // futures → underlying crypto desk
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/swing?market=${m}&t=${Date.now()}`, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function fetchWhales(market: MarketKind): Promise<WhaleRadar | null> {
  const m = market === 'INDIA' ? 'INDIA' : 'CRYPTO'; // futures → underlying crypto desk
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/whales?market=${m}&t=${Date.now()}`, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function fetchLedger(limit = 20): Promise<LedgerView | null> {
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/ledger?limit=${limit}&t=${Date.now()}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function fetchMorningBrief(): Promise<MorningBrief | null> {
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/brief?t=${Date.now()}`, { signal: AbortSignal.timeout(45000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function fetchOrderbook(symbol: string): Promise<OrderbookView | null> {
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/orderbook?symbol=${symbol}&t=${Date.now()}`, { signal: AbortSignal.timeout(15000) });
    // 502 with an honest error payload is still a displayable view
    return await r.json().catch(() => null);
  } catch { return null; }
}

// ---------------- v6.8: agent · wallet · futures markets ----------------
export async function fetchAgentStatus(): Promise<AgentView | null> {
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/agent?t=${Date.now()}`, { signal: AbortSignal.timeout(45000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function startAgent(mode: 'paper' | 'live' | 'notify', liveConfirmPhrase?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/agent/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, ...(mode === 'live' && liveConfirmPhrase ? { liveConfirmPhrase } : {}) }),
      signal: AbortSignal.timeout(20000),
    });
    return await r.json().catch(() => ({ ok: false, error: 'bad response' }));
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

export async function stopAgent(): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/agent/stop`, { method: 'POST', signal: AbortSignal.timeout(15000) });
    return await r.json().catch(() => ({ ok: false, error: 'bad response' }));
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

export async function saveAgentConfig(patch: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/agent/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
      signal: AbortSignal.timeout(15000),
    });
    return await r.json().catch(() => ({ ok: false, error: 'bad response' }));
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

export async function fetchWallet(): Promise<WalletView | null> {
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/wallet?t=${Date.now()}`, { signal: AbortSignal.timeout(20000) });
    // 4xx/5xx with an honest payload is still displayable
    return await r.json().catch(() => null);
  } catch { return null; }
}

export async function fetchFuturesMarkets(): Promise<FuturesMarketsView | null> {
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/futures/markets?t=${Date.now()}`, { signal: AbortSignal.timeout(15000) });
    return await r.json().catch(() => null);
  } catch { return null; }
}

// ---------------- v6.11: glama Tier-2/3 fetchers ----------------
export async function fetchTrust(): Promise<TrustView | null> {
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/trust?t=${Date.now()}`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function fetchPerf(): Promise<PerfView | null> {
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/perf?t=${Date.now()}`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function fetchCorrelations(): Promise<CorrView | null> {
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/correlations?t=${Date.now()}`, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function fetchSectors(): Promise<SectorView | null> {
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/sectors?t=${Date.now()}`, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function fetchIncomeSetups(): Promise<IncomeView | null> {
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/income?t=${Date.now()}`, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function fetchNextActions(): Promise<NextActionsView | null> {
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/next-actions?t=${Date.now()}`, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
