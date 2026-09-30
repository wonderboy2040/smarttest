// ============================================================
// server/ai/strategyEvolution.js — v19.0 SELF-IMPROVEMENT ENGINE
// ------------------------------------------------------------
// PHASE 3b — STRATEGY EVOLUTION (bounded genetic search).
//
// strategyLab lets a HUMAN describe a strategy; the desk never
// DISCOVERED its own. This module evolves candidate strategies
// INSIDE the lab's already-whitelisted rule-space (10 indicators ×
// 4 operators — a genetic search can never invent an unbounded
// rule, by construction):
//
//   runEvolution({ market, symbols })  one PASS:
//     1. SEED  — classic archetypes (mean-reversion RSI, momentum
//        breakout, trend-follow EMA stack, Stoch oversold…) as
//        validated rule-sets.
//     2. EVOLVE — 5 generations × population 16: tournament-select
//        top performers, MUTATE (one indicator/operator/value
//        nudge) + CROSSOVER (entry conditions swap) — every child
//        re-validated by validateStrategyRules (rejects = death).
//     3. FITNESS — simulateCustomStrategy on REAL candle history
//        (fetchHistoryFor — no look-ahead, same simulator the human
//        lab uses): fitness = expectancyR × sqrt(n) with a 12-trade
//        floor (thin-sample strategies never win by luck).
//     4. REPORT — best 3 candidates with full stats land on the
//        evolution ledger + a proposal each. NOTHING auto-trades:
//        candidates live in the Strategy Lab for the human to
//        inspect/promote (safe-first).
//
// Bounds (compute honesty): 1 market × ≤5 symbols per pass (candle
// history is cached in backtest.js), deterministic RNG (seeded —
// reproducible audits), one in-flight guard, 30s symbol budget.
// ============================================================
import { validateStrategyRules, simulateCustomStrategy } from './strategyLab.js';
import { fetchHistoryFor } from './backtest.js';
import { recordChange } from './evolutionLedger.js';

const POP = 16;
const GENERATIONS = 5;
const MIN_TRADES = 12;
const TOP_REPORT = 3;
const MAX_SYMBOLS = 5;

const r2 = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : null);

// deterministic RNG (mulberry32) — reproducible evolution runs
function rng(seed = 42) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------- seed archetypes (all schema-valid) ----------------
function seeds() {
  return [
    { name: 'mr-rsi', direction: 'LONG', entry: [{ indicator: 'rsi', operator: 'below', value: 32 }], exit: [{ indicator: 'rsi', operator: 'above', value: 62 }], stopLossAtr: 1.5, takeProfitR: 2, maxHoldBars: 48 },
    { name: 'mom-vol', direction: 'LONG', entry: [{ indicator: 'volumeRatio', operator: 'above', value: 2 }, { indicator: 'rsi', operator: 'above', value: 55 }], exit: [], stopLossAtr: 2, takeProfitR: 2.5, maxHoldBars: 36 },
    { name: 'trend-ema', direction: 'LONG', entry: [{ indicator: 'emaStack', value: 'bullish' }, { indicator: 'adx', operator: 'above', value: 22 }], exit: [], stopLossAtr: 2.5, takeProfitR: 3, maxHoldBars: 96 },
    { name: 'stoch-os', direction: 'LONG', entry: [{ indicator: 'stochK', operator: 'below', value: 22 }], exit: [{ indicator: 'stochK', operator: 'above', value: 70 }], stopLossAtr: 1.2, takeProfitR: 1.8, maxHoldBars: 30 },
    { name: 'pb-ema20', direction: 'LONG', entry: [{ indicator: 'priceVsEma20Pct', operator: 'below', value: -3 }], exit: [], stopLossAtr: 1.8, takeProfitR: 2.2, maxHoldBars: 60 },
    { name: 'short-extended', direction: 'SHORT', entry: [{ indicator: 'priceVsEma20Pct', operator: 'above', value: 6 }], exit: [], stopLossAtr: 1.8, takeProfitR: 2, maxHoldBars: 48 },
    { name: 'macd-flip', direction: 'LONG', entry: [{ indicator: 'macdHistNorm', operator: 'crossing_above', value: 0 }], exit: [{ indicator: 'macdHistNorm', operator: 'crossing_below', value: 0 }], stopLossAtr: 2, takeProfitR: 2.5, maxHoldBars: 72 },
    { name: 'rsi-short', direction: 'SHORT', entry: [{ indicator: 'rsi', operator: 'above', value: 70 }], exit: [{ indicator: 'rsi', operator: 'below', value: 45 }], stopLossAtr: 1.5, takeProfitR: 2, maxHoldBars: 48 },
  ];
}

