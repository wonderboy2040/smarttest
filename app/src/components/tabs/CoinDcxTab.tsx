// ============================================================
// src/components/tabs/CoinDcxTab.tsx — v6.10 COINDCX DESK
// ------------------------------------------------------------
// The CoinDCX half of the old AI Trading tab, now a SELF-CONTAINED
// desk — nothing NSE on this screen:
//   ┌ COMMAND BAR      BTC regime · engine status · refresh
//   ├ DESK SWITCHER    ₿ SPOT (INR pairs)  |  ⚡ GLOBAL FUTURES (USDT perps)
//   ├ QUICK NAV        sticky section jump chips
//   ├ 📊 DESK STATS    v6.10 one-glance strip of the active desk
//   ├ 00 AUTO-AGENT    superintelligence auto entry/exit (3 trades/day)
//   ├ 📱 WALLET        spot + futures + equity — "wallet me kitna hai"
//   ├ 🏆 TOP 5 PICKS   composite ranking of the active desk's universe
//   ├ 01 SIGNAL BOARD  10-model consensus cards · trade tickets
//   ├ 01b MORNING BRIEF · 02b SWING+WHALES+ORDERBOOK
//   ├ 03 EXECUTION     spot+futures positions · leverage · risk gates
//   └ 04 BACKTEST · 05 ALERTS · 06 MODELS · 07 LEDGER
// ============================================================
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAITrading } from '../aitrading/useAITrading';
import { useWalletPoll } from '../aitrading/useWalletPoll';
// v20.6.3: apiFetch + getProxyBase for the manual /api/ai/wallet/reconnect call
import { apiFetch, getProxyBase } from '../../utils/api';
import { ExpertPicksPanel } from '../aitrading/ExpertPicksPanel';
import { SignalCard, UltrafastChecklist } from '../aitrading/SignalCard';
import { MtfBlock, EdgeBlock } from '../aitrading/DeepQualityBlock';
import { CandleChart } from '../aitrading/CandleChart';
import { TopPicksPanel } from '../aitrading/TopPicksPanel';
import { QuickNav } from '../aitrading/QuickNav';
import { OrderConsole } from '../aitrading/OrderConsole';
// v10.16 S2: the manual-trade tracking section (user's own trades)
import { ManualTradeMonitor } from '../aitrading/ManualTradeMonitor';
// v12.8 SUPERINTELLIGENCE REVERSAL RECOVERY — ₹-cycle board (self-contained fetch)
import { ReversalPanel } from '../aitrading/ReversalPanel';
import { ModelRegistry } from '../aitrading/ModelRegistry';
import { BacktestPanel } from '../aitrading/BacktestPanel';
import { ModelPerformancePanel } from '../aitrading/ModelPerformancePanel';
// v11.6 → v11.7 FIX: the MCP mesh ops view was originally wired only into the
// DEAD tabs/AITradingTab.tsx (unreachable from App.tsx since the v6.9 desk
// split) — users could never see it. Re-wired here onto the LIVE crypto desk
// (mesh is shared infra — same 10 agents feed both desks' T3 seats).
import { MeshStatusPanel } from '../aitrading/MeshStatusPanel';
import { AlertsPanel } from '../aitrading/AlertsPanel';
import { AgentPanel } from '../aitrading/AgentPanel';
// v20.6.3: the self-improvement panel was DELETED from the repo
// (file gone). To re-mount: recreate the component from git history
// (commit before v20.6.3) and add the JSX block back here.
import { ProTraderAutoPanel } from '../aitrading/ProTraderAutoPanel';
import { MorningBriefPanel, SwingDeskPanel, WhaleRadarPanel, SignalLedgerPanel, OrderbookPanel, TrustLayerPanel, PerfAnalyticsPanel, CorrelationPanel } from '../aitrading/ProPanels';
// v10.1: the crypto desk conversational AI (mirror of the intraday ProTrader panel)
import { CryptoAgentPanel } from '../aitrading/CryptoAgentPanel';
// v12.0 PRO TRADER UPGRADE — the perp positioning intelligence view
// (funding/OI/top-trader L-S/taker flow) on the GLOBAL FUTURES desk.
import { PerpIntelPanel } from '../aitrading/PerpIntelPanel';
// v10.10: DIRECT CoinDCX ultra-fast live prices (2s RT — spot INR +
// USDT perps + USDC global equity perps) overlaid on every card.
import { useCxLivePrices } from '../aitrading/useCxLivePrices';
// v20.7.5 DEEP ANALYSIS ACCURACY UPGRADE — 15s self-recheck of the open
// modal + freshness chips + the FULL indicator transparency grid.
import { useDeepAutoRecheck, DeepFreshnessChip, DeepTransitionLog, DeepIndicatorGrid, DeepPinnedCompare, isPinnableSignal, deepPinVerdict, type DeepModalState } from '../aitrading/deepAnalysisExtras';
// v20.7.5 THE 15s SIGNAL RECHECK PANEL — every STRONG/ACTION signal's
// live re-validation state (loop ki hi cadence par poll hota hai).
import { SignalRecheckPanel } from '../aitrading/SignalRecheckPanel';
import { EngineHealthStrip } from '../aitrading/EngineHealthStrip';
import {
  SectionLabel, RegimeChips, BreadthStrip, FilterChips, RefreshCountdown, BoardSummary, DeskStatsStrip,
  FreshnessBadge, boardStaleClass,
  filterSignals, countSignals, useDeskViewMode, ViewModeToggle, ProSectionsNote, type BoardFilter,
} from '../aitrading/deskShared';
import type { AISignal, SignalBoard } from '../aitrading/types';

// v6.13: simple-view = trade-flow only (AGENT/TOP5/SIGNALS/EXECUTE);
// whales/backtest/alerts/models/ledger/trust/brief/correlations → PRO.
// v20.7.12 [H3-1]: 'SELF-FIX' chip DELETED — self-improvement section
// v20.6.3 me remove hua tha, chip dead-scroll karta rehta tha.
// v20.7.12 [H3-2]: 'RECHECK' chip ADDED — 01r section render hota hai par
// QuickNav se unreachable tha (v20.2 ne isi class ka bug crypto desk pe
// fix kiya tha; ye chip reh gaya tha).
const NAV = [
  { id: 'cx-agent', label: 'AGENT', emoji: '🤖', pro: false },
  { id: 'cx-proauto', label: 'PRO AUTO', emoji: '🧠', pro: false },
  { id: 'cx-chat', label: 'ASK AI', emoji: '💬', pro: false },
  { id: 'cx-expert', label: 'EXPERT', emoji: '🧠', pro: false },
  { id: 'cx-top5', label: 'TOP 5', emoji: '🏆', pro: false },
  { id: 'cx-signals', label: 'SIGNALS', emoji: '📡', pro: false },
  { id: 'cx-recheck', label: 'RECHECK', emoji: '🔁', pro: false },
  // v12.8: the user's flagship ₹-cycle reversal desk (section 02f)
  { id: 'cx-reversal', label: 'REVERSAL', emoji: '🔄', pro: false },
  { id: 'cx-manual', label: 'MY TRADES', emoji: '✍️', pro: false },
  { id: 'cx-execute', label: 'EXECUTE', emoji: '⚙️', pro: false },
  { id: 'cx-brief', label: 'BRIEF', emoji: '📰', pro: true },
  { id: 'cx-whales', label: 'WHALES', emoji: '🐋', pro: true },
  { id: 'cx-corr', label: 'CORR', emoji: '📊', pro: true },
  { id: 'cx-backtest', label: 'BACKTEST', emoji: '🧪', pro: true },
  { id: 'cx-alerts', label: 'ALERTS', emoji: '🔔', pro: true },
  { id: 'cx-models', label: 'MODELS', emoji: '🧠', pro: true },
  { id: 'cx-ledger', label: 'LEDGER', emoji: '🔗', pro: true },
  { id: 'cx-trust', label: 'TRUST', emoji: '🛡️', pro: true },
];

