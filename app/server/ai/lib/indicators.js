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
    volume: candles[candles.length - 1].volume || 0,
    avgVolume20: candles.slice(-20).reduce((a, c) => a + (c.volume || 0), 0) / Math.min(20, candles.length),
  };
}

// ---------------- guards for tests/API ----------------
export { num };
