// ============================================================
// src/components/tabs/BotsTab.tsx — Jev Bot Lab v20.8.0
// ------------------------------------------------------------
// The BOTS DESK (plan §13 Phase 9): honest-signal bot lab view.
//   ┌ COMMAND BAR   mode badge PAPER/LIVE · SSE state · smoke
//   ├ BOT CARDS     per bot: equity · today P&L (GROSS vs NET) ·
//   │               win-rate · avg R · fees eaten · drawdown ·
//   │               heartbeat · arm selector · kill switch
//   ├ JEV PANEL     decision stream (probs, take/wait, latency,
//   │               cached) + breaker/usage stats
//   ├ DECISIONS     append-only event log (risk blocks, orders)
//   └ GROUND RULES  the honesty contract, on the screen itself
// ============================================================
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useBots, type BotCard, type BotEvent } from '../bots/useBots';

const fmtMoney = (v: number | null | undefined, cur: string) =>
  // v20.8.2 FIX (L): USD/USDT values used en-IN lakh grouping ($1,00,000)
  // — locale follows the currency now.
  v == null || !Number.isFinite(v) ? '—' : `${cur === 'INR' ? '₹' : '$'}${v.toLocaleString(cur === 'INR' ? 'en-IN' : 'en-US', { maximumFractionDigits: 0 })}`;
const fmtNum = (v: number | null | undefined, d = 2) =>
  v == null || !Number.isFinite(v) ? '—' : v.toFixed(d);

const ARM_LABEL: Record<string, string> = {
  rules: 'RULES (baseline)',
  gated: 'GATED (control)',
  jev: 'JEV (filter)',
};

const BOT_LABEL: Record<string, string> = {
  orb_in: 'ORB-IN · NSE opening-range breakout',
  orb_crypto_utc: 'ORB-CRYPTO · UTC session',
  orb_crypto_london: 'ORB-CRYPTO · London session',
  orb_crypto_ny: 'ORB-CRYPTO · NY session',
  lvl: 'LVL · crypto liquidity sweep',
  lvl_in: 'LVL-IN · NSE prior-day sweep',
  ensemble: 'ENSEMBLE · site STRONG adapter',
};

