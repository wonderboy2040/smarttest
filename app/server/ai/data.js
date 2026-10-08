// ============================================================
// server/ai/data.js — market-data access layer for the AI engine
// ------------------------------------------------------------
// ONE place that knows how to reach every data source. Everything
// downstream (models, ensemble, options desk) consumes normalized
// structures and NEVER touches fetch() directly.
//
//   INDIA equities : TradingView India scanner (1 request, rich
//                    pre-computed indicators — proven in prod)
//   INDIA indices  : Yahoo Finance chart API (^NSEI, ^NSEBANK, …)
//   INDIA options  : NSE option-chain (cookie bootstrap) with a
//                    Black-Scholes synthetic fallback
//   CRYPTO         : CoinDCX public candles + tickers, TV crypto
//                    scanner as the USD-indicator source
//   FX             : Yahoo USDINR=X
//
// Every fetch is timeout-guarded and null-safe: an unreachable
// source degrades that market's signals — it never crashes the API.
// ============================================================
import { computeIndicatorsFromCandles } from './lib/indicators.js';
import { fetchCoinDcxTickers } from '../cryptoStream.js';
import { TV_SCAN_HEADERS } from '../lib/tvHeaders.js';
// v20.7.8 [L5]: the SHARED disk-backed USDINR store — the leftover flat
// ×84 in fetchCryptoSnapshot priced exotic fallback symbols ~6-7% off at
// USDINR ≈ 89 (the exact class the v20.2 consolidation killed everywhere
// else). Last-known-good rate first; 84 only on a never-seen cold boot.
import { usdInrFallback as _usdInrFallback } from './lib/usdinr.js';
// v18.9: ONE market-clock definition — isNseOpen now shares the
// intraday/time.js NSE calendar (weekends + fixed + NSE_HOLIDAYS env),
// so the LIVE gauntlet and the scanner agree on "market band hai".
// time.js is import-free (pure) — no cycle is possible.
import { isNseMarketOpen as _isNseMarketOpenShared } from '../intraday/time.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

// ---------------- universes ----------------
// Liquid NSE large/mid caps — the AI scanner universe (kept tight
// for scanner latency: 44 symbols = 1 TV request + fast scan).
export const INDIA_UNIVERSE = [
  'RELIANCE', 'HDFCBANK', 'ICICIBANK', 'INFY', 'TCS', 'SBIN', 'BHARTIARTL', 'ITC',
  'LT', 'AXISBANK', 'KOTAKBANK', 'HINDUNILVR', 'BAJFINANCE', 'MARUTI', 'ASIANPAINT',
  'SUNPHARMA', 'TITAN', 'ULTRACEMCO', 'TATAMOTORS', 'TATASTEEL', 'WIPRO', 'ONGC',
  'NTPC', 'POWERGRID', 'ADANIENT', 'ADANIPORTS', 'JSWSTEEL', 'HCLTECH', 'TECHM',
  'INDUSINDBK', 'CIPLA', 'DRREDDY', 'DIVISLAB', 'NESTLEIND', 'BAJAJFINSV', 'SHRIRAMFIN',
  'EICHERMOT', 'HEROMOTOCO', 'BAJAJ-AUTO', 'BPCL', 'COALINDIA', 'GRASIM', 'HINDALCO',
  'SBILIFE', 'HDFCLIFE',
];

export const CRYPTO_UNIVERSE = [
  'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT', 'TRX', 'POL',
];

export const INDICES = ['NIFTY', 'BANKNIFTY', 'FINNIFTY'];

// ---------------- TV scanner (INDIA) ----------------
// Two-tier column set: the extended set adds BB/Stoch/52w; if the
// scanner rejects any column, we retry once with the proven set.
const TV_FULL = [
  'close', 'open', 'high', 'low', 'volume', 'change',
  'EMA10', 'EMA20', 'EMA50', 'SMA20', 'SMA50',
  'RSI', 'MACD.macd', 'MACD.signal',
  'ATR', 'VWAP', 'ADX', 'ADX+DI', 'ADX-DI',
  'relative_volume_10d_calc',
  'Pivot.M.Classic.Middle', 'Pivot.M.Classic.S1', 'Pivot.M.Classic.R1',
  'BB.upper', 'BB.lower', 'Stoch.K', 'Stoch.D',
  'price_52_week_high', 'price_52_week_low',
  'Recommend.All',
];
const TV_SAFE = [...TV_FULL.slice(0, 23), 'Recommend.All']; // v20.7.8 [L4]: 24-col safe set — Recommend.All KEPT at d[23]; the old slice(0,23) read pf(d[23]) on a 23-col response → recommend was ALWAYS null on the safe-retry path

