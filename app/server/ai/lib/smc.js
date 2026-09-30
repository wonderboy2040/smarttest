// ============================================================
// server/ai/lib/smc.js — ICT / SMART-MONEY CONCEPTS (v6.7)
// ------------------------------------------------------------
// The 10th ensemble model. Pure candle-geometry detectors, no
// look-ahead (only candles[0..i]):
//
//   1. LIQUIDITY SWEEP — a wick pierces a prior swing high/low
//      (resting liquidity) but the bar CLOSES back inside. Classic
//      stop-hunt reversal: bearish when a high is swept (sell-side
//      liquidity grabbed above), bullish when a low is swept.
//   2. ORDER BLOCK — the last OPPOSITE candle before an impulsive
//      displacement move. Price retesting a bullish OB from above
//      = institutional support → bullish; mirror for bearish OB.
//   3. FVG (fair value gap) — 3-candle imbalance: candle1.high <
//      candle3.low (bullish FVG below price → magnet/support) or
//      candle1.low > candle3.high (bearish FVG above).
//
// Each concept contributes a signed score; the vote direction is
// the net, confidence scales with how many concepts stack + how
// fresh the sweep is. Weights live in models.js (SMC entry).
// ============================================================

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Find the most recent swing high/low pivot before index i. */
function swingLevel(candles, i, side, lookback = 22, strength = 3) {
  // pivot = a bar whose high/low is the extreme of ±strength bars
  for (let j = Math.min(i - strength - 1, i - 1); j >= Math.max(strength, i - lookback); j--) {
    const c = candles[j];
    let isPivot = true;
    for (let k = j - strength; k <= j + strength; k++) {
      if (k === j || k < 0 || k >= candles.length) continue;
      if (side === 'high' && candles[k].high >= c.high) { isPivot = false; break; }
      if (side === 'low' && candles[k].low <= c.low) { isPivot = false; break; }
    }
    if (isPivot) return { index: j, price: side === 'high' ? c.high : c.low };
  }
  return null;
}

/** LIQUIDITY SWEEP detection on the last `recent` bars. */
export function detectSweep(candles, recent = 3) {
  const n = candles.length;
  if (n < 15) return null;
  for (let i = n - recent; i < n; i++) {
    if (i < 10) continue;
    const c = candles[i];
    const hi = swingLevel(candles, i, 'high');
    const lo = swingLevel(candles, i, 'low');
    // sweep of a swing HIGH: wick above, close back below → bearish
    if (hi && c.high > hi.price && c.close < hi.price) {
      return { type: 'sweep-high', dir: -1, level: hi.price, wick: Math.round((c.high - hi.price) / c.close * 10000) / 100, barAge: n - 1 - i };
    }
    // sweep of a swing LOW: wick below, close back above → bullish
    if (lo && c.low < lo.price && c.close > lo.price) {
      return { type: 'sweep-low', dir: 1, level: lo.price, wick: Math.round((lo.price - c.low) / c.close * 10000) / 100, barAge: n - 1 - i };
    }
  }
  return null;
}

/** ORDER BLOCK: last opposite candle before a displacement move. */
export function detectOrderBlock(candles, dispFactor = 1.6, maxScan = 60) {
  const n = candles.length;
  if (n < 25) return null;
  // displacement = a body ≥ dispFactor × recent avg body, in one direction
  const bodies = candles.slice(-Math.min(n, 40)).map(c => Math.abs(c.close - c.open));
  const avgBody = bodies.reduce((a, b) => a + b, 0) / (bodies.length || 1) || 1e-9;
  for (let i = n - 2; i >= Math.max(1, n - maxScan); i--) {
    const c = candles[i];
    const body = c.close - c.open;
    if (Math.abs(body) < dispFactor * avgBody) continue;
    // find the last OPPOSITE candle just before the displacement
    for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
      const prev = candles[j];
      const prevBody = prev.close - prev.open;
      const opposite = body > 0 ? prevBody < 0 : prevBody > 0;
      if (!opposite) continue;
      const ltp = candles[n - 1].close;
      const ob = {
        type: body > 0 ? 'bullish-ob' : 'bearish-ob',
        dir: body > 0 ? 1 : -1,
        top: Math.max(prev.open, prev.close),
        bottom: Math.min(prev.open, prev.close),
        barAge: n - 1 - j,
      };
      // only meaningful when price is NEAR the OB (retest zone ±0.6%)
      const near = Math.abs(ltp - (ob.top + ob.bottom) / 2) / ltp;
      return { ...ob, nearPct: Math.round(near * 10000) / 100, inRetest: near <= 0.6 };
    }
  }
  return null;
}