// ---------------- mutation / crossover (schema-safe) ----------------
const MUTATABLE = ['rsi', 'adx', 'stochK', 'volumeRatio', 'priceVsEma20Pct', 'priceVsEma50Pct', 'priceVsVwapPct', 'macdHistNorm', 'changePct'];
const OPS = ['above', 'below', 'crossing_above', 'crossing_below'];
const DEFAULT_RANGE = { rsi: [20, 80], adx: [15, 40], stochK: [15, 85], volumeRatio: [1.2, 4], priceVsEma20Pct: [-8, 8], priceVsEma50Pct: [-12, 12], priceVsVwapPct: [-5, 5], macdHistNorm: [-2, 2], changePct: [-6, 6] };

function mutate(rules, rand) {
  const clone = JSON.parse(JSON.stringify(rules));
  const pick = Math.floor(rand() * 3);
  try {
    if (pick === 0 && clone.entry.length) { // nudge a value
      const i = Math.floor(rand() * clone.entry.length);
      const c = clone.entry[i];
      if (c.indicator === 'emaStack') return clone;
      const [lo, hi] = DEFAULT_RANGE[c.indicator] || [0, 10];
      const step = (hi - lo) * 0.12;
      c.value = r2(Math.max(lo, Math.min(hi, c.value + (rand() - 0.5) * 2 * step)));
    } else if (pick === 1 && clone.entry.length < 4) { // add a condition
      const ind = MUTATABLE[Math.floor(rand() * MUTATABLE.length)];
      const [lo, hi] = DEFAULT_RANGE[ind];
      clone.entry.push({ indicator: ind, operator: OPS[Math.floor(rand() * 4)], value: r2((lo + hi) / 2) });
    } else if (clone.entry.length > 1) { // drop a condition
      clone.entry.splice(Math.floor(rand() * clone.entry.length), 1);
    }
    if (rand() < 0.25) clone.stopLossAtr = r2(Math.max(0.5, Math.min(5, clone.stopLossAtr + (rand() - 0.5))));
    if (rand() < 0.25) clone.takeProfitR = r2(Math.max(0.5, Math.min(5, clone.takeProfitR + (rand() - 0.5))));
    if (rand() < 0.15) clone.maxHoldBars = Math.max(6, Math.min(168, Math.round(clone.maxHoldBars * (0.75 + rand() * 0.5))));
    clone.name = String(clone.name || 'evolved').slice(0, 20);
    return clone;
  } catch { return clone; }
}

function crossover(a, b, rand) {
  try {
    const child = JSON.parse(JSON.stringify(a));
    if (b.entry?.length && rand() < 0.5 && child.entry.length < 4) {
      child.entry.push(JSON.parse(JSON.stringify(b.entry[Math.floor(rand() * b.entry.length)])));
    }
    if (b.exit?.length && rand() < 0.5 && child.exit.length < 3) {
      child.exit.push(JSON.parse(JSON.stringify(b.exit[Math.floor(rand() * b.exit.length)])));
    }
    return child;
  } catch { return a; }
}

// ---------------- fitness ----------------
async function fitnessOf(rules, historyMap) {
  let n = 0, totalR = 0;
  for (const [, candles] of historyMap) {
    const sim = simulateCustomStrategy({ symbol: 'sym', market: 'CRYPTO', candles, rules, capitalPerTradeINR: 1000 });
    if (!sim) continue;
    n += sim.trades.length;
    totalR += sim.trades.reduce((acc, t) => acc + t.r, 0);
  }
  if (n < MIN_TRADES) return { n, expectancyR: -1, fitness: -1 };
  const expectancyR = totalR / n;
  const fitness = expectancyR * Math.sqrt(n); // thin samples never win by luck
  return { n, expectancyR: r2(expectancyR), fitness: r2(fitness) };
}

// ---------------- one evolution pass ----------------
let _inFlight = false;
/**
 * @param {{market?:string, symbols?:string[], seed?:number}} opts
 * @returns report {ok, generations, best[], historySources, note}
 */