export async function fetchTVIndiaBatch(symbols) {
  const tickers = [], map = {};
  for (const s of symbols) {
    for (const ex of ['NSE', 'BSE']) {
      const t = `${ex}:${s}`;
      tickers.push(t);
      map[t] = s;
    }
  }
  for (const columns of [TV_FULL, TV_SAFE]) {
    try {
      const res = await fetch(`https://scanner.tradingview.com/india/scan?t=${Date.now()}`, {
        method: 'POST',
        headers: TV_SCAN_HEADERS,
        body: JSON.stringify({ symbols: { tickers: [...new Set(tickers)] }, columns }),
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (!data?.data) continue;
      const out = {};
      for (const item of data.data) {
        if (!item?.d) continue;
        const sym = map[item.s];
        if (!sym || out[sym]) continue;
        const d = item.d;
        const pf = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : null;
        out[sym] = {
          symbol: sym,
          exchange: item.s.split(':')[0],
          ltp: pf(d[0]), open: pf(d[1]), high: pf(d[2]), low: pf(d[3]),
          volume: pf(d[4]), changePct: pf(d[5]),
          ema10: pf(d[6]), ema20: pf(d[7]), ema50: pf(d[8]),
          sma20: pf(d[9]), sma50: pf(d[10]),
          rsi: pf(d[11]), macd: pf(d[12]), macdSignal: pf(d[13]),
          atr: pf(d[14]), vwap: pf(d[15]),
          adx: pf(d[16]), adxPlus: pf(d[17]), adxMinus: pf(d[18]),
          relVolume: pf(d[19]),
          pivot: { p: pf(d[20]), s1: pf(d[21]), r1: pf(d[22]) },
          bbUpper: columns === TV_FULL ? pf(d[23]) : null,
          bbLower: columns === TV_FULL ? pf(d[24]) : null,
          stochK: columns === TV_FULL ? pf(d[25]) : null,
          stochD: columns === TV_FULL ? pf(d[26]) : null,
          high52w: columns === TV_FULL ? pf(d[27]) : null,
          low52w: columns === TV_FULL ? pf(d[28]) : null,
          recommend: columns === TV_FULL ? pf(d[29]) : pf(d[23]),
        };
      }
      if (Object.keys(out).length > 0) return out;
    } catch { /* try the safe set */ }
  }
  return {};
}

// ---------------- v10.17 chunked India batch (full universe) ----------------
// The tiered full-universe scan can hand over 100+ symbols (200+
// NSE+BSE tickers) — the single-request path was never sized for
// that. Chunked at 60 symbols (120 tickers) per request, max 3
// concurrent, results merged first-match-wins (identical row shape
// to fetchTVIndiaBatch — a drop-in expansion, zero downstream edits).
const TV_INDIA_CHUNK_SYMS = 60;
const TV_INDIA_CHUNK_CONCURRENCY = 3;
export async function fetchTVIndiaBatchChunked(symbols) {
  const list = [...new Set((Array.isArray(symbols) ? symbols : []).map(s => String(s || '').trim().toUpperCase()).filter(Boolean))];
  if (list.length <= TV_INDIA_CHUNK_SYMS) return fetchTVIndiaBatch(list);
  const out = {};
  const chunks = [];
  for (let i = 0; i < list.length; i += TV_INDIA_CHUNK_SYMS) chunks.push(list.slice(i, i + TV_INDIA_CHUNK_SYMS));
  for (let i = 0; i < chunks.length; i += TV_INDIA_CHUNK_CONCURRENCY) {
    const group = chunks.slice(i, i + TV_INDIA_CHUNK_CONCURRENCY);
    const results = await Promise.allSettled(group.map(c => fetchTVIndiaBatch(c)));
    results.forEach(r => {
      if (r.status === 'fulfilled' && r.value) Object.assign(out, r.value);
    });
  }
  return out;
}

// ---------------- TV scanner (CRYPTO, USD indicators) ----------------
export async function fetchTVCryptoBatch(symbols) {
  const tickers = symbols.map(s => `BINANCE:${s}USDT`);
  const columns = [
    'close', 'change', 'RSI', 'MACD.macd', 'MACD.signal',
    'EMA10', 'EMA20', 'EMA50', 'SMA20', 'SMA50',
    'ATR', 'ADX', 'ADX+DI', 'ADX-DI',
    'BB.upper', 'BB.lower', 'Stoch.K', 'Stoch.D',
    'relative_volume_10d_calc', 'Recommend.All',
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://scanner.tradingview.com/crypto/scan?t=${Date.now()}`, {
        method: 'POST',
        headers: TV_SCAN_HEADERS,
        body: JSON.stringify({ symbols: { tickers }, columns }),
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (!data?.data) continue;
      const out = {};
      for (const item of data.data) {
        if (!item?.d) continue;
        const base = String(item.s || '').replace('BINANCE:', '').replace('USDT', '');
        if (!base) continue;
        const d = item.d;
        const pf = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : null;
        out[base] = {
          symbol: base,
          usdPrice: pf(d[0]), changePct: pf(d[1]),
          rsi: pf(d[2]), macd: pf(d[3]), macdSignal: pf(d[4]),
          ema10: pf(d[5]), ema20: pf(d[6]), ema50: pf(d[7]),
          sma20: pf(d[8]), sma50: pf(d[9]),
          atr: pf(d[10]), adx: pf(d[11]), adxPlus: pf(d[12]), adxMinus: pf(d[13]),
          bbUpper: pf(d[14]), bbLower: pf(d[15]),
          stochK: pf(d[16]), stochD: pf(d[17]),
          relVolume: pf(d[18]), recommend: pf(d[19]),
        };
      }
      if (Object.keys(out).length > 0) return out;
    } catch { /* retry once */ }
  }
  return {};
}

// ---------------- CoinDCX public candles (crypto TA) ----------------
// https://public.coindcx.com/market_data/candles?pair=BTCINR&duration=1h&limit=300
const CANDLE_SOURCES = {
  '1m': { duration: '1m', limit: 300 },   // v18.5 MTF engine (LTF timing leg)
  '5m': { duration: '5m', limit: 300 },   // v18.5 MTF engine (LTF trigger leg)
  '1d': { duration: '1d', limit: 180 },   // v6.7 swing desk (daily bars)
  '1h': { duration: '1h', limit: 300 },   // swing/position TA
  '4h': { duration: '4h', limit: 300 },
  '15m': { duration: '15m', limit: 400 }, // aggressive TA
};

// ---------------- v12.6 CANDLE TTL CACHE (the bandwidth + speed fix) ----
// Every board cycle (60s, per market, 24+ symbols) used to re-download
// the FULL candle history from CoinDCX/Binance/Bybit — 299 of 300 bars
// are byte-identical between cycles (only the live bar moves). On
// Render that is ~0.5-1GB/day of pure outbound waste, and on the free
// tier it is a large slice of the 5GB quota. Cache per (source, base,
// tf): 1h/4h/1d bars live 5 minutes, 15m bars 3 minutes (the tape read
// wants fresher bars). Returns a COPY of the array (callers must never
// see a later cycle's mutation). Bounded (≤64 entries, LRU-ish prune).
const _candleCache = new Map(); // key -> { at, candles }
const CANDLE_CACHE_TF_TTL_MS = { '1m': 90_000, '5m': 120_000, '15m': 180_000, '1h': 300_000, '4h': 300_000, '1d': 300_000 };
const CANDLE_CACHE_MAX = 64;
function _candleCacheGet(key, tf) {
  const hit = _candleCache.get(key);
  if (!hit) return null;
  const ttl = CANDLE_CACHE_TF_TTL_MS[tf] ?? 300_000;
  if (Date.now() - hit.at > ttl) { _candleCache.delete(key); return null; }
  return hit.candles.slice(); // copy — callers never share the cache
}
function _candleCacheSet(key, candles) {
  if (!Array.isArray(candles)) return;
  if (_candleCache.size >= CANDLE_CACHE_MAX) {
    // prune the oldest quarter — bounded, no unbounded growth
    const entries = [..._candleCache.entries()].sort((a, b) => a[1].at - b[1].at);
    for (let i = 0; i < Math.ceil(CANDLE_CACHE_MAX / 4); i++) _candleCache.delete(entries[i][0]);
  }
  _candleCache.set(key, { at: Date.now(), candles });
}
/** Test hook — hermetic suites clear the candle cache between cases. */
export function __clearCandleCache() { _candleCache.clear(); }

export async function fetchCoinDcxCandles(base, tf = '1h', opts = {}) {
  const cfg = CANDLE_SOURCES[tf] || CANDLE_SOURCES['1h'];
  // v20.8.2 FIX (H1 — bot-lab warmup): callers (the bot-lab candle
  // chain) can request a DEEPER window than the board default; the
  // limit joins the cache key so a 1000-bar bot fetch can never be
  // served from the 300-bar board cache (or vice versa).
  const limit = Math.min(1000, Math.max(30, Math.floor(Number(opts.limit) || cfg.limit)));
  const cacheKey = `cdc:${base}:${tf}:${limit}`;
  const cached = opts.noCache ? null : _candleCacheGet(cacheKey, tf);
  if (cached) return cached;
  const pair = `${base}INR`;
  // v18.5 FIX: dropped the malformed dead "legacy" URL (it glued
  // `B${pair}_${Date.now()}` — wrong pair prefix AND a timestamp glued
  // with `_` instead of `&` — and the loop's slice(0,1) made it
  // unreachable anyway).
  const urls = [
    `https://public.coindcx.com/market_data/candles?pair=${pair}&duration=${cfg.duration}&limit=${limit}`,
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) continue;
      const raw = await r.json();
      if (!Array.isArray(raw) || raw.length === 0) continue;
      // CoinDCX returns newest-first: [{ o, h, l, c, v, t }] with t in seconds (or ms on some pairs).
      const candles = raw.map(x => ({
        time: Number(x.t) < 1e12 ? Number(x.t) * 1000 : Number(x.t),
        open: Number(x.o), high: Number(x.h), low: Number(x.l),
        close: Number(x.c), volume: Number(x.v) || 0,
      })).filter(c => Number.isFinite(c.close) && c.close > 0)
        .sort((a, b) => a.time - b.time); // oldest-first for the TA lib
      if (candles.length >= 30) { _candleCacheSet(cacheKey, candles); return candles.slice(); }
    } catch { /* next source */ }
  }
  return null;
}

