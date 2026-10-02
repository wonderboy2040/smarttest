// ============================================================
// server/ai/lib/indicators.js — pure technical-analysis math
// ------------------------------------------------------------
// The quantitative foundation of the Superintelligence Ensemble.
// Every function here is PURE (no fetch, no clock, no state) so the
// test-suite can pin the math exactly. Data sources (TV scanner /
// CoinDCX candles) feed these numbers; models consume them.
//
// Conventions:
//   • candles: [{ time, open, high, low, close, volume }] oldest-first
//   • null-safety: every function returns null when inputs are
//     insufficient — models treat null as "no vote", never as 0.
// ============================================================

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// ---------------- moving averages ----------------
export function sma(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

export function ema(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

export function emaSeries(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = new Array(period - 1).fill(null).concat([e]);
  for (let i = period; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}

// ---------------- RSI (Wilder smoothing) ----------------
export function rsi(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgGain = gain / period, avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, d)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -d)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ---------------- MACD ----------------
export function macd(closes, fast = 12, slow = 26, signal = 9) {
  if (!Array.isArray(closes) || closes.length < slow + signal) return null;
  const fastE = emaSeries(closes, fast);
  const slowE = emaSeries(closes, slow);
  if (!fastE || !slowE) return null;
  const macdLine = [];
  for (let i = 0; i < closes.length; i++) {
    const f = fastE[i], s = slowE[i];
    macdLine.push(f != null && s != null ? f - s : null);
  }
  // Signal line over the non-null tail of the MACD line.
  const firstIdx = macdLine.findIndex(v => v != null);
  if (firstIdx < 0) return null;
  const tail = macdLine.slice(firstIdx).filter(v => v != null);
  if (tail.length < signal) return null;
  const sig = ema(tail, signal);
  const m = tail[tail.length - 1];
  const prevM = tail[tail.length - 2] ?? m;
  const hist = m - sig;
  const prevHist = prevM - sig;
  return { macd: m, signal: sig, hist, histSlope: hist - prevHist };
}

// ---------------- ATR (Wilder) ----------------
export function atr(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  let a = trs.slice(0, period).reduce((x, y) => x + y, 0) / period;
  for (let i = period; i < trs.length; i++) a = (a * (period - 1) + trs[i]) / period;
  return a;
}

// ---------------- Bollinger Bands ----------------
export function bollinger(closes, period = 20, mult = 2) {
  if (!Array.isArray(closes) || closes.length < period) return null;
  const tail = closes.slice(-period);
  const mid = tail.reduce((a, b) => a + b, 0) / period;
  const variance = tail.reduce((a, b) => a + (b - mid) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  const upper = mid + mult * sd, lower = mid - mult * sd;
  const last = closes[closes.length - 1];
  const width = upper - lower;
  return {
    upper, mid, lower,
    percentB: width > 0 ? (last - lower) / width : 0.5,
    widthPct: mid > 0 ? (width / mid) * 100 : 0,
  };
}

// ---------------- Stochastic ----------------
export function stochastic(candles, period = 14, smoothK = 3, smoothD = 3) {
  if (!Array.isArray(candles) || candles.length < period + smoothK + smoothD) return null;
  const raw = [];
  for (let i = period - 1; i < candles.length; i++) {
    const win = candles.slice(i - period + 1, i + 1);
    const hh = Math.max(...win.map(c => c.high));
    const ll = Math.min(...win.map(c => c.low));
    const c = candles[i].close;
    raw.push(hh > ll ? ((c - ll) / (hh - ll)) * 100 : 50);
  }
  const k = sma(raw.slice(-smoothK - 1), smoothK) ?? raw[raw.length - 1];
  const d = sma(raw.slice(-smoothK - smoothD), smoothD) ?? k;
  return { k, d };
}

// ---------------- ADX / DMI ----------------
export function adx(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period * 2 + 1) return null;
  const plusDM = [], minusDM = [], trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    const up = c.high - p.high, down = p.low - c.low;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const wilder = (arr) => {
    let s = arr.slice(0, period).reduce((a, b) => a + b, 0);
    const out = [s];
    for (let i = period; i < arr.length; i++) { s = s - s / period + arr[i]; out.push(s); }
    return out;
  };
  const trS = wilder(trs), pS = wilder(plusDM), mS = wilder(minusDM);
  const dxs = [];
  for (let i = 0; i < trS.length; i++) {
    if (trS[i] <= 0) continue;
    const pdi = (pS[i] / trS[i]) * 100, mdi = (mS[i] / trS[i]) * 100;
    const sum = pdi + mdi;
    if (sum > 0) dxs.push((Math.abs(pdi - mdi) / sum) * 100);
  }
  if (dxs.length < period) return null;
  const adxVal = dxs.slice(-period).reduce((a, b) => a + b, 0) / period;
  const last = trS.length - 1;
  const pdi = (pS[last] / trS[last]) * 100, mdi = (mS[last] / trS[last]) * 100;
  return { adx: adxVal, plusDI: pdi, minusDI: mdi };
}

// ---------------- OBV + slope ----------------
export function obvSlope(candles, lookback = 10) {
  if (!Array.isArray(candles) || candles.length < lookback + 2) return null;
  let obv = 0;
  const series = [0];
  for (let i = 1; i < candles.length; i++) {
    obv += candles[i].close > candles[i - 1].close ? candles[i].volume
      : (candles[i].close < candles[i - 1].close ? -candles[i].volume : 0);
    series.push(obv);
  }
  const first = series[series.length - 1 - lookback], last = series[series.length - 1];
  const avgVol = candles.slice(-lookback).reduce((a, c) => a + (c.volume || 0), 0) / lookback;
  if (!(avgVol > 0)) return null;
  return (last - first) / (avgVol * lookback); // normalized: OBV units per avg-volume
}

// ---------------- MFI (money flow index) ----------------
export function mfi(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) return null;
  let pos = 0, neg = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const tp = (candles[i].high + candles[i].low + candles[i].close) / 3;
    const prevTp = (candles[i - 1].high + candles[i - 1].low + candles[i - 1].close) / 3;
    const flow = tp * (candles[i].volume || 0);
    if (tp > prevTp) pos += flow; else if (tp < prevTp) neg += flow;
  }
  if (neg === 0) return 100;
  return 100 - 100 / (1 + pos / neg);
}