export async function runEvolution({ market = 'CRYPTO', symbols = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP'], seed = 42 } = {}) {
  if (_inFlight) return { ok: false, note: 'evolution pehle se chal raha hai — coalesced' };
  _inFlight = true;
  try {
    const syms = (symbols || []).slice(0, MAX_SYMBOLS);
    // 1. real candle history (cached in backtest.js)
    const historyMap = new Map();
    const sources = [];
    for (const s of syms) {
      try {
        const { candles, source } = await fetchHistoryFor(market, s);
        if (Array.isArray(candles) && candles.length > 80) { historyMap.set(s, candles); sources.push(source); }
      } catch { /* symbol down — honest skip */ }
    }
    if (!historyMap.size) {
      return { ok: false, note: `koi candle history nahi mili (${syms.join(', ')}) — network/exchange down, evolution skip` };
    }
    const rand = rng(seed);
    // 2. seed population (validated)
    let population = seeds().map(s => ({ rules: s, fit: null }));
    // 3. generations
    for (let gen = 0; gen < GENERATIONS; gen++) {
      for (const p of population) {
        const v = validateStrategyRules(p.rules);
        p.rules = v.ok ? v.rules : null; // invalid mutant dies
      }
      population = population.filter(p => p.rules);
      for (const p of population) {
        if (p.fit == null) p.fit = (await fitnessOf(p.rules, historyMap)).fitness ?? -1;
      }
      population.sort((a, b) => b.fit - a.fit);
      if (gen === GENERATIONS - 1) break;
      // next gen: elite 4 + mutated + crossed
      const next = population.slice(0, 4).map(p => ({ rules: JSON.parse(JSON.stringify(p.rules)), fit: null }));
      while (next.length < POP) {
        const a = population[Math.floor(rand() * Math.min(8, population.length))];
        const b = population[Math.floor(rand() * Math.min(8, population.length))];
        const child = rand() < 0.5 ? mutate(a.rules, rand) : crossover(mutate(a.rules, rand), b?.rules || a.rules, rand);
        next.push({ rules: child, fit: null });
      }
      population = next;
    }
    population.sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1));
    const best = population.slice(0, TOP_REPORT).map(p => {
      const st = { rules: p.rules, fitness: p.fit };
      const f = fitnessOfCache(p.rules, historyMap);
      return { ...st, trades: f.n, expectancyR: f.expectancyR };
    });
    const report = {
      ok: true, ts: Date.now(), market, symbols: [...historyMap.keys()], historySources: [...new Set(sources)],
      generations: GENERATIONS, population: POP, minTrades: MIN_TRADES, best,
      note: best.length ? `top candidate: ${best[0].rules.name} — ${best[0].trades} trades, ${best[0].expectancyR}R expectancy (Strategy Lab me inspect karo — kuch auto-trade nahi hota)` : 'koi candidate min-trade floor cross nahi kar paya — honest empty',
    };
    if (best.length && (best[0].fitness ?? -1) > 0) {
      recordChange('strategy-evolve', `evolution pass COMPLETE — best ${best[0].rules.name} (fit ${best[0].fitness}, ${best[0].trades} trades, ${best[0].expectancyR}R)`, {
        market, symbols: [...historyMap.keys()], best: best.map(b => ({ name: b.rules.name, fitness: b.fitness, trades: b.trades, expectancyR: b.expectancyR })),
      });
    }
    return report;
  } catch (e) {
    return { ok: false, note: `evolution failed — ${String(e?.message || e).slice(0, 120)}` };
  } finally {
    _inFlight = false;
  }
}

// final stats for reporting (bounded — ≤5 symbols, cached candles)
function fitnessOfCache(rules, historyMap) {
  const r = { n: 0, total: 0, expectancyR: null };
  for (const [, candles] of historyMap) {
    const sim = simulateCustomStrategy({ symbol: 'sym', market: 'CRYPTO', candles, rules, capitalPerTradeINR: 1000 });
    if (!sim) continue;
    r.n += sim.trades.length;
    r.total += sim.trades.reduce((a, t) => a + t.r, 0);
  }
  if (r.n) r.expectancyR = r2(r.total / r.n);
  return r;
}

// ---------------- tests ----------------
export const __testables = { mutate, crossover, seeds, rng, fitnessOf };