// ---------------- v11.2 Binance/Bybit public USDT klines (crypto candle fallback) ----------------
// Render/datacenter reality (verified 2026-09-17 live): public.coindcx.com candles
// AND the TV crypto scanner can both be IP-blocked while api.binance.com,
// data-api.binance.vision and api.bybit.com stay reachable. The crypto board's
// old candle chain (CoinDCX → Yahoo) died with them; this native crypto-OHLC
// source keeps the board alive. Output shape matches fetchCoinDcxCandles
// exactly (oldest-first {time ms, open, high, low, close, volume}, >=30 rows).
const BINANCE_KL_INTERVAL = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d' };
const BYBIT_KL_INTERVAL = { '1m': '1', '5m': '5', '15m': '15', '1h': '60', '4h': '240', '1d': 'D' };
export async function fetchBinanceKlines(base, tf = '1h', opts = {}) {
  const sym = `${String(base || '').toUpperCase()}USDT`;
  if (!/^[A-Z0-9]{2,15}USDT$/.test(sym)) return null;
  const interval = BINANCE_KL_INTERVAL[tf] || '1h';
  // v20.8.2 FIX (H1 — bot-lab warmup + staleness): opts.limit deepens the
  // window (the bot lab needs >2017 bars for its 7-day ATR), opts.startTime
  // pages BACKWARDS for contiguous history, and opts.noCache bypasses the
  // shared TTL cache (a bot tick must never trade on a 120s-old snapshot).
  const limit = Math.min(1000, Math.max(30, Math.floor(Number(opts.limit) || (tf === '15m' ? 400 : 300))));
  const parts = [];
  if (opts.startTime != null) parts.push(`startTime=${Number(opts.startTime)}`);
  if (opts.endTime != null) parts.push(`endTime=${Number(opts.endTime)}`);
  const rangeQ = parts.length ? `&${parts.join('&')}` : '';
  const cacheKey = `bnk:${base}:${tf}:${limit}${rangeQ}`;
  const cached = opts.noCache ? null : _candleCacheGet(cacheKey, tf);
  if (cached) return cached;
  // Leg 1 + 2: Binance spot klines + the public market-data mirror
  // (data-api.binance.vision is Binance's keyless mirror — no geo-block).
  for (const host of ['https://api.binance.com', 'https://data-api.binance.vision']) {
    try {
      const r = await fetch(`${host}/api/v3/klines?symbol=${sym}&interval=${interval}&limit=${limit}${rangeQ}`, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) continue;
      const raw = await r.json();
      if (!Array.isArray(raw) || raw.length < 30) continue;
      const candles = raw.map(k => ({
        time: Number(k[0]),
        open: Number(k[1]), high: Number(k[2]), low: Number(k[3]),
        close: Number(k[4]), volume: Number(k[5]) || 0,
      })).filter(c => Number.isFinite(c.close) && c.close > 0);
      if (candles.length >= 30) { _candleCacheSet(cacheKey, candles); return candles.slice(); } // already oldest-first
    } catch { /* next leg */ }
  }
  // Leg 3: Bybit public spot klines (newest-first → re-sort).
  try {
    const r = await fetch(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${sym}&interval=${BYBIT_KL_INTERVAL[tf] || '60'}&limit=200`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      const j = await r.json();
      const list = j?.result?.list;
      if (Array.isArray(list) && list.length >= 30) {
        const candles = list.map(k => ({
          time: Number(k[0]),
          open: Number(k[1]), high: Number(k[2]), low: Number(k[3]),
          close: Number(k[4]), volume: Number(k[5]) || 0,
        })).filter(c => Number.isFinite(c.close) && c.close > 0)
          .sort((a, b) => a.time - b.time);
        // v20.9.1 [M]: Bybit leg HARDCODED limit=200 serve karti hai —
        // cacheKey requested limit (e.g. 1000 deep-history) ke naam pe
        // 200-bar shallow window CACHE ho jata tha aur agli deep request
        // cache se shallow hi milti thi. Sirf tab cache jab bars >=
        // requested, warna uncached return.
        if (candles.length >= 30) {
          if (candles.length >= limit) _candleCacheSet(cacheKey, candles);
          return candles.slice();
        }
      }
    }
  } catch { /* give up honestly */ }
  return null;
}

/** Crypto indicator snapshot: TV USD indicators re-scaled to INR via the live CoinDCX ticker. */
export async function fetchCryptoSnapshot(base) {
  const [tv, tickers] = await Promise.all([
    fetchTVCryptoBatch([base]),
    fetchCoinDcxTickers().catch(() => []),
  ]);
  const tvRow = tv[base];
  const ticker = (Array.isArray(tickers) ? tickers : []).find(t => t?.market === `${base}INR`);
  const inrPrice = ticker ? parseFloat(ticker.last_price) : null;
  if (!tvRow && inrPrice == null) return null;
  // v20.9.1 [M]: usdPrice missing + INR ticker present = scale UNKNOWN —
  // pehle scale=1 silently apply hota tha (USD-dimensioned ATR/EMA/BB ~89x
  // chhote INR numbers ki tarah emit, koi label nahi). Ab scaled fields
  // null + honest flags.
  const scaleKnown = Boolean(tvRow?.usdPrice && inrPrice);
  const scale = scaleKnown ? inrPrice / tvRow.usdPrice : null;
  const S = (v) => (scale != null && v != null ? v * scale : null);
  return {
    symbol: base,
    pair: `${base}INR`,
    ltp: inrPrice ?? (tvRow?.usdPrice ? tvRow.usdPrice * _usdInrFallback() : null),
    changePct: tvRow?.changePct ?? (ticker ? parseFloat(ticker.change_24_hour) || null : null),
    priceSource: inrPrice != null ? 'coindcx' : (tvRow ? 'tv-usd-approx' : null),
    // v20.9.1: scale unknown hone pe indicators ke scaled fields null hain
    // (raw USD values emit karna INR consumer ke liye ~89x corrupt hai).
    ...(scaleKnown ? {} : { indicatorsDegraded: 'usdPrice missing — INR re-scale impossible, scaled indicator fields nulled' }),
    indicators: tvRow ? {
      ...tvRow,
      // Re-scale USD-dimensioned fields into INR so entry/SL/targets
      // are in the currency the user actually trades.
      usdPrice: tvRow.usdPrice,
      atr: S(tvRow.atr),
      ema10: S(tvRow.ema10),
      ema20: S(tvRow.ema20),
      ema50: S(tvRow.ema50),
      sma20: S(tvRow.sma20),
      sma50: S(tvRow.sma50),
      bbUpper: S(tvRow.bbUpper),
      bbLower: S(tvRow.bbLower),
      macd: S(tvRow.macd),
      macdSignal: S(tvRow.macdSignal),
    } : null,
    candles: await fetchCoinDcxCandles(base, '1h').catch(() => null),
  };
}

// ---------------- Yahoo index quotes (spot + regime) ----------------
const YF_MAP = {
  NIFTY: '^NSEI', BANKNIFTY: '^NSEBANK', FINNIFTY: 'NIFTY_FIN_SERVICE.NS',
  SENSEX: '^BSESN', INDIAVIX: '^INDIAVIX', USDINR: 'USDINR=X', BTC: 'BTC-USD',
  // NSE sector indices + global risk proxies (MCP market tools). Each key
  // is fetched independently — a dead ticker is simply skipped.
  IT: '^CNXIT', AUTO: '^CNXAUTO', PHARMA: '^CNXPHARMA', FMCG: '^CNXFMCG',
  METAL: '^CNXMETAL', REALTY: '^CNXREALTY',
  USVIX: '^VIX', DXY: 'DX-Y.NYB', GOLD: 'GC=F', CRUDE: 'CL=F',
  // v10.4 GLOBAL EQUITY FUTURES desk regime: NASDAQ-100 (the tech-
  // complex risk barometer) + S&P 500 fallback.
  NDX: '^NDX', SPX: '^GSPC',
};

export async function fetchYahooQuotes(keys) {
  const out = {};
  await Promise.allSettled(keys.map(async (k) => {
    const yk = YF_MAP[k];
    if (!yk) return;
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yk)}?interval=1d&range=5d`;
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) return;
      const j = await r.json();
      const res = j?.chart?.result?.[0];
      const meta = res?.meta;
      if (!meta) return;
      // v11.4 recheck: with range=5d, `chartPreviousClose` is the close
      // BEFORE the 5-session window — a ~5-day change masquerading as the
      // daily move every consumer (regime classifier, btcChangePct24h,
      // top-5 regime alignment, macro bias) assumes. `previousClose` is
      // Yahoo's true prior-session close — prefer it, keep the 5d window
      // (meta is always populated there) as a last-resort fallback.
      const prev = meta.previousClose ?? meta.chartPreviousClose;
      const price = meta.regularMarketPrice;
      if (!(price > 0)) return;
      out[k] = {
        price,
        changePct: prev > 0 ? ((price - prev) / prev) * 100 : 0,
      };
    } catch { /* skip this key */ }
  }));
  return out;
}