// ---------------- VWAP (session — all provided candles) ----------------
export function vwap(candles) {
  if (!Array.isArray(candles) || candles.length === 0) return null;
  let pv = 0, v = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    pv += tp * (c.volume || 0);
    v += c.volume || 0;
  }
  return v > 0 ? pv / v : null;
}

// ---------------- Supertrend ----------------
export function supertrend(candles, period = 10, mult = 3) {
  if (!Array.isArray(candles) || candles.length < period + 2) return null;
  const a = atr(candles, period);
  if (a == null) return null;
  const c = candles[candles.length - 1];
  const mid = (c.high + c.low) / 2;
  const upper = mid + mult * a, lower = mid - mult * a;
  const prev = candles[candles.length - 2];
  const prevClose = prev.close;
  // Direction: close above lower band & rising → uptrend; below upper & falling → downtrend.
  if (prevClose >= lower && c.close > prevClose) return { direction: 1, line: lower, upper, lower };
  if (prevClose <= upper && c.close < prevClose) return { direction: -1, line: upper, upper, lower };
  return { direction: 0, line: mid, upper, lower };
}

// ---------------- Pivots (classic daily) ----------------
export function pivots(candle) {
  if (!candle) return null;
  const { high, low, close } = candle;
  const p = (high + low + close) / 3;
  return {
    p, r1: 2 * p - low, s1: 2 * p - high,
    r2: p + (high - low), s2: p - (high - low),
    r3: high + 2 * (p - low), s3: low - 2 * (high - p),
  };
}

