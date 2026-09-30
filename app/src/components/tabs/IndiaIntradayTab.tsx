// ============================================================
// src/components/tabs/IndiaIntradayTab.tsx — v6.10 INDIA DESK
// ------------------------------------------------------------
// The India half of the old AI Trading tab, now a SELF-CONTAINED
// desk — nothing crypto on this screen:
//   ┌ COMMAND BAR     NIFTY/VIX regime · engine status · refresh
//   ├ NSE CLOCK       live IST session phase + countdown
//   ├ QUICK NAV       sticky section jump chips
//   ├ 00 AGENT        NSE auto-trade agent console (v10.3)
//   ├ 00b ASK AI      Pro Trader MCP agent chat (v10.3 wiring)
//   ├ 📊 DESK STATS   v6.10 one-glance strip (scanned·actionable·
//   │                 STRONG·avg conf·mood)
//   ├ 🏆 TOP 5 PICKS  full-universe composite ranking (44 stocks
//   │                 + NIFTY/BANKNIFTY → ranked 5 best trades)
//   ├ 01 SIGNAL BOARD 10-model consensus cards (Dhan paper/live)
//   ├ 01b MORNING BRIEF · 02 OPTIONS DESK (NSE indices)
//   ├ 02b SWING DESK  multi-day India setups
//   ├ 03 EXECUTION    India positions · Dhan · risk gates
//   └ 04 BACKTEST · 05 ALERTS · 06 MODELS · 07 LEDGER
// ============================================================
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAITrading } from '../aitrading/useAITrading';
import { SignalCard } from '../aitrading/SignalCard';
import { MtfBlock, EdgeBlock } from '../aitrading/DeepQualityBlock';
import { CandleChart } from '../aitrading/CandleChart';
import { TopPicksPanel } from '../aitrading/TopPicksPanel';
import { ExpertPicksPanel } from '../aitrading/ExpertPicksPanel';
import { MarketClockStrip } from '../aitrading/MarketClockStrip';
import { QuickNav } from '../aitrading/QuickNav';
import { OptionsDeskPanel } from '../aitrading/OptionsDeskPanel';
import { OrderConsole } from '../aitrading/OrderConsole';
// v10.16 S2: the manual-trade tracking section (user's own trades)
import { ManualTradeMonitor } from '../aitrading/ManualTradeMonitor';
import { ModelRegistry } from '../aitrading/ModelRegistry';
import { BacktestPanel } from '../aitrading/BacktestPanel';
import { GateReplayPanel } from '../intraday/GateReplayPanel';
import { ModelPerformancePanel } from '../aitrading/ModelPerformancePanel';
// v11.6 → v11.7 FIX: the MCP mesh ops view was originally wired only into the
// DEAD tabs/AITradingTab.tsx (unreachable from App.tsx since the v6.9 desk
// split) — users could never see it. Re-wired here onto the LIVE India desk.
import { MeshStatusPanel } from '../aitrading/MeshStatusPanel';
import { AlertsPanel } from '../aitrading/AlertsPanel';
import { MorningBriefPanel, SwingDeskPanel, SignalLedgerPanel, TrustLayerPanel, PerfAnalyticsPanel, SectorMapPanel } from '../aitrading/ProPanels';
// v9.1 PAPER DESK (Phase-1 merge of the orphaned v4 intraday tree — the
// panels were fully built/tested, just unreachable from the shipped UI,
// which is why "Paper Trading" never started on the India desk):
//   • useIntradayStream — SSE live quotes for open paper positions
//   • PaperTradePanel / openPaperTrade — server-managed simulator
//     (T1 50% book + breakeven trail + SL/T2/EOD auto-exit)
//   • TrackRecordPanel / JournalPanel / CommitteePanel — the
//     accountability + AI-coaching layer over those virtual trades
//   • UniverseEditor — the scanner watchlist those scans run on
import { useIntradayStream } from '../intraday/useIntradayStream';
import { PaperTradePanel, openPaperTrade } from '../intraday/PaperTradePanel';
import { TrackRecordPanel } from '../intraday/TrackRecordPanel';
import { JournalPanel } from '../intraday/JournalPanel';
import { CommitteePanel } from '../intraday/CommitteePanel';
import { UniverseEditor } from '../intraday/UniverseEditor';
import { adaptAISignal } from '../intraday/adaptAISignal';
import type { LiveQuote } from '../intraday/types';
// v10.3 PARITY (CoinDCX level): the two missing panels —
//   • ProTraderAgentPanel — the ASK-AI chat (8 MCP tools, /api/intraday-agent)
//     jo purane dead IntradayTab me tha par naye desk me wire nahi hua tha
//   • IndiaAgentPanel — the NSE auto-trade agent console (/api/india/agent)
import { ProTraderAgentPanel } from '../intraday/ProTraderAgentPanel';
import { IndiaAgentPanel } from '../aitrading/IndiaAgentPanel';
// v11.0 GLOBAL MARKET COUNCIL — 6-seat verdict surface + near-miss
// journal (India desk: onchain seat structurally abstains, options-flow
// seat rides the NSE chain read).
import { CouncilVerdictPanel } from '../aitrading/CouncilVerdictPanel';
import { NearMissPanel } from '../aitrading/NearMissPanel';
import {
  SectionLabel, RegimeChips, BreadthStrip, FilterChips, RefreshCountdown, BoardSummary, DeskStatsStrip,
  filterSignals, countSignals, IndiaHowToTrade, useDeskViewMode, ViewModeToggle, ProSectionsNote, type BoardFilter,
  boardStaleClass, FreshnessBadge,
} from '../aitrading/deskShared';
import type { AISignal, DhanStatus } from '../aitrading/types';