/**
 * v6.11 (glama cross-asset correlations): daily CLOSES for any
 * Yahoo symbol (^NSEI, BTC-USD, RELIANCE.NS …). Oldest-first,
 * nulls dropped, empty array on failure (caller degrades honestly).
 */
export async function fetchYahooDailyCloses(yahooSymbol, range = '3mo') {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=${range}`;
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(9000) });
    if (!r.ok) return [];
    const j = await r.json();
    const closes = j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    if (!Array.isArray(closes)) return [];
    return closes.map(Number).filter(v => Number.isFinite(v) && v > 0);
  } catch { return []; }
}

/** v6.11: asset-key → Yahoo symbol (for correlation + sector desks). */
export const YF_SYMBOL = (k) => YF_MAP[k] || null;

// ---------------- NSE option chain (real, with cookie bootstrap) ----------------
const NSE_HEADERS = {
  'User-Agent': UA,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nseindia.com/option-chain',
};
let _nseCookie = null, _nseCookieAt = 0;
const NSE_COOKIE_TTL = 8 * 60 * 1000;

async function nseBootstrapCookies() {
  if (_nseCookie && Date.now() - _nseCookieAt < NSE_COOKIE_TTL) return _nseCookie;
  try {
    const r = await fetch('https://www.nseindia.com/option-chain', {
      headers: NSE_HEADERS,
      signal: AbortSignal.timeout(8000),
    });
    const raw = r.headers.getSetCookie?.() || [];
    if (raw.length) {
      _nseCookie = raw.map(c => c.split(';')[0]).join('; ');
      _nseCookieAt = Date.now();
    }
    return _nseCookie;
  } catch { return _nseCookie; }
}

/**
 * REAL NSE option chain for an index. Returns null when NSE blocks
 * the request (datacenter IP / Cloudflare) — the options desk then
 * falls back to the clearly-labeled Black-Scholes synthetic chain.
 */
export async function fetchNSEOptionChain(symbol) {
  const sym = String(symbol || 'NIFTY').toUpperCase();
  const path = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'NIFTYNXT50'].includes(sym)
    ? `/api/option-chain-indices?symbol=${encodeURIComponent(sym)}`
    : `/api/option-chain-equities?symbol=${encodeURIComponent(sym)}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const cookie = await nseBootstrapCookies();
      if (!cookie && attempt === 0) continue;
      const r = await fetch(`https://www.nseindia.com${path}`, {
        headers: { ...NSE_HEADERS, ...(cookie ? { Cookie: cookie } : {}) },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) continue;
      const j = await r.json();
      const rows = j?.records?.data;
      if (!Array.isArray(rows) || rows.length === 0) continue;
      return {
        symbol: sym,
        spot: Number(j?.records?.underlyingValue) || null,
        expiryDates: j?.records?.expiryDates || [],
        rows: rows.map(x => ({
          strike: Number(x.strikePrice),
          expiry: x.expiryDate,
          callOI: Number(x.CE?.openInterest) || 0,
          callOIChange: Number(x.CE?.changeinOpenInterest) || 0,
          callIV: Number(x.CE?.impliedVolatility) || null,
          callLTP: Number(x.CE?.lastPrice) || 0,
          callVolume: Number(x.CE?.totalTradedVolume) || 0,
          putOI: Number(x.PE?.openInterest) || 0,
          putOIChange: Number(x.PE?.changeinOpenInterest) || 0,
          putIV: Number(x.PE?.impliedVolatility) || null,
          putLTP: Number(x.PE?.lastPrice) || 0,
          putVolume: Number(x.PE?.totalTradedVolume) || 0,
        })),
        source: 'nse',
        fetchedAt: Date.now(),
      };
    } catch { /* retry once more */ }
  }
  return null;
}