// ---------------- momentum helpers ----------------
export function roc(closes, period = 10) {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;
  const last = closes[closes.length - 1];
  const past = closes[closes.length - 1 - period];
  return past > 0 ? ((last - past) / past) * 100 : null;
}

// ---------------- candlestick patterns ----------------
// Returns an array of detected patterns on the LAST candles with a
// directional bias: +1 bullish, -1 bearish, 0 neutral.
export function detectPatterns(candles) {
  if (!Array.isArray(candles) || candles.length < 3) return [];
  const found = [];
  const c = candles[candles.length - 1];
  const p = candles[candles.length - 2];
  const pp = candles[candles.length - 3];
  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low;
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const prevBody = Math.abs(p.close - p.open);

  if (range > 0 && body / range < 0.1) found.push({ name: 'Doji', bias: 0 });

  if (lowerWick > body * 2 && upperWick < body && range > 0) {
    found.push({ name: 'Hammer', bias: 1 });
  }
  if (upperWick > body * 2 && lowerWick < body && range > 0) {
    found.push({ name: 'Shooting Star', bias: -1 });
  }
  if (c.close > c.open && p.close < p.open && c.close > p.open && c.open < p.close && body > prevBody) {
    found.push({ name: 'Bullish Engulfing', bias: 1 });
  }
  if (c.close < c.open && p.close > p.open && c.close < p.open && c.open > p.close && body > prevBody) {
    found.push({ name: 'Bearish Engulfing', bias: -1 });
  }
  if (pp && p && c) {
    const smallMid = Math.abs(p.close - p.open) < (Math.abs(pp.close - pp.open) * 0.5);
    if (smallMid && pp.close < pp.open && c.close > c.open && p.close < c.high) {
      found.push({ name: 'Morning Star', bias: 1 });
    }
    if (smallMid && pp.close > pp.open && c.close < c.open && p.close > c.low) {
      found.push({ name: 'Evening Star', bias: -1 });
    }
  }
  return found;
}

// ---------------- ATR percentile (how volatile is now vs recent) ----------------
export function atrPercentile(candles, period = 14, lookback = 60) {
  if (!Array.isArray(candles) || candles.length < lookback) return null;
  const values = [];
  for (let end = period + 1; end <= candles.length; end++) {
    const v = atr(candles.slice(0, end), period);
    if (v != null) values.push(v);
  }
  if (values.length < 10) return null;
  const current = values[values.length - 1];
  const below = values.filter(v => v < current).length;
  return (below / values.length) * 100;
}

// ============================================================
// v20.7.4 — USER-SPEC INDICATOR STACK (9 upgrades)
// Price Action / Fibonacci / SMC / Liquidity Sweep / Volume
// Profile / Chart Patterns / FVG / ICT / EMA / Supply-Demand.
// Pure math, no look-ahead (only candles[0..i]).
// ============================================================