// v20.7.12 [H2-1]: module-scope derived nav lists — pehle `NAV.filter(...)`
// har render pe NAYA array bana ke memo'd QuickNav ko bust karta tha (tab
// ~1.25/s re-render ho raha tha live-price flushes se — QuickNav bhi har
// baad me re-render hota tha).
const NAV_SIMPLE = NAV.filter(n => !n.pro);

// v20.2: FUTURES desk only — the PERP INTEL section renders on that desk
// alone, so its nav chip rides along (SPOT/GLOBAL pe dead chip nahi).
const NAV_FUTURES = [{ id: 'cx-perp', label: 'PERP', emoji: '🛰️', pro: false }, ...NAV];

// v20.7.12 [H2-1]: stable no-op handlers — OrderConsole ko per-render
// naye inline async arrows na milen (desk 1.25/s re-render ho raha hai).
const CX_DHAN_CONNECT_STUB = async () => ({ ok: false, error: 'India desk me jao (🇮🇳 India tab)' });
const CX_DHAN_DISCONNECT_STUB = async () => ({ ok: false, error: 'n/a' });
const CX_DHAN_REFRESH_STUB = () => {};

/** v6.9: prominent wallet card — spot INR + USDT, futures margin, equity.
 *  The "wallet me kitna hai / kitna bacha hai" answer at the top of the
 *  CoinDCX desk. v20.2: shares ONE 60s poller with WalletStrip +
 *  PortfolioHeat via useWalletPoll (3 independent pollers used to burn
 *  3 signed wallet calls/min). Honest degrade (CF-block / no keys note). */