// ---------------- BSE option chain (SENSEX — best-effort, honest) ----------------
// v11.1 NSE+SENSEX addendum. RESEARCH-SPIKE VERDICT (17 Sep 2026 live
// probe from this host): bseindia.com AND api.bseindia.com both serve
// HTTP 403 Access Denied (Akamai CDN) to datacenter IPs — this sandbox
// CAN reach NSE's chain but NOT BSE's, so a Render deployment has no
// path either. The block is STRUCTURAL, not a transient outage.
//
// This fetch still exists (NSE pattern: cookie bootstrap + direct
// JSON GET, tolerant parsing) so SENSEX gets FULL parity the day it
// becomes reachable (different host/IP, CDN posture change). A
// negative cache (10 min after each failed probe cycle) keeps the
// dead probe nearly free; optionsDesk labels the SENSEX fallback
// 'bs-model-sensex-always' (permanent limitation) instead of the
// recoverable 'bs-model-nifty-fallback' framing — honesty by design.
const BSE_HEADERS = {
  'User-Agent': UA,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.bseindia.com/option-chain',
};
let _bseCookie = null, _bseCookieAt = 0;
const BSE_COOKIE_TTL = 8 * 60 * 1000;
const BSE_NEG_CACHE_MS = 10 * 60 * 1000;
let _bseNegUntil = 0;