// ---------------- FIBONACCI RETRACEMENT (auto swing) ----------------
// Finds the dominant leg (swing low→high or high→low) over the
// lookback, computes the classic retracement grid 0.236…0.786 +
// the 1.272/1.618 extensions, and marks the GOLDEN POCKET
// (0.618–0.65) — the highest-probability continuation zone.
export function fibonacciRetracement(candles, { lookback = 90 } = {}) {
  if (!Array.isArray(candles) || candles.length < 20) return null;
  const win = candles.slice(-Math.min(candles.length, lookback));
  let hiIdx = 0, loIdx = 0, hi = -Infinity, lo = Infinity;
  win.forEach((c, i) => {
    if (c.high > hi) { hi = c.high; hiIdx = i; }
    if (c.low < lo) { lo = c.low; loIdx = i; }
  });
  if (!(hi > lo) || hiIdx === loIdx) return null;
  const up = loIdx < hiIdx;            // up-leg: low came first
  const diff = hi - lo;
  const levels = {};
  for (const r of [0.236, 0.382, 0.5, 0.618, 0.65, 0.786]) {
    levels[String(r)] = up ? hi - r * diff : lo + r * diff;
  }
  const extensions = {
    '1.272': up ? hi + 0.272 * diff : lo - 0.272 * diff,
    '1.618': up ? hi + 0.618 * diff : lo - 0.618 * diff,
  };
  const gpA = levels['0.618'], gpB = levels['0.65'];
  const goldenPocket = { low: Math.min(gpA, gpB), high: Math.max(gpA, gpB) };
  const ltp = win[win.length - 1].close;
  const inGoldenPocket = ltp >= goldenPocket.low && ltp <= goldenPocket.high;
  return {
    swingHigh: hi, swingLow: lo, direction: up ? 'up' : 'down',
    levels, extensions, goldenPocket, inGoldenPocket,
    positionPct: Math.round(((ltp - lo) / diff) * 10000) / 100,
    // pullback into the golden pocket of an up-leg = bullish
    // continuation zone; mirror for the down-leg.
    bias: inGoldenPocket ? (up ? 1 : -1) : 0,
  };
}

// ---------------- VOLUME PROFILE (VPVR: POC / VAH / VAL) ----------------
// Bins typical-price × volume over the lookback, finds the Point of
// Control (highest-volume price) and the 70% Value Area (VAH/VAL).
export function volumeProfile(candles, { bins = 24, lookback = 120, valueAreaPct = 0.70 } = {}) {
  if (!Array.isArray(candles) || candles.length < 20) return null;
  const win = candles.slice(-Math.min(candles.length, lookback));
  let hi = -Infinity, lo = Infinity, totalV = 0;
  for (const c of win) {
    if (c.high > hi) hi = c.high;
    if (c.low < lo) lo = c.low;
    totalV += c.volume || 0;
  }
  if (!(hi > lo) || !(totalV > 0)) return null;
  const width = (hi - lo) / bins;
  const buckets = new Array(bins).fill(0);
  for (const c of win) {
    const tp = (c.high + c.low + c.close) / 3;
    let idx = Math.floor((tp - lo) / width);
    if (idx < 0) idx = 0;
    if (idx >= bins) idx = bins - 1;
    buckets[idx] += c.volume || 0;
  }
  let pocIdx = 0;
  buckets.forEach((v, i) => { if (v > buckets[pocIdx]) pocIdx = i; });
  // value area: expand from the POC until the target share is covered
  const target = totalV * valueAreaPct;
  let vaVol = buckets[pocIdx], loI = pocIdx, hiI = pocIdx;
  while (vaVol < target && (loI > 0 || hiI < bins - 1)) {
    const down = loI > 0 ? buckets[loI - 1] : -1;
    const up = hiI < bins - 1 ? buckets[hiI + 1] : -1;
    if (up >= down) { hiI++; vaVol += Math.max(0, up); } else { loI--; vaVol += Math.max(0, down); }
  }
  const ltp = win[win.length - 1].close;
  return {
    poc: lo + (pocIdx + 0.5) * width,
    vah: lo + (hiI + 1) * width,
    val: lo + loI * width,
    bins,
    priceVsPoc: ltp > lo + (pocIdx + 0.5) * width ? 'above' : 'below',
    inValueArea: ltp >= lo + loI * width && ltp <= lo + (hiI + 1) * width,
    ltp,
  };
}

