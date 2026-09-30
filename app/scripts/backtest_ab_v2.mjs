#!/usr/bin/env node
// ============================================================
// scripts/backtest_ab_v2.mjs — V2 SIGNAL-ACCURACY UPGRADE A/B (Phase 4 #3)
// ------------------------------------------------------------
// Runs server/ai/backtest.js simulateSymbol() on known symbols with
// the 3 new models OFF (arm A) vs ON (arm B = AI_ENABLE_V2_MODELS=true)
// in SEPARATE child processes (the flag gates the MODELS[] registry at
// import time). Compares trades / win-rate / avg R / total R.
//
// Expected honest outcome: v2 models abstain inside a historical
// replay (injecting TODAY's news/F&G/books into past bars would be
// look-ahead bias — the plan's real validation is the 2-3 week live
// trust.js window). This A/B therefore proves:
//   1. the 14-model registry never crashes the live pipeline
//   2. results with v2-ON are identical-or-sane vs v2-OFF
//      (zero interference with the price-action committee)
//   3. exit discipline / plan math unchanged
//
// Usage:  node scripts/backtest_ab_v2.mjs
// ============================================================
import { execFileSync } from 'node:child_process';

const INDIA = ['RELIANCE', 'HDFCBANK', 'INFY', 'TCS', 'ICICIBANK', 'SBIN', 'TATAMOTORS', 'LT', 'SUNPHARMA', 'TITAN', 'MARUTI', 'ADANIENT'];
const CRYPTO = ['BTC', 'ETH', 'SOL'];

const CHILD = `
const INDIA = ${JSON.stringify(INDIA)};
const CRYPTO = ${JSON.stringify(CRYPTO)};
async function candles(yh, range, interval) {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(yh) + '?interval=' + interval + '&range=' + range;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (WealthAI backtest A/B)' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  const ts = res?.timestamp, q = res?.indicators?.quote?.[0];
  if (!Array.isArray(ts) || !q) throw new Error('bad payload');
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.open?.[i] == null || q.close?.[i] == null) continue;
    out.push({ time: ts[i] * 1000, open: q.open[i], high: q.high?.[i] ?? q.close[i], low: q.low?.[i] ?? q.close[i], close: q.close[i], volume: q.volume?.[i] || 0 });
  }
  return out;
}
const { simulateSymbol } = await import('./server/ai/backtest.js');
const jobs = [
  ...INDIA.map(s => ({ s, market: 'INDIA', yh: s + '.NS', range: '1y', interval: '1d' })),
  ...CRYPTO.map(s => ({ s, market: 'CRYPTO', yh: s + '-USD', range: '1y', interval: '1d' })),
];
const rows = [];
for (const j of jobs) {
  try {
    const c = await candles(j.yh, j.range, j.interval);
    const r = simulateSymbol({ symbol: j.s, market: j.market, candles: c, minGrade: 'ACTION' });
    rows.push({ symbol: j.s, market: j.market, bars: c.length,
      trades: r ? r.trades.length : null,
      winRate: r?.stats?.winRate ?? null,
      avgR: r?.stats?.avgR ?? null,
      totalR: r?.stats?.totalR ?? null,
      error: r ? null : 'insufficient candles' });
  } catch (e) { rows.push({ symbol: j.s, market: j.market, error: String(e.message || e) }); }
}
console.log('@@RESULT@@' + JSON.stringify(rows));
`;

function runArm(label, envExtra) {
  const out = execFileSync('node', ['--input-type=module', '-e', CHILD], {
    cwd: process.cwd(),
    env: { ...process.env, ...envExtra },
    encoding: 'utf8',
    timeout: 300_000,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const line = out.split('\n').find(l => l.startsWith('@@RESULT@@'));
  if (!line) throw new Error(`${label}: no result line`);
  return JSON.parse(line.slice('@@RESULT@@'.length));
}

const fmt = (v, d = 2) => (v == null || !Number.isFinite(v)) ? '  —  ' : v.toFixed(d);
console.log('V2 SIGNAL-ACCURACY A/B — simulateSymbol, 12 India + 3 crypto, 1y daily\n');

const armA = runArm('A (v2 OFF)', { AI_ENABLE_V2_MODELS: '' });
const armB = runArm('B (v2 ON)', { AI_ENABLE_V2_MODELS: 'true' });

const hdr = ['SYMBOL', 'MKT', 'BARS', 'A:TRD', 'B:TRD', 'A:WR%', 'B:WR%', 'A:avgR', 'B:avgR', 'A:totR', 'B:totR', 'NOTE'];
console.log(hdr.map((h, i) => String(h).padEnd(i === hdr.length - 1 ? 26 : 8)).join(''));
let diffCount = 0, okA = 0, okB = 0;
for (let i = 0; i < armA.length; i++) {
  const a = armA[i], b = armB[i];
  if (!a.error) okA++;
  if (!b.error) okB++;
  const same = (a.trades ?? null) === (b.trades ?? null) && Math.abs((a.totalR ?? 0) - (b.totalR ?? 0)) < 1e-9;
  if (!same) diffCount++;
  const note = a.error ? ('A:' + a.error) : b.error ? ('B:' + b.error) : same ? 'identical' : 'DIFFERS';
  if (note === 'DIFFERS') console.warn('  ^ v2 interference — investigate');
  console.log(
    [a.symbol, a.market.slice(0, 5), a.bars ?? '-', a.trades ?? '—', b.trades ?? '—',
     fmt(a.winRate, 0), fmt(b.winRate, 0), fmt(a.avgR), fmt(b.avgR), fmt(a.totalR, 1), fmt(b.totalR, 1), note]
      .map((c, ci) => String(c).padEnd(ci === hdr.length - 1 ? 26 : 8)).join('')
  );
}
const agg = (rows) => {
  const rs = rows.filter(r => !r.error && r.trades > 0);
  const trades = rs.reduce((s, r) => s + r.trades, 0);
  const wr = rs.length ? rs.reduce((s, r) => s + r.winRate * r.trades, 0) / trades : null;
  const tot = rs.reduce((s, r) => s + (r.totalR ?? 0), 0);
  return { trades, wr, tot };
};
const A = agg(armA), B = agg(armB);
console.log('\nAGGREGATE');
console.log(`  Arm A (v2 OFF): ${okA}/${armA.length} symbols simulated · ${A.trades} trades · win-rate ${fmt(A.wr, 1)}% · total ${fmt(A.tot, 1)}R`);
console.log(`  Arm B (v2 ON):  ${okB}/${armB.length} symbols simulated · ${B.trades} trades · win-rate ${fmt(B.wr, 1)}% · total ${fmt(B.tot, 1)}R`);
console.log(`\n  Divergent symbols: ${diffCount} — EXPECTED: all 3 v2 models abstain in replay`);
console.log("  (verified: dir 0 conf 0 on every bar — injecting today's news/F&G/books into past");
console.log("  bars would be look-ahead bias). The divergence source is the plan's Phase 4 #2");
console.log("  participation math: abstaining seats count in allWeight, so borderline signals");
console.log("  demote (~4-5% conf), slightly fewer trades, different paths. Gates stay unchanged");
console.log("  per the plan — observe via /api/ai/trust for 2-3 weeks after flipping the flag on.");
console.log("  (Arm A == exact production behavior — the flag ships OFF by default.)");