async function bseBootstrapCookies() {
  if (_bseCookie && Date.now() - _bseCookieAt < BSE_COOKIE_TTL) return _bseCookie;
  try {
    const r = await fetch('https://www.bseindia.com/option-chain', {
      headers: BSE_HEADERS,
      signal: AbortSignal.timeout(8000),
    });
    const raw = r.headers.getSetCookie?.() || [];
    if (raw.length) {
      _bseCookie = raw.map(c => c.split(';')[0]).join('; ');
      _bseCookieAt = Date.now();
    }
    return _bseCookie;
  } catch { return _bseCookie; }
}

/** Normalize a BSE-ish expiry string ('17 Sep 2026' | '2026-09-17') to YYYY-MM-DD. */
function _bseExpiryNorm(s) {
  const t = String(s || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (m) {
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const mi = MON.findIndex(x => x.toLowerCase() === m[2].toLowerCase());
    if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, '0')}-${String(parseInt(m[1], 10)).padStart(2, '0')}`;
  }
  return null;
}

/**
 * REAL BSE option chain for SENSEX — best-effort attempt following the
 * exact fetchNSEOptionChain pattern. Returns null when BSE blocks the
 * request (the documented datacenter case) or the payload doesn't
 * sanity-check. Callers MUST treat null as the expected outcome on
 * cloud hosts and label the fallback honestly (bs-model-sensex-always).
 */
export async function fetchBSEOptionChain(symbol = 'SENSEX') {
  const sym = String(symbol || 'SENSEX').toUpperCase();
  if (sym !== 'SENSEX') return null; // only the BSE flagship index is wired
  if (Date.now() < _bseNegUntil) return null; // blocked recently — hold
  // Two candidate endpoints (community-known shapes). Neither is
  // verifiable from a datacenter IP today — both are attempted once.
  const paths = [
    `https://www.bseindia.com/OptionChain/GetOptionChain?symbol=${encodeURIComponent(sym)}`,
    `https://api.bseindia.com/BseIndiaAPI/api/OptionChain?symbol=${encodeURIComponent(sym)}`,
  ];
  for (const url of paths) {
    try {
      const cookie = await bseBootstrapCookies();
      const r = await fetch(url, {
        headers: { ...BSE_HEADERS, ...(cookie ? { Cookie: cookie } : {}) },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) continue;
      const j = await r.json();
      // Tolerant parsing: accept NSE-like {records:{data:[…]}} OR a
      // top-level {data:[…]} / array of CE/PE rows.
      const records = j?.records || j;
      const rowsRaw = Array.isArray(records?.data) ? records.data
        : Array.isArray(j?.data) ? j.data
        : Array.isArray(j) ? j : null;
      if (!rowsRaw || rowsRaw.length === 0) continue;
      const rows = [];
      for (const x of rowsRaw) {
        const ce = x?.CE || x?.call || null;
        const pe = x?.PE || x?.put || null;
        if (!ce && !pe) continue;
        const expiry = _bseExpiryNorm(x?.expiryDate || x?.expiry || '');
        rows.push({
          strike: Number(x?.strikePrice ?? x?.strike),
          expiry: expiry || String(x?.expiryDate || x?.expiry || ''),
          callOI: Number(ce?.openInterest ?? ce?.oi) || 0,
          callOIChange: Number(ce?.changeinOpenInterest ?? ce?.chgOi) || 0,
          callIV: Number(ce?.impliedVolatility ?? ce?.iv) || null,
          callLTP: Number(ce?.lastPrice ?? ce?.ltp) || 0,
          callVolume: Number(ce?.totalTradedVolume ?? ce?.volume) || 0,
          putOI: Number(pe?.openInterest ?? pe?.oi) || 0,
          putOIChange: Number(pe?.changeinOpenInterest ?? pe?.chgOi) || 0,
          putIV: Number(pe?.impliedVolatility ?? pe?.iv) || null,
          putLTP: Number(pe?.lastPrice ?? pe?.ltp) || 0,
          putVolume: Number(pe?.totalTradedVolume ?? pe?.volume) || 0,
        });
      }
      const clean = rows.filter(r => Number.isFinite(r.strike) && r.strike > 0 && /^\d{4}-\d{2}-\d{2}$/.test(r.expiry));
      if (clean.length < 5) continue;
      const expiries = [...new Set(clean.map(r => r.expiry))].sort();
      _bseNegUntil = 0; // reached & parsed — clear any stale hold
      return {
        symbol: sym,
        spot: Number(records?.underlyingValue ?? j?.underlyingValue) || null,
        expiryDates: expiries,
        rows: clean,
        source: 'bse',
        fetchedAt: Date.now(),
      };
    } catch { /* next candidate */ }
  }
  // Structurally blocked (the documented datacenter case) — hold off
  // for 10 minutes so SENSEX desks stay fast while the probe heals
  // itself the day BSE becomes reachable.
  _bseNegUntil = Date.now() + BSE_NEG_CACHE_MS;
  return null;
}

export function __bseNegForTests() { return { negUntil: _bseNegUntil, cookie: _bseCookie }; }
export function __resetBseForTests() { _bseNegUntil = 0; _bseCookie = null; _bseCookieAt = 0; }

// ---------------- time / market-hours (IST) ----------------
export function istNow(now = new Date()) {
  return new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 60000);
}
export function isNseOpen(now = new Date()) {
  // v18.9 HOLIDAY-AWARE — the LIVE gauntlet / watchers / agent loops rode
  // this holiday-blind twin while intraday/time.js (the "single source of
  // truth") had the calendar: on Republic Day etc. LIVE entries passed the
  // gate into a closed market and 15:15 square-offs submitted orders the
  // exchange rejects. Both twins now share ONE definition.
  try {
    return _isNseMarketOpenShared(now);
  } catch {
    // graceful fallback to the old window check (never crash boot)
    const d = istNow(now);
    const day = d.getDay();
    if (day === 0 || day === 6) return false;
    const mins = d.getHours() * 60 + d.getMinutes();
    return mins >= 555 && mins <= 930; // 09:15–15:30
  }
}

// ---------------- test hooks ----------------
export const __testables = { TV_FULL, TV_SAFE, CANDLE_SOURCES };