// ---------------- CHART PATTERNS (multi-bar geometry) ----------------
// Double top/bottom, H&S (+inverse), triangles, flags — on fractal
// swing pivots. bias: +1 bullish / -1 bearish; confidence grows when
// the neckline is actually broken (confirmed), not just forming.
export function detectChartPatterns(candles, { strength = 3, tolPct = 0.6 } = {}) {
  if (!Array.isArray(candles) || candles.length < 30) return [];
  const n = candles.length;
  const highs = [], lows = [];
  for (let i = strength; i < n - strength; i++) {
    let isH = true, isL = true;
    for (let k = i - strength; k <= i + strength; k++) {
      if (k === i) continue;
      if (candles[k].high >= candles[i].high) isH = false;
      if (candles[k].low <= candles[i].low) isL = false;
    }
    if (isH) highs.push({ i, price: candles[i].high });
    if (isL) lows.push({ i, price: candles[i].low });
  }
  const found = [];
  const lastClose = candles[n - 1].close;
  const h2 = highs.slice(-2), l2 = lows.slice(-2);

  if (h2.length === 2) {
    const tol = (Math.max(h2[0].price, h2[1].price) * tolPct) / 100;
    if (Math.abs(h2[0].price - h2[1].price) <= tol) {
      let neck = Infinity;
      for (let i = h2[0].i; i <= h2[1].i; i++) neck = Math.min(neck, candles[i].low);
      if (h2[1].price > neck) {
        const confirmed = lastClose < neck;
        found.push({ name: `Double Top (${confirmed ? 'confirmed' : 'forming'})`, dir: -1, neckline: neck, confidence: confirmed ? 70 : 45 });
      }
    }
  }
  if (l2.length === 2) {
    const tol = (Math.max(l2[0].price, l2[1].price) * tolPct) / 100;
    if (Math.abs(l2[0].price - l2[1].price) <= tol) {
      let neck = -Infinity;
      for (let i = l2[0].i; i <= l2[1].i; i++) neck = Math.max(neck, candles[i].high);
      if (l2[1].price < neck) {
        const confirmed = lastClose > neck;
        found.push({ name: `Double Bottom (${confirmed ? 'confirmed' : 'forming'})`, dir: 1, neckline: neck, confidence: confirmed ? 70 : 45 });
      }
    }
  }
  const h3 = highs.slice(-3), l3 = lows.slice(-3);
  if (h3.length === 3) {
    const [l, h, r] = h3;
    const tol = (h.price * tolPct) / 100;
    if (h.price > l.price && h.price > r.price && Math.abs(l.price - r.price) <= tol * 2) {
      let neck = Infinity;
      for (let i = l.i; i <= r.i; i++) neck = Math.min(neck, candles[i].low);
      const confirmed = lastClose < neck;
      found.push({ name: `Head & Shoulders (${confirmed ? 'confirmed' : 'forming'})`, dir: -1, neckline: neck, confidence: confirmed ? 72 : 48 });
    }
  }
  if (l3.length === 3) {
    const [l, h, r] = l3;
    const tol = (h.price * tolPct) / 100;
    if (h.price < l.price && h.price < r.price && Math.abs(l.price - r.price) <= tol * 2) {
      let neck = -Infinity;
      for (let i = l.i; i <= r.i; i++) neck = Math.max(neck, candles[i].high);
      const confirmed = lastClose > neck;
      found.push({ name: `Inverse H&S (${confirmed ? 'confirmed' : 'forming'})`, dir: 1, neckline: neck, confidence: confirmed ? 72 : 48 });
    }
  }
  if (h2.length === 2 && l2.length === 2) {
    const flatHighs = Math.abs(h2[0].price - h2[1].price) <= (h2[1].price * tolPct) / 100;
    const risingLows = l2[1].price > l2[0].price * (1 + tolPct / 200);
    if (flatHighs && risingLows) found.push({ name: 'Ascending Triangle', dir: 1, confidence: 55, apex: h2[1].price });
    const flatLows = Math.abs(l2[0].price - l2[1].price) <= (l2[1].price * tolPct) / 100;
    const fallingHighs = h2[1].price < h2[0].price * (1 - tolPct / 200);
    if (flatLows && fallingHighs) found.push({ name: 'Descending Triangle', dir: -1, confidence: 55, apex: l2[1].price });
  }
  const flag = _impulseAndFlag(candles);
  if (flag) found.push(flag);
  return found;
}