// v6.13: simple-view me sirf trade-flow sections (AGENT/TOP5/ASK AI/
// SIGNALS/OPTIONS/EXECUTE) dikhte hain; pro nav ke andar walon ko
// `pro: true` lagaya gaya hai.
const NAV = [
  { id: 'in-agent', label: 'AGENT', emoji: '🤖', pro: false },
  { id: 'in-top5', label: 'TOP 5', emoji: '🏆', pro: false },
  { id: 'in-chat', label: 'ASK AI', emoji: '💬', pro: false },
  { id: 'in-signals', label: 'SIGNALS', emoji: '📡', pro: false },
  { id: 'in-options', label: 'OPTIONS', emoji: '📊', pro: false },
  { id: 'in-execute', label: 'EXECUTE', emoji: '⚙️', pro: false },
  { id: 'in-paper-desk', label: 'PAPER', emoji: '📋', pro: true },
  { id: 'in-brief', label: 'BRIEF', emoji: '📰', pro: true },
  { id: 'in-sectors', label: 'SECTORS', emoji: '🗺️', pro: true },
  { id: 'in-swing', label: 'SWING', emoji: '🗂️', pro: true },
  { id: 'in-backtest', label: 'BACKTEST', emoji: '🧪', pro: true },
  { id: 'in-alerts', label: 'ALERTS', emoji: '🔔', pro: true },
  { id: 'in-models', label: 'MODELS', emoji: '🧠', pro: true },
  { id: 'in-ledger', label: 'LEDGER', emoji: '🔗', pro: true },
  { id: 'in-trust', label: 'TRUST', emoji: '🛡️', pro: true },
];

