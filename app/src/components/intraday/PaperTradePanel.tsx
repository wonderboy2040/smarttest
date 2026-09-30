// ============================================================
// intraday/PaperTradePanel — virtual-trade simulator UI
// ------------------------------------------------------------
// Lists open virtual positions with LIVE P&L (SSE prices), today's
// closed trades, and day/total P&L stats. Auto-managed by the
// server watcher (T1 books 50%, trail to entry, SL/T2/EOD close).
//
// v2 — DURABLE HISTORY:
//   • "History" section: day-wise closed trades + win-rate accuracy
//     stats (signal testing actually accurate hai ya nahi).
//   • Device mirror (IndexedDB) + auto-restore: Render free tier
//     wipes server/data/ on restart — the browser silently POSTs
//     its mirror back and rebuilds the server's trade history.
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../utils/api';
import { syncMirrorWithServer } from '../../utils/paperMirror';
import type { PaperHistory, PaperSummary, PaperTrade, LiveQuote, IntradaySignal, PaperDayStats } from './types';

async function fetchSummary(): Promise<PaperSummary | null> {
  try {
    const res = await apiFetch(`/api/intraday-paper`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) return await res.json();
  } catch { /* offline */ }
  return null;
}

async function fetchHistory(): Promise<PaperHistory | null> {
  try {
    const res = await apiFetch(`/api/intraday-paper/history?days=90`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) return await res.json();
  } catch { /* offline */ }
  return null;
}