function _impulseAndFlag(candles) {
  const n = candles.length;
  if (n < 25) return null;
  const bodies = candles.slice(-Math.min(n, 40)).map(c => Math.abs(c.close - c.open));
  const avgBody = bodies.reduce((a, b) => a + b, 0) / (bodies.length || 1) || 1e-9;
  for (let i = n - 6; i >= Math.max(1, n - 15); i--) {
    const body = candles[i].close - candles[i].open;
    if (Math.abs(body) < 2.2 * avgBody) continue;
    let ok = true, drift = 0;
    for (let j = i + 1; j < n; j++) {
      const b = candles[j].close - candles[j].open;
      if (Math.abs(b) > 1.2 * avgBody) { ok = false; break; }
      drift += b;
    }
    if (!ok || n - 1 - i < 3) continue;
    if (body > 0 && drift < 0) return { name: 'Bull Flag', dir: 1, confidence: 58, note: 'impulse up + tight drift down' };
    if (body < 0 && drift > 0) return { name: 'Bear Flag', dir: -1, confidence: 58, note: 'impulse down + tight drift up' };
  }
  return null;
}

// ---------------- SUPPLY & DEMAND ZONES ----------------
// A base (2-5 small-bodied candles) followed by a strong impulse
// LEAVING the base = institutional footprint. Demand = up-impulse
// base (support), Supply = down-impulse base (resistance). Fresh =
// price never returned into the zone after creation.
// v20.7.4: base smallness ab IMPULSE-relative hai (body ≤ 25% of the
// impulse body) — avgBody-relative check mixed-body windows me galat
// tight ho jata tha (zero-body drift bars average niche kheench dete
// the aur asli base reject ho jata tha).
export function supplyDemandZones(candles, { maxScan = 80, baseBodyRatio = 0.25, impulseFactor = 2.0 } = {}) {
  if (!Array.isArray(candles) || candles.length < 25) return null;
  const n = candles.length;
  const ltp = candles[n - 1].close;
  const bodies = candles.slice(-Math.min(n, maxScan)).map(c => Math.abs(c.close - c.open));
  const avgBody = bodies.reduce((a, b) => a + b, 0) / (bodies.length || 1) || 1e-9;
  const zones = [];
  for (let i = n - 4; i >= Math.max(2, n - maxScan); i--) {
    const body = candles[i].close - candles[i].open;
    const mag = Math.abs(body);
    if (mag < impulseFactor * avgBody) continue;
    for (let len = 2; len <= 5; len++) {
      const s = i - len;
      if (s < 0) break;
      let small = true, zTop = -Infinity, zBottom = Infinity;
      for (let j = s; j < i; j++) {
        if (Math.abs(candles[j].close - candles[j].open) > baseBodyRatio * mag) { small = false; break; }
        zTop = Math.max(zTop, Math.max(candles[j].open, candles[j].close));
        zBottom = Math.min(zBottom, Math.min(candles[j].open, candles[j].close));
      }
      if (!small) continue;
      const dir = body > 0 ? 1 : -1;
      if (dir === 1 && candles[i].close <= zTop) continue;
      if (dir === -1 && candles[i].close >= zBottom) continue;
      let fresh = true;
      for (let j = i + 1; j < n; j++) {
        if (dir === 1 && candles[j].low < zTop) { fresh = false; break; }
        if (dir === -1 && candles[j].high > zBottom) { fresh = false; break; }
      }
      const mid = (zTop + zBottom) / 2;
      zones.push({
        type: dir === 1 ? 'demand' : 'supply', dir,
        top: zTop, bottom: zBottom, fresh,
        nearPct: Math.round((Math.abs(ltp - mid) / ltp) * 10000) / 100,
        inZone: ltp >= zBottom && ltp <= zTop,
        barAge: n - 1 - i,
      });
      break; // longest valid base for this impulse
    }
  }
  const demand = zones.filter(z => z.type === 'demand').sort((a, b) => a.nearPct - b.nearPct)[0] || null;
  const supply = zones.filter(z => z.type === 'supply').sort((a, b) => a.nearPct - b.nearPct)[0] || null;
  if (!demand && !supply) return null;
  return { demand, supply, count: zones.length };
}