export default memo(function IndiaIntradayTab() {
  // v6.9: India-scoped loading — the India desk never pays for the
  // crypto/futures boards.
  const t = useAITrading(true, { markets: ['INDIA'] });
  const { india, state, positions, entries, loading, busy, refresh, refreshPositions, executeIndia, updateConfig, closePos, fetchDeep, boardError, positionsLive, rescan, rescanning } = t;
  const { runBacktest, runStrategyLab, fetchAlertsStatus, saveAlertsConfig, testAlert, fetchDhanStatus, dhanConnect, dhanDisconnect } = t;
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState<BoardFilter>('ALL');
  // v6.13: SIMPLE (trade-flow only) / PRO (poora desk) — persist hota hai
  const [viewMode, setViewMode] = useDeskViewMode();
  const simple = viewMode === 'simple';

  // ---- v9.1 PAPER DESK state ----
  // SSE live quotes feed the open-position P&L. v10.12 (#1): the SIGNAL
  // BOARD cards now consume the same stream for their live LTP overlay +
  // source pill (Groww·live / Yahoo·delayed), so the stream stays connected
  // in EVERY view mode — not just while the pro-mode paper desk renders.
  // (The server watcher broadcasts regardless; one more attached client
  // costs nothing.)
  const stream = useIntradayStream(true);
  // Live-quote lookup for a board signal — null (snapshot fallback) when
  // the watcher isn't covering that symbol yet.
  // v18.6.4: 30s FRESHNESS GATE (useCxLivePrices ke mirror me) — India
  // stream ungated tha, stale quote ko ⚡LIVE dikha ke FALSE
  // "PLAN INVALIDATED" fire karta tha (SignalCard ka liveInvalidation
  // strip fresh-price assumption par chalta hai).
  const liveFor = useCallback((symbol: string): LiveQuote | null => {
    const q = stream.livePrices[String(symbol || '').toUpperCase()];
    if (!q || !(q.price > 0)) return null;
    const at = q.ts || stream.lastQuoteAt;
    return (at > 0 && Date.now() - at <= 30_000) ? q : null;
  }, [stream.livePrices, stream.lastQuoteAt]);
  // bump → Paper/TrackRecord/Journal panels refetch (after open/close).
  const [paperRefresh, setPaperRefresh] = useState(0);
  // v20.2 B8: TrackRecord/Journal self-poll — "Currently Tracking" LTP +
  // journal rows pehle sirf paper open/close pe refresh hote the (stale
  // indefinitely). 60s visibility-gated tick dono panels ko live rakhta hai.
  const [trackTick, setTrackTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) setTrackTick(v => v + 1); }, 60_000);
    return () => clearInterval(t);
  }, []);
  const [universeOpen, setUniverseOpen] = useState(false);
  // open Paper-Desk symbols, lifted UP from PaperTradePanel so the board
  // cards can show ✓ PAPER OPEN (the old tab kept this in a dead ref — fixed).
  const [paperOpenSymbols, setPaperOpenSymbols] = useState<ReadonlySet<string>>(new Set());
  const handlePaperSymbols = useCallback((next: Set<string>) => {
    setPaperOpenSymbols(prev => {
      if (prev.size === next.size && [...next].every(x => prev.has(x))) return prev; // no-change → no re-render
      return new Set(next);
    });
  }, []);
  const [deep, setDeep] = useState<{ loading: boolean; signal?: AISignal; indicators?: Record<string, unknown>; narrative?: import('../aitrading/types').NarrativeView | null; ltf?: import('../aitrading/types').LtfSnapshot | null; edge?: import('../aitrading/types').EdgeStats | null; error?: string } | null>(null);
  const [dhan, setDhan] = useState<DhanStatus | null>(null);

  const board = india;
  const models = board?.models || [];
  const canLiveIndia = state?.config?.indiaMode === 'live' && !!dhan?.connected;

  // Dhan status boot-load (light: profile ping only when connected)
  useEffect(() => {
    let alive = true;
    fetchDhanStatus().then(s => { if (alive && s) setDhan(s); }).catch(() => {});
    return () => { alive = false; };
  }, [fetchDhanStatus]);
  const refreshDhan = useCallback(() => {
    fetchDhanStatus().then(s => { if (s) setDhan(s); }).catch(() => {});
  }, [fetchDhanStatus]);

  // Track which ACTIONABLE symbols were NOT in the previous board → flash them.
  // v18.5 FIX: the old version mutated prevTopRef inside useMemo (render-phase
  // side effect — breaks under StrictMode double-render and is a hooks
  // violation). The diff is now computed purely from render inputs, and the
  // ref update moved into a useEffect.
  const prevTopRef = useRef<Set<string>>(new Set());
  const actionableSyms = useMemo(
    () => new Set((board?.signals || []).filter(s => s.grade === 'ACTION' || s.grade === 'STRONG').map(s => s.symbol)),
    [board?.generatedAt, board?.signals], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const newSymbols = useMemo(() => {
    const fresh = [...actionableSyms].filter(s => !prevTopRef.current.has(s));
    return new Set(fresh);
  }, [actionableSyms]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (board?.generatedAt) prevTopRef.current = actionableSyms;
  }, [board?.generatedAt, actionableSyms]); // eslint-disable-line react-hooks/exhaustive-deps

  // v10.18 (deep-recheck #3): timer-ref toast — a stale timer used to
  // wipe a newer execution message early (two actions inside 6s).
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((ok: boolean, text: string) => {
    setToast({ ok, text });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const onExecuteIndia = useCallback(async (signal: AISignal, mode: 'paper' | 'live' | 'notify', opts?: { qtyINR?: number; leverage?: number }) => {
    const r = await executeIndia(signal, mode, opts);
    if (r.ok) {
      // v7.0.2: notify-mode is NOT a paper trade — the old toast fell into
      // the paper branch and said "paper trade opened … qty undefined".
      if (mode === 'notify') {
        notify(true, `🔔 Notify-only — ${r.note || 'gauntlet chala, alert + journal audit likha. Koi order/position NAHI bana.'}`);
      } else {
        notify(true, mode === 'live'
          ? `✅ Dhan LIVE order placed — ${signal.symbol} ${signal.side} · ${r.filled?.qty ?? '—'} shares @ ₹${r.filled?.price ?? '—'} · broker SL-M armed · 15:15 square-off${r.fitted ? ` · ⚙️ ${r.fitted}` : ''}`
          : `🧪 India paper trade opened — ${signal.symbol} ${signal.side} · ${r.filled?.qty ?? '—'} shares @ ₹${r.filled?.price ?? '—'} (watcher SL/TP + trailing)${r.fitted ? ` · ⚙️ ${r.fitted}` : ''}`);
      }
    } else {
      notify(false, `⛔ ${r.error || 'execution failed'}`);
    }
    return r; // v7.0.2: the ticket's own banner awaits this honest result
  }, [executeIndia, notify]);

  // v9.1 PAPER DESK BRIDGE — the Superintelligence board's signal, opened
  // as a server-managed Paper Desk position (/api/intraday-paper): T1 par
  // 50% book, breakeven trail, SL/T2 watcher + 15:10 EOD square-off, live
  // P&L + durable history + AI journal — the full simulator, one click.
  const onDeskPaper = useCallback(async (signal: AISignal) => {
    const adapted = adaptAISignal(signal);
    if (!adapted) {
      notify(false, `⛔ ${signal.symbol}: Paper Desk ke liye tradeable levels (entry/SL/targets) incomplete hain`);
      return;
    }
    // Size mirrors the ticket math: budget ÷ entry (min 1 share).
    const budget = state?.config?.indiaMaxOrderINR ?? 5000;
    const qty = Math.max(1, Math.floor(budget / adapted.entry));
    const r = await openPaperTrade(adapted, qty);
    if (r.ok) {
      notify(true, `📈 Paper Desk trade opened — ${signal.symbol} ${qty} shares @ ₹${adapted.entry.toFixed(2)} · T1 50% book + breakeven trail + SL/T2/EOD auto-exit (08 PAPER DESK me track)`);
      setPaperRefresh(k => k + 1); // panels + badges refetch
    } else {
      notify(false, `⛔ ${r.error || 'Paper Desk open failed'}`);
    }
  }, [state?.config?.indiaMaxOrderINR, notify]);

  const onSaveConfig = useCallback(async (patch: Record<string, unknown>) => {
    const r = await updateConfig(patch);
    if (!r.ok) notify(false, `⛔ ${r.error}`);
    else if (patch.killSwitch) notify(true, '☠️ Kill switch ON — auto disabled, mode → paper, open orders cancelled');
    else if (patch.indiaMode === 'live') notify(true, '🔴 India LIVE armed — Dhan par ab STRONG India signals REAL orders de sakte hain');
    else if (patch.indiaMode === 'paper') notify(true, '🧪 India paper mode — orders simulated');
    return r;
  }, [updateConfig, notify]);

  const onClose = useCallback(async (id: string) => {
    const r = await closePos(id);
    notify(r.ok, r.ok ? '✅ Position closed' : `⛔ ${r.error}`);
  }, [closePos, notify]);

  // v6.12.1: request token — a stale fetchDeep response (modal closed
  // via Escape mid-flight, or a new deep scan started) can no longer
  // re-open the modal with late data.
  const deepReq = useRef(0);
  const onDeep = useCallback(async (signal: AISignal) => {
    const id = ++deepReq.current;
    setDeep({ loading: true });
    const r = await fetchDeep(signal.symbol, signal.market);
    if (deepReq.current !== id) return; // stale — dropped
    if (r.ok && r.signal) setDeep({ loading: false, signal: r.signal, indicators: r.indicators, narrative: r.narrative, ltf: r.ltf, edge: r.edge });
    else setDeep({ loading: false, error: r.error || 'deep analysis unavailable' });
  }, [fetchDeep]);

  // v6.12: Escape closes the deep modal (keyboard a11y)
  // v6.13.1: body scroll lock when deep modal is open
  useEffect(() => {
    if (!deep) return;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { deepReq.current++; setDeep(null); } };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [deep]);

  const counts = useMemo(() => countSignals(board), [board]);
  const visibleSignals = useMemo(() => filterSignals(board, filter), [board, filter]);

  return (
    <div className="space-y-4">
      {/* ============ COMMAND BAR (India-branded) ============ */}
      <div className="quantum-panel rounded-2xl p-4 bg-gradient-to-r from-orange-500/[0.08] via-transparent to-amber-500/[0.05] border border-orange-500/15">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black tracking-wide bg-gradient-to-r from-orange-300 to-amber-200 bg-clip-text text-transparent">🇮🇳 INDIA INTRADAY DESK</h2>
              <span className="quantum-badge">v6.13</span>
            </div>
            <p className="text-[10px] text-slate-500 mt-0.5">
              NSE 86-name core universe (500+ full mode) + NIFTY/BANKNIFTY → 10-model consensus · TOP-5 composite rank · options desk · Dhan gauntlet
              {canLiveIndia && <span className="text-red-400 font-black"> · INDIA LIVE ARMED (Dhan)</span>}
              <span className="text-orange-400/80 font-bold"> · crypto alag tab me (₿ CoinDCX)</span>
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <RegimeChips board={board} market="INDIA" />
            <RefreshCountdown board={board} loading={loading} />
            <ViewModeToggle mode={viewMode} onSet={setViewMode} />
            {/* v12.5 RESCAN — full NSE universe fresh scan (cache bypass) */}
            <button onClick={() => rescan()} disabled={rescanning || loading}
              title="RESCAN — poora NSE universe dobara fresh scan (deep AI ensemble, cache bypass). Naye top intraday signals — fresh prices, fresh consensus, fresh guards. Cold scan me kuch second lag sakte hain."
              className={`px-3 py-2 rounded-xl text-xs font-black border transition-all disabled:opacity-50 ${rescanning
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/50 animate-pulse'
                : 'bg-gradient-to-r from-cyan-600/30 to-violet-600/30 text-cyan-200 border-cyan-500/40 hover:from-cyan-500/40 hover:to-violet-500/40'}`}>
              <span className={rescanning ? 'inline-block animate-spin' : ''}>🔁</span>
              {rescanning ? 'SCANNING…' : 'RESCAN'}
            </button>
            <button onClick={() => refresh()} disabled={loading}
              className="quantum-btn-ghost px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-50">
              <span className={loading ? 'inline-block animate-spin' : ''}>🔄</span>
            </button>
          </div>
        </div>
      </div>

      {/* ============ NSE SESSION CLOCK (v6.9) ============ */}
      <MarketClockStrip marketOpen={board?.marketOpen} />

      {/* ============ v6.12 PRO SESSION GATE ============ */}
      {board?.sessionPhase && (
        <div className={`mt-1.5 mb-1.5 rounded-lg border px-3 py-1.5 flex items-center gap-2 flex-wrap ${board.sessionPhase.tradeable
          ? 'bg-emerald-500/10 border-emerald-500/25'
          : 'bg-amber-500/10 border-amber-500/30'}`}
          aria-label="session phase gate">
          <span className={`text-[10px] font-black tracking-wider ${board.sessionPhase.tradeable ? 'text-emerald-300' : 'text-amber-300'}`}>
            {board.sessionPhase.tradeable ? '🟢 SESSION' : '⏰ SESSION GATE'}
          </span>
          <span className="text-[10px] font-mono text-slate-300">{board.sessionPhase.phase}</span>
          <span className="text-[10px] text-slate-400">· {board.sessionPhase.note}</span>
          {!board.sessionPhase.tradeable && (
            <span className="text-[9px] font-black text-amber-300/90">— abhi fresh intraday entries grade-cap ho rahe hain (WATCH tak)</span>
          )}
        </div>
      )}

      {/* ============ STICKY QUICK NAV (v6.9; v6.13 simple-mode filter) ============ */}
      <QuickNav items={simple ? NAV.filter(n => !n.pro) : NAV} />

      {/* ============ 📊 DESK STATS (v6.10 one-glance) ============ */}
      <DeskStatsStrip board={board} deskLabel="🇮🇳 INDIA DESK SNAPSHOT" />

      {/* toast */}
      {toast && (
        <div className={`quantum-panel rounded-xl px-4 py-2.5 text-xs font-bold border ${toast.ok ? 'border-emerald-500/40 text-emerald-300' : 'border-red-500/40 text-red-300'}`}
          role="status" aria-live="polite">
          {toast.text}
        </div>
      )}

      {/* ============ 00 · NSE AUTO-TRADE AGENT (v10.3 · CoinDCX parity) ============
          The India desk's autonomous agent — auto entry (75+ AI score,
          quorum-aware) · 3 trades/day · T1/T2/runner PRO exits · NSE
          clock (09:30–15:00 entries, 15:15 EOD square-off) · trend-flip
          + time-exit · paper-first (LIVE needs typed arming). */}
      <div id="in-agent">
        <SectionLabel num="00" title="India Auto-Trade Agent" sub="NSE autonomous desk — auto entry/exit · daily 3 trades · capital-based sizing · T1 40%+BE / T2 40% / runner trail · 15:15 EOD square-off — sab gauntlet-gated (Dhan)" />
        <div className="mt-2.5">
          <IndiaAgentPanel />
        </div>
      </div>

      {/* ============ 🧠 EXPERT PICKS (v9 — Advance Pro Trader Engine) ============ */}
      <div id="in-expert">
        <ExpertPicksPanel active market="INDIA" onDeep={(sym) => { onDeep({ symbol: sym, market: 'INDIA' } as AISignal); }} />
      </div>

      {/* ============ 🏆 TOP 5 PICKS (v6.9) ============ */}
      <div id="in-top5">
        <TopPicksPanel picks={board?.topFive} market="INDIA" deskLabel="🇮🇳 NSE · INDIA" scanned={board?.scanned} loading={loading} onDeep={onDeep} />
      </div>

      {/* ============ 00b · ASK AI — PRO TRADER MCP AGENT (v10.3 wiring fix) ============
          CoinDCX parity: the desk ka conversational agent (8 live tools —
          signals / deep scan / quotes / regime / track-record / paper
          positions / news / sizing). Backend (/api/intraday-agent) pehle
          se mounted tha — sirf naye desk me panel wire nahi hua tha. */}
      <div id="in-chat">
        <SectionLabel num="00b" title="Ask AI — Pro Trader Agent" sub="intraday desk ka conversational agent — buy/sell reasoning, tools se live data (signals · deep scan · quotes · regime · track-record · positions · news · sizing)" />
        <div className="mt-2.5">
          <ProTraderAgentPanel />
        </div>
      </div>

      {/* ============ MARKET BREADTH ============ */}
      <BreadthStrip board={board} />

      {/* ============ India how-to-trade guide ============ */}
      <IndiaHowToTrade />

      {/* ============ 01 · SUPERINTELLIGENCE SIGNAL BOARD ============ */}
      <div id="in-signals">
        <div className="flex items-end justify-between flex-wrap gap-2">
          <SectionLabel num="01" title="Superintelligence Signal Board" sub="NSE equities + indices (TV live scanner) → 10-model consensus + 7-factor expert engine → AI SCORE (80+ = STRONG, 85+ = ELITE) + full trade blueprint" />
          {/* v18.6.4 DESK PARITY: CoinDCX desk ka FreshnessBadge ab India
              board par bhi — aging/stale board visual dono desks pe same. */}
          <div className="flex items-center gap-2"><BoardSummary board={board} /><FreshnessBadge board={board} /></div>
        </div>
        <div className="mt-2.5 flex items-center justify-between flex-wrap gap-2">
          <FilterChips filter={filter} onChange={setFilter} counts={counts} />
          <div className="flex items-center gap-1.5">
            {/* v18.6.4 DESK PARITY: India board ko bhi wahi honesty chip —
                NSE stream connected + last quote age (CoinDCX desk ke
                4-state chip ka India mirror; stream sirf 2-state deta hai). */}
            <span className={`text-[9px] px-1.5 py-0.5 rounded border font-mono flex items-center gap-1
              ${stream.connected ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : 'text-amber-400 border-amber-500/30 bg-amber-500/10'}`}
              title={stream.connected ? 'Intraday SSE stream connected — quotes ~5s cadence (NSE hours).' : 'Intraday stream disconnected — auto-retry chal raha hai; board snapshot values use ho rahe hain.'}>
              <span className={`w-1.5 h-1.5 rounded-full ${stream.connected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400 animate-pulse'}`} />
              {stream.connected
                ? `NSE STREAM · ${stream.lastQuoteAt ? `${Math.max(0, Math.round((Date.now() - stream.lastQuoteAt) / 1000))}s ago` : 'waiting'}`
                : 'NSE stream down — retrying'}
            </span>
            <span className="text-[10px] text-slate-600 font-mono">🔥 80+ = super AI score · STRONG ≥75% conf + 70% agree · ACTION ≥55 · WATCH ≥35</span>
          </div>
        </div>
        {/* v9 engine meta strip — what got scanned, how many cleared 80+ */}
        {board?.superIntelMeta && (
          <div className="mt-2 flex items-center gap-2 flex-wrap text-[10px] font-mono">
            <span className="px-2 py-1 rounded-lg bg-gradient-to-r from-cyan-500/15 to-violet-500/15 border border-cyan-500/30 text-cyan-300 font-black tracking-wider">🧠 {board.superIntelMeta.engine}</span>
            <span className="px-2 py-1 rounded-lg bg-black/30 border border-slate-700/40 text-slate-400">universe: {board.superIntelMeta.universeSize} symbols ({board.superIntelMeta.universeMode})</span>
            <span className="px-2 py-1 rounded-lg bg-black/30 border border-emerald-500/25 text-emerald-400">🔥 80+ strong: {board.superIntelMeta.strongCount ?? 0}</span>
            <span className="px-2 py-1 rounded-lg bg-black/30 border border-amber-500/25 text-amber-400">🧠 85+ elite: {board.superIntelMeta.eliteCount ?? 0}</span>
          </div>
        )}
        <div className={`grid gap-3 mt-2.5 xl:grid-cols-2 ${boardStaleClass(board)}`}>
          {loading && (!board || board.signals.length === 0) && (
            <div className="quantum-panel rounded-2xl p-10 text-center col-span-full">
              <div className="text-4xl mb-3 animate-float">🧠</div>
              <div className="text-sm text-slate-400 font-medium">Ensemble scanning the NSE universe (86-name core, 500+ full mode)…</div>
            </div>
          )}
          {board && !board.ok && (
            <div className="quantum-panel rounded-2xl p-6 col-span-full text-center">
              <div className="text-3xl mb-2">📡</div>
              <div className="text-sm text-red-400 font-bold">{board.reason || 'Data unavailable'}</div>
              <div className="text-[11px] text-slate-500 mt-1">Will auto-retry every 30s</div>
            </div>
          )}
          {/* v7.0.2: network/API failure used to render NOTHING here (silent
              hole between sections) — now an honest unreachable panel. */}
          {!loading && !board && boardError && (
            <div className="quantum-panel rounded-2xl p-6 col-span-full text-center border border-red-500/20">
              <div className="text-3xl mb-2">📡</div>
              <div className="text-sm text-red-400 font-bold">Signal board unreachable</div>
              <div className="text-[11px] text-slate-500 mt-1">Network / API issue — har 30s me auto-retry ho raha hai. Top-5 picks bhi isi board se aate hain (refresh button bhi dabao).</div>
            </div>
          )}
          {visibleSignals.map(s => (
            <SignalCard key={`INDIA-${s.symbol}`} signal={s} busy={busy} onExecuteIndia={onExecuteIndia} onDeep={onDeep}
              canLiveIndia={canLiveIndia} isNew={newSymbols.has(s.symbol)}
              orderBudgetINR={state?.config?.maxOrderINR} riskCapPct={board?.riskCap ?? state?.config?.maxRiskPct ?? 5}
              indiaBudgetINR={state?.config?.indiaMaxOrderINR ?? 5000}
              onPaperTrade={onDeskPaper} paperOpenForSymbol={paperOpenSymbols.has(s.symbol)}
              liveLtp={liveFor(s.symbol)?.price ?? null}
              liveSrc={liveFor(s.symbol)?.src ?? null} />
          ))}
          {board?.signals?.length === 0 && !loading && (
            <div className="quantum-panel rounded-2xl p-8 col-span-full text-center">
              <div className="text-3xl mb-2">😌</div>
              <div className="text-sm text-slate-400 font-bold">No tradeable consensus right now</div>
              <div className="text-[11px] text-slate-500 mt-1">The ensemble only speaks when models agree — silence is a signal too.</div>
            </div>
          )}
          {board?.ok && board.signals.length > 0 && visibleSignals.length === 0 && (
            <div className="quantum-panel rounded-2xl p-6 col-span-full text-center">
              <div className="text-2xl mb-1">🔍</div>
              <div className="text-xs text-slate-400 font-bold">No signals match this filter right now</div>
              <div className="text-[10px] text-slate-500 mt-1">Try ALL — the board re-ranks every 30s.</div>
            </div>
          )}
        </div>
      </div>

      {/* ============ 01a · GLOBAL MARKET COUNCIL (v11.0) ============ */}
      <div>
        <SectionLabel num="01a" title="Global Market Council" sub="6 specialist AI seats (India: Technical · Macro · Sentiment · Options-Flow · Risk) · calibrated consensus · precision gate · 10-agent MCP mesh" />
        <div className="mt-2.5 space-y-3">
          <CouncilVerdictPanel board={board} />
          <NearMissPanel />
        </div>
      </div>

      {/* ============ 01b · MORNING BRIEF (PRO) ============ */}
      {!simple && (
        <div id="in-brief">
          <SectionLabel num="01b" title="Morning Brief" sub="ek nazar me poora desk — market · top signals · open book · guards · ledger · next-actions" />
          <div className="mt-2.5">
            <MorningBriefPanel />
          </div>
        </div>
      )}

      {/* ============ 01c · SECTOR MAP + CONTEXT CHAIN + F-SCORE (v6.11 · PRO) ============ */}
      {!simple && (
        <div id="in-sectors">
          <SectionLabel num="01c" title="Sector Map + Context Chain" sub="macro→sector→symbol top-down lens · 45 stocks 10 sectors me · F-Score trend-quality board (Piotroski-style)" />
          <div className="mt-2.5">
            <SectorMapPanel />
          </div>
        </div>
      )}

      {/* ============ 02 · OPTIONS DESK ============ */}
      <div id="in-options">
        <SectionLabel num="02" title="Options Desk" sub="NSE indices — live chain / BS model · PCR · max pain · GEX + gamma flip · strategies with POP" />
        <div className="mt-2.5">
          <OptionsDeskPanel />
        </div>
      </div>

      {/* ============ 02b · SWING DESK (India · PRO) ============ */}
      {!simple && (
        <div id="in-swing">
          <SectionLabel num="02b" title="Swing Desk" sub="multi-day India setups (analysis only) — 3–8 din horizon · 1.8×ATR stop · 2R/3R targets" />
          <div className="mt-2.5">
            <SwingDeskPanel market="INDIA" />
          </div>
        </div>
      )}

      {/* ============ 02e · MANUAL TRADE TRACKER (v10.16 S2) ============ */}
      <div id="in-manual">
        <SectionLabel num="02e" title="Manual Trade Tracker" sub="aapke REAL trades — live LTP (5s) · P&L · SL/T distances · ensemble conviction re-vote vs entry snapshot · EXIT NOW banner on flip" />
        <div className="mt-2.5">
          <ManualTradeMonitor desk="INDIA" notify={notify} />
        </div>
      </div>

      {/* ============ 03 · EXECUTION CONSOLE (India venue) ============ */}
      <div id="in-execute">
        <SectionLabel num="03" title="Execution Console" sub="India positions + Dhan gauntlet — STRONG signals only · trailing SL · 15:15 square-off · audited" />
        <div className="mt-2.5">
          <OrderConsole
            state={state} positions={positions} entries={entries} busy={busy} venue="INDIA" positionsLive={positionsLive}
            onClose={onClose} onSaveConfig={onSaveConfig}
            onPositionsChanged={refreshPositions}
            dhan={dhan} onDhanConnect={async (id, tok) => { const r = await dhanConnect(id, tok); refreshDhan(); return r; }}
            onDhanDisconnect={async () => { const r = await dhanDisconnect(); refreshDhan(); return r; }}
            onDhanRefresh={refreshDhan}
          />
        </div>
      </div>

      {/* ============ 04 · BACKTEST LAB (India · PRO) ============ */}
      {!simple && (
        <div id="in-backtest">
          <SectionLabel num="04" title="Backtest Lab" sub="the SAME 10-model ensemble replayed on India history — win rate · avg R · equity curve · learned gates" />
          <div className="mt-2.5">
            <BacktestPanel market="INDIA" runBacktest={runBacktest} runStrategyLab={runStrategyLab} />
          </div>
          {/* v20.2 GATE REPLAY — the intraday gates (MTF ladder · chase ·
              OB/OS · conf ladder) ka 5m-bar replay: tuning ab data se. */}
          <div className="mt-2.5">
            <GateReplayPanel symbols={(board?.signals || []).map(s => s?.symbol).filter(Boolean)} />
          </div>
          {/* v10.6 Pro Upgrade #5: the walk-forward dashboard — per-model
              30/90d win-rates + calibration chart + regime tilt state. */}
          <div className="mt-2.5">
            <ModelPerformancePanel desk="INDIA" />
          </div>
          {/* v11.6 MCP mesh ops — 10 data agents' health, free-tier budgets
              and the mesh-backed ensemble seats (shadow/voting state). */}
          <div className="mt-2.5">
            <MeshStatusPanel />
          </div>
        </div>
      )}

      {/* ============ 05 · ALERTS & AI KEYS (PRO) ============ */}
      {!simple && (
        <div id="in-alerts">
          <SectionLabel num="05" title="Alerts & AI Keys" sub="Telegram pings on STRONG signals · AI Council keys — app se hi, Render env ki zaroorat nahi" />
          <div className="mt-2.5">
            <AlertsPanel fetchAlertsStatus={fetchAlertsStatus} saveAlertsConfig={saveAlertsConfig} testAlert={testAlert} busy={busy} notify={notify} />
          </div>
        </div>
      )}

      {/* ============ 06 · MODEL REGISTRY (PRO) ============ */}
      {!simple && (
        <div id="in-models">
          <SectionLabel num="06" title="Model Registry" sub="the superintelligence bus — every analyst, weight & status" />
          <div className="mt-2.5">
            <ModelRegistry models={models} />
          </div>
        </div>
      )}

      {/* ============ 07 · SIGNAL LEDGER (PRO) ============ */}
      {!simple && (
        <div id="in-ledger">
          <SectionLabel num="07" title="Signal Ledger" sub="SHA-256 hash chain — har executed signal provable, koi edit possible nahi (dono desks)" />
          <div className="mt-2.5">
            <SignalLedgerPanel />
          </div>
        </div>
      )}

      {/* ============ 07b · TRUST LAYER + PERFORMANCE (v6.11 · PRO) ============ */}
      {!simple && (
        <div id="in-trust">
          <SectionLabel num="07b" title="Trust Layer + Performance Lab" sub="engine ki confidence kitni sahi hai — calibration · Brier · monthly trend · model p-values · MDD/Sharpe/Sortino" />
          <div className="mt-2.5 grid gap-3 lg:grid-cols-2">
            <TrustLayerPanel />
            <PerfAnalyticsPanel />
          </div>
        </div>
      )}

      {/* ============ 08 · PAPER DESK & AI JOURNAL (v9.1 · PRO) ============
          The orphaned v4 intraday tree, merged into the live desk:
          server-managed virtual trades (T1 50% book → breakeven trail →
          SL/T2/EOD auto-exit) + signal track record + AI-reviewed journal
          + committee debate. Board cards open positions via 📈 DESK PAPER. */}
      {!simple && (
        <div id="in-paper-desk">
          <div className="flex items-end justify-between gap-2 flex-wrap">
            <SectionLabel num="08" title="Paper Desk & AI Journal" sub="virtual trade simulator (server-managed T1/trail/SL/EOD) · signal track record · AI-reviewed trade journal · committee debate" />
            <button onClick={() => setUniverseOpen(true)}
              title="Universe edit karo — v20.2 se ye SIGNAL BOARD pe bhi apply hota hai (remove kiya hua symbol board se gayab, custom symbol Tier-1 scan me aata hai) + committee/briefing/track-record scans isi se chalte hain (server-side persisted)"
              className="quantum-btn-ghost px-2.5 py-1.5 rounded-lg text-[10px] font-black shrink-0">
              ⚙ UNIVERSE
            </button>
          </div>
          <div className="mt-2.5 space-y-3">
            <PaperTradePanel livePrices={stream.livePrices} refreshKey={paperRefresh} onOpenSymbolsChange={handlePaperSymbols} />
            <TrackRecordPanel refreshKey={paperRefresh + trackTick} />
            <JournalPanel refreshKey={paperRefresh + trackTick} />
            <CommitteePanel />
          </div>
        </div>
      )}

      {/* ============ v6.13: SIMPLE-mode me PRO sections ka pointer ============ */}
      {simple && (
        <ProSectionsNote names="Brief · Sector Map · Swing · Backtest · Alerts · Models · Ledger · Trust · Paper Desk" />
      )}

      {/* ============ DEEP ANALYSIS MODAL ============ */}
      {deep && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Deep analysis"
          onClick={() => { deepReq.current++; setDeep(null); }}>
          <div className="quantum-panel rounded-2xl p-5 max-w-2xl w-full max-h-[85vh] overflow-y-auto animate-scale-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-black text-orange-300 tracking-wide">🔬 DEEP ENSEMBLE ANALYSIS</h3>
              <button onClick={() => { deepReq.current++; setDeep(null); }} className="quantum-btn-ghost px-2.5 py-1 rounded-lg text-xs font-black" aria-label="Close">✕</button>
            </div>
            {deep.loading && (
              <div className="py-12 text-center">
                <div className="text-4xl mb-3 animate-float">🧠</div>
                <div className="text-xs text-slate-400">Running a fresh 10-model ensemble on {deep.signal?.symbol ?? 'the symbol'}…</div>
              </div>
            )}
            {!deep.loading && deep.error && (
              <div className="py-8 text-center text-xs text-red-400 font-bold">⛔ {deep.error}</div>
            )}
            {!deep.loading && deep.signal && (
              <>
                <SignalCard signal={deep.signal} onExecuteIndia={onExecuteIndia} onDeep={onDeep} canLiveIndia={canLiveIndia} busy={busy}
                  orderBudgetINR={state?.config?.maxOrderINR} riskCapPct={board?.riskCap ?? state?.config?.maxRiskPct ?? 5}
                  indiaBudgetINR={state?.config?.indiaMaxOrderINR ?? 5000}
                  onPaperTrade={onDeskPaper} paperOpenForSymbol={paperOpenSymbols.has(deep.signal.symbol)} />
                <MtfBlock ltf={deep.ltf} quality={deep.signal.quality} />
                {/* v20.2: deep modal ka apna price chart — plan levels ke
                    saath candles (SignalCard ka lazy toggle yahan default
                    open hai — deep analysis me chart FIRST-CLASS hai). */}
                <div className="mt-3">
                  <CandleChart symbol={deep.signal.symbol} market={deep.signal.market} ltp={deep.signal.ltp} plan={deep.signal.plan} defaultTf="15m" />
                </div>
                <EdgeBlock edge={deep.edge} />
                {deep.narrative && (
                  <div className="mt-3 bg-cyan-500/[0.05] border border-cyan-500/15 rounded-xl p-3" aria-label="regime narrative">
                    <div className="text-[10px] font-black text-cyan-300 tracking-wider mb-1.5">📖 EXPLAIN TICKER — {deep.narrative.title}</div>
                    <ul className="space-y-1">
                      {(deep.narrative.story || []).slice(0, 6).map((s, i) => (
                        <li key={i} className="text-[10px] text-slate-300 leading-relaxed">• {s}</li>
                      ))}
                    </ul>
                    <div className="text-[10px] text-amber-300/90 mt-1.5 font-bold">⚠️ {deep.narrative.watch}</div>
                  </div>
                )}
                {deep.indicators && (
                  <div className="mt-3 bg-black/25 rounded-xl p-3">
                    <div className="text-[10px] font-black text-slate-500 tracking-wider mb-2">LIVE INDICATOR SNAPSHOT</div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[10px] font-mono">
                      {['rsi', 'adx', 'atr', 'vwap'].map(k => {
                        const v = (deep.indicators as Record<string, unknown>)[k];
                        // v18.5 FIX: object indicators printed the .adx subfield
                        // for EVERY key (copy-paste bug) — now each key reads its
                        // own field (adx object → its .adx score), numbers format.
                        const val = v == null ? '—'
                          : typeof v === 'number' ? v.toFixed(2)
                          : typeof v === 'object'
                            ? String((v as Record<string, unknown>)[k] ?? (v as Record<string, unknown>).value ?? (v as Record<string, unknown>).adx ?? '—')
                            : String(v);
                        return <div key={k} className="flex justify-between bg-black/30 rounded px-2 py-1"><span className="text-slate-500 uppercase">{k}</span><span className="text-slate-200">{val}</span></div>;
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ============ v9.1: SCANNER UNIVERSE EDITOR (Paper Desk ke saath) ============ */}
      {universeOpen && (
        <UniverseEditor market="INDIA" onClose={() => setUniverseOpen(false)} onChanged={() => setPaperRefresh(k => k + 1)} />
      )}
    </div>
  );
});
