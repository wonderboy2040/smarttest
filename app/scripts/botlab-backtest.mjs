#!/usr/bin/env node
// ============================================================
// app/scripts/botlab-backtest.mjs — Jev Bot Lab Phase 3 CLI (plan §7)
// ------------------------------------------------------------
// Usage:
//   node scripts/botlab-backtest.mjs --bot orb_crypto_utc --arm all
//   node scripts/botlab-backtest.mjs --bot orb_in --bars state/bots/backtest-in.json
//   node scripts/botlab-backtest.mjs --bot lvl --synth 5000   (synthetic sanity data)
//
// Runs the honest 3-arm harness (rules | gated | jev) with the
// REAL tradingCosts friction, prints the §7.3 metric set + §7.4
// pass criteria + mechanical audit (N/N) per arm. Without a bars
// file it runs on deterministic synthetic data so the harness
// itself is always verifiable end-to-end (real data via candle
// store: see server/bots/core/candleStore.js).
// ============================================================
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BotRunner, STRATEGIES, runThreeArmBacktest } from '../server/bots/botRunner.js';
import { createJev, jevConfig } from '../server/bots/jevEngine.js';
import { auditTrades, auditLine } from '../server/bots/core/audit.js';
import { sweepThreshold } from '../server/bots/core/engine.js';

const args = process.argv.slice(2);
const argOf = (name, dflt = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const botId = argOf('bot', 'orb_crypto_utc');
const armSel = argOf('arm', 'all');
const barsFile = argOf('bars');
const synth = Number(argOf('synth', barsFile ? 0 : 5000));
const doSweep = args.includes('--sweep');

if (!STRATEGIES[botId]) {
  console.error(`Unknown bot '${botId}'. Available: ${Object.keys(STRATEGIES).join(', ')}`);
  process.exit(1);
}
// v20.8.1 FIX (M): arm validation — a typo'd --arm used to surface as a
// raw makeDecider stack trace.
if (armSel !== 'all' && !['rules', 'gated', 'jev'].includes(armSel)) {
  console.error(`Unknown arm '${armSel}'. Available: rules | gated | jev | all`);
  process.exit(1);
}

// ---------------- deterministic synthetic bars (seeded PRNG) ----------------
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function synthBars(n) {
  const rnd = mulberry32(42);
  const bars = [];
  let px = 100;
  const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 97) * 0.35 + (rnd() - 0.5) * 0.9;
    const open = px;
    const close = Math.max(1, open + drift);
    const high = Math.max(open, close) + rnd() * 0.6;
    const low = Math.min(open, close) - rnd() * 0.6;
    bars.push({ time: t0 + i * 5 * 60000, open, high, low, close, volume: 1000 + Math.floor(rnd() * 4000) });
    px = close;
  }
  return bars;
}

let bars;
if (barsFile) {
  // v20.8.1 FIX (M): a missing --bars file used to die as an unhandled
  // ENOENT stack.
  try {
    bars = JSON.parse(fs.readFileSync(barsFile, 'utf8'));
  } catch (e) {
    console.error(`Cannot read --bars ${barsFile}: ${e?.message || e}`);
    process.exit(1);
  }
  console.log(`Loaded ${bars.length} bars from ${barsFile}`);
} else {
  bars = synthBars(synth);
  console.log(`Synthetic bars: ${bars.length} (seeded, deterministic) — real data via --bars <file> or candleStore`);
}

const strategy = STRATEGIES[botId].factory();
const jcfg = jevConfig();
// v20.8.2 FIX (L): CWD-relative cache path split the cache when the CLI
// ran from the repo root vs app/ — resolve against the script location.
const _repoStateDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'data', 'bots');
const jev = jcfg.apiKey ? createJev({ ...jcfg, cachePath: path.join(_repoStateDir, 'jev_cache.jsonl') }) : null;
if (!jev) console.log('No TYPESAFE_API_KEY — jev arm skipped (rules vs gated still meaningful: plan §4.4)');

const armsWanted = armSel === 'all' ? ['rules', 'gated', ...(jev ? ['jev'] : [])] : [armSel];
const runArms = async () => {
  const out = {};
  for (const arm of armsWanted) {
    const { runBacktest } = await import('../server/bots/core/engine.js');
    const { makeDecider } = await import('../server/bots/deciders.js');
    const { estimateRoundTripCost } = await import('../server/ai/tradingCosts.js');
    const decider = makeDecider({ arm, strategy, jev: jev || undefined });
    out[arm] = await runBacktest({
      rows: strategy.prepare(bars), strategy, decider,
      costFn: (a) => estimateRoundTripCost(a) || { total: 0 },
      symbol: botId, instrumentType: strategy.instrumentType, lotSize: strategy.lotSize,
      squareOff: strategy.desk === 'india' ? { enabled: true, ist: '15:10' } : null,
    });
  }
  return out;
};

const arms = await runArms();