const BotCardView = memo(function BotCardView({ bot, onStop, onArm, busy }: {
  bot: BotCard;
  onStop: (bot: string, on: boolean) => void;
  onArm: (bot: string, arm: string) => void;
  busy?: boolean;
}) {
  const a = bot.account;
  const cur = a?.currency || 'USDT';
  const pnlClass = (v: number | null | undefined) =>
    v == null ? 'text-slate-400' : v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-slate-300';
  const hbAge = bot.heartbeat ? Math.max(0, Math.round((Date.now() - bot.heartbeat.at) / 1000)) : null;
  return (
    <div className={`quantum-panel rounded-2xl p-4 ${bot.killSwitch ? 'ring-1 ring-rose-500/50' : ''}`}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <div className="text-sm font-black text-slate-100">{BOT_LABEL[bot.bot] || bot.bot}</div>
          <div className="text-[10px] text-slate-500 mt-0.5 font-mono">{bot.bot}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black ${bot.mode === 'LIVE' ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30' : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/25'}`}>
            {bot.mode}
          </span>
          {bot.killSwitch && <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-rose-500/20 text-rose-300">KILL SWITCH ON</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <Stat label="Equity" value={fmtMoney(a?.equity, cur)} />
        <Stat label="Today P&L (net)" value={fmtMoney(a?.todayPnl?.net, cur)} className={pnlClass(a?.todayPnl?.net)} />
        <Stat label="Today P&L (gross)" value={fmtMoney(a?.todayPnl?.gross, cur)} className={pnlClass(a?.todayPnl?.gross)} sub="gross ≠ net = friction" />
        <Stat label="Fees eaten" value={fmtMoney(a?.feesPaid, cur)} className="text-amber-300" />
        <Stat label="Win rate" value={a?.winRate != null ? `${(a.winRate * 100).toFixed(1)}%` : '—'} />
        <Stat label="Avg R" value={fmtNum(a?.avgR)} className={pnlClass(a?.avgR)} />
        <Stat label="Trades" value={String(a?.trades ?? 0)} />
        <Stat label="Max DD" value={a?.maxDrawdownPct != null ? `${a.maxDrawdownPct.toFixed(1)}%` : '—'} className="text-rose-300" />
        {/* v20.8.2 FIX (L): the backtest pWin the server persists (and the
            fee gate is calibrated on) was delivered but never rendered. */}
        <Stat
          label="Backtest pWin"
          value={bot.backtest?.pWin != null ? `${(Number(bot.backtest.pWin) * 100).toFixed(1)}%` : '—'}
          sub={bot.backtest?.verdict || (bot.backtest?.pWin != null ? 'fee-gate input' : 'run /api/bots/backtest')}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[10px]">
        <select
          value={bot.arm}
          onChange={(e) => onArm(bot.bot, e.target.value)}
          disabled={busy}
          className="bg-slate-900/80 border border-slate-700 rounded-lg px-2 py-1 text-slate-300 font-bold disabled:opacity-50"
          aria-label={`decider arm for ${bot.bot}`}
        >
          {Object.entries(ARM_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button
          onClick={() => onStop(bot.bot, !bot.killSwitch)}
          disabled={busy}
          className={`px-2.5 py-1 rounded-lg font-black border transition-colors disabled:opacity-50 ${bot.killSwitch
            ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20'
            : 'bg-rose-500/10 text-rose-300 border-rose-500/30 hover:bg-rose-500/20'}`}
        >
          {busy ? '…' : bot.killSwitch ? '▶ RESUME' : '⏸ KILL SWITCH'}
        </button>
        <span className="text-slate-500 font-mono">
          heartbeat {hbAge != null ? `${hbAge}s ago · ${bot.heartbeat?.bars ?? 0} bars · ${bot.heartbeat?.note || ''}` : 'none'}
        </span>
      </div>
    </div>
  );
});

function Stat({ label, value, className = '', sub }: { label: string; value: string; className?: string; sub?: string }) {
  return (
    <div className="bg-slate-900/40 rounded-xl px-2.5 py-2 border border-slate-800/60">
      <div className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">{label}</div>
      <div className={`text-sm font-black ${className || 'text-slate-200'}`}>{value}</div>
      {sub && <div className="text-[8px] text-slate-600 mt-0.5">{sub}</div>}
    </div>
  );
}

const DecisionRow = memo(function DecisionRow({ e }: { e: BotEvent }) {
  // v20.8.2 FIX (H3): production order events carry {kind:'order', ok}
  // with NO `action` field — the old `take` check made every order row
  // render verdict '—' and the dead 'ORDERED' branch unreachable, so a
  // FAILED open was indistinguishable from a filled one in the audit
  // stream the whole lab is built around.
  const isOrder = e.kind === 'order';
  const verdict = isOrder
    ? (e.ok === false ? 'FAILED' : 'ORDERED')
    : e.action === 'take' ? 'TAKE' : (e.action || '—');
  const verdictClass = isOrder
    ? (e.ok === false ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold')
    : e.action === 'take' ? 'text-emerald-400 font-bold' : 'text-slate-500';
  const t = e.at ? new Date(e.at).toLocaleTimeString('en-GB', { hour12: false }) : '';
  const probs = e.jev?.probs;
  return (
    <div className="grid grid-cols-[70px_60px_1fr_90px_110px] gap-2 items-center text-[10px] font-mono px-2 py-1.5 border-b border-slate-800/40">
      <span className="text-slate-500">{t}</span>
      <span className={e.kind === 'risk_block' ? 'text-amber-400' : isOrder ? 'text-cyan-300' : e.kind === 'settle' ? 'text-emerald-300' : 'text-slate-400'}>{e.kind}</span>
      <span className="text-slate-300 truncate">
        {e.symbol ? `${e.symbol} ` : ''}{e.candidate?.side ? `${e.candidate.side} ` : ''}
        {e.exitWhy != null ? <span className="text-slate-500">· exit {String(e.exitWhy)} </span> : null}
        {e.reason ? <span className="text-slate-500">· {e.reason}</span> : null}
        {e.reasons?.length ? <span className="text-amber-500/80">· {e.reasons.join(', ')}</span> : null}
      </span>
      <span className={verdictClass}>{verdict}</span>
      <span className="text-slate-500 text-right">
        {/* v20.8.1 FIX (L): Number() guard — a string value in the probs map
            used to throw and take the whole desk down with it. */}
        {probs ? Object.entries(probs).map(([k, v]) => `${k.slice(0, 5)}:${Number(v).toFixed(2)}`).join(' ') : ''}
        {e.jev?.cached ? ' ⛁' : ''}{e.jev?.latencyMs != null ? ` ${e.jev.latencyMs}ms` : ''}
      </span>
    </div>
  );
});

export default function BotsTab() {
  const { status, events, connected, error, stopBot, setArm, runSmoke } = useBots();
  const [smoke, setSmoke] = useState<unknown>(null);
  const [smokeBusy, setSmokeBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // v20.8.2 FIX (L): actionError used to stick forever (until the next
  // action) — auto-clear after 6s so a transient failure doesn't read
  // as a permanent error state.
  useEffect(() => {
    if (!actionError) return;
    const t = setTimeout(() => setActionError(null), 6000);
    return () => clearTimeout(t);
  }, [actionError]);

  // v20.8.1 FIX (H2): kill switch / arm failures are now VISIBLE — a
  // failed POST used to be swallowed and the user believed the bot was
  // killed. Results refresh the SSE status on success.
  // v20.8.4 FIX (L — in-flight double-fire): both controls are disabled
  // while their POST is pending — rapid double-clicks double-fired and
  // out-of-order arm switches could briefly leave the OLDER arm active.
  const [actionBusy, setActionBusy] = useState<Record<string, boolean>>({});
  const markBusy = (bot: string, v: boolean) => setActionBusy((s) => ({ ...s, [bot]: v }));
  const onStop = useCallback(async (bot: string, on: boolean) => {
    markBusy(bot, true);
    try {
      const r = await stopBot(bot, on);
      if (r && r.ok === false) setActionError(`kill-switch ${on ? 'ON' : 'OFF'} failed for ${bot}: ${r.error || 'unknown'}`);
      else setActionError(null);
    } finally { markBusy(bot, false); }
  }, [stopBot]);
  const onArm = useCallback(async (bot: string, arm: string) => {
    markBusy(bot, true);
    try {
      const r = await setArm(bot, arm);
      if (r && r.ok === false) setActionError(`arm switch failed for ${bot}: ${r.error || 'unknown'}`);
      else setActionError(null);
    } finally { markBusy(bot, false); }
  }, [setArm]);
  const doSmoke = useCallback(async () => {
    setSmokeBusy(true);
    try { setSmoke(await runSmoke()); } finally { setSmokeBusy(false); }
  }, [runSmoke]);

  const decisionEvents = useMemo(() => [...events].reverse().slice(0, 60), [events]);
  const jev = status?.jev;

  return (
    <section className="p-3 sm:p-4 space-y-4 max-w-7xl mx-auto">
      {/* -------- command bar -------- */}
      <div className="quantum-panel rounded-2xl px-4 py-3 flex flex-wrap items-center gap-3">
        <h2 className="text-base font-black text-slate-100">🤖 Bot Lab</h2>
        <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black border ${status?.mode === 'LIVE'
          ? 'bg-rose-500/15 text-rose-300 border-rose-500/30' : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25'}`}>
          {status?.mode || 'PAPER'} MODE
        </span>
        {status?.globalPause && <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-rose-500/20 text-rose-300">GLOBAL PAUSE</span>}
        <span className={`text-[10px] font-mono ${connected ? 'text-emerald-400' : 'text-slate-500'}`}>
          {connected ? '● SSE live' : '○ SSE reconnecting…'}
        </span>
        {status?.scheduler && (
          <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black border ${status.scheduler === 'running'
            ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25'
            : 'bg-amber-500/10 text-amber-300 border-amber-500/25'}`}>
            TICKER {status.scheduler.toUpperCase()}
          </span>
        )}
        <button
          onClick={doSmoke}
          disabled={smokeBusy}
          className="ml-auto px-3 py-1.5 rounded-xl text-[11px] font-black bg-cyan-500/10 text-cyan-300 border border-cyan-500/25 hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {smokeBusy ? 'RUNNING…' : '⚡ PHASE-0 SMOKE'}
        </button>
      </div>

      {actionError && (
        <div className="quantum-panel rounded-2xl px-4 py-2 text-[11px] font-mono text-rose-300 border border-rose-500/30">
          {actionError}
        </div>
      )}

      {smoke != null && (
        <div className="quantum-panel rounded-2xl p-4 text-[11px] font-mono text-slate-300 whitespace-pre-wrap">
          {JSON.stringify(smoke, null, 2)}
        </div>
      )}

      {/* -------- bot cards -------- */}
      <div className="grid gap-3 md:grid-cols-2">
        {(status?.bots || []).map((b) => <BotCardView key={b.bot} bot={b} onStop={onStop} onArm={onArm} busy={!!actionBusy[b.bot]} />)}
        {(!status || status.bots.length === 0) && (
          <div className="quantum-panel rounded-2xl p-6 text-center text-slate-500 text-xs">
            {/* v20.8.1 FIX (L): honest empty-state copy — unset BOTS_ENABLED
                yields the 3 DEFAULT bots; an empty card grid means the list
                parsed to zero or SSE is down. */}
            {connected
              ? 'No bots enabled — BOTS_ENABLED parsed to an empty list (unset it to get the defaults: orb_in, orb_crypto_utc, lvl)'
              : (error || 'Connecting to bot stream…')}
          </div>
        )}
      </div>

      {/* -------- jev panel -------- */}
      <div className="quantum-panel rounded-2xl p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-black uppercase tracking-wider text-cyan-300">Jev (TypeSafe System One)</h3>
          {jev && <span className={`text-[10px] font-mono ${jev.breakerOpen ? 'text-rose-400' : 'text-slate-500'}`}>{jev.breakerOpen ? 'BREAKER OPEN' : 'healthy'}</span>}
        </div>
        {jev ? (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            <Stat label="Model" value={jev.model} />
            <Stat label="Threshold" value={jev.threshold.toFixed(2)} sub="gate on probs[chosen]" />
            <Stat label="Calls" value={String(jev.calls)} sub={`${jev.cacheHits} cached`} />
            <Stat label="p50 / p95" value={`${fmtNum(jev.p50, 0)} / ${fmtNum(jev.p95, 0)} ms`} />
            <Stat label="Errors" value={String(jev.errors)} className={jev.errors > 0 ? 'text-amber-300' : ''} />
            <Stat label="Key" value={jev.hasKey ? 'configured' : 'ABSENT'} className={jev.hasKey ? '' : 'text-rose-300'} />
          </div>
        ) : (
          <div className="text-[11px] text-slate-500">
            Jev not configured — set <code className="text-cyan-400">TYPESAFE_API_KEY</code> in server .env. Rules vs gated comparison stays valid without it.
          </div>
        )}
      </div>

      {/* -------- decision stream -------- */}
      <div className="quantum-panel rounded-2xl p-4">
        <h3 className="text-xs font-black uppercase tracking-wider text-cyan-300 mb-2">Decision stream (append-only)</h3>
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <div className="grid grid-cols-[70px_60px_1fr_90px_110px] gap-2 text-[9px] uppercase tracking-wider text-slate-500 font-bold px-2 pb-1 border-b border-slate-800">
              <span>time</span><span>kind</span><span>candidate / reason</span><span>verdict</span><span className="text-right">jev probs · lat</span>
            </div>
            {decisionEvents.length === 0 && <div className="text-[11px] text-slate-600 px-2 py-3">No decisions yet — bots tick on 5-min bar closes.</div>}
            {/* v20.8.2 FIX (M): stable keys — the old `${at}-${reversed-index}-bot`
            key shifted EVERY row's index on each append, remounting all 60
            memoized rows per events frame. __rid is stamped once at receipt. */}
            {decisionEvents.map((e) => <DecisionRow key={String((e as BotEvent & { __rid?: number }).__rid ?? `${e.bot}-${e.at}-${e.kind}`)} e={e} />)}
          </div>
        </div>
      </div>

      {/* -------- honesty contract -------- */}
      <div className="quantum-panel rounded-2xl p-4 text-[10px] text-slate-500 leading-relaxed">
        <span className="text-slate-400 font-black">Ground rules (engine-enforced, not prompt-enforced):</span>{' '}
        strategies propose · deciders (rules/gated/jev) only approve or wait · hard risk rules override everything ·
        Jev never flips sides, never sizes, never sets SL/TP · default mode is PAPER · gross AND net always shown together ·
        t-stat on mean R with train/test halves is the only scoreboard · edge nahi dikha to bot band, tuning nahi.
      </div>
    </section>
  );
}