const WalletCard = memo(function WalletCard() {
  const { wallet: w, failed, refresh: refreshWallet } = useWalletPoll();
  const [reconnecting, setReconnecting] = useState(false);
  const inr = w?.spot?.inr as { free?: number; locked?: number } | undefined;
  const usdt = w?.spot?.usdt as { free?: number; locked?: number } | undefined;
  const fut = w?.futures?.usdt as { free?: number; locked?: number; total?: number; crossUserMargin?: number | null } | undefined;
  const futINR = w?.futures?.inr as { free?: number; locked?: number; total?: number; crossUserMargin?: number | null } | undefined;
  const err = w?.spot?.error || w?.futures?.error;
  const showReconnect = !!(w?.futures?.error) || !!(w?.futures?.scope === 'no_scope');
  const onReconnect = useCallback(async () => {
    if (reconnecting) return;
    setReconnecting(true);
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/wallet/reconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        console.warn('wallet reconnect failed:', r.status, j?.error || '');
      }
    } catch (e) {
      console.warn('wallet reconnect error:', e);
    } finally {
      // give the server a moment to clear the cooldown + sweep the ladder
      setTimeout(() => { refreshWallet?.(); setReconnecting(false); }, 800);
    }
  }, [reconnecting, refreshWallet]);
  return (
    <div className="quantum-panel rounded-2xl p-4 bg-gradient-to-br from-amber-500/[0.06] via-transparent to-violet-500/[0.05] border border-amber-500/15" aria-label="CoinDCX wallet">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-black tracking-wider text-amber-300">📱 COINDCX WALLET</span>
        {w && (
          <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black border ${w.connected
            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
            : 'bg-slate-600/20 text-slate-400 border-slate-600/30'}`}>
            {w.connected ? 'LIVE · API CONNECTED' : 'PAPER (keys nahi mili — .env me COINDCX_API_KEY+COINDCX_SECRET daalo ya Portfolio tab se connect karo)' }
          </span>
        )}
        {!w && <span className={`text-[10px] ${failed ? 'text-amber-500/80' : 'text-slate-500'}`}>{failed ? '⚠️ wallet API unreachable — retrying every 60s' : 'loading…'}</span>}
        {w?.usdInr != null && <span className="ml-auto text-[10px] font-mono font-bold text-slate-500">USD/₹ {w.usdInr}</span>}
        {/* v20.6.3: MANUAL RECONNECT button — when the futures wallet is
            showing an error (WAF block, cooldown armed, scope probe cached),
            the user can click this to clear the futures wallet transport
            ladder + cooldown + scope probe and force a fresh sweep.
            The button calls POST /api/ai/wallet/reconnect {force:true}. */}
        {showReconnect && (
          <button
            onClick={onReconnect}
            disabled={reconnecting}
            className="ml-1 px-2 py-0.5 rounded-lg text-[9px] font-black border border-amber-400/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/30 transition-colors disabled:opacity-50 disabled:cursor-wait"
            title="Futures wallet transport reset — ladder + cooldown + scope probe clear karke fresh 7-rung sweep trigger karo"
          >
            {reconnecting ? '⏳ Reconnecting…' : '🔄 Reconnect Futures Wallet'}
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
        <div className="bg-black/25 rounded-xl p-2.5 text-center">
          <div className="text-[9px] font-black text-slate-500 tracking-wider">SPOT INR (free)</div>
          <div className="text-sm font-black font-mono text-emerald-300">{inr?.free != null ? `₹${inr.free.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'}</div>
          {inr?.locked != null && inr.locked > 0 && <div className="text-[9px] font-mono text-slate-500">locked ₹{Math.round(inr.locked).toLocaleString('en-IN')}</div>}
        </div>
        <div className="bg-black/25 rounded-xl p-2.5 text-center">
          <div className="text-[9px] font-black text-slate-500 tracking-wider">SPOT USDT (free)</div>
          <div className="text-sm font-black font-mono text-cyan-300">{usdt?.free != null ? `${usdt.free.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—'}</div>
        </div>
        <div className="bg-black/25 rounded-xl p-2.5 text-center">
          <div className="text-[9px] font-black text-slate-500 tracking-wider">FUTURES MARGIN (USDT)</div>
          <div className="text-sm font-black font-mono text-violet-300">{fut?.free != null ? `${fut.free.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—'}</div>
          {/* v10.3.1: 2025 futures API — `balance` IS the free margin; locked
              (isolated + cross-order) aur total ab honest subtitle me dikhte
              hain instead of the old silent 0-clip. */}
          {(fut?.locked != null && fut.locked > 0) && <div className="text-[9px] font-mono text-slate-500">locked {fut.locked.toFixed(2)}</div>}
          {(fut?.total != null && fut.total > 0) && <div className="text-[9px] font-mono text-slate-600">total {fut.total.toFixed(2)}</div>}
          {fut?.crossUserMargin != null && fut.crossUserMargin > 0 && <div className="text-[9px] font-mono text-amber-400/80">cross {fut.crossUserMargin.toFixed(2)}</div>}
        </div>
        {/* v20.7.2: INR-margined futures wallet — the user's diagnostic
            confirmed their wallet returns INR. This card surfaces it. */}
        <div className="bg-black/25 rounded-xl p-2.5 text-center">
          <div className="text-[9px] font-black text-slate-500 tracking-wider">FUTURES MARGIN (INR)</div>
          <div className="text-sm font-black font-mono text-violet-300">{futINR?.free != null ? `₹${futINR.free.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—'}</div>
          {(futINR?.locked != null && futINR.locked > 0) && <div className="text-[9px] font-mono text-slate-500">locked ₹{futINR.locked.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>}
          {(futINR?.total != null && futINR.total > 0) && <div className="text-[9px] font-mono text-slate-600">total ₹{futINR.total.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>}
        </div>
        <div className="bg-black/25 rounded-xl p-2.5 text-center">
          <div className="text-[9px] font-black text-slate-500 tracking-wider">TOTAL EQUITY (₹)</div>
          <div className="text-sm font-black font-mono text-amber-200">{w?.equityINR != null ? `₹${Math.round(w.equityINR).toLocaleString('en-IN')}` : '—'}</div>
          <div className="text-[9px] text-slate-600">spot + futures @ live USD/₹</div>
        </div>
      </div>
      {/* v12.2: when the futures key-scope probe has spoken, the error is
          the DEFINITIVE one — red + ⛔ so "permission wali key banao"
          can't be missed inside the amber noise. */}
      {err && (
        <div className={`text-[9px] mt-1.5 font-mono ${(w?.futures?.error && w?.futures?.scope === 'no_scope') ? 'text-red-400/90 font-bold' : 'text-amber-500/80'}`}>
          {(w?.futures?.error && w?.futures?.scope === 'no_scope') ? '⛔ ' : '⚠ '}{err}
        </div>
      )}
    </div>
  );
});

export default memo(function CoinDcxTab() {
  // v6.9: CoinDCX-scoped loading — spot + futures boards only.
  // v10.4: + GLOBAL equity futures SIM board (AAPL/GOOGL/NVDA/…/SPACEX).
  const t = useAITrading(true, { markets: ['CRYPTO', 'FUTURES', 'GLOBALFUTURES'] });
  const { crypto, futures, globalFut, state, positions, entries, loading, busy, refresh, refreshPositions, executeSignal, executeFutures, executeGlobal, updateConfig, closePos, fetchDeep, boardError, positionsLive, rescan, rescanning } = t;
  const { runBacktest, runStrategyLab, fetchAlertsStatus, saveAlertsConfig, testAlert } = t;
  const [desk, setDesk] = useState<'CRYPTO' | 'FUTURES' | 'GLOBAL'>('CRYPTO');
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState<BoardFilter>('ALL');
  // BUG 6 fix: reset filter when desk changes — avoids stale empty-board
  // when e.g. STRONG filter active on SPOT but 0 STRONG on FUTURES.
  // v18.6.4: desk switch pe deep modal bhi band — purane desk ka analysis
  // naye desk ke upar overlay tha.
  const switchDesk = useCallback((d: 'CRYPTO' | 'FUTURES' | 'GLOBAL') => { setDesk(d); setFilter('ALL'); setDeep(null); }, []);
  // v6.13: SIMPLE (trade-flow only) / PRO (poora desk) — persist hota hai
  const [viewMode, setViewMode] = useDeskViewMode();
  const simple = viewMode === 'simple';
  const [deep, setDeep] = useState<DeepModalState | null>(null);

  const board: SignalBoard | null = desk === 'FUTURES' ? futures : desk === 'GLOBAL' ? globalFut : crypto;
  // v20.7.12 [M-6]: models fallback chain SPOT desk ka registry GLOBAL desk
  // pe dikha deti thi jab tak globalFut load nahi hota (galat desk ka "bus
  // chal raha hai" signal). Ab sirf ACTIVE desk ka registry — loading me
  // honest empty.
  const models = board?.models || [];
  const canLive = state?.config?.mode === 'live' && !state?.blocked?.notConnected;

  // -----------------------------------------------------------------
  // v10.10 DIRECT COINDCX ULTRA-FAST RT — the fix for "SPOT / Global
  // Futures / Equity SIM me realtime prices fetch nahi ho rahe, isliye
  // wrong call / signal show ho rahe hai". ONE EventSource carries all
  // three desks' symbols (crypto= spot INR · fut= USDT perps · glob=
  // USDC equity perps), server polls CoinDCX DIRECT every 2s and pushes
  // ticks; the cards overlay the live LTP with the snapshot as fallback.
  // -----------------------------------------------------------------
  const spotSyms = useMemo(() => (crypto?.signals || []).map(s => s.symbol), [crypto]);
  const futSyms = useMemo(() => (futures?.signals || []).map(s => s.symbol), [futures]);
  const globSyms = useMemo(() => (globalFut?.signals || []).map(s => s.symbol), [globalFut]);
  const cxLive = useCxLivePrices(true, spotSyms, futSyms, globSyms);
  const liveFor = cxLive.forSignal;
  // v20.7.12 [H2-1]: STABLE CALLBACK PROPS — pehle Expert/TopPicks/OrderConsole
  // ko inline arrow props milte the jo har render pe NAYI identity lete the —
  // 24/7 live tick flush (~1.25 renders/s) par ye HEAVY panels bhi re-render
  // hote the chahe unka content same ho. Ab useCallback (deps sirf tab-deep
  // change pe badalte hain) + memo'd children skip hote hain.
  const liveLtpFor = useCallback((m: string, s: string) => liveFor(m, s)?.price ?? null, [liveFor]);
  const liveSrcFor = useCallback((m: string, s: string) => liveFor(m, s)?.src ?? null, [liveFor]);
  // (onDeepExpert ONDEEP ke declaration ke baad define hota hai — TDZ)
  // honesty chip: how fresh is the newest live tick (s) + feed state
  const liveAgeS = cxLive.lastAt ? Math.max(0, Math.round((Date.now() - cxLive.lastAt) / 1000)) : null;
  // v10.14 (deep-recheck S2 #3): WS accelerator honesty — when the socket
  // is benched, say WHY (quiet GLOB feed vs handshake streak) and for how
  // long, instead of silently reverting to the 2s REST cadence.
  // v10.15: the BINANCE FUT accelerator tier — while the CoinDCX socket
  // cools, FUT_ still gets SUB-SECOND pushes; the chip says so.
  const wsH = cxLive.wsHealth;
  const wsCoolMin = wsH?.cooldownActive ? Math.max(1, Math.round(wsH.cooldownRemainMs / 60_000)) : 0;
  const bnH = wsH?.binanceFut;
  // v18.10: the OFFICIAL spot socket tier — servable book = direct
  // sub-2s INR pushes are live ("SPOT·WS"). Missing on older frames →
  // silent (REST 2s anchor still honest).
  const spH = wsH?.spotWs;
  const spotWsNote = !spH ? '' : spH.servable
    ? ' · SPOT·WS⚡'
    : spH.cooling ? ` · SPOT·WS cooling ${Math.max(1, Math.round((spH.ageMs ?? 0) / 60_000))}m`
      : '';
  const wsNote = !wsH ? '' : wsH.cooldownActive
    ? (wsH.cooldownReason === 'glob-quiet'
      ? ` · GLOB quiet — cooling ${wsCoolMin}m${bnH?.healthy ? ' · FUT Binance·WS⚡' : ''}`
      : wsH.cooldownReason === 'silent-contract'
        ? ` · WS silent — cooling ${wsCoolMin}m${bnH?.healthy ? ' · FUT Binance·WS⚡' : ''}`
        : ` · WS reconnecting ${wsCoolMin}m${bnH?.healthy ? ' · FUT Binance·WS⚡' : ''}`)
    : `${spotWsNote}${wsH.healthy ? ' · FUT/GLOB·WS⚡' : ''}${bnH?.healthy ? ' · FUT Binance·WS⚡' : ''}`;

  // Track which ACTIONABLE symbols were NOT in the previous board → flash them.
  // v18.5 FIX: render-phase ref mutation (queueMicrotask inside useMemo)
  // moved to a proper useEffect — StrictMode-safe, no missed NEW flashes.
  const prevTopRef = useRef<Set<string>>(new Set());
  const actionableSyms = useMemo(
    () => new Set((board?.signals || []).filter(s => s.grade === 'ACTION' || s.grade === 'STRONG').map(s => s.symbol)),
    [board?.generatedAt, board?.signals, desk], // eslint-disable-line react-hooks/exhaustive-deps
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

  const onExecute = useCallback(async (signal: AISignal, mode: 'paper' | 'live' | 'notify', opts?: { qtyINR?: number; leverage?: number }) => {
    const r = await executeSignal(signal, mode, opts);
    if (r.ok) {
      // v7.0.2: notify-mode is NOT a paper trade — honest branch + guarded
      // fills (the old toast rendered "qty undefined @ ₹undefined").
      if (mode === 'notify') {
        notify(true, `🔔 Notify-only — ${r.note || 'gauntlet chala, alert + journal audit likha. Koi order/position NAHI bana.'}`);
        return r;
      }
      const levTag = r.filled?.leverage ? ` · ${r.filled.leverage}x margin (₹${Math.round(r.filled.marginINR ?? 0)})` : '';
      notify(true, mode === 'live'
        ? `✅ LIVE order placed — ${signal.symbol} ${signal.side} · qty ${r.filled?.qty ?? '—'} @ ₹${r.filled?.price ?? '—'}${levTag}${r.fitted ? ` · ⚙️ ${r.fitted}` : ''}`
        : `🧪 Paper trade opened — ${signal.symbol} ${signal.side} · qty ${r.filled?.qty ?? '—'} @ ₹${r.filled?.price ?? '—'}${levTag}${r.fitted ? ` · ⚙️ ${r.fitted}` : ''}`);
    } else {
      notify(false, `⛔ ${r.error || 'execution failed'}`);
    }
    return r; // v7.0.2: the ticket's own banner awaits this honest result
  }, [executeSignal, notify]);

  // v6.8: GLOBAL FUTURES gauntlet (USDT perpetuals) — same handler shape.
  const onExecuteFutures = useCallback(async (signal: AISignal, mode: 'paper' | 'live' | 'notify', opts?: { qtyINR?: number; marginUSDT?: number; leverage?: number }) => {
    const r = await executeFutures(signal, mode, opts);
    if (r.ok) {
      // v7.0.2: notify-mode is NOT a paper trade — honest branch + guarded
      // fills (the old toast rendered "qty undefined @ undefined").
      if (mode === 'notify') {
        notify(true, `🔔 Notify-only — ${r.note || 'gauntlet chala, alert + journal audit likha. Koi order/position NAHI bana.'}`);
        return r;
      }
      const levTag = r.filled?.leverage ? ` · ${r.filled.leverage}x · margin ${Math.round((r.filled as { marginUSDT?: number }).marginUSDT ?? 0)} USDT` : '';
      notify(true, mode === 'live'
        ? `✅ FUTURES LIVE order placed — ${signal.symbol} ${signal.side} · ${r.filled?.qty ?? '—'} @ ${r.filled?.price ?? '—'}${levTag}${r.fitted ? ` · ⚙️ ${r.fitted}` : ''}`
        : `🧪 Futures paper trade opened — ${signal.symbol} ${signal.side} · ${r.filled?.qty ?? '—'} @ ${r.filled?.price ?? '—'}${levTag}${r.fitted ? ` · ⚙️ ${r.fitted}` : ''}`);
    } else {
      notify(false, `⛔ ${r.error || 'execution failed'}`);
    }
    return r; // v7.0.2: the ticket's own banner awaits this honest result
  }, [executeFutures, notify]);

  // v10.4: GLOBAL EQUITY FUTURES SIM desk (Apple/Google/NVIDIA/Tesla/Meta/
  // Amazon/Microsoft + SPACEX) — signals REAL Yahoo data par, execution
  // paper/notify only (CoinDCX par ye contracts listed nahi — server
  // LIVE-reject karta hai with the honest reason).
  const onExecuteGlobal = useCallback(async (signal: AISignal, mode: 'paper' | 'live' | 'notify', opts?: { qtyINR?: number; marginUSDT?: number; leverage?: number }) => {
    const r = await executeGlobal(signal, mode, opts); // 'live' → server gate-0 honest reject (SIM desk)
    if (r.ok) {
      if (mode === 'notify') {
        notify(true, `🔔 Notify-only — ${r.note || 'gauntlet chala, alert + journal audit likha. Koi position NAHI bani.'}`);
        return r;
      }
      const levTag = r.filled?.leverage ? ` · ${r.filled.leverage}x · margin ${Math.round((r.filled as { marginUSDT?: number }).marginUSDT ?? 0)} USDT` : '';
      notify(true, `🌍 Global SIM trade opened — ${signal.symbol} ${signal.side} · ${r.filled?.qty ?? '—'} @ ${r.filled?.price ?? '—'}${levTag}${r.fitted ? ` · ⚙️ ${r.fitted}` : ''} · paper-only desk`);
    } else {
      notify(false, `⛔ ${r.error || 'execution failed'}`);
    }
    return r;
  }, [executeGlobal, notify]);

  const onSaveConfig = useCallback(async (patch: Record<string, unknown>) => {
    const r = await updateConfig(patch);
    if (!r.ok) notify(false, `⛔ ${r.error}`);
    else if (patch.killSwitch) notify(true, '☠️ Kill switch ON — auto disabled, mode → paper, open orders cancelled');
    else if (patch.mode === 'live') notify(true, '🔴 LIVE mode armed — REAL CoinDCX orders now possible on STRONG signals');
    else if (patch.mode === 'paper') notify(true, '🧪 Paper mode — orders simulated');
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
    // v20.7.9 THE BOARD-vs-DEEP MISMATCH FIX: PIN the clicked signal.
    // The old flow threw it away and rendered only the fresh re-run —
    // which legitimately drifts (board scan is up to ~90s old) and read
    // as "deep analysis ka data signal board se alag hai". The modal now
    // shows the EXACT card the user clicked + a LIVE RE-VERIFICATION
    // comparison. Expert/Top-picks stubs (no confidence) stay pin-less.
    const pin = isPinnableSignal(signal) ? signal : null;
    setDeep({ loading: true, pinned: pin, pinnedAt: pin ? Date.now() : null });
    // v20.7.5: user click → fresh=1 (server 30s deep cache BYPASSED — the
    // ensemble runs NOW; the open modal then self-rechecks every 15s).
    const r = await fetchDeep(signal.symbol, signal.market);
    if (deepReq.current !== id) return; // stale — dropped
    if (r.ok && r.signal) setDeep(prev => ({ ...prev, loading: false, signal: r.signal, indicators: r.indicators, narrative: r.narrative, ltf: r.ltf, edge: r.edge, recheckedAt: r.recheckedAt ?? Date.now() }));
    else setDeep(prev => ({ ...prev, loading: false, error: r.error || 'deep analysis unavailable' }));
  }, [fetchDeep]);
  // v20.7.12 [H2-1]: ExpertPicks ka stable onDeep (market desk ke saath
  // bake hota hai — desk switch pe hi naya identity, har render pe nahi)
  const onDeepExpert = useCallback((sym: string) => { onDeep({ symbol: sym, market: desk } as AISignal); }, [onDeep, desk]);

  // v20.7.5: the OPEN deep modal re-checks ITSELF every 15s (the user's
  // every-15-sec ask applied to the analysis they are reading) — grade /
  // side / confidence drift becomes a VISIBLE transition log instead of
  // silent stale numbers.
  const deepMarket = (deep?.signal?.market || (desk === 'FUTURES' ? 'FUTURES' : desk === 'GLOBAL' ? 'GLOBALFUTURES' : 'CRYPTO')) as 'INDIA' | 'CRYPTO' | 'FUTURES' | 'GLOBALFUTURES';
  const deepAuto = useDeepAutoRecheck(deep, setDeep, fetchDeep, deepReq, deepMarket);

  // v20.7.12 [H3-3]: EXECUTE ROUTING — modal ka 🚀 TRADE button pehle HAMESHA
  // pinned (~90s purana) card ka plan use karta tha, chahe DeepPinnedCompare
  // ka verdict DRIFTED/FLIPPED ho (compare khud keh raha tha "LIVE column se
  // lo"). Ab: CONFIRMED → pinned plan executable; DRIFTED → ticket LIVE
  // signal ke fresh plan pe shift (same side, naye numbers — card ke saath
  // honest amber strip); FLIPPED → execute DISABLED (dead thesis se trade
  // nahi); UNKNOWN → pinned reference, execute disabled jab tak verdict na
  // aaye (over-alarm safety + over-eagerness dono band).
  const deepPinV = deep?.pinned && deep?.signal
    ? deepPinVerdict(deep.pinned, deep.signal)
    : null;
  const deepExecSig = deep
    ? (deepPinV
      ? (deepPinV.verdict === 'CONFIRMED' ? deep.pinned!
        : deepPinV.verdict === 'DRIFTED' ? deep.signal!
          : null)
      : (deep.pinned ?? deep.signal))
    : null;
  const deepPrimary = deep ? (deep.pinned ?? deep.signal) : null; // DISPLAY card (pin design intact)
  // v20.7.12 [H3-3]: jo card render hoga + execute hoga (upar ka comment)
  const deepCardSig = deepExecSig ?? deepPrimary;
  const deepCardCanExec = !!deepExecSig;
  const deepCardTick = deepCardSig ? liveFor(deepCardSig.market, deepCardSig.symbol) : null;

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
      {/* ============ COMMAND BAR (CoinDCX-branded) ============ */}
      <div className="quantum-panel rounded-2xl p-4 bg-gradient-to-r from-amber-500/[0.07] via-transparent to-violet-500/[0.06] border border-amber-500/15">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black tracking-wide bg-gradient-to-r from-amber-300 to-yellow-200 bg-clip-text text-transparent">₿ COINDCX DESK</h2>
              <span className="quantum-badge">v12.0 PRO</span>
            </div>
            <p className="text-[10px] text-slate-500 mt-0.5">
              SPOT (INR) + ⚡ GLOBAL FUTURES (USDT perps) · wallet · leverage · auto-agent
              {canLive && <span className="text-red-400 font-black"> · LIVE EXECUTION ARMED</span>}
              <span className="text-amber-400/80 font-bold"> · India/NSE alag tab me (🇮🇳 India)</span>
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <RegimeChips board={board} market="CRYPTO" />
            {/* v10.10: the direct-CoinDCX feed honesty chip — LIVE (2s direct
                poll) / connecting / down / parked, plus the newest tick's age.
                v18.6.3: 'parked' (tab background ≥30s — OUR bandwidth choice)
                is slate, not the alarming red "feed down"; a real 'down' now
                self-heals in ≤5s (never-stop watchdog in the hook). */}
            <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black border tracking-wider ${cxLive.status === 'live'
              ? (wsH?.cooldownActive ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30')
              : cxLive.status === 'down'
                ? 'bg-red-500/15 text-red-300 border-red-500/30'
                : cxLive.status === 'parked'
                  ? 'bg-slate-600/20 text-slate-400 border-slate-600/30'
                  : 'bg-slate-600/20 text-slate-400 border-slate-600/30'}`}
              title="Spot INR (official CoinDCX spot-WS direct push + 2s anchor + ~1s Binance WS) · USDT perps (2s direct CoinDCX RT + WS accelerator) · USDC equity perps (2s direct RT + Yahoo fallback) — ek hi SSE connection, teeno desks live, 24x7. WS cooldown = socket benched, REST 2s abhi bhi chal raha hai. Paused = tab background me tha (bandwidth park) — tab pe wapas aate hi instant live.">
              {cxLive.status === 'live' ? `⚡ DIRECT COINDCX WS${liveAgeS != null ? ` · ${liveAgeS}s ago` : ''}${wsNote}` : cxLive.status === 'down' ? '⚡ live feed down — retrying (≤5s)' : cxLive.status === 'parked' ? '⚡ live feed paused — tab background me tha' : '⚡ live feed connecting…'}
            </span>
            <FreshnessBadge board={board} />
            <RefreshCountdown board={board} loading={loading} />
            <ViewModeToggle mode={viewMode} onSet={setViewMode} />
            {/* v12.5 RESCAN — full fresh universe scan (server-side cache
                bypass): naye prices → naya consensus → fresh top signals.
                The normal refresh reads the 60s cache; THIS re-runs the
                deep ensemble scan (single-flight server-side). */}
            <button onClick={() => rescan()} disabled={rescanning || loading}
              title="RESCAN — pura universe DObara fresh scan (deep AI ensemble, cache bypass). Naye top trade signals — fresh prices, fresh consensus, fresh guards. Cold scan me kuch second lag sakte hain."
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
        <div className="mt-3">
          {/* Desk switcher: SPOT vs GLOBAL FUTURES (dono CoinDCX ke hain —
              isliye ye tab ke ANDAR hai; India alag top-level tab hai). */}
          <div className="flex gap-1 quantum-panel p-1 rounded-2xl w-full sm:w-auto" role="tablist" aria-label="CoinDCX desk">
            <button onClick={() => switchDesk('CRYPTO')} role="tab" aria-pressed={desk === 'CRYPTO'}
              className={`flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-xs font-black transition-colors flex items-center gap-2 ${desk === 'CRYPTO' ? 'bg-gradient-to-r from-amber-600 to-yellow-600 text-white shadow-lg shadow-amber-500/20' : 'text-slate-400 hover:text-slate-200'}`}>
              ₿ SPOT
              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-emerald-500/20 text-emerald-300">INR · 24/7</span>
            </button>
            <button onClick={() => switchDesk('FUTURES')} role="tab" aria-pressed={desk === 'FUTURES'}
              className={`flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-xs font-black transition-colors flex items-center gap-2 ${desk === 'FUTURES' ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-500/20' : 'text-slate-400 hover:text-slate-200'}`}>
              ⚡ GLOBAL FUTURES
              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-violet-500/20 text-violet-300">USDT · 24/7</span>
            </button>
            {/* v10.4: GLOBAL EQUITY FUTURES SIM desk — the world's biggest
                companies, REAL Yahoo signals, paper/notify execution. */}
            <button onClick={() => switchDesk('GLOBAL')} role="tab" aria-pressed={desk === 'GLOBAL'}
              className={`flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-xs font-black transition-colors flex items-center gap-2 ${desk === 'GLOBAL' ? 'bg-gradient-to-r from-sky-600 to-blue-600 text-white shadow-lg shadow-sky-500/20' : 'text-slate-400 hover:text-slate-200'}`}>
              🌍 EQUITY SIM
              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-sky-500/20 text-sky-300">USD · AAPL…SPACEX</span>
            </button>
          </div>
        </div>
      </div>

      {/* ============ STICKY QUICK NAV (v6.9; v6.13 simple-mode filter) ============ */}
      {/* v20.7.12 [H2-1]: NAV_SIMPLE module-scope const — per-render array nahi */}
      <QuickNav items={simple ? NAV_SIMPLE : desk === 'FUTURES' ? NAV_FUTURES : NAV} />

      {/* ============ 📊 DESK STATS (v6.10 — active desk one-glance) ============ */}
      <DeskStatsStrip board={board} deskLabel={desk === 'FUTURES' ? '⚡ FUTURES DESK SNAPSHOT' : desk === 'GLOBAL' ? '🌍 EQUITY SIM DESK SNAPSHOT' : '₿ SPOT DESK SNAPSHOT'} />

      {/* ============ v21.0.3 LOCAL LLM (OLLAMA) MODEL STRIP ============
          India tab jaisa hi — "konsa local ollama model use ho raha hai"
          ab crypto desk par bhi top-level visible (pehle sirf collapsed
          chat panel ke andar). Chip: SCAN + DEEP model; hover: vision/
          ctx/installed; 30s auto-refresh + RECHECK. Dono tabs me accurate
          aur hamesha-visible model attribution. */}
      <div className="quantum-panel rounded-2xl py-1.5">
        <EngineHealthStrip />
      </div>

      {/* ============ 00 · SUPERINTELLIGENCE AUTO-AGENT ============ */}
      <div id="cx-agent">
        <SectionLabel num="00" title="Superintelligence Auto-Agent" sub="wallet-fetch · auto entry/exit · daily 3 trades · SL-based sizing — v19.0 auto scope: GLOBAL FUTURES (USDT margin) + EQUITY SIM (USDC) hi auto-trade hote hain, SPOT auto-entry OFF (manual trading full chalta hai) — sab gauntlet-gated" />
        <div className="mt-2.5">
          <AgentPanel notify={notify} />
        </div>
      </div>

      {/* ============ 00d · SELF-IMPROVEMENT ENGINE — REMOVED v20.6.3 ============
          The user explicitly asked to "completely remove" the loop.
          v20.6.0 disabled the intervals (default SELFIMPROVE_ENABLED=false).
          v20.6.3 went further — the panel component FILE was DELETED from
          the repo, the 14 /api/ai/self/* route handlers were removed from
          routes.js, and the 8 imports were dropped. The loop module FILES
          (outcomeHarvester, driftMonitor, etc.) remain because council.js
          dynamically imports lessonsEngine for the lessonsBlock prompt.
          See app/docs/CHANGES.md v20.6.3 for the full rationale.
      ==================================================================== */}

      {/* ============ 00c · PRO TRADER AUTO — SAPTA (v18.6) ============ */}
      <div id="cx-proauto">
        <SectionLabel num="00c" title="Pro Trader Auto — Browser Execution" sub="AI 75+ · conf 65+ · VERIFIED 90+ CONFIRM wale trade hi — aapke khule CoinDCX/Dhan browser me symbol search → entry price → leverage → order · reversal CONFIRM hote hi close (2× tick + SL instant)" />
        <div className="mt-2.5">
          <ProTraderAutoPanel notify={notify} />
        </div>
      </div>

      {/* ============ 00b · CRYPTO DESK AI AGENT (v10.1 chat) ============ */}
      <div id="cx-chat">
        <SectionLabel num="00b" title="Crypto Desk AI Agent" sub="conversational · 18 live tools (signals / deep scan / global stock / wallet / positions / regime / track-record / sizing / agent status / funding / PERP POSITIONING / WIN PROBABILITY / risk / P&L / strategy lab / news search / verify-signal / model consensus) — full-ticket answers with P(win) + EV, Telegram bot se bhi yahi engine" />
        <div className="mt-2.5">
          <CryptoAgentPanel />
        </div>
      </div>

      {/* ============ 📱 WALLET (v6.9 — "wallet me kitna hai") ============ */}
      <WalletCard />

      {/* toast */}
      {toast && (
        <div className={`quantum-panel rounded-xl px-4 py-2.5 text-xs font-bold border ${toast.ok ? 'border-emerald-500/40 text-emerald-300' : 'border-red-500/40 text-red-300'}`}
          role="status" aria-live="polite">
          {toast.text}
        </div>
      )}

      {/* ============ 🧠 EXPERT PICKS (v8.0 Advance Pro Trader Engine) ============ */}
      <div id="cx-expert">
        {desk !== 'GLOBAL' && <ExpertPicksPanel active market={desk} onDeep={onDeepExpert}
          liveLtpFor={liveLtpFor}
          liveSrcFor={liveSrcFor} />}
      </div>

      {/* ============ 🛰️ v12.0 PERP POSITIONING INTELLIGENCE (FUTURES desk) ============ */}
      {desk === 'FUTURES' && <div id="cx-perp"><PerpIntelPanel /></div>}

      {/* ============ 🏆 TOP 5 PICKS (v6.9) ============ */}
      <div id="cx-top5">
        <TopPicksPanel picks={board?.topFive} market={desk === 'GLOBAL' ? 'GLOBALFUTURES' : desk} deskLabel={desk === 'GLOBAL' ? '🌍 GLOBAL EQUITY FUTURES · USD (SIM desk)' : desk === 'FUTURES' ? '⚡ COINDCX GLOBAL FUTURES · USDT' : '₿ COINDCX SPOT · INR'} scanned={board?.scanned} loading={loading} onDeep={onDeep}
          liveLtpFor={liveLtpFor}
          liveSrcFor={liveSrcFor} />
      </div>

      {/* ============ MARKET BREADTH ============ */}
      <BreadthStrip board={board} />

      {/* ============ 01 · SUPERINTELLIGENCE SIGNAL BOARD ============ */}
      <div id="cx-signals">
        <div className="flex items-end justify-between flex-wrap gap-2">
          <SectionLabel num="01" title="Superintelligence Signal Board" sub={`${desk === 'FUTURES'
            ? 'CoinDCX GLOBAL FUTURES — poora dynamic perp universe scan (RT USDT prices)'
            : desk === 'GLOBAL'
              ? '🌍 GLOBAL EQUITY FUTURES SIM — AAPL/MSFT/GOOGL/AMZN/NVDA/TSLA/META (real Yahoo quotes + 1h candles) + SPACEX (deterministic synthetic, labeled SIM) → same 10-model committee → signals REAL data par, execution PAPER/NOTIFY only'
              : 'CoinDCX SPOT — poora dynamic INR universe scan'} → 10-model consensus + 7-factor expert engine → AI SCORE (80+ = STRONG, 85+ = ELITE) + calibrated WIN PROBABILITY (P(win) vs R:R breakeven + EV in R) + full trade blueprint`} />
          <BoardSummary board={board} />
        </div>
        <div className="mt-2.5 flex items-center justify-between flex-wrap gap-2">
          <FilterChips filter={filter} onChange={setFilter} counts={counts} />
          <span className="text-[10px] text-slate-600 font-mono">🔥 80+ = super AI score · STRONG ≥75% conf + 70% agree · ACTION ≥55 · WATCH ≥35</span>
        </div>
        {/* v9 engine meta strip — what got scanned, how many cleared 80+ */}
        {board?.superIntelMeta && (
          <div className="mt-2 flex items-center gap-2 flex-wrap text-[10px] font-mono">
            <span className="px-2 py-1 rounded-lg bg-gradient-to-r from-cyan-500/15 to-violet-500/15 border border-cyan-500/30 text-cyan-300 font-black tracking-wider">🧠 {board.superIntelMeta.engine}</span>
            <span className="px-2 py-1 rounded-lg bg-black/30 border border-slate-700/40 text-slate-400">universe: {board.superIntelMeta.universeSize} coins ({board.superIntelMeta.universeMode})</span>
            {board.superIntelMeta.priceSource && <span className="px-2 py-1 rounded-lg bg-black/30 border border-slate-700/40 text-slate-500">prices: {board.superIntelMeta.priceSource}</span>}
            <span className="px-2 py-1 rounded-lg bg-black/30 border border-emerald-500/25 text-emerald-400">🔥 80+ strong: {board.superIntelMeta.strongCount ?? 0}</span>
            <span className="px-2 py-1 rounded-lg bg-black/30 border border-amber-500/25 text-amber-400">🧠 85+ elite: {board.superIntelMeta.eliteCount ?? 0}</span>
          </div>
        )}
        <div className={`grid gap-3 mt-2.5 xl:grid-cols-2 ${boardStaleClass(board)}`}>
          {loading && (!board || board.signals.length === 0) && (
            <div className="quantum-panel rounded-2xl p-10 text-center col-span-full">
              <div className="text-4xl mb-3 animate-float">🧠</div>
              <div className="text-sm text-slate-400 font-medium">Ensemble scanning {desk === 'FUTURES' ? 'the futures universe' : desk === 'GLOBAL' ? 'the global equity desk (Yahoo feed)' : 'crypto majors'}…</div>
            </div>
          )}
          {board && !board.ok && (
            <div className="quantum-panel rounded-2xl p-6 col-span-full text-center">
              <div className="text-3xl mb-2">📡</div>
              <div className="text-sm text-red-400 font-bold">{board.reason || 'Data unavailable'}</div>
              <div className="text-[11px] text-slate-500 mt-1">Will auto-retry every 60s</div>
            </div>
          )}
          {/* v7.0.2: network/API failure used to render NOTHING here (silent
              hole between sections) — now an honest unreachable panel. */}
          {!loading && !board && boardError && (
            <div className="quantum-panel rounded-2xl p-6 col-span-full text-center border border-red-500/20">
              <div className="text-3xl mb-2">📡</div>
              <div className="text-sm text-red-400 font-bold">Signal board unreachable</div>
              <div className="text-[11px] text-slate-500 mt-1">Network / API issue — har 60s me auto-retry ho raha hai. Desk switch ya refresh button se dobara try karo.</div>
            </div>
          )}
          {visibleSignals.map(s => {
            // v20.7.12 [M-2]: ek hi liveFor() call per card (pehle 2 —
            // liveLtp + liveSrc alag-alag, age-math bhi do baar)
            const t = liveFor(s.market, s.symbol);
            return (
              <SignalCard key={`${s.market}-${s.symbol}`} signal={s} busy={busy}
                liveLtp={t?.price ?? null}
                liveSrc={t?.src ?? null}
                onExecute={desk === 'CRYPTO' ? onExecute : undefined}
                onExecuteFutures={desk === 'FUTURES' ? onExecuteFutures : undefined}
                onExecuteGlobal={desk === 'GLOBAL' ? onExecuteGlobal : undefined}
                onDeep={onDeep}
                canLive={desk === 'GLOBAL' ? false : canLive} isNew={newSymbols.has(s.symbol)}
                orderBudgetINR={state?.config?.maxOrderINR} riskCapPct={board?.riskCap ?? state?.config?.maxRiskPct ?? 5}
                maxLeverage={state?.config?.cryptoLeverage ?? 1} />
            );
          })}
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
              <div className="text-[10px] text-slate-500 mt-1">Try ALL — the board re-ranks every 60s.</div>
            </div>
          )}
        </div>
      </div>

      {/* ============ 01r · 15s SIGNAL RECHECK (v20.7.5) ============ */}
      <div id="cx-recheck" className="mt-4">
        <SignalRecheckPanel />
      </div>

      {/* ============ 01b · MORNING BRIEF (PRO) ============ */}
      {!simple && (
        <div id="cx-brief">
          <SectionLabel num="01b" title="Morning Brief" sub="ek nazar me poora desk — market · top signals · open book · guards · ledger" />
          <div className="mt-2.5">
            <MorningBriefPanel />
          </div>
        </div>
      )}

      {/* ============ 02b · SWING DESK + WHALE RADAR + ORDERBOOK (PRO) ============ */}
      {!simple && (
        <div id="cx-whales">
          <SectionLabel num="02b" title="Swing Desk + Whale Radar + Orderbook" sub="multi-day crypto setups · volume-spike footprints · live book imbalance" />
          <div className="mt-2.5 grid gap-3 xl:grid-cols-2">
            <SwingDeskPanel market="CRYPTO" />
            <div className="space-y-3">
              <WhaleRadarPanel market="CRYPTO" />
              <OrderbookPanel />
            </div>
          </div>
        </div>
      )}

      {/* ============ 02c · CROSS-ASSET CORRELATIONS (v6.11 · PRO) ============ */}
      {!simple && (
        <div id="cx-corr">
          <SectionLabel num="02c" title="Cross-Asset Correlations" sub="60d returns — NIFTY + sectors + GOLD/CRUDE/DXY/USVIX + BTC/ETH · BTC↔NIFTY risk link · hidden concentration visible" />
          <div className="mt-2.5">
            <CorrelationPanel />
          </div>
        </div>
      )}

      {/* ============ 02e · MANUAL TRADE TRACKER (v10.16 S2) ============ */}
      <div id="cx-manual">
        <SectionLabel num="02e" title="Manual Trade Tracker" sub="aapke REAL trades (crypto + global) — live LTP (5s) · P&L ₹/USDT · R-multiple + peak MFE capture · SL/T distances · ensemble conviction re-vote vs entry snapshot · EXIT NOW banner on flip · exit-quality report card" />
        <div className="mt-2.5">
          <ManualTradeMonitor desk="CRYPTO" notify={notify} />
        </div>
      </div>

      {/* ============ 02f · SUPERINTELLIGENCE REVERSAL AI (v12.8) ============ */}
      <div id="cx-reversal">
        <SectionLabel num="02f" title="Superintelligence Reversal AI" sub="₹ loss-cap CUT → ulta-side FLIP → ₹ target BOOK → confirmed re-entry — failed signals net-positive cycles me badalte hain · leg budget / cooldown / cycle-stop / ensemble gate · CoinDCX futures desk pe AUTO, manual trades pe advisory banner" />
        <div className="mt-2.5">
          <ReversalPanel notify={notify} />
        </div>
      </div>

      {/* ============ 03 · EXECUTION CONSOLE (CoinDCX venue) ============ */}
      <div id="cx-execute">
        <SectionLabel num="03" title="Execution Console" sub="CoinDCX spot + futures positions · leverage · native TP/SL · trailing · portfolio HEAT (total open risk) · risk-gated · audited" />
        <div className="mt-2.5">
          <OrderConsole
            state={state} positions={positions} entries={entries} busy={busy} venue="COINDCX" positionsLive={positionsLive}
            onClose={onClose} onSaveConfig={onSaveConfig} onPositionsChanged={refreshPositions}
            dhan={null} onDhanConnect={CX_DHAN_CONNECT_STUB} onDhanDisconnect={CX_DHAN_DISCONNECT_STUB} onDhanRefresh={CX_DHAN_REFRESH_STUB}
          />
        </div>
      </div>

      {/* ============ 04 · BACKTEST LAB (crypto · PRO) ============ */}
      {!simple && (
        <div id="cx-backtest">
          <SectionLabel num="04" title="Backtest Lab" sub="the SAME 10-model ensemble replayed on crypto history — win rate · avg R · equity curve · learned gates" />
          <div className="mt-2.5">
            <BacktestPanel market="CRYPTO" runBacktest={runBacktest} runStrategyLab={runStrategyLab} />
          </div>
          {/* v10.6 Pro Upgrade #5: the walk-forward dashboard — per-model
              30/90d win-rates + calibration chart + regime tilt state. */}
          <div className="mt-2.5">
            <ModelPerformancePanel desk="CRYPTO" />
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
        <div id="cx-alerts">
          <SectionLabel num="05" title="Alerts & AI Keys" sub="Telegram pings on STRONG signals · AI Council keys — app se hi, Render env ki zaroorat nahi" />
          <div className="mt-2.5">
            <AlertsPanel fetchAlertsStatus={fetchAlertsStatus} saveAlertsConfig={saveAlertsConfig} testAlert={testAlert} busy={busy} notify={notify} />
          </div>
        </div>
      )}

      {/* ============ 06 · MODEL REGISTRY (PRO) ============ */}
      {!simple && (
        <div id="cx-models">
          <SectionLabel num="06" title="Model Registry" sub="the superintelligence bus — every analyst, weight & status" />
          <div className="mt-2.5">
            <ModelRegistry models={models} />
          </div>
        </div>
      )}

      {/* ============ 07 · SIGNAL LEDGER (PRO) ============ */}
      {!simple && (
        <div id="cx-ledger">
          <SectionLabel num="07" title="Signal Ledger" sub="SHA-256 hash chain — har executed signal provable, koi edit possible nahi (dono desks)" />
          <div className="mt-2.5">
            <SignalLedgerPanel />
          </div>
        </div>
      )}

      {/* ============ 07b · TRUST LAYER + PERFORMANCE (v6.11 · PRO) ============ */}
      {!simple && (
        <div id="cx-trust">
          <SectionLabel num="07b" title="Trust Layer + Performance Lab" sub="engine ki confidence kitni sahi hai — calibration · Brier · monthly trend · model p-values · MDD/Sharpe/Sortino" />
          <div className="mt-2.5 grid gap-3 lg:grid-cols-2">
            <TrustLayerPanel />
            <PerfAnalyticsPanel />
          </div>
        </div>
      )}

      {/* ============ v6.13: SIMPLE-mode me PRO sections ka pointer ============ */}
      {simple && (
        <ProSectionsNote names="Brief · Swing/Whales · Correlations · Backtest · Alerts · Models · Ledger · Trust" />
      )}

      {/* ============ DEEP ANALYSIS MODAL ============ */}
      {deep && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Deep analysis"
          onClick={() => { deepReq.current++; setDeep(null); }}>
          <div className="quantum-panel rounded-2xl p-5 max-w-2xl w-full max-h-[85vh] overflow-y-auto animate-scale-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-black text-amber-300 tracking-wide">🔬 DEEP ENSEMBLE ANALYSIS</h3>
                {/* v20.7.5: freshness chips — data ki age ab visible hai + the
                    open analysis self-rechecks every 15s (superintel fix for
                    "galat/purana info" reads). */}
                {!deep.loading && deep.signal && (
                  <DeepFreshnessChip recheckedAt={deep.recheckedAt} nextRecheckAt={deepAuto.nextRecheckAt} rechecks={deepAuto.rechecks} />
                )}
              </div>
              <button onClick={() => { deepReq.current++; setDeep(null); }} className="quantum-btn-ghost px-2.5 py-1 rounded-lg text-xs font-black" aria-label="Close">✕</button>
            </div>
            {deep.loading && (
              <div className="py-8 text-center">
                {/* v20.7.9: the PINNED card renders IMMEDIATELY while the
                    live re-verification runs — the user sees the exact
                    signal they clicked, never a blank "the symbol" screen. */}
                {deep.pinned ? (
                  <>
                    <SignalCard signal={deep.pinned}
                      liveLtp={liveFor(deep.pinned.market, deep.pinned.symbol)?.price ?? null}
                      liveSrc={liveFor(deep.pinned.market, deep.pinned.symbol)?.src ?? null}
                      canLive={canLive} busy={busy}
                      orderBudgetINR={state?.config?.maxOrderINR} riskCapPct={board?.riskCap ?? state?.config?.maxRiskPct ?? 5}
                      maxLeverage={state?.config?.cryptoLeverage ?? 1} />
                    <div className="mt-3 flex items-center justify-center gap-2 text-[10px] font-black text-cyan-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                      LIVE RE-VERIFICATION chal raha hai — fresh 10-model ensemble {deep.pinned.symbol} par abhi compute ho raha hai…
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-4xl mb-3 animate-float">🧠</div>
                    <div className="text-xs text-slate-400">Running a fresh 10-model ensemble on {deep.signal?.symbol ?? 'the symbol'}…</div>
                  </>
                )}
              </div>
            )}
            {!deep.loading && deep.error && !deep.pinned && (
              <div className="py-8 text-center text-xs text-red-400 font-bold">⛔ {deep.error}</div>
            )}
            {/* v20.7.9: a failed live re-run with a PINNED card still shows
                the original signal (the click context survives) + the honest
                error strip below it. */}
            {!deep.loading && deep.error && deep.pinned && (
              <>
                <SignalCard signal={deep.pinned}
                  liveLtp={liveFor(deep.pinned.market, deep.pinned.symbol)?.price ?? null}
                  liveSrc={liveFor(deep.pinned.market, deep.pinned.symbol)?.src ?? null}
                  canLive={canLive} busy={busy}
                  orderBudgetINR={state?.config?.maxOrderINR} riskCapPct={board?.riskCap ?? state?.config?.maxRiskPct ?? 5}
                  maxLeverage={state?.config?.cryptoLeverage ?? 1} />
                <div className="mt-2 py-2 text-center text-[10px] text-amber-400 font-bold">⚠ Live re-verification abhi unavailable ({deep.error}) — upar wahi BOARD CARD hai jise aapne click kiya tha</div>
              </>
            )}
            {!deep.loading && deep.signal && (
              <>
                {/* v20.7.9: PRIMARY card = the PINNED board signal (the one
                    clicked on the board); pin-less dives (Expert/Top picks)
                    render the live signal as before. The live re-run lives in
                    the DeepPinnedCompare block right below — never a silent
                    swap.
                    v20.7.12 [H3-3]: DRIFTED pe ticket LIVE plan pe shift hota
                    hai (compare block ka apna mashvara), FLIPPED pe execute
                    band (dead thesis), UNKNOWN pe verdict ka wait. */}
                {deepCardSig && (
                  <SignalCard signal={deepCardSig}
                    liveLtp={deepCardTick?.price ?? null}
                    liveSrc={deepCardTick?.src ?? null}
                    onExecute={deepCardCanExec && deepExecSig!.market === 'CRYPTO' ? onExecute : undefined}
                    onExecuteFutures={deepCardCanExec && deepExecSig!.market === 'FUTURES' ? onExecuteFutures : undefined}
                    onExecuteGlobal={deepCardCanExec && deepExecSig!.market === 'GLOBALFUTURES' ? onExecuteGlobal : undefined}
                    onDeep={onDeep}
                    canLive={canLive} busy={busy}
                    orderBudgetINR={state?.config?.maxOrderINR} riskCapPct={board?.riskCap ?? state?.config?.maxRiskPct ?? 5}
                    maxLeverage={state?.config?.cryptoLeverage ?? 1} />
                )}
                {deepPinV?.verdict === 'DRIFTED' && (
                  <div className="mt-2 py-2 text-center text-[10px] text-amber-400 font-bold">⚠ Board card DRIFT tha — trade ticket abhi ke LIVE plan pe shift ho gaya hai (upar wahi card, fresh entry/SL/targets)</div>
                )}
                {deepPinV?.verdict === 'FLIPPED' && (
                  <div className="mt-2 py-2 text-center text-[10px] text-red-400 font-bold">⛔ LIVE re-run ne side ULAAT di hai — trade button band hai. Fresh signal board se kholo (upar compare table me side dikhta hai)</div>
                )}
                {deepPinV?.verdict === 'UNKNOWN' && (
                  <div className="mt-2 py-2 text-center text-[10px] text-slate-400 font-bold">❔ Live re-run ka verdict pending — trade button tab tak band hai jab tak CONFIRM/DRIFT/FLIP na aaye</div>
                )}
                {deep.pinned && deep.signal && (
                  <DeepPinnedCompare pinned={deep.pinned} pinnedAt={deep.pinnedAt} live={deep.signal} recheckedAt={deep.recheckedAt} />
                )}
                {/* v20.9.3 FIX (M): the ultrafast 9-check micro-checklist now
                    renders from the LIVE deep payload — NOT from the pinned
                    display card (which carries only the compact wire, no
                    `checks`). Board-click dives show it from the first render. */}
                {deep.signal?.ultrafast && <div className="mt-2"><UltrafastChecklist v={deep.signal.ultrafast} /></div>}
                <MtfBlock ltf={deep.ltf} quality={(deep.pinned ?? deep.signal).quality} />
                {/* v20.2: deep modal ka apna price chart — plan levels ke
                    saath candles. CRYPTO desk INR-scale me convert hota hai
                    (server ltp-ratio conversion — fallback Binance USDT
                    candles bhi desk ke currency me dikhte hain). */}
                <div className="mt-3">
                  <CandleChart symbol={deep.signal.symbol} market={deep.signal.market} ltp={liveFor(deep.signal.market, deep.signal.symbol)?.price ?? deep.signal.ltp} plan={deep.signal.plan} defaultTf="15m" side={deep.signal.side} />
                </div>
                <EdgeBlock edge={deep.edge} />
                {/* v20.7.5: the 15s self-recheck's VISIBLE transition log —
                    grade/side/conf drift ab dikhta hai, silently stale nahi hota. */}
                <DeepTransitionLog log={deepAuto.log} />
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
                {/* v20.7.5: FULL indicator transparency grid — classic stack
                    + the v20.7.4 confluence stack (Fib GP · VP POC/VAH/VAL ·
                    patterns · S/D zones · price action · EMA100/200). The
                    old 4-field block (rsi/adx/atr/vwap) was "deep analysis"
                    in name only. */}
                <DeepIndicatorGrid ind={deep.indicators} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
});