// ---------------- PRICE ACTION STATS (bar-quality read) ----------------
// Close-Location-Value, body/range ratio, up-down bar count and the
// mini-range position — the tape's fingerprint beyond patterns.
export function priceActionStats(candles, { lookback = 20 } = {}) {
  if (!Array.isArray(candles) || candles.length < 5) return null;
  const win = candles.slice(-Math.min(candles.length, lookback));
  const c = win[win.length - 1];
  const range = c.high - c.low;
  const clv = range > 0 ? ((c.close - c.low) / range) * 2 - 1 : 0;
  let upBars = 0, downBars = 0;
  for (let i = 1; i < win.length; i++) {
    if (win[i].close > win[i - 1].close) upBars++;
    else if (win[i].close < win[i - 1].close) downBars++;
  }
  const bodies = win.map(x => Math.abs(x.close - x.open));
  const avgBody = bodies.reduce((a, b) => a + b, 0) / win.length;
  const ranges = win.map(x => x.high - x.low);
  const avgRange = ranges.reduce((a, b) => a + b, 0) / win.length;
  let hh = -Infinity, ll = Infinity;
  for (const w of win) { if (w.high > hh) hh = w.high; if (w.low < ll) ll = w.low; }
  return {
    clv: Math.round(clv * 100) / 100,
    bodyRatio: avgRange > 0 ? Math.round((avgBody / avgRange) * 100) / 100 : null,
    upBars, downBars, bars: win.length,
    rangePositionPct: hh > ll ? Math.round(((c.close - ll) / (hh - ll)) * 10000) / 100 : null,
    trendBias: upBars > downBars * 1.3 ? 1 : (downBars > upBars * 1.3 ? -1 : 0),
  };
}

// ---------------- aggregate from candles (one call) ----------------
export function computeIndicatorsFromCandles(candles) {
  if (!Array.isArray(candles) || candles.length < 30) return null;
  const closes = candles.map(c => c.close);
  const bb = bollinger(closes);
  const st = stochastic(candles);
  const ad = adx(candles);
  const sup = supertrend(candles);
  return {
    ltp: closes[closes.length - 1],
    ema10: ema(closes, 10),
    ema20: ema(closes, 20),
    ema50: ema(closes, 50),
    // v20.7.4 USER-SPEC: EMA stack ab 100/200 tak — macro trend layer
    ema100: candles.length >= 100 ? ema(closes, 100) : null,
    ema200: candles.length >= 200 ? ema(closes, 200) : null,
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    rsi: rsi(closes),
    macd: macd(closes),
    atr: atr(candles),
    atrPct: atrPercentile(candles),
    bollinger: bb,
    stochastic: st,
    adx: ad,
    obvSlope: obvSlope(candles),
    mfi: mfi(candles),
    vwap: vwap(candles),
    supertrend: sup,
    roc: roc(closes),
    patterns: detectPatterns(candles),
    // ---- v20.7.4 USER-SPEC INDICATOR UPGRADE ----
    chartPatterns: detectChartPatterns(candles),        // multi-bar geometry
    fib: fibonacciRetracement(candles),                 // auto swing + golden pocket
    volumeProfile: volumeProfile(candles),              // POC / VAH / VAL
    supplyDemand: supplyDemandZones(candles),           // institutional zones
    priceAction: priceActionStats(candles),             // CLV / body / bar-count tape
    volume: candles[candles.length - 1].volume || 0,
    avgVolume20: candles.slice(-20).reduce((a, c) => a + (c.volume || 0), 0) / Math.min(20, candles.length),
  };
}

// ---------------- guards for tests/API ----------------
export { num };