async function closeTrade(id: number): Promise<boolean> {
  try {
    const res = await apiFetch(`/api/intraday-paper/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch { return false; }
}

export async function openPaperTrade(s: IntradaySignal, qty: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(`/api/intraday-paper`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: s.symbol, direction: s.direction, entry: s.entry, qty,
        stopLoss: s.stopLoss, target1: s.target1, target2: s.target2,
        market: s.market || (['BTC','ETH','SOL','BNB','XRP','DOGE','ADA','AVAX','DOT','LINK','UNI','MATIC'].includes(s.symbol) ? 'CRYPTO' : 'INDIA'),
      }),
      signal: AbortSignal.timeout(8000),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.ok) return { ok: true };
    return { ok: false, error: j?.error?.message || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network error' };
  }
}

// ------------------------------------------------------------
// v9.5 F&O OPTION PAPER TRADE — the "Nifty50 15Sep 23400 CE" signal
// card opens a premium-BUY (LONG) position in the SAME Paper Desk:
//   qty   = 1 LOT (P&L auto-multiplied by lotSize server-side)
//   T2    = entry + 1.5× the reward leg (extends the card's target)
//   price = watcher re-prices the premium via Black-Scholes on the
//           live index spot (NIFTY→^NSEI / SENSEX→^BSESN), so SL/T1/
//           T2/trailing/15:10 square-off + live P&L all work
// ------------------------------------------------------------
export async function openOptionPaperTrade(c: {
  symbol: string; strike: number; type: 'CE' | 'PE'; expiry: string;
  entry: number; target: number; stopLoss: number; iv: number | null;
  lotSize: number; name: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    // Option BUY = premium LONG: SL < entry < T1 < T2 in premium terms.
    if (!(c.stopLoss > 0 && c.stopLoss < c.entry && c.target > c.entry)) {
      return { ok: false, error: 'Card levels incomplete (entry/target/SL) — option paper trade nahi khul sakta.' };
    }
    const t2 = +(c.entry + (c.target - c.entry) * 1.5).toFixed(2);
    const res = await apiFetch(`/api/intraday-paper`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // compact contract id: NIFTY23400CE (validated server-side)
        symbol: `${c.symbol}${Math.round(c.strike)}${c.type}`,
        direction: 'LONG',                    // premium BUY
        entry: c.entry, qty: 1,               // 1 lot
        stopLoss: c.stopLoss, target1: c.target, target2: t2,
        market: 'INDIA',
        assetKind: 'OPTION', underlying: c.symbol,
        strike: c.strike, optType: c.type, expiry: c.expiry,
        iv: c.iv && c.iv > 0 ? c.iv : 13,    // BS fallback IV (13%) — same as the card builder
        lotSize: c.lotSize, label: c.name,    // "Nifty50 15Sep 23400 CE"
      }),
      signal: AbortSignal.timeout(8000),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.ok) return { ok: true };
    return { ok: false, error: j?.error?.message || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network error' };
  }
}

const pnlColor = (v: number) => (v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-slate-400');
const fmtPnl = (v: number) => `${v >= 0 ? '+' : '−'}₹${Math.abs(v).toFixed(2)}`;

/** v9.2 adaptive price format — DOGE/SHIB-class crypto paper trades
 *  must not render as ₹0.0 (0.0848 → ₹0.0848, 4-8 decimals below ₹1). */
const px = (v: number | null | undefined): string => {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const dp = a >= 1 ? (a >= 100 ? 1 : 2) : a >= 0.01 ? 4 : a >= 0.0001 ? 6 : 8;
  return `₹${v.toFixed(dp)}`;
};

function dayLabel(dayKey: string): string {
  try {
    const d = new Date(`${dayKey}T12:00:00`);
    return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  } catch { return dayKey; }
}

function TradeRow({ t, live, onClose, closing }: {
  t: PaperTrade; live?: LiveQuote; onClose: (id: number) => void; closing: boolean;
}) {
  const sign = t.direction === 'LONG' ? 1 : -1;
  const lotMult = t.assetKind === 'OPTION' ? (t.lotSize || 1) : 1; // v9.5 F&O lots
  const livePnl = live?.price != null
    ? t.remainingQty * (live.price - t.entry) * sign * lotMult + t.realizedPnl
    : t.realizedPnl + t.unrealizedPnl;
  const livePrice = live?.price ?? t.lastPrice;
  const isClosed = t.status === 'CLOSED';
  const isOption = t.assetKind === 'OPTION';
  // v11.1 GAP 3: entry-side costs already locked in (brokerage buy order +
  // stamp/txn/SEBI/GST) ride as an honest small chip under the gross number.
  const openCosts = !isClosed && t.costs != null && t.costs > 0 ? t.costs : null;
  return (
    <tr className="border-b border-white/5 hover:bg-white/[0.03]">
      <td className="px-2 py-1.5">
        <span className="font-black text-white" title={isOption ? `${t.label || t.symbol} · ${t.expiry} · lot ${t.lotSize}` : t.symbol}>
          {isOption ? (t.label || t.symbol) : t.symbol}
        </span>
        {isOption && (
          <span className="ml-1 px-1 py-0.5 rounded text-[8px] font-black font-mono bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/25" title={`F&O option · 1 lot = ${t.lotSize} qty · premium re-priced live`}>F&amp;O</span>
        )}
        {t.market === 'CRYPTO' && (
          <span className="ml-1 px-1 py-0.5 rounded text-[8px] font-black font-mono bg-amber-500/15 text-amber-300 border border-amber-500/25" title="Crypto market · CoinDCX INR · 24/7">₿</span>
        )}
        <span className={`ml-1 text-[9px] font-black ${t.direction === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>
          {t.direction === 'LONG' ? 'L' : 'S'}
        </span>
      </td>
      <td className="px-2 py-1.5 text-center text-cyan-200">{px(t.entry)}</td>
      <td className="px-2 py-1.5 text-center text-slate-300">
        {px(livePrice)}{live && <span className="ml-0.5 text-[7px] text-cyan-500 animate-pulse">●</span>}
      </td>
      <td className="px-2 py-1.5 text-center text-slate-400">{t.remainingQty}/{t.qty}</td>
      <td className={`px-2 py-1.5 text-center font-bold ${pnlColor(livePnl)}`} title={openCosts != null ? `gross ${fmtPnl(livePnl)} — entry-side costs ${fmtPnl(openCosts)} abhi tak lage hain (brokerage/STT/txn/GST/SEBI/stamp)` : undefined}>
        {fmtPnl(livePnl)}
        {openCosts != null && <span className="ml-1 text-[8px] font-black text-amber-500/80" title="costs so far (entry side)">−{fmtPnl(openCosts).replace('₹', '₹')}c</span>}
      </td>
      <td className="px-2 py-1.5 text-center">
        {isClosed ? (
          <span className="text-[9px] font-bold text-slate-500">{t.closeReason}</span>
        ) : t.status === 'PARTIAL' ? (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-amber-500/15 text-amber-300 border border-amber-500/30">T1 BOOKED</span>
        ) : (
          <button
            onClick={() => onClose(t.id)}
            disabled={closing}
            className="px-2 py-0.5 rounded text-[9px] font-black bg-white/5 border border-white/15 text-slate-300 hover:bg-white/10 disabled:opacity-40"
          >
            {closing ? '…' : 'CLOSE'}
          </button>
        )}
      </td>
    </tr>
  );
}

// ---- HISTORY sub-section: day-wise closed trades + accuracy stats ----
function HistorySection({ history }: { history: PaperHistory }) {
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const { overall, groups, trades } = history;
  if (overall.totalTrades === 0) return null;

  return (
    <div className="rounded-lg bg-black/20 border border-white/5 p-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap px-1">
        <div className="text-[9px] uppercase font-bold text-slate-500 tracking-wider">History — Accuracy Audit</div>
        <div className="text-[10px] font-mono text-slate-400 flex items-center gap-2 flex-wrap">
          <span>{overall.totalTrades} trades</span>
          <span className={`font-black ${overall.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
            {overall.winRate.toFixed(1)}% win
          </span>
          {overall.profitFactor != null && <span className="text-slate-500">PF {overall.profitFactor.toFixed(2)}</span>}
          <b className={pnlColor(overall.totalNetPnl ?? overall.totalPnl)} title={`gross ${fmtPnl(overall.totalPnl)} − costs ${fmtPnl(overall.totalCosts ?? 0)}`}>
            {fmtPnl(overall.totalNetPnl ?? overall.totalPnl)} net
          </b>
          {overall.totalPnl !== (overall.totalNetPnl ?? overall.totalPnl) && (
            <span className="text-slate-600">gross {fmtPnl(overall.totalPnl)}</span>
          )}
        </div>
      </div>
      <div className="text-[9px] font-mono text-slate-500 px-1 flex gap-3 flex-wrap">
        <span>Avg W <b className="text-emerald-400/80">{fmtPnl(overall.avgWin)}</b></span>
        <span>Avg L <b className="text-red-400/80">{fmtPnl(overall.avgLoss)}</b></span>
        {overall.bestDay && <span>Best <b className="text-emerald-400/80">{overall.bestDay.dayKey} {fmtPnl(overall.bestDay.pnl)}</b></span>}
        {(overall.totalCosts ?? 0) > 0 && (
          <span className="text-amber-500/80" title="brokerage + STT + exchange txn + SEBI + GST + stamp (env-tunable to your broker)">
            Costs ate {fmtPnl(overall.totalCosts ?? 0)}{overall.costsPctOfGrossProfit != null ? ` · ${overall.costsPctOfGrossProfit}% of gross profit` : ''}
          </span>
        )}
      </div>
      <div className="max-h-56 overflow-y-auto">
        {groups.map((g: PaperDayStats) => {
          const open = expandedDay === g.dayKey;
          const dayTrades = trades.filter(t => (t.dayKey || '') === g.dayKey);
          return (
            <div key={g.dayKey} className="border-b border-white/5 last:border-0">
              <button
                onClick={() => setExpandedDay(open ? null : g.dayKey)}
                className="w-full flex items-center justify-between gap-2 px-1.5 py-1 hover:bg-white/[0.03] text-left"
              >
                <span className="text-[10px] font-mono font-bold text-slate-300">{dayLabel(g.dayKey)}</span>
                <span className="text-[9px] font-mono text-slate-500 flex items-center gap-2">
                  <span>{g.trades}T</span>
                  <span className="text-emerald-400/70">{g.wins}W</span>
                  <span className="text-red-400/70">{g.losses}L</span>
                  <span className={`px-1 rounded font-black ${g.winRate >= 50 ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>
                    {g.winRate.toFixed(0)}%
                  </span>
                  <b className={pnlColor(g.netPnl ?? g.realizedPnl)} title={`gross ${fmtPnl(g.realizedPnl)} − costs ${fmtPnl(g.costs ?? 0)}`}>{fmtPnl(g.netPnl ?? g.realizedPnl)}</b>
                </span>
              </button>
              {open && dayTrades.length > 0 && (
                <table className="w-full text-[10px] font-mono pb-1">
                  <tbody>
                    {dayTrades.map(t => {
                      const exit = t.parts.length ? t.parts[t.parts.length - 1].exitPrice : t.entry;
                      return (
                        <tr key={t.id} className="border-b border-white/5">
                          <td className="px-2 py-1 text-left">
                            <span className="font-black text-slate-200" title={t.assetKind === 'OPTION' ? `${t.label || t.symbol} · lot ${t.lotSize}` : undefined}>
                              {t.assetKind === 'OPTION' ? (t.label || t.symbol) : t.symbol}
                            </span>
                            <span className={`ml-1 text-[8px] font-black ${t.direction === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>
                              {t.direction === 'LONG' ? 'L' : 'S'}
                            </span>
                          </td>
                          <td className="px-2 py-1 text-center text-cyan-200/80">{px(t.entry)}</td>
                          <td className="px-2 py-1 text-center text-slate-400">{px(exit)}</td>
                          <td className="px-2 py-1 text-center text-slate-500">{t.qty}</td>
                          <td className={`px-2 py-1 text-center font-bold ${pnlColor(t.netPnl ?? t.realizedPnl)}`} title={`gross ${fmtPnl(t.realizedPnl)} − costs ${fmtPnl(t.costs ?? 0)} (brokerage/STT/txn/GST/SEBI/stamp)`}>
                            {fmtPnl(t.netPnl ?? t.realizedPnl)}
                            {(t.costs ?? 0) > 0 && <span className="ml-0.5 text-[8px] font-black text-amber-500/70">net</span>}
                          </td>
                          <td className="px-2 py-1 text-center text-[8px] text-slate-600">{t.closeReason}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PaperTradePanel({ livePrices, refreshKey, onOpenSymbolsChange }: {
  livePrices: Record<string, LiveQuote>; refreshKey: number;
  /** v9.1: lift the open-trade symbol set to the parent tab so the Signal
   *  Board cards can badge "PAPER OPEN" (the old IntradayTab kept this
   *  in a never-populated ref — the badge never lit up; fixed by design). */
  onOpenSymbolsChange?: (symbols: Set<string>) => void;
}) {
  const [summary, setSummary] = useState<PaperSummary | null>(null);
  const [history, setHistory] = useState<PaperHistory | null>(null);
  const [closingId, setClosingId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [restoredNote, setRestoredNote] = useState<string | null>(null);
  const syncingRef = useRef(false);
  // v9.1: report the open-symbol set upward (dedup'd via a ref so the
  // 15s/60s pollers don't spam the parent with fresh-but-equal Sets).
  const lastSymbolsRef = useRef<Set<string> | null>(null);
  const reportSymbols = useCallback((s: PaperSummary | null) => {
    if (!onOpenSymbolsChange) return;
    const next = new Set((s?.open || []).map(t => String(t.symbol).toUpperCase()));
    const prev = lastSymbolsRef.current;
    if (prev && prev.size === next.size && [...next].every(x => prev.has(x))) return;
    lastSymbolsRef.current = next;
    onOpenSymbolsChange(next);
  }, [onOpenSymbolsChange]);

  const load = useCallback(async () => {
    const s = await fetchSummary();
    if (s) { setSummary(s); reportSymbols(s); }
  }, [reportSymbols]);

  const loadHistory = useCallback(async () => {
    // History fetch + device-mirror sync (guard: no overlapping runs —
    // a restore inside triggers a refresh, which re-enters here).
    if (syncingRef.current) return;
    syncingRef.current = true;
    try {
      const [s, h] = await Promise.all([fetchSummary(), fetchHistory()]);
      if (!s) return;
      setSummary(s);
      setHistory(h);
      reportSymbols(s);
      if (h) {
        const restored = await syncMirrorWithServer(s.open || [], h.trades || []);
        if (restored) {
          // Server was wiped (Render restart) and the device mirror just
          // rebuilt it — refresh both views to show the recovered history.
          const [s2, h2] = await Promise.all([fetchSummary(), fetchHistory()]);
          if (s2) setSummary(s2);
          if (h2) setHistory(h2);
          if (s2) reportSymbols(s2);
          setRestoredNote('history device-backup se recover hui');
          setTimeout(() => setRestoredNote(null), 8000);
        }
      }
    } finally {
      syncingRef.current = false;
    }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory, refreshKey]);

  // Periodic refresh (open trades' server-side auto-management).
  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 15000);
    return () => clearInterval(t);
  }, [load]);

  // History + mirror re-sync every 60s (cheap: server renders from RAM).
  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') loadHistory();
    }, 60000);
    return () => clearInterval(t);
  }, [loadHistory]);

  const onClose = async (id: number) => {
    setClosingId(id);
    const ok = await closeTrade(id);
    if (ok) { await load(); await loadHistory(); }
    setClosingId(null);
  };

  if (!summary) return null;
  const { stats } = summary;
  if (summary.open.length === 0 && summary.closedToday.length === 0 && stats.totalRealizedPnl === 0
    && (history?.overall.totalTrades || 0) === 0) {
    return (
      <div className="quantum-panel rounded-2xl p-4 border border-purple-500/15">
        <div className="text-xs font-bold text-slate-300 flex items-center gap-1.5 mb-1">
          <span>📈</span> Paper Trading Simulator
        </div>
        <p className="text-[11px] text-slate-500">
          Koi virtual trade nahi khula. Kisi bhi signal card par <b className="text-purple-300">📈 DESK PAPER</b> dabain
          aur engine ki levels bina real paisa lagaye test karein — T1 par 50% book, breakeven trail, SL/T2/EOD auto-manage.
        </p>
      </div>
    );
  }

  return (
    <div className="quantum-panel rounded-2xl border border-purple-500/20 overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-white/[0.02]"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-slate-200">📈 Paper Trading Simulator</span>
          <span className="px-2 py-0.5 rounded-md text-[9px] font-mono font-black bg-purple-500/15 text-purple-300 border border-purple-500/30">
            VIRTUAL
          </span>
          <span className="text-[10px] font-mono text-slate-400">
            Open {stats.openCount} • Day P&L <b className={pnlColor((stats.dayNetPnl ?? stats.dayRealizedPnl) + stats.dayUnrealizedPnl)}>
              {fmtPnl((stats.dayNetPnl ?? stats.dayRealizedPnl) + stats.dayUnrealizedPnl)}
            </b> • Total <b className={pnlColor(stats.totalNetPnl ?? stats.totalRealizedPnl)}>{fmtPnl(stats.totalNetPnl ?? stats.totalRealizedPnl)}</b>
            {(stats.totalCosts ?? 0) > 0 && (
              <span className="text-amber-500/70" title="brokerage + STT + exchange txn + SEBI + GST + stamp — env-tunable (AI_TC_*) to match your broker"> · costs {fmtPnl(stats.totalCosts ?? 0)}</span>
            )}
          </span>
        </div>
        <span className="text-slate-500 text-xs">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3">
          {summary.open.length > 0 && (
            <div className="overflow-x-auto">
              <div className="text-[9px] uppercase font-bold text-slate-500 tracking-wider px-1 pb-1">Open Virtual Trades</div>
              <table className="w-full text-[11px] font-mono">
                <thead>
                  <tr className="border-b border-white/10 text-[9px] uppercase text-slate-500">
                    <th className="px-2 py-1 text-left">Symbol</th>
                    <th className="px-2 py-1">Entry</th>
                    <th className="px-2 py-1">LTP</th>
                    <th className="px-2 py-1">Qty</th>
                    <th className="px-2 py-1">P&L</th>
                    <th className="px-2 py-1">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.open.map(t => (
                    <TradeRow key={t.id} t={t} live={livePrices[t.symbol]} onClose={onClose} closing={closingId === t.id} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {summary.closedToday.length > 0 && (
            <div className="overflow-x-auto">
              <div className="text-[9px] uppercase font-bold text-slate-500 tracking-wider px-1 pb-1">Closed Today</div>
              <table className="w-full text-[11px] font-mono">
                <thead>
                  <tr className="border-b border-white/10 text-[9px] uppercase text-slate-500">
                    <th className="px-2 py-1 text-left">Symbol</th>
                    <th className="px-2 py-1">Entry</th>
                    <th className="px-2 py-1">Exit</th>
                    <th className="px-2 py-1">Qty</th>
                    <th className="px-2 py-1">P&L</th>
                    <th className="px-2 py-1">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.closedToday.map(t => {
                    const exit = t.parts.length ? t.parts[t.parts.length - 1].exitPrice : t.entry;
                    return (
                      <tr key={t.id} className="border-b border-white/5">
                        <td className="px-2 py-1.5">
                          <span className="font-black text-slate-200" title={t.assetKind === 'OPTION' ? `${t.label || t.symbol} · lot ${t.lotSize}` : undefined}>
                            {t.assetKind === 'OPTION' ? (t.label || t.symbol) : t.symbol}
                          </span>
                          <span className={`ml-1 text-[9px] font-black ${t.direction === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>
                            {t.direction === 'LONG' ? 'L' : 'S'}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-center text-cyan-200">{px(t.entry)}</td>
                        <td className="px-2 py-1.5 text-center text-slate-300">{px(exit)}</td>
                        <td className="px-2 py-1.5 text-center text-slate-400">{t.qty}</td>
                        <td className={`px-2 py-1.5 text-center font-bold ${pnlColor(t.netPnl ?? t.realizedPnl)}`} title={`gross ${fmtPnl(t.realizedPnl)} − costs ${fmtPnl(t.costs ?? 0)} (brokerage/STT/txn/GST/SEBI/stamp)`}>
                          {fmtPnl(t.netPnl ?? t.realizedPnl)}
                          {(t.costs ?? 0) > 0 && <span className="ml-0.5 text-[8px] font-black text-amber-500/70">net</span>}
                        </td>
                        <td className="px-2 py-1.5 text-center text-[9px] text-slate-500">{t.closeReason}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {history && <HistorySection history={history} />}
          {restoredNote && (
            <p className="text-[9px] text-emerald-400 font-mono text-center">✓ {restoredNote}</p>
          )}
          <p className="text-[9px] text-slate-600 font-mono text-center pt-1 border-t border-white/5">
            Virtual trades only — no real money. Auto-managed: T1 → 50% book + breakeven trail • SL/T2 hit → close • 15:10 IST square-off.
            History server + device mirror me durable hai.
            P&L numbers NET hain — brokerage + STT + exchange txn + SEBI + GST + stamp deduct ho chuke hain (AI_TC_* env se apne broker ke rates pin karo); gross tooltip me.
          </p>
        </div>
      )}
    </div>
  );
}