/** FVG: 3-candle imbalance near current price. */
export function detectFvg(candles, nearPctMax = 1.2) {
  const n = candles.length;
  if (n < 12) return null;
  const ltp = candles[n - 1].close;
  for (let i = n - 3; i >= Math.max(0, n - 30); i--) {
    const a = candles[i], c = candles[i + 2];
    // bullish FVG: candle1.high < candle3.low (gap below → magnet up)
    if (a.high < c.low) {
      const gapMid = (a.high + c.low) / 2;
      const near = Math.abs(ltp - gapMid) / ltp * 100;
      if (near <= nearPctMax) return { type: 'bullish-fvg', dir: 1, top: c.low, bottom: a.high, barAge: n - 1 - i };
    }
    // bearish FVG: candle1.low > candle3.high (gap above → magnet down)
    if (a.low > c.high) {
      const gapMid = (a.low + c.high) / 2;
      const near = Math.abs(ltp - gapMid) / ltp * 100;
      if (near <= nearPctMax) return { type: 'bearish-fvg', dir: -1, top: a.low, bottom: c.high, barAge: n - 1 - i };
    }
  }
  return null;
}

/**
 * THE SMC VOTE — used by models.js as the 10th ensemble model.
 * Accepts either ctx (signals.js shape: ctx.candles) or plain candles.
 */
export function smcVote(ctxOrCandles) {
  const candles = Array.isArray(ctxOrCandles) ? ctxOrCandles : ctxOrCandles?.candles;
  if (!Array.isArray(candles) || candles.length < 30) {
    return { dir: 0, conf: 0, reasons: ['SMC: not enough candles'] };
  }
  const sweep = detectSweep(candles);
  const ob = detectOrderBlock(candles);
  const fvg = detectFvg(candles);
  const facts = [sweep, ob, fvg].filter(Boolean);
  if (facts.length === 0) {
    return { dir: 0, conf: 0, reasons: ['SMC: no sweep / order-block / FVG confluence in range'] };
  }
  let score = 0;
  const reasons = [];
  if (sweep) {
    // fresh sweeps (age ≤ 1 bar) weigh double
    const w = sweep.barAge <= 1 ? 2 : 1;
    score += sweep.dir * w;
    reasons.push(`${sweep.type === 'sweep-high' ? 'sell-side liquidity swept' : 'buy-side liquidity swept'} @ ${Math.round(sweep.level)} (wick ${sweep.wick}%, ${sweep.barAge} bar${sweep.barAge === 1 ? '' : 's'} ago)${w === 2 ? ' — FRESH' : ''}`);
  }
  if (ob?.inRetest) {
    score += ob.dir;
    reasons.push(`${ob.type === 'bullish-ob' ? 'price retesting bullish' : 'price retesting bearish'} order block (retest zone ${ob.nearPct}% away)`);
  } else if (ob) {
    // distant OB = weak context signal (quarter weight)
    score += ob.dir * 0.25;
  }
  if (fvg) {
    score += fvg.dir * 0.5;
    reasons.push(`${fvg.type === 'bullish-fvg' ? 'bullish' : 'bearish'} FVG ${Math.round(fvg.bottom)}–${Math.round(fvg.top)} acting as magnet`);
  }
  if (score === 0) {
    return { dir: 0, conf: 0, reasons: ['SMC: signals cancel out (no net confluence)'] };
  }
  const dir = score > 0 ? 1 : -1;
  // confidence: 1 concept ~45, 2 stacked ~65, all 3 ~78; fresh sweep +8
  const conf = clamp(38 + facts.length * 14 + (sweep && sweep.barAge <= 1 ? 8 : 0) + Math.min(8, Math.abs(score) * 3), 0, 85);
  return { dir, conf, reasons };
}