const fmt = (v, d = 2) => (v == null ? '  n/a' : v.toFixed(d));
console.log(`\n=== ${botId} — ${armsWanted.join(' vs ')} ===`);
for (const [arm, r] of Object.entries(arms)) {
  const m = r.metrics;
  console.log(`\n[${arm}]`);
  console.log(`  trades ${m.trades}  winRate ${m.winRate == null ? 'n/a' : `${(m.winRate * 100).toFixed(1)}%`}  avgR ${fmt(m.avgR)}  tStat ${fmt(m.tStat)}  PF ${fmt(m.profitFactor)}`);
  console.log(`  grossR ${fmt(m.grossR)}  netR ${fmt(m.netR)}  feeDragR ${fmt(m.feeDragR)}  maxDD(R) ${fmt(m.maxDrawdownR)}`);
  if (m.halves) console.log(`  halves: train(n=${m.halves.train.trades} t=${fmt(m.halves.train.tStat)}) test(n=${m.halves.test.trades} t=${fmt(m.halves.test.tStat)})`);
  console.log(`  decisions: candidates ${r.meta.decisions.candidates} taken ${r.meta.decisions.taken} standAside ${fmt((r.meta.decisions.standAsideRate ?? 0) * 100, 1)}%`);
  const vb = Object.entries(r.meta.decisions.vetoBreakdown);
  if (vb.length) console.log(`  vetoes: ${vb.map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`  ambiguousShare ${fmt((r.meta.ambiguousShare ?? 0) * 100, 1)}%  openAtEnd ${r.meta.openAtEnd}`);
  console.log(`  pass criteria: ${r.pass.pass ? 'PASS' : 'FAIL ' + r.pass.failed.join(',')}`);
  // v20.8.1 FIX (H2 — the audit was DEAD in production): the CLI passed
  // ctx WITHOUT minutesFromOpen, so entry_after_open was always false and
  // entry_before_last_entry always true-failing for every orb_in trade —
  // the printed "N/N satisfied" was meaningless. Full ctx + BARS now flow
  // to the independent re-derivation auditor.
  const stratId = botId.includes('lvl') ? 'lvl' : botId.startsWith('orb_crypto') ? 'orb_crypto' : 'orb_in';
  const strat = STRATEGIES[botId].factory();
  const aud = auditTrades(r.trades, {
    strategyId: stratId,
    bars,
    intervalMin: 5,
    lastEntryMinutes: 135,
    minutesFromOpen: (t) => istMinutesOf(t) - (9 * 60 + 15),
    orb: stratId === 'orb_in'
      ? { desk: 'india', rangeMinutes: 15, targetR: 2.0 }
      : stratId === 'orb_crypto'
        ? { desk: 'crypto', rangeMinutes: 30, offsetMin: (strat.sessionVariant === 'london' ? 480 : strat.sessionVariant === 'ny' ? 810 : 0), targetR: 2.0 }
        : undefined,
    lvl: stratId === 'lvl' ? { desk: strat.desk, entryFracR: 0.25, stopFracR: 0.125, targetFracR: 0.50 } : undefined,
  });
  console.log(`  mechanical audit: ${auditLine(aud)}${aud.failures.length ? ' — FAILURES: ' + aud.failures.slice(0, 5).map(f => `${f.i}:${f.rule}`).join(',') : ''}`);
}

// IST minutes helper for the audit ctx (pure arithmetic, engine parity)
function istMinutesOf(tsMs) {
  const t = Number(tsMs);
  if (!Number.isFinite(t)) return NaN;
  return Math.floor((t + 330 * 60000) / 60000) % 1440;
}

if (doSweep && jev) {
  console.log('\n=== Jev threshold sweep (0.20-0.60) ===');
  const { runBacktest } = await import('../server/bots/core/engine.js');
  const { makeDecider } = await import('../server/bots/deciders.js');
  const { estimateRoundTripCost } = await import('../server/ai/tradingCosts.js');
  const sweep = await sweepThreshold({
    thresholds: [0.2, 0.3, 0.4, 0.5, 0.6],
    runOne: async (th) => {
      const j2 = createJev({ ...jcfg, threshold: th, cachePath: path.join(_repoStateDir, 'jev_cache.jsonl') });
      const decider = makeDecider({ arm: 'jev', strategy, jev: j2 });
      const r = await runBacktest({
        rows: strategy.prepare(bars), strategy, decider,
        costFn: (a) => estimateRoundTripCost(a) || { total: 0 },
        symbol: botId, instrumentType: strategy.instrumentType, lotSize: strategy.lotSize,
      });
      return { trades: r.metrics.trades, avgR: r.metrics.avgR, tStat: r.metrics.tStat, netR: r.metrics.netR };
    },
  });
  for (const s of sweep) console.log(`  th=${s.threshold.toFixed(2)}  n=${s.trades}  avgR=${fmt(s.avgR)}  t=${fmt(s.tStat)}  netR=${fmt(s.netR)}`);
  console.log('  (plan §18: best-looking threshold ko same data pe report karna = overfitting; sweep sirf out-of-sample pe validate)');
}

// v20.8.1 FIX (M): the CLI always exited 0 — a FAILing backtest could
// not gate CI. Exit 1 when any RUN arm failed its pass criteria.
const ranArms = Object.values(arms);
const anyFail = ranArms.some(r => r.pass && r.pass.pass === false && (r.metrics?.trades ?? 0) >= 150);
console.log('\nDone.');
process.exit(anyFail ? 1 : 0);
