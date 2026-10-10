// ============================================================
// server/ai/futures.js — CoinDCX GLOBAL FUTURES desk (v6.8)
// ------------------------------------------------------------
// CoinDCX's GLOBAL futures are USDT-margined perpetuals with
// instrument names like "B-BTC_USDT". This module owns EVERYTHING
// futures — data, wallets, execution gauntlet, position watching —
// so the spot path (coindcxOrders.js) stays untouched:
//
//  PUBLIC (no auth):
//   • fetchFuturesPrices()      RT prices (ls/mark/pc) — 20s cache
//   • fetchFuturesActiveInstruments() — ["B-BTC_USDT", …] — 6h cache
//   • fetchFuturesInstrumentMeta(pair) — max leverage / qty rules — 6h cache
//   • fetchFuturesCandles(pair)  candlesticks?…&pcode=f — TA source
//
//  PRIVATE (HMAC-signed, same coindcxPrivate transport):
//   • fetchFuturesWallets()     DF wallet balances (USDT margin)
//   • listFuturesPositions()    active_pos / avg_price / liquidation
//   • createFuturesOrder()      market/limit order (nested `order` body)
//   • exitFuturesPosition(id)   market exit by position id
//   • createFuturesTpsl()       NATIVE exchange TP/SL (survives server death)
//
//  EXECUTION:
//   • executeFuturesSignal()    the SAME gauntlet as spot: kill switch
//                               → auto policy → LIVE arming → fresh STRONG
//                               signal (venue FUTURES) → leverage sanity →
//                               wallet-margin sizing → journal caps
//   • watchFuturesPositions()   SL/TP/trailing/liquidation + exchange
//                               reconcile (native TP/SL closes detected)
//   • closeFuturesPosition()    manual close (market)
//
// Currency honesty: futures prices/margins are USDT; the shared journal
// and daily risk caps stay INR — every USDT amount carries its INR
// twin converted at the live USDINR rate (10-min cache, fallback 84).
// ============================================================
import crypto from 'node:crypto';
import { coindcxPrivate, coindcxConnected } from '../mcp/coindcx.js';
import { loadJSON, saveJSON } from '../lib/store.js';
import { durablePut } from '../mcp/durable.js';
import { recordExecution, settlePositionOutcome, markPartialOutcome } from './ledger.js';
import { isAmbiguousTransportError } from './coindcxOrders.js'; // v20.3: ambiguous-retry guard (v18.9 spot fix, ported)
import { computeTrailSl, maxSaneLeverage, fitPlanToRiskCap, evaluateExecutionGate } from './ensemble.js';
import { pRound } from './lib/priceRound.js';
import { withJournalLock, pushEntry, todayIST, dailyStats, ratchetSl, exitStageOf, loadProTraderConfig } from './coindcxOrders.js';
import { validateTick, wickJournalEntry } from './wickFilter.js';
import { futBookSnapshot } from './cxBookState.js';

const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '')); return Number.isFinite(n) ? n : null; };
const ok = (r) => r && r.ok;

// ---------------- constants ----------------
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const PRICES_URL = 'https://public.coindcx.com/market_data/v3/current_prices/futures/rt';
const CANDLES_URL = 'https://public.coindcx.com/market_data/candlesticks';
const INSTRUMENTS_URL = 'https://api.coindcx.com/exchange/v1/derivatives/futures/data/active_instruments';
const INSTRUMENT_URL = 'https://api.coindcx.com/exchange/v1/derivatives/futures/data/instrument';
const ORDERS_CREATE_PATH = '/exchange/v1/derivatives/futures/orders/create';
const POSITIONS_PATH = '/exchange/v1/derivatives/futures/positions';
const POSITIONS_EXIT_PATH = '/exchange/v1/derivatives/futures/positions/exit';
const POSITIONS_TPSL_PATH = '/exchange/v1/derivatives/futures/positions/create_tpsl';
const WALLETS_PATH = '/exchange/v1/derivatives/futures/wallets';

/** The futures universe we scan — liquid USDT perps matching the spot
 *  crypto universe (plus a couple of perp-only staples). */
export const FUTURES_UNIVERSE = [
  'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT', 'TRX',
  // v20.3: MATIC hata diya (delisted → POL migration; the slot never
  // priced — a dead seed silently scanned every cycle).
  'POL',
];

export function futuresPairFor(base) {
  return `B-${String(base || '').toUpperCase()}_USDT`;
}
export function baseOfFuturesPair(pair) {
  const m = String(pair || '').match(/^B-([A-Z0-9]+)_USDT$/i);
  return m ? m[1].toUpperCase() : String(pair || '').toUpperCase();
}

// ---------------- USDINR (shared conversion, cached) ----------------
// v20.2: the last-known rate is recorded into ai/lib/usdinr (disk-backed)
// — a cold boot + Yahoo FX outage now re-hydrates yesterday's rate instead
// of falling to the flat 84 (~5% error at USDINR ~88).
import { usdInrRecord, usdInrFallback } from './lib/usdinr.js';
let _usdInr = null, _usdInrAt = 0;
export async function fetchUsdInr() {
  if (_usdInr && Date.now() - _usdInrAt < 10 * 60_000) return _usdInr;
  try {
    const { fetchYahooQuotes } = await import('./data.js');
    const q = await fetchYahooQuotes(['USDINR']);
    const v = num(q?.USDINR?.price);
    if (v > 40 && v < 150) {
      _usdInr = v; _usdInrAt = Date.now();
      usdInrRecord(v, 'yahoo-quotes');
      return v;
    }
  } catch { /* fall back to the last-known rate */ }
  return _usdInr || usdInrFallback();
}
const inrOfUsdt = (usdt, usdInr) => (Number.isFinite(usdt) ? Math.round(usdt * usdInr * 100) / 100 : null);

// ---------------- PUBLIC: RT prices ----------------
let _pricesCache = null, _pricesAt = 0;
let _pricesInflight = null; // v10.10: single-flight — the 2s RT stream + board compute share ONE round-trip
// v11.3: deep-stale window — the LAST resort before throwing. A
// 3-min-old official book keeps the futures board alive (and honest —
// rows keep their real ts) while REST heals.
const PRICES_DEEP_STALE_MS = 180_000;
// v11.3: negative cache for the Binance/Bybit synth leg — when the leg
// returns nothing (blocked / empty), hold off 30s instead of hammering
// fapi on every 2s stream beat while CoinDCX REST is dark. A SUCCESS
// never arms it (the synth becomes the serving source).
const SYNTH_NEG_MS = 30_000;
let _synthDownUntil = 0;
/**
 * Live futures prices. Returns [{ pair, base, last, mark, changePct,
 * high, low, volume }] — one row per active USDT perp. 20s default cache
 * (the SSE crypto stream pattern: one shared round-trip, nobody hits the
 * upstream per-request); the v10.10 ultra-fast stream passes maxAgeMs≈1.3s
 * and joins the in-flight fetch instead of stacking a second one.
 * v11.3 RESILIENCE CHAIN (the "futures board dead on Render" fix):
 *   REST RT (public.coindcx.com) → official WS book (cxBookState — the
 *   stream's currentPrices@futures@rt socket) → Binance fapi 24h tickers
 *   (same USDT-perp domain, honest 'binance-fut' source) → deep-stale
 *   cache serve → throw. Every fallback row carries `source`.
 */
export async function fetchFuturesPrices({ maxAgeMs = 20_000 } = {}) {
  if (_pricesCache && Date.now() - _pricesAt < maxAgeMs) return _pricesCache;
  if (_pricesInflight) return _pricesInflight;
  const probe = (async () => {
    try {
      const r = await fetch(PRICES_URL, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
      if (!ok(r)) throw new Error(`futures prices HTTP ${r?.status}`);
      const j = await r.json();
      const map = j?.prices && typeof j.prices === 'object' ? j.prices : null;
      if (!map) throw new Error('futures prices: unexpected payload');
      const rows = _rowsFromRtPayload(j, map);
      if (rows.length === 0) throw new Error('futures prices: empty');
      _pricesCache = rows; _pricesAt = Date.now();
      return rows;
    } catch {
      // v11.3 leg 2 — the official futures WS book (fresh ≤5s rows from
      // the stream socket; happens to be FASTER than REST when healthy).
      const book = futBookSnapshot(5_000);
      if (book.size > 0) {
        const rows = [...book.values()];
        _pricesCache = rows; _pricesAt = Date.now();
        return rows;
      }
      // v11.3 leg 3 — Binance fapi / Bybit linear USDT-perp tickers (1:1
      // domain), rate-limited by the negative cache so a dead CoinDCX
      // never turns into a 2s fapi hammer.
      // v12.7 BANDWIDTH: the fapi leg now requests ONLY the board's
      // universe symbols (?symbols= JSON-array param) instead of the
      // full ~500-symbol 1-2MB book — the futures board scans
      // FUTURES_UNIVERSE, so the synth leg only ever needs those rows.
      if (Date.now() >= _synthDownUntil) {
        const synth = await _binanceFutRows(FUTURES_UNIVERSE).catch(() => null);
        if (synth && synth.length > 0) {
          _pricesCache = synth; _pricesAt = Date.now();
          return synth;
        }
        _synthDownUntil = Date.now() + SYNTH_NEG_MS;
      }
      // v11.3 leg 4 — deep-stale serve.
      if (_pricesCache && Date.now() - _pricesAt < PRICES_DEEP_STALE_MS) return _pricesCache;
      throw new Error('futures prices: all legs failed');
    }
  })();
  _pricesInflight = probe;
  try { return await probe; } finally { _pricesInflight = null; }
}

/** RT payload → rows (shared by the REST leg; extracted v11.3 so the
 *  fallback legs produce the identical shape). */
function _rowsFromRtPayload(j, map) {
  const rows = [];
  // v10.13 (deep-recheck M3): normalize the payload epoch to MILLISECONDS.
  // CoinDCX's top-level `ts` is seconds; consumers (cxRtStream's WS
  // out-of-order guard, liveFeed freshness) compare against ms values —
  // mixed units made correctness luck-dependent.
  const rawTs = num(j?.ts);
  const tsMs = rawTs > 0 ? (rawTs < 1e12 ? rawTs * 1000 : rawTs) : Date.now();
  for (const [pair, p] of Object.entries(map)) {
    if (!p || typeof p !== 'object') continue;
    const last = num(p.ls);
    if (!(last > 0)) continue; // dark/illiquid rows carry ls=0
    rows.push({
      pair: String(pair),
      base: baseOfFuturesPair(pair),
      last,
      mark: num(p.mp) || last,
      changePct: num(p.pc),
      high: num(p.h),
      low: num(p.l),
      volume: num(p.v),
      ts: tsMs,
    });
  }
  return rows;
}

/** v11.3 leg 3 — Binance fapi / Bybit linear 24h ticker book →
 *  CoinDCX-shaped rows. Same USDT-perp domain (zero projection risk);
 *  source: 'binance-fut' / 'bybit-fut'.
 *  v12.7 BANDWIDTH: `bases` (optional array) adds Binance's ?symbols=
 *  JSON-array filter so a dark-CoinDCX board fetch pulls ~12 rows
 *  (~5KB) instead of the full ~500-symbol 1-2MB book — the
 *  dark-fallback leg's payload drops ~99% and the request weight
 *  falls with it. No bases = full book (legacy callers/tests). */
async function _binanceFutRows(bases) {
  const symParam = Array.isArray(bases) && bases.length > 0
    ? (() => {
        const symbols = [...new Set(bases.map(b => String(b || '').toUpperCase()).filter(Boolean))]
          .map(b => `${b}USDT`).slice(0, 100);
        return symbols.length > 0 ? `?symbols=${encodeURIComponent(JSON.stringify(symbols))}` : null;
      })()
    : null;
  try {
    const r = await fetch(symParam ? `https://fapi.binance.com/fapi/v1/ticker/24hr${symParam}` : 'https://fapi.binance.com/fapi/v1/ticker/24hr', {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(8000),
    });
    if (ok(r)) {
      const raw = await r.json();
      if (Array.isArray(raw) && raw.length > 0) {
        const rows = _rowsFromBinanceFut(raw, 'binance-fut');
        if (rows.length > 0) return rows;
      }
    }
  } catch { /* next leg */ }
  try {
    const r = await fetch('https://api.bybit.com/v5/market/tickers?category=linear', {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(8000),
    });
    if (ok(r)) {
      const j = await r.json();
      const list = j?.result?.list;
      if (Array.isArray(list) && list.length > 0) {
        const rows = [];
        const now = Date.now();
        for (const x of list) {
          if (!x || typeof x.symbol !== 'string' || !x.symbol.endsWith('USDT')) continue;
          const base = x.symbol.slice(0, -4);
          const last = parseFloat(x.lastPrice);
          if (!base || !(last > 0)) continue;
          rows.push({
            pair: `B-${base}_USDT`,
            base,
            last,
            mark: parseFloat(x.markPrice) || last,
            changePct: (parseFloat(x.price24hPcnt) || 0) * 100,
            high: parseFloat(x.highPrice24h) || 0,
            low: parseFloat(x.lowPrice24h) || 0,
            volume: parseFloat(x.volume24h) || 0,
            ts: now,
            source: 'bybit-fut',
          });
        }
        if (rows.length > 0) return rows;
      }
    }
  } catch { /* give up honestly */ }
  return null;
}

function _rowsFromBinanceFut(raw, source) {
  const rows = [];
  const now = Date.now();
  for (const x of raw) {
    if (!x || typeof x.symbol !== 'string' || !x.symbol.endsWith('USDT')) continue;
    const base = x.symbol.slice(0, -4);
    const last = parseFloat(x.lastPrice);
    if (!base || !(last > 0)) continue;
    rows.push({
      pair: `B-${base}_USDT`,
      base,
      last,
      mark: parseFloat(x.markPrice) || last,
      changePct: parseFloat(x.priceChangePercent) || 0,
      high: parseFloat(x.highPrice) || 0,
      low: parseFloat(x.lowPrice) || 0,
      volume: parseFloat(x.volume) || 0,
      ts: now,
      source,
    });
  }
  return rows;
}
export async function fetchFuturesLtpMap() {
  const rows = await fetchFuturesPrices().catch(() => []);
  return new Map((Array.isArray(rows) ? rows : []).map(x => [x.pair, x.last]));
}

// ---------------- PUBLIC: instruments ----------------
let _instrumentsCache = null, _instrumentsAt = 0;
export async function fetchFuturesActiveInstruments() {
  if (_instrumentsCache && Date.now() - _instrumentsAt > 0 && Date.now() - _instrumentsAt < 6 * 3600_000) return _instrumentsCache;
  const url = `${INSTRUMENTS_URL}?margin_currency_short_name[]=USDT`;
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
  if (!ok(r)) throw new Error(`futures instruments HTTP ${r?.status}`);
  const list = await r.json();
  if (!Array.isArray(list) || list.length === 0) throw new Error('futures instruments: empty');
  _instrumentsCache = list.map(String); _instrumentsAt = Date.now();
  return _instrumentsCache;
}

let _instrumentMetaCache = new Map();
/** Instrument rules for one pair (max leverage, qty precision, minimums).
 *  The endpoint shape is documented with max_leverage_long/short; qty
 *  precision/min-quantity keys vary by API revision — every plausible
 *  key is tried (the CoinDCX field-name lesson, learned twice). */
export async function fetchFuturesInstrumentMeta(pair) {
  const key = String(pair).toUpperCase();
  const hit = _instrumentMetaCache.get(key);
  if (hit && Date.now() - hit._at < 6 * 3600_000) return hit;
  try {
    const url = `${INSTRUMENT_URL}?pair=${encodeURIComponent(key.toLowerCase())}&margin_currency_short_name=USDT`;
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    if (ok(r)) {
      const j = await r.json();
      const i = j?.instrument && typeof j.instrument === 'object' ? j.instrument : (j && typeof j === 'object' && !Array.isArray(j) ? j : null);
      if (i) {
        const meta = {
          pair: String(i.pair || key),
          maxLeverage: Math.max(1, Math.floor(Math.min(
            num(i.max_leverage) ?? num(i.max_leverage_long) ?? 10,
            num(i.max_leverage_short) ?? num(i.max_leverage_long) ?? 10,
          ))),
          qtyPrecision: Math.max(0, Math.min(8, Math.round(
            num(i.quantity_precision) ?? num(i.qty_precision) ?? num(i.precision) ?? guessPrecision(key)
          ))),
          minQty: num(i.min_qty) ?? num(i.min_quantity) ?? num(i.minimum_qty) ?? 0,
          status: String(i.status || 'active'),
          _at: Date.now(),
        };
        _instrumentMetaCache.set(key, meta);
        return meta;
      }
    }
  } catch { /* fall back to the conservative default */ }
  const meta = { pair: key, maxLeverage: 10, qtyPrecision: guessPrecision(key), minQty: 0, status: 'unknown', _at: Date.now() };
  _instrumentMetaCache.set(key, meta);
  return meta;
}
function guessPrecision(pair) {
  const base = baseOfFuturesPair(pair);
  const p = { BTC: 4, ETH: 3, BNB: 2, SOL: 1, XRP: 0, DOGE: 0, ADA: 0, AVAX: 1, LINK: 1, DOT: 1, TRX: 0, POL: 0 }[base];
  return p != null ? p : 3;
}
export function roundFuturesQty(pair, qty) {
  return Math.floor(Number(qty) * 10 ** guessPrecision(pair)) / 10 ** guessPrecision(pair);
}

// ---------------- PUBLIC: candlesticks (pcode=f) ----------------
/**
 * Futures candles — TA source for the futures board. Docs shape:
 *   GET /market_data/candlesticks?pair=B-MKR_USDT&from=…&to=…&resolution=60&pcode=f
 *   → { s: "ok", data: [{ open, high, low, volume, close, time (ms) }] }
 * (also tolerates the legacy bare-array shape).
 */
export async function fetchFuturesCandles(pair, resolution = '60', limit = 300) {
  // v12.6 candle TTL cache — same rationale as data.js (the futures
  // board re-fetches the full history every cycle; 299/300 bars are
  // identical). 3 min for 15m bars, 5 min otherwise.
  const cacheKey = `fut:${pair}:${resolution}`;
  const ttl = resolution === '15' ? 180_000 : 300_000;
  const hit = _futCandleCache.get(cacheKey);
  if (hit && Date.now() - hit.at <= ttl) return hit.candles.slice();
  const to = Math.floor(Date.now() / 1000);
  const from = to - Math.max(1, Math.ceil(limit * resolutionSeconds(resolution) * 1.2 / 60)) * 60;
  const url = `${CANDLES_URL}?pair=${encodeURIComponent(String(pair).toLowerCase())}&from=${from}&to=${to}&resolution=${resolution}&pcode=f`;
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
  if (!ok(r)) return null;
  const j = await r.json().catch(() => null);
  const raw = Array.isArray(j) ? j : (Array.isArray(j?.data) ? j.data : null);
  if (!raw || raw.length === 0) return null;
  const candles = raw.map(x => ({
    time: Number(x.time) < 1e12 ? Number(x.time) * 1000 : Number(x.time),
    open: num(x.open), high: num(x.high), low: num(x.low),
    close: num(x.close), volume: num(x.volume) || 0,
  })).filter(c => c.close > 0 && c.open > 0)
    .sort((a, b) => a.time - b.time);
  if (candles.length < 30) return null;
  if (_futCandleCache.size >= 48) {
    const entries = [..._futCandleCache.entries()].sort((a, b) => a[1].at - b[1].at);
    for (let i = 0; i < 12; i++) _futCandleCache.delete(entries[i][0]);
  }
  _futCandleCache.set(cacheKey, { at: Date.now(), candles });
  return candles.slice();
}
const _futCandleCache = new Map(); // key -> { at, candles } (v12.6 TTL cache)
/** Test hook — hermetic suites clear the candle cache between cases. */
export function __clearFuturesCandleCacheForTest() { _futCandleCache.clear(); }
function resolutionSeconds(res) {
  const r = String(res);
  if (r === '1D') return 86400;
  return parseInt(r, 10) * 60 || 3600;
}

// ---------------- PRIVATE: wallets ----------------
function loadCredsForOrder() {
  const c = loadJSON('mcp-coindcx.json', {});
  return c?.apiKey && c?.secret ? { apiKey: c.apiKey, secret: c.secret } : null;
}
function credGuard() {
  if (!coindcxConnected()) { const e = new Error('CoinDCX not connected — connect an API key first'); e.status = 400; throw e; }
  const creds = loadCredsForOrder();
  if (!creds) { const e = new Error('CoinDCX credentials unreadable'); e.status = 400; throw e; }
  return creds;
}

/** DF (derivatives-futures) wallet rows: [{ currency, total, free, locked, crossMargin }]
 *
 * 2025 FUTURES API SEMANTICS (docs.coindcx.com — verified against the
 * official field reference + the "Total wallet balance" formula):
 *   • balance            = USABLE (free) balance — NOT the total. The
 *                          old pre-migration reading (`balance` = total,
 *                          free = total − locked) now computes free
 *                          NEGATIVE and clips to 0 — the exact
 *                          "3.01 USDT available par site kuch nahi
 *                          dikha raha" bug. `free` IS `balance`.
 *   • locked_balance     = total initial margin locked in ISOLATED
 *                          margined orders/positions
 *   • cross_order_margin = total initial margin locked in CROSS orders
 *   • cross_user_margin  = total initial margin locked in CROSS positions
 *   • Total wallet balance = balance + locked_balance
 *                          + cross_order_margin + cross_user_margin
 *
 * v10.3.2 TRANSPORT FIX: the wallets route is GET-only — the POST call
 * died with `[404] not_found` (Express routes by METHOD, so the path
 * "doesn't exist" for POST), which is why the futures USDT tile showed
 * 0 while the user's CoinDCX app showed 3.01 USDT available. Transport
 * chain: GET(seconds) → GET(ms) → legacy POST. The first transport that
 * answers sticks for the process lifetime (no per-poll probing).
 * Wrapper tolerance: bare array (documented), `{wallets:[]}`,
 * `{data:[]}` and `{balances:[]}` are all accepted.
 *
 * v10.14 (deep-recheck S1) PROBE-COOLDOWN: a full 3-mode sweep on every
 * 60s wallet poll could stack 3 × 10s timeouts = 30s — beyond the
 * client's 20s fetch budget → "wallet API unreachable" even though a
 * single transport blip was the only fault. After one full-sweep
 * failure the transport probe goes into a 5-min cooldown: only the
 * sticky mode is retried (one round-trip, fail fast) until it answers
 * again or the cooldown lapses.
 *
 * v12.1 AUTH LADDER (live incident 2026-09-19, smartai1.onrender.com):
 * the user's Global-Futures wallet HAS funds, but every wallet poll
 * returns `[401] Invalid credentials` while the SAME key signs spot
 * POSTs fine — and POST on this route still answers `[404] not_found`
 * (route stays GET-only). The 2025-era string-timestamp GET stopped
 * authenticating: CoinDCX evidently drifted the canonical signed
 * payload (the official doc samples type the timestamp as an INT, not
 * a string). The sweep is now a 6-rung AUTH LADDER covering every
 * plausible canonicalization — string/number × seconds/ms × bare
 * params/page+size — plus the legacy POST. The FIRST rung the server
 * accepts goes STICKY (zero per-poll cost after that). When every rung
 * fails, the thrown error carries the FULL variant trace
 * (`GET-s/str:401 · GET-ms/num:401 · …`) so the next probe pinpoints
 * exactly which auth the server speaks — and, if all GETs answer 401
 * with a key that works on spot, the guidance says what to check (a
 * Global-Futures-permission API key).
 *
 * v12.2 SCOPE PROBE + SPACED RUNGS (same incident, round 2): the 6
 * compact-GET permutations ALL 401'd live while an independent public
 * CoinDCX SDK signs the wallets GET exactly like rung 1 — so either
 * the key lacks derivatives permission, or the server rebuilds the
 * canonical string with PYTHON json.dumps spacing. Two additions:
 *   • rungs GET-s/str-sp / GET-ms/num-sp — signature over the spaced
 *     canonical form (see coindcxPrivateGET v12.2).
 *   • probeFuturesKeyScope() — THE discriminator: POST
 *     /derivatives/futures/positions (a documented POST route) with
 *     the SAME key. 2xx/4xx-shape → auth PASSED on the derivatives
 *     family (scope OK, wallets-GET auth is the fault). 401/403 → the
 *     key itself is rejected on derivatives (Global-Futures permission
 *     missing) — the error then LEADS with that verdict so the blocker
 *     panel tells the user the exact one-step fix. Cached 10 min,
 *     single-flight, only fired when every GET rung 401s.
 *
 * v12.3 THE VERDICT-BACKED FIX (same incident, round 3 — the live
 *   scope probe ANSWERED): the key's scope is OK (the positions POST
 *   auth PASSES with the same key that 401s on the wallets GET). The
 *   official docs.coindcx.com Slate capture (1.1MB, "Wallet Details"
 *   + "Wallet Transactions" samples) settles it: the derivatives
 *   wallets GET carries the SIGNED {"timestamp":<int ms>} JSON AS THE
 *   REQUEST BODY (requests.get(url, data=json_body)) — params like
 *   page/size ride the query string UNSIGNED. Our GETs were sending
 *   the signed payload as QUERY PARAMS with an EMPTY BODY, so the
 *   server's body-based verification could never pass → 401 on every
 *   permutation, forever. coindcxPrivateGET now defaults to the
 *   documented body mode; the ladder leads with the body rungs. */
const WALLET_PROBE_COOLDOWN_MS = 5 * 60_000;
// v20.5.1: force a FULL ladder re-probe every 10 minutes even when the
// cooldown is armed and sticky mode is set. Without this escape hatch,
// a server that hit the cooldown with a stale UA / transient 401 keeps
// retrying ONLY rung 1 every poll and re-arming the cooldown forever —
// a deploy that fixes the underlying transport (UA / signature / WAF
// rule change) never gets a chance to actually take effect until the
// user manually reconnects. With this counter, the 11th attempt post-
// cooldown-arming (i.e. ~10 polls at 60s cadence = ~10min) silently
// does a full 7-rung sweep and re-establishes sticky on whichever rung
// wins. Never throws; never blocks the cooldown's fail-fast intent on
// the first 10 polls.
const _walletsTransport = { mode: null, coolUntil: 0, probesSinceSweep: 0 };
function _walletList(resp) {
  if (Array.isArray(resp)) return resp;
  if (Array.isArray(resp?.wallets)) return resp.wallets;
  if (Array.isArray(resp?.data)) return resp.data;
  if (Array.isArray(resp?.balances)) return resp.balances;
  return null; // error-shaped / unknown wrapper → try the next transport
}
// The v12.3 ladder — order matters: rungs 1-3 are THE DOCUMENTED
// GET-with-body contract (docs.coindcx.com Wallet Details sample —
// requests.get(url, data=json_body)): the compact {"timestamp":<int>}
// JSON is BOTH signed AND sent as the GET request body. This is the
// transport the live scope-OK verdict demands (key CAN auth derivatives
// — POSTs pass, every query-param GET 401'd because the server verifies
// the signature against the REQUEST BODY, which was empty). Rung 1 is
// the exact doc sample (ms + int); rung 2 covers the Request-Definitions
// table's "epoch seconds" wording; rung 3 the string-ts variant. Then
// the legacy query-transport rungs (2025-verified family) as fallbacks,
// and POST last (the [404] legacy canary).
const WALLET_AUTH_LADDER = [
  { id: 'GET-body/ms/num', method: 'GET', mode: 'body', unit: 'ms', tsType: 'num', params: {} },
  { id: 'GET-body/s/num', method: 'GET', mode: 'body', unit: 's', tsType: 'num', params: {} },
  { id: 'GET-body/ms/str', method: 'GET', mode: 'body', unit: 'ms', tsType: 'str', params: {} },
  { id: 'GET-s/str', method: 'GET', unit: 's', tsType: 'str', params: {} },
  { id: 'GET-ms/num', method: 'GET', unit: 'ms', tsType: 'num', params: {} },
  { id: 'GET-s/pgsz', method: 'GET', unit: 's', tsType: 'str', params: { page: '1', size: '100' } },
  { id: 'POST', method: 'POST' },
];
async function _walletTransportAttempt(variant, apiKey, secret) {
  if (variant.method === 'POST') return coindcxPrivate(WALLETS_PATH, apiKey, secret, {});
  const { coindcxPrivateGET } = await import('../mcp/coindcx.js');
  return coindcxPrivateGET(WALLETS_PATH, apiKey, secret, variant.params, {
    unit: variant.unit, tsType: variant.tsType,
    ...(variant.mode ? { mode: variant.mode } : {}),
    ...(variant.sep ? { sep: variant.sep } : {}),
  });
}
/** v20.8.5: wallets payload → normalized rows (shared by the parallel
 * cold-probe and the sequential ladder — ek hi mapping, do paths). */
function _mapWalletRows(list) {
  return list.map(w => {
    const free = num(w.balance) || 0;
    const lockedIso = num(w.locked_balance) || 0;
    const crossOrder = num(w.cross_order_margin) || 0;
    const crossUser = num(w.cross_user_margin) || 0;
    return {
      currency: String(w.currency_short_name || w.currency || '').toUpperCase(),
      total: r2(free + lockedIso + crossOrder + crossUser),
      locked: r2(lockedIso + crossOrder),
      free: r2(Math.max(0, free)),
      crossUserMargin: r2(crossUser),
    };
  }).filter(w => w.currency && w.total > 0);
}
// ---------------- v12.2: futures key-scope probe ----------------
// THE discriminator for the live 401 incident: POST
// /derivatives/futures/positions is a documented POST route on the
// SAME derivatives family — one harmless read with the SAME key tells
// us whether the key can authenticate derivatives AT ALL:
//   • 2xx            → scope OK (and the route works)
//   • 400/422        → scope OK — auth PASSED, the request merely failed
//                      validation (a validation error is past the auth
//                      middleware by definition)
//   • 401/403        → scope MISSING — the key is rejected on the whole
//                      derivatives family (spot works, futures doesn't:
//                      a SPOT-scoped API key)
//   • 404/5xx/net    → UNKNOWN — route moved or gateway trouble; the
//                      verdict stays honest rather than guessing.
// Cached 10 min (verdicts don't flap per-minute), single-flight.
let _scopeProbe = null; // { verdict: 'ok'|'no_scope'|'unknown', status, at }
let _scopeProbeInflight = null;
const SCOPE_PROBE_TTL_MS = 10 * 60_000;
export async function probeFuturesKeyScope({ force = false } = {}) {
  if (_scopeProbe && !force && Date.now() - _scopeProbe.at < SCOPE_PROBE_TTL_MS) return _scopeProbe;
  if (_scopeProbeInflight) return _scopeProbeInflight;
  _scopeProbeInflight = (async () => {
    let out;
    try {
      const { apiKey, secret } = credGuard();
      await coindcxPrivate(POSITIONS_PATH, apiKey, secret, {
        page: '1', size: '10', margin_currency_short_name: ['USDT'],
      });
      out = { verdict: 'ok', status: 200, at: Date.now() }; // 2xx — full pass
    } catch (e) {
      const s = Number(e?.status);
      if (s === 401 || s === 403) out = { verdict: 'no_scope', status: s, at: Date.now() };
      else if (s === 400 || s === 422) out = { verdict: 'ok', status: s, at: Date.now() }; // auth passed, shape rejected
      else out = { verdict: 'unknown', status: Number.isFinite(s) ? s : null, at: Date.now() };
    }
    _scopeProbe = out;
    return out;
  })();
  try { return await _scopeProbeInflight; } finally { _scopeProbeInflight = null; }
}
/** Last scope verdict (null before the first probe) — walletSnapshot
 *  exposes it as futures.scope so the UI can badge the exact cause. */
export function lastFuturesKeyScope() { return _scopeProbe ? { ..._scopeProbe } : null; }
/** v12.2: a fresh CoinDCX connect (new key) resets the wallet transport
 *  ladder + cooldown AND this probe's cached verdict — the old key's
 *  state must never mask the new key's behavior (called from
 *  coindcxConnect via dynamic import). */
export function resetWalletTransportForReconnect() {
  _walletsTransport.mode = null;
  _walletsTransport.coolUntil = 0;
  _walletsTransport.probesSinceSweep = 0;
  _scopeProbe = null;
  _scopeProbeInflight = null;
  _resetWalletSnapshotCache(); // v20.8.5: purane key ka cached snapshot naya verify na mask kare
}
export async function fetchFuturesWallets() {
  const { apiKey, secret } = credGuard();
  // v20.5.1: count every probe so a stuck cooldown doesn't lock the
  // ladder to rung 1 forever. Every 10 probes (= ~10 polls × 60s = 10
  // min), force a FULL ladder sweep even while cooling — the deploy
  // may have fixed the underlying transport and the only way to find
  // out is to actually try every rung again.
  _walletsTransport.probesSinceSweep = (_walletsTransport.probesSinceSweep || 0) + 1;
  const forceSweep = _walletsTransport.probesSinceSweep >= 10;
  if (forceSweep) _walletsTransport.probesSinceSweep = 0;
  const probeCooling = Date.now() < _walletsTransport.coolUntil && !forceSweep;
  // sticky rung first; a legacy pre-v12.1 sticky value maps onto the
  // ladder ('GET-s' → 'GET-s/str', 'GET-ms' → 'GET-ms/str'). v12.3: the
  // resolved rung is what gets filtered out of the tail (a stale id that
  // no longer exists resolves to ladder rung 1 — never duplicated).
  const stickyId = _walletsTransport.mode === 'GET-s' ? 'GET-s/str'
    : _walletsTransport.mode === 'GET-ms' ? 'GET-ms/str' : _walletsTransport.mode;
  const stickyRung = stickyId
    ? (WALLET_AUTH_LADDER.find(v => v.id === stickyId) || WALLET_AUTH_LADDER[0])
    : null;
  let order = stickyRung
    ? [stickyRung, ...WALLET_AUTH_LADDER.filter(v => v.id !== stickyRung.id)]
    : [...WALLET_AUTH_LADDER];
  // v10.14: during the post-sweep-failure cooldown the alternates are
  // NOT re-probed — one sticky-mode round-trip bounds the failure path.
  if (probeCooling && stickyId) order = [order[0]];
  else if (probeCooling) order = order.slice(0, 1);
  const trace = [];
  let lastErr = null;
  // v20.8.5: COLD-START PARALLEL PROBE — 3 documented GET-body rungs ka
  // sequential sweep worst-case 3 × 10s lagta tha (aur 9s wallet-leg
  // budget use CUT kar deti thi) → boot / cooldown ke baad ka PEHLA
  // futures-wallet read consistently fail-ya-late hota tha ("wallet
  // bahut late read"). Ab teeno documented rung EK SAATH udte hain
  // (harmless signed GET reads); ladder-order preference me jo bhi
  // pehla array-shaped jawab de wahi STICKY ban jata hai — cold read
  // ≈ ek round-trip. Teeno fail → legacy rungs sequential (old path).
  if (!probeCooling && !stickyId) {
    const bodyRungs = WALLET_AUTH_LADDER.filter(v => v.mode === 'body');
    // v20.8.5a: dynamic import ko RACE se pehle EK baar resolve karo —
    // 3 concurrent import() calls (vi.mock registry race) test-env me
    // REAL module tak leak ho sakte the (real network 403!). Ek resolved
    // reference se saare rung udte hain — production me bhi zero repeat
    // import overhead.
    const { coindcxPrivateGET } = await import('../mcp/coindcx.js');
    const raced = await Promise.all(bodyRungs.map((v) =>
      Promise.resolve(coindcxPrivateGET(WALLETS_PATH, apiKey, secret, v.params, {
        unit: v.unit, tsType: v.tsType,
        ...(v.mode ? { mode: v.mode } : {}),
        ...(v.sep ? { sep: v.sep } : {}),
      })).then((resp) => ({ v, resp })).catch((e) => ({ v, e }))
    ));
    for (const { v, resp, e } of raced) {
      if (e) { trace.push(`${v.id}:${Number.isFinite(e?.status) ? e.status : 'T'}`); lastErr = e; continue; }
      const list = _walletList(resp);
      if (!list) { trace.push(`${v.id}:200?`); lastErr = new Error(`wallets payload not array-shaped (${v.id})`); continue; }
      _walletsTransport.mode = v.id;
      _walletsTransport.coolUntil = 0; // health restored — full probing again
      return _mapWalletRows(list);
    }
    // teeno body rung fail — sequential fallback me unhe REPEAT mat karo
    // (unka trace upar already hai; worst-case total attempts 7 hi rehte
    // hain — cold 3 parallel + 4 legacy sequential).
    order = order.filter(v => v.mode !== 'body');
  }
  for (const variant of order) {
    try {
      const resp = await _walletTransportAttempt(variant, apiKey, secret);
      const list = _walletList(resp);
      if (!list) { trace.push(`${variant.id}:200?`); throw new Error(`wallets payload not array-shaped (${variant.id})`); }
      _walletsTransport.mode = variant.id;
      _walletsTransport.coolUntil = 0; // health restored — full probing again
      return _mapWalletRows(list);
    } catch (e) {
      const status = e?.status;
      trace.push(`${variant.id}:${Number.isFinite(status) ? status : 'T'}`);
      lastErr = e;
    }
  }
  // every rung failed → arm the probe cooldown (fail-fast on the next
  // poll instead of another full-ladder sweep)…
  if (!probeCooling) _walletsTransport.coolUntil = Date.now() + WALLET_PROBE_COOLDOWN_MS;
  // …and throw the HONEST trace: which rungs answered what. All GET-401
  // with a spot-working key = the key itself can't read the derivatives
  // wallet family (Global Futures permission) — say exactly that. (POST's
  // 404 is EXPECTED on this route family — it never counts against the
  // GET verdict.)
  const getTraces = trace.filter(t => !t.startsWith('POST:'));
  const allGet401 = getTraces.length > 0 && getTraces.every(t => t.endsWith(':401') || t.endsWith(':T'));
  // v12.2: STRICT 401s only (no 'T' timeouts — a network stall is not an
  // auth rejection) → run the key-scope probe and let its verdict LEAD
  // the error text, so the agent blocker's 200-char slice carries the
  // definitive cause + fix, not just the ladder trace.
  let verdictTag = '';
  let guidance = '';
  const strict401 = getTraces.length > 0 && getTraces.every(t => t.endsWith(':401'));
  if (strict401) {
    const probe = await probeFuturesKeyScope().catch(() => null);
    if (probe?.verdict === 'no_scope') {
      verdictTag = ' · futures-key-scope: MISSING';
      guidance = ' — API key me Global Futures permission nahi hai (derivatives positions auth bhi 401 — same key spot par chalti hai). CoinDCX app → API Dashboard → Futures permission ON karke NAYI key banao → site me CoinDCX reconnect karo';
    } else if (probe?.verdict === 'ok') {
      verdictTag = ' · futures-key-scope: OK';
      guidance = ' — key derivatives-auth pass karti hai (positions readable) — sirf wallets-GET reject ho raha. v12.3 GET-with-body rungs ab ladder me HEAD par hain (documented contract); agar phir bhi 401 rahe to CoinDCX API changelog dekho';
    }
  }
  if (!guidance && allGet401) {
    guidance = ' — key spot par kaam karta hai par derivatives wallet reject kar raha hai: CoinDCX app → API Dashboard me GLOBAL FUTURES permission wali key bana ke reconnect karo';
  }
  // Order: verdict → guidance → trace LAST. The user-facing surfaces
  // (agent blocker 260 · log 300 · Telegram 200 · snapshot 420) slice
  // from the FRONT — the verdict + the one-step fix must land inside
  // every budget; the ladder trace is tail diagnostic for the logs.
  const err = new Error(`${String(lastErr?.message || lastErr).slice(0, 90)}${verdictTag}${guidance} [auth-ladder ${trace.join(' · ')}]`);
  err.status = lastErr?.status;
  throw err;
}

/** Spot wallet rows via the SAME /users/balances transport (free/locked). */
export async function fetchSpotWallets() {
  const { apiKey, secret } = credGuard();
  const resp = await coindcxPrivate('/exchange/v1/users/balances', apiKey, secret, { page: '1', size: '100' });
  const list = Array.isArray(resp) ? resp : [];
  const out = [];
  for (const w of list) {
    const base = String(w.currency_short_name ?? w.currency ?? '').toUpperCase();
    if (!base) continue;
    const free = num(w.available_balance ?? w.balance) || 0;
    const locked = num(w.locked_balance) || 0;
    if (free + locked <= 0) continue;
    out.push({ currency: base, free: r2(free), locked: r2(locked), total: r2(free + locked) });
  }
  return out;
}

/**
 * ONE wallet view for the UI + agent sizing:
 *   spot INR/USDT free+locked, futures USDT margin free+locked,
 *   USDINR, and INR-equivalent equity / deployable margin.
 * Never throws — a failed leg degrades to null with the reason kept.
 *
 * v10.14 (deep-recheck S1) RESPONSE-BUDGET FIX: the old body ran
 * `await fetchUsdInr()` SEQUENTIALLY before the two wallet legs — a cold
 * FX cache added up to 8s of Yahoo latency ON TOP of the legs (a full
 * 3-mode transport sweep could add 30s) → 38s worst case vs the client's
 * 20s AbortSignal → "⚡ wallet API unreachable" on a mere FX blip ("ek
 * ek baar"). Now: FX + both legs run in PARALLEL, each leg individually
 * deadline-bounded, so the route ALWAYS answers well inside the client
 * budget with whatever data it has (honest `error` per lagging leg).
 */
const WALLET_LEG_BUDGET_MS = 9_000;
let _walletLegBudgetMs = WALLET_LEG_BUDGET_MS;
function _withDeadline(p, ms, label) {
  let timer = null;
  const budget = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ error: `${label} — ${ms}ms budget exceeded (degraded)` }), ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([p, budget]).finally(() => { if (timer) clearTimeout(timer); });
}
// v20.8.5: SERVER-SIDE SNAPSHOT MINI-CACHE (10s) + single-flight. Ek hi
// browser ke kai surfaces (WalletCard/WalletStrip/PortfolioHeat ka shared
// useWalletPoll, agent ka 55s throttle, status views) ek hi window me
// walletSnapshot maang sakte hain — pehle HAR call 2 signed CoinDCX
// round-trips lagti thi. Ab 10s window me sab EK hi snapshot share
// karte hain (fetchedAt honest rehta hai — data ki umar kabhi chhupi
// nahi). force:true (reconnect route) cache bypass karta hai.
const WALLET_SNAPSHOT_CACHE_MS = 10_000;
let _walletSnapCache = null;   // { at, value }
let _walletSnapInflight = null;
export async function walletSnapshot({ force = false } = {}) {
  if (!force && _walletSnapCache && Date.now() - _walletSnapCache.at < WALLET_SNAPSHOT_CACHE_MS) {
    return _walletSnapCache.value;
  }
  if (_walletSnapInflight) return _walletSnapInflight;
  const build = (async () => {
    const [usdInr, fut, spot] = await Promise.all([
      fetchUsdInr().catch(() => _usdInr || 84), // belt & braces — never let FX break the snapshot
      _withDeadline(
        // v12.2: 420 chars (was 300) — the scope verdict LEADS, then the
        // 8-rung ladder trace, then the guidance; the whole diagnostic
        // sentence must survive to the UI so the user sees WHICH fault it
        // is (key permission vs auth drift) and the one-step fix.
        fetchFuturesWallets().catch(e => ({ error: String(e?.message || e).slice(0, 420) })),
        _walletLegBudgetMs, 'futures wallets slow'),
      _withDeadline(
        fetchSpotWallets().catch(e => ({ error: String(e?.message || e).slice(0, 140) })),
        _walletLegBudgetMs, 'spot wallets slow'),
    ]);
    // FX honesty: 84-static / >10min-cached rate flagged, never silently trusted
    const fxStale = !(Date.now() - _usdInrAt < 11 * 60_000);
    const futRows = Array.isArray(fut) ? fut : [];
    const spotRows = Array.isArray(spot) ? spot : [];
    const spotINR = spotRows.find(w => w.currency === 'INR') || { free: 0, locked: 0, total: 0 };
    const spotUSDT = spotRows.find(w => w.currency === 'USDT') || { free: 0, locked: 0, total: 0 };
    // v20.7.2: CoinDCX futures wallets can be USDT-margined OR INR-margined.
    // The user's diagnostic confirmed their wallet returns INR — the old code
    // only looked for USDT → showed 0 in the UI. Now surface BOTH.
    const futUSDT = futRows.find(w => w.currency === 'USDT') || { free: 0, locked: 0, total: 0, crossUserMargin: 0 };
    const futINR = futRows.find(w => w.currency === 'INR') || { free: 0, locked: 0, total: 0, crossUserMargin: 0 };
    const equityINR = r2(
      (spotINR.total || 0)
      + (spotUSDT.total || 0) * usdInr
      + (futUSDT.total || 0) * usdInr
      + (futINR.total || 0),
    );
    return {
      ok: true,
      connected: coindcxConnected(),
      usdInr: r2(usdInr),
      fxStale,
      spot: {
        inr: spotINR,
        usdt: spotUSDT,
        error: Array.isArray(spot) ? null : spot?.error || 'unavailable',
        rows: spotRows.filter(w => w.currency !== 'INR' && w.currency !== 'USDT' && w.total > 5).slice(0, 12),
      },
      futures: {
        usdt: futUSDT,
        inr: futINR,
        error: Array.isArray(fut) ? null : fut?.error || 'unavailable',
        scope: lastFuturesKeyScope()?.verdict || null,
        rows: futRows.filter(w => w.currency !== 'USDT' && w.currency !== 'INR' && w.total > 0).slice(0, 12),
      },
      equityINR,
      deployableFuturesUSDT: r2(Math.max(0, (futUSDT.free || 0))),
      deployableFuturesINR: r2(Math.max(0, (futINR.free || 0))),
      deployableSpotINR: r2(Math.max(0, (spotINR.free || 0))),
      fetchedAt: Date.now(),
    };
  })();
  _walletSnapInflight = build;
  try {
    const snap = await build;
    _walletSnapCache = { at: Date.now(), value: snap };
    return snap;
  } finally { _walletSnapInflight = null; }
}
/** v20.8.5: transport reset (reconnect / key-swap) snapshot cache bhi
 * invalidate karta hai — purane key ka cached error naya verify-mask
 * nahi karega. resetWalletTransportForReconnect inhi ko call karta hai. */
function _resetWalletSnapshotCache() { _walletSnapCache = null; }
/** test hook — v20.8.5 mini-cache ko reset karo (test isolation). */
export function __resetWalletSnapshotCacheForTests() { _walletSnapCache = null; _walletSnapInflight = null; }

// ---------------- PRIVATE: positions ----------------
/**
 * Exchange futures positions (USDT margin). [{ id, pair, activePos,
 * avgPrice, liquidationPrice, leverage, marginType, markPrice, tp, sl }]
 * side is derived: activePos > 0 → LONG, < 0 → SHORT, 0 → flat.
 */
export async function listFuturesPositions() {
  const { apiKey, secret } = credGuard();
  const resp = await coindcxPrivate(POSITIONS_PATH, apiKey, secret, {
    page: '1', size: '100', margin_currency_short_name: ['USDT'],
  });
  const list = Array.isArray(resp) ? resp : (Array.isArray(resp?.positions) ? resp.positions : []);
  return list.map(p => ({
    id: String(p.id || ''),
    pair: String(p.pair || ''),
    activePos: num(p.active_pos) || 0,
    avgPrice: num(p.avg_price) || 0,
    liquidationPrice: num(p.liquidation_price) || 0,
    leverage: num(p.leverage) || 1,
    marginType: String(p.margin_type || ''),
    markPrice: num(p.mark_price) || 0,
    tp: num(p.take_profit_trigger),
    sl: num(p.stop_loss_trigger),
    updatedAt: num(p.updated_at) || 0,
  })).filter(p => p.pair);
}

// ---------------- PRIVATE: orders ----------------
/** v20.7.12 [H2-1] — CoinDCX kabhi-kabhi HTTP 200 ke andar hi error body
 * bhejta hai ({code,message} / {status:'error',message} / {error}). The
 * non-2xx path coindcxPrivate me throw karta hai, par ye wrapped rejections
 * parse ko null nahi karte the — createFuturesTpsl HAMESHA {ok:true} return
 * karta tha (naked leveraged position "protected" maana jata tha jabki
 * exchange pe SL set hi nahi hua tha). Ye pure detector us jhooth band
 * karta hai. FALSE-POSITIVE-SAFE: sirf tab error jab body me EXPLICIT
 * numeric code >= 400 ho, ya string status 'error' ho, ya top-level
 * `error` string ho — success bodies (order:{id}, positions[], {message:'...'}
 * success shapes) kabhi flag nahi hote. */
export function coindcxRespError(resp) {
  if (!resp || typeof resp !== 'object' || Array.isArray(resp)) return null;
  if (typeof resp.code === 'number' && resp.code >= 400) {
    return String(resp.message || resp.error || resp.error_description || `CoinDCX code ${resp.code}`).slice(0, 180);
  }
  if (typeof resp.code === 'string' && /^\d{3,}$/.test(resp.code) && Number(resp.code) >= 400) {
    return String(resp.message || resp.error || `CoinDCX code ${resp.code}`).slice(0, 180);
  }
  if (typeof resp.status === 'string' && /error|fail|reject/i.test(resp.status)) {
    return String(resp.message || resp.error || `CoinDCX status ${resp.status}`).slice(0, 180);
  }
  if (typeof resp.error === 'string' && resp.error.trim()) {
    return resp.error.slice(0, 180);
  }
  return null;
}

/** Build the nested create-order body (documented shape). */
export function futuresOrderBody({ pair, side, qty, leverage, price }) {
  const long = String(side).toUpperCase() !== 'SHORT';
  const limit = Number(price) > 0;
  return {
    timestamp: Date.now(),
    order: {
      side: long ? 'buy' : 'sell',
      pair: String(pair),
      order_type: limit ? 'limit_order' : 'market_order',
      ...(limit ? { price: String(price) } : {}),
      total_quantity: Number(qty),
      leverage: Math.max(1, Math.floor(Number(leverage) || 1)),
      notification: 'no_notification',
      time_in_force: 'good_till_cancel',
      hidden: false,
      post_only: false,
    },
  };
}
export async function createFuturesOrder({ pair, side, qty, leverage, price }) {
  const { apiKey, secret } = credGuard();
  const body = futuresOrderBody({ pair, side, qty, leverage, price });
  const resp = await coindcxPrivate(ORDERS_CREATE_PATH, apiKey, secret, body);
  // v20.7.12 [H2-1/H2-4]: 200-wrapped error body ya orderId-less 200 —
  // pehle {orderId: null} + truthy object return hota tha aur port.open()
  // ok:true bol deta tha (order kabhi gaya hi nahi, "placed" journal).
  // Ab honest error. orderId ab SIRF exchange-issued id se aata hai —
  // clientId fallback hata diya (journal dedupe ke liye raw.clientId
  // return hota hai, ok ke lie id hi truth hai).
  const errOf = coindcxRespError(resp);
  const orderId = resp?.order?.id ?? resp?.id ?? null;
  if (errOf) return { orderId: null, error: errOf, raw: resp };
  if (orderId == null || String(orderId).trim() === '') {
    return { orderId: null, error: 'exchange ne order id nahi diya (200 body me id missing)', raw: resp };
  }
  return { orderId: String(orderId), raw: resp };
}
export async function exitFuturesPosition(positionId) {
  const { apiKey, secret } = credGuard();
  const resp = await coindcxPrivate(POSITIONS_EXIT_PATH, apiKey, secret, { timestamp: Date.now(), id: String(positionId) });
  // v20.7.12 [H2-1]: wrapped-rejection detection — port.close() pehle
  // `ok: r != null` se hamesha true bolta tha.
  const errOf = coindcxRespError(resp);
  return errOf ? { ok: false, error: errOf, raw: resp } : { ok: true, raw: resp };
}

/** v7.0 PRO TRADER: PARTIAL futures exit. CoinDCX futures
 *  /positions/exit is FULL-exit only — a partial close goes through an
 *  OPPOSITE-side market order for the fraction (the exchange nets it
 *  against the open position, shrinking it to the runner qty). */
export async function partialFuturesExit({ pair, qty, side, leverage }) {
  const opposite = String(side).toUpperCase() === 'SHORT' ? 'LONG' : 'SHORT';
  return createFuturesOrder({
    pair, side: opposite, qty,
    leverage: Math.max(1, Math.floor(Number(leverage) || 1)),
  });
}
/** NATIVE exchange TP/SL — the safety net that keeps working even when
 *  this server is down (Render free-tier sleeps between ticks). */
export async function createFuturesTpsl({ positionId, stopLoss, takeProfit }) {
  const { apiKey, secret } = credGuard();
  const body = {
    timestamp: Date.now(),
    id: String(positionId),
    ...(stopLoss != null && Number(stopLoss) > 0 ? {
      stop_loss: { stop_price: String(stopLoss), order_type: 'stop_market' },
    } : {}),
    ...(takeProfit != null && Number(takeProfit) > 0 ? {
      take_profit: { stop_price: String(takeProfit), order_type: 'take_profit_market' },
    } : {}),
  };
  if (!body.stop_loss && !body.take_profit) return { ok: false, error: 'no levels given' };
  const resp = await coindcxPrivate(POSITIONS_TPSL_PATH, apiKey, secret, body);
  // v20.7.12 [H2-1] CRITICAL: pehle ye HAMESHA {ok:true} return karta tha.
  // CoinDCX 200-wrapped rejection bhejta hai ({code,message}) — executeFuturesSignal
  // journal me "native TP/SL armed on the exchange" likh deta tha jabki SL SET
  // HI NAHI THA (naked leveraged position believed protected — v20.7.10 ne arg
  // names fix kiye the, verdict ka jhootha ok nahi). Ab body inspect hoti hai.
  const errOf = coindcxRespError(resp);
  if (errOf) return { ok: false, error: errOf, raw: resp };
  return { ok: true, raw: resp };
}

// ---------------- THE FUTURES EXECUTION GAUNTLET ----------------
/**
 * executeFuturesSignal({ symbol, side, mode, marginUSDT | qtyINR,
 * leverage, getFreshSignal, wantAuto, source })
 *
 * Same gate ladder as the spot gauntlet (coindcxOrders.executeSignal),
 * venue-switched to the GLOBAL FUTURES desk:
 *   1. kill switch    2. auto policy (allowAuto + LIVE)
 *   3. LIVE arming    4. connection
 *   5. fresh STRONG signal (venue FUTURES, ≤90s for LIVE)
 *   6. leverage sanity (liquidation OUTSIDE the SL)
 *   7. margin sizing vs the DF wallet (live) — never over-commit
 *   8. journal caps under the lock (daily trades / loss / one-per-pair
 *      / concentration) — same journal, same lock, same INR caps
 *
 * LIVE orders additionally arm the NATIVE exchange TP/SL so the stop
 * exists even if this server never wakes up again.
 */
export async function executeFuturesSignal(opts) {
  const {
    symbol, side, mode, qtyINR, marginUSDT, leverage,
    getFreshSignal, wantAuto = false, source = 'manual', sendTelegram,
  } = opts || {};
  const cfg = await import('./coindcxOrders.js').then(m => m.loadConfig());
  const pair = futuresPairFor(symbol);
  const base = baseOfFuturesPair(pair);
  // v6.11: NOTIFY mode — full gauntlet, Telegram alert, no order/position.
  const wantMode = mode === 'live' ? 'live' : mode === 'notify' ? 'notify' : 'paper';
  const day = todayIST();
  const entry = { kind: 'ORDER', day, symbol: pair, side, mode: wantMode, market: 'FUTURES', source };

  const reject = (reason, error, extra = {}) => withJournalLock(() => {
    const j = loadJournalFresh();
    pushEntry(j, { ...entry, status: 'REJECTED', reason, ...extra });
    saveJournalFresh(j);
  }).then(() => ({ ok: false, error: error || reason }));

  // --- gate 1: kill switch ---
  if (cfg.killSwitch) return reject('Kill switch ON — execution disabled');

  // v21.1.0 (Phase-2 #4 + Phase-4): reconciler kill + GO-LIVE gate + per-strategy
  // kill rule — spot desk ke saath parity (coindcxOrders.js gate 1 block dekho).
  if (wantMode === 'live') {
    try {
      const { isKilled, killLevel, killReason } = await import('../exec/reconciler.js');
      if (typeof isKilled === 'function' && isKilled()) {
        return reject(`Exec kill L${killLevel()} ACTIVE (${killReason() || 'no reason'}) — live entries blocked`);
      }
    } catch { /* reconciler unavailable — single-node local */ }
  }
  if (wantMode === 'live') {
    try {
      const { goLiveGateBlocked } = await import('./strategyGuard.js');
      const g = goLiveGateBlocked();
      if (g.blocked) return reject(g.reason, g.reason, { goLiveGate: g.readiness?.stats });
    } catch { /* guard unavailable — never break the flow */ }
  }
  {
    try {
      const { strategyGuardBlocked } = await import('./strategyGuard.js');
      const g = strategyGuardBlocked(source, 'FUTURES');
      if (g.blocked) return reject(g.reason, g.reason, { strategyPaused: true });
    } catch { /* guard unavailable — never break the flow */ }
  }

  // --- gate 2: auto policy ---
  if (wantAuto && !cfg.allowAuto) return { ok: false, error: 'Auto-execution is OFF (enable it in Risk settings)' };
  if (wantAuto && cfg.mode !== 'live') return { ok: false, error: 'Auto-execution only runs in LIVE mode' };

  // --- gate 3: LIVE arming (typed "LIVE" in Risk settings) ---
  if (wantMode === 'live' && cfg.mode !== 'live') {
    return reject('LIVE mode is not enabled — type LIVE in Risk settings first');
  }
  // --- gate 4: connection ---
  if (wantMode === 'live' && !coindcxConnected()) return reject('CoinDCX not connected');

  // --- gate 5: fresh STRONG futures signal ---
  // v11.5: mode flows into the fresh-signal source — paper/notify may use
  // the board-cached fallback when the deep path is down; LIVE never does.
  const signal = await getFreshSignal(pair, { mode: wantMode });
  if (!signal) return reject('No fresh ensemble signal available for this futures pair');

  const gates = { minConfidence: cfg.minConfidence, minAgreement: cfg.minAgreement };
  const riskCap = Number(cfg.maxRiskPct) > 0 ? Number(cfg.maxRiskPct) : 5;

  // PAPER practice fallback (same honesty model as the spot path) — v9.0.2
  // adds side-flip + below-floor coverage so a PAPER click never dead-ends
  // (the "paper trading start hi nhi ho raha" fix).
  let effectiveSignal = signal;
  let synthNote = null;
  // v12.7 (recheck R1-#9): an ABSENT side no longer silently defaults
  // LONG — an unspecified request inherits the fresh signal's side (the
  // client always sends side; a missing side is a malformed call, and
  // minting a LONG from nothing was a free directional bias).
  const _reqRaw = String(side || '').toUpperCase();
  const reqSide = _reqRaw === 'SHORT' || _reqRaw === 'LONG' ? _reqRaw
    : (signal.side === 'SHORT' || signal.side === 'LONG' ? signal.side : 'LONG');
  const sideConflict = signal.side !== 'FLAT' && signal.side !== reqSide;
  const belowFloor = signal.grade !== 'STRONG' && signal.grade !== 'ACTION';
  if (wantMode !== 'live' && (sideConflict || signal.side === 'FLAT' || !signal.plan)) {
    const { buildTradePlan } = await import('./ensemble.js');
    const synthPlan = buildTradePlan(
      { side: reqSide, dir: reqSide === 'LONG' ? 1 : -1 },
      { ltp: signal.ltp, ind: {} }, 'FUTURES',
    );
    if (synthPlan && signal.ltp > 0) {
      effectiveSignal = { ...signal, side: reqSide, plan: synthPlan };
      synthNote = sideConflict
        ? `practice plan @ live futures price (fresh consensus FLIPPED: ${signal.side} ${signal.confidence}%)`
        : `practice plan @ live futures price (fresh consensus: ${signal.side} ${signal.confidence}%)`;
    }
  }
  const floorNote = (wantMode !== 'live' && !synthNote && (belowFloor || (Number(signal.confidence) || 0) < 55))
    ? `practice floor relaxed (fresh ${signal.grade ?? '—'} · ${signal.confidence ?? 0}% — journaled)` : null;

  // risk auto-fit (paper always; live mild overshoot ≤ 1.5×)
  let fitNote = null;
  const planRiskPct = Number(effectiveSignal?.plan?.riskPct);
  if (Number.isFinite(planRiskPct) && planRiskPct > riskCap) {
    if (wantMode !== 'live' || planRiskPct <= riskCap * 1.5) {
      const fitted = fitPlanToRiskCap(effectiveSignal, riskCap);
      if (fitted.note) { effectiveSignal = fitted.signal; fitNote = fitted.note; }
    }
  }
  const verdict = evaluateExecutionGate(effectiveSignal, {
    side: side || effectiveSignal.side, gates,
    requireStrong: wantMode === 'live',
    maxAgeMs: wantMode === 'live' ? 90_000 : 600_000,
    maxRiskPct: riskCap, venue: 'FUTURES',
    practice: wantMode !== 'live', // v9.0.2: paper/notify practice — floor relaxed, honesty journaled
  });
  if (!verdict.ok) {
    return reject(verdict.reason, `Signal gate: ${verdict.reason}`, {
      signal: { grade: signal.grade, conf: signal.confidence, agreement: signal.agreement },
    });
  }

  // v6.11 NOTIFY: gauntlet pass — Telegram alert + journal audit, NO order.
  // Position-creation caps deliberately don't block a notification.
  if (wantMode === 'notify') {
    const alertPrice = Number(effectiveSignal.ltp) > 0 ? Number(effectiveSignal.ltp) : null;
    return withJournalLock(async () => {
      const j = loadJournalFresh();
      const stats = dailyStats(j);
      const plan = effectiveSignal.plan;
      const capsNote = `trades ${stats.tradesCount}/${cfg.dailyMaxTrades} · realized ₹${r2(stats.realizedPnlINR)}`;
      const lines = [
        `🔔 <b>SmartAI NOTIFY (Futures)</b> — ${base} PERP ${effectiveSignal.side}`,
        `<b>${signal.grade || '—'}</b> · conf ${signal.confidence ?? '—'}% · agreement ${Math.round((signal.agreement ?? 0) * 100)}%`,
        plan ? `Entry ${pRound(plan.entry)} · SL ${pRound(plan.stopLoss)} · T1 ${pRound(plan.target1)} · T2 ${pRound(plan.target2)} · risk ${r2(plan.riskPct)}%` : 'plan nahi bana',
        `Book: ${capsNote}`,
        [synthNote, fitNote, floorNote].filter(Boolean).join(' · ') || undefined,
        '— notify-only: koi order place NAHI hua.',
      ].filter(Boolean);
      let telegramSent = false;
      if (typeof sendTelegram === 'function') {
        try { telegramSent = !!(await sendTelegram(lines.join('\n'))).ok; } catch { /* best-effort */ }
      }
      pushEntry(j, {
        ...entry, status: 'NOTIFIED', ...(alertPrice ? { price: pRound(alertPrice) } : {}),
        signal: { grade: signal.grade, conf: signal.confidence, agreement: signal.agreement },
        reason: [synthNote, fitNote, floorNote, verdict.reason].filter(Boolean).join(' · ') || 'gauntlet pass',
        telegramSent,
      });
      saveJournalFresh(j);
      return {
        ok: true, mode: 'notify', notified: true, telegramSent,
        alert: { pair: base, side: effectiveSignal.side, grade: signal.grade, confidence: signal.confidence,
          plan: plan ? { entry: pRound(plan.entry), stopLoss: pRound(plan.stopLoss), target2: pRound(plan.target2) } : null,
          caps: capsNote },
        note: telegramSent ? 'Telegram alert bhej diya (journal AUDIT: NOTIFIED). Koi futures order nahi laga.'
          : 'Gauntlet pass + journal AUDIT likha, par Telegram configured nahi — Alerts & AI Keys me token daalo.',
      };
    });
  }

  // --- sizing (USDT margin domain) ---
  const price = effectiveSignal.ltp;
  if (!(price > 0)) return { ok: false, error: 'No live futures price for sizing' };
  const usdInr = await fetchUsdInr();
  const meta = await fetchFuturesInstrumentMeta(pair).catch(() => null);
  const levCapInstrument = meta?.maxLeverage || 10;
  const levCapConfig = Number(cfg.cryptoLeverage) >= 1 ? Math.floor(Number(cfg.cryptoLeverage)) : 1;
  let lev = Math.max(1, Math.floor(Number(leverage) || 1));
  if (lev > levCapConfig) lev = levCapConfig;
  if (lev > levCapInstrument) lev = levCapInstrument;

  // margin budget: direct USDT wins; else the INR budget converted; else the INR cap
  let margin = Number(marginUSDT) > 0 ? Number(marginUSDT)
    : (Number(qtyINR) > 0 ? Number(qtyINR) / usdInr : Math.min(cfg.maxOrderINR, 1000) / usdInr);
  margin = Math.round(margin * 1000) / 1000;

  // leverage sanity — liquidation must sit OUTSIDE the SL
  const slDistPct = Math.abs(price - (effectiveSignal.plan?.stopLoss ?? price)) / price * 100;
  const saneLev = maxSaneLeverage(slDistPct, Math.min(levCapConfig, levCapInstrument));
  let levNote = null;
  if (lev > 1 && lev > saneLev) {
    if (wantMode === 'paper') {
      levNote = `leverage auto-reduced ${lev}x → ${saneLev}x (liquidation est. would fire before the ${r2(slDistPct)}% SL)`;
      lev = saneLev;
    } else {
      return reject(`leverage ${lev}x puts liquidation (~${r2(95 / lev)}% away) inside the ${r2(slDistPct)}% stop — reduce leverage to ≤${saneLev}x`,
        `Leverage gate: ${lev}x liquidates before the SL — use ≤ ${saneLev}x`);
    }
  }

  // live margin must exist in the DF wallet (USDT first; auto-deposit
  // from spot USDT, else from spot INR at the live FX rate)
  let walletNote = null;
  if (wantMode === 'live') {
    try {
      const wallets = await fetchFuturesWallets();
      const futUSDT = wallets.find(w => w.currency === 'USDT');
      const free = futUSDT?.free || 0;
      if (margin > free) {
        // try auto-transfer from the spot wallet (documented transfer API)
        const spotWallets = await fetchSpotWallets();
        const spotUSDT = spotWallets.find(w => w.currency === 'USDT')?.free || 0;
        const spotINR = spotWallets.find(w => w.currency === 'INR')?.free || 0;
        const need = margin - free;
        if (spotUSDT >= need) {
          await transferSpotToFutures({ amount: r2(need + 0.5), currency: 'USDT' });
          walletNote = `auto-moved ${r2(need + 0.5)} USDT spot → futures margin`;
        } else if (spotINR / usdInr >= need) {
          const usdtNeed = r2((need + 0.5));
          await transferSpotToFutures({ amount: r2(usdtNeed * usdInr), currency: 'INR' });
          walletNote = `auto-moved ₹${r2(usdtNeed * usdInr)} spot → futures (≈ ${usdtNeed} USDT margin)`;
        } else {
          return reject(`futures wallet short: need ${r2(margin)} USDT margin, ${r2(free)} free + spot ₹${r2(spotINR)} insufficient`,
            `Wallet gate: ${r2(margin)} USDT margin needed — futures free ${r2(free)} USDT, spot ₹${r2(spotINR)} — transfer margin in the CoinDCX app`);
        }
      }
    } catch (e) {
      return reject(`futures wallet check failed: ${String(e?.message || e).slice(0, 140)}`,
        `Wallet gate: ${String(e?.message || e).slice(0, 140)}`);
    }
  }

  const rawQty = (margin * lev) / price;
  const qty = roundFuturesQty(pair, rawQty);
  if (!(qty > 0)) return { ok: false, error: `Quantity rounds to 0 for ${pair} — increase the margin` };
  // v9.5: the exchange minimum stays a HARD gate for LIVE (CoinDCX would
  // reject the real order), but PAPER is practice money — a small-margin
  // rehearsal now runs with an honest note instead of dead-ending on
  // "Quantity below the futures minimum" (BTC's min is 1 whole contract).
  let minQtyNote = null;
  if (meta?.minQty > 0 && qty < meta.minQty) {
    if (wantMode === 'live') {
      return { ok: false, error: `Quantity ${qty} below the futures minimum (${meta.minQty}) for ${pair}` };
    }
    minQtyNote = `paper qty ${qty} below the exchange minimum (${meta.minQty}) — real order would need more margin; simulating anyway`;
  }
  const notionalUSDT = r2(qty * price);
  const marginUsed = r2(notionalUSDT / lev);
  if (marginUsed < 2) return { ok: false, error: `Margin ₹${inrOfUsdt(marginUsed, usdInr)} too small for ${pair} — increase the order size` };
  const liquidation = lev > 1 && effectiveSignal.plan?.stopLoss != null
    ? pRound(effectiveSignal.side !== 'SHORT' ? price * (1 - 0.95 / lev) : price * (1 + 0.95 / lev))
    : null;

  // --- FINAL MUTATION under the journal lock (fresh copy) ---
  return withJournalLock(async () => {
    const j = loadJournalFresh();
    const stats = dailyStats(j);
    if (stats.tradesCount >= cfg.dailyMaxTrades) {
      pushEntry(j, { ...entry, status: 'REJECTED', reason: `Daily trade cap (${cfg.dailyMaxTrades}) hit` });
      saveJournalFresh(j);
      return { ok: false, error: `Daily trade cap (${cfg.dailyMaxTrades}) reached — resets at IST midnight` };
    }
    if (stats.realizedPnlINR <= -cfg.dailyMaxLossINR) {
      pushEntry(j, { ...entry, status: 'REJECTED', reason: `Daily loss cap (₹${cfg.dailyMaxLossINR}) hit` });
      saveJournalFresh(j);
      return { ok: false, error: `Daily loss cap (₹${cfg.dailyMaxLossINR}) breached — trading paused for today` };
    }
    if (j.positions.some(p => p.pair === pair && (p.status === 'OPEN' || p.status === 'UNKNOWN'))) {
      pushEntry(j, { ...entry, status: 'REJECTED', reason: 'Position already open for this futures pair' });
      saveJournalFresh(j);
      return { ok: false, error: `An open position already exists for ${pair} (one-per-pair rule)` };
    }
    const openCount = j.positions.filter(p => p.status === 'OPEN' || p.status === 'UNKNOWN').length;
    if (openCount >= (cfg.maxOpenPositions || 5)) {
      pushEntry(j, { ...entry, status: 'REJECTED', reason: `Max open positions (${cfg.maxOpenPositions || 5}) hit` });
      saveJournalFresh(j);
      return { ok: false, error: `Concentration guard: ${openCount} positions already open (max ${cfg.maxOpenPositions || 5})` };
    }

    const mkPosition = (extra) => ({
      id: crypto.randomUUID(), pair, symbol: base, market: 'FUTURES', side: effectiveSignal.side, mode: wantMode, source,
      qty, entryPrice: price, notionalUSDT, notionalINR: inrOfUsdt(notionalUSDT, usdInr),
      marginUSDT: marginUsed, marginINR: inrOfUsdt(marginUsed, usdInr),
      leverage: lev, ...(lev > 1 ? { liquidation } : {}),
      sl: effectiveSignal.plan?.stopLoss ?? null, tp: effectiveSignal.plan?.target1 ?? null, tp2: effectiveSignal.plan?.target2 ?? null,
      initialRisk: pRound(Math.abs(price - (effectiveSignal.plan?.stopLoss ?? price))),
      peakPrice: pRound(price),
      signal: { grade: signal.grade, confidence: signal.confidence, agreement: signal.agreement, summary: synthNote || signal.summary },
      openedAt: Date.now(), status: 'OPEN', ...extra,
    });

    // --- PAPER execution ---
    if (wantMode === 'paper') {
      let ledgerEntryId = null;
      // v20.3: relaxed stamp (the spot desk already had it) — practice
      // entries built against a flipped/sub-floor consensus must stay OUT
      // of the calibration corpus on EVERY desk, not just CRYPTO.
      try {
        ledgerEntryId = recordExecution(signal, {
          mode: 'paper', market: 'FUTURES', source,
          ...(synthNote || floorNote ? { relaxed: true } : {}),
        })?.id || null;
      } catch { /* best-effort */ }
      const position = mkPosition(ledgerEntryId ? { ledgerEntryId } : {});
      j.positions.push(position);
      pushEntry(j, {
        ...entry, status: 'FILLED', qty, price: pRound(price), notionalUSDT, notionalINR: inrOfUsdt(notionalUSDT, usdInr),
        leverage: lev, marginUSDT: marginUsed,
        signal: { grade: signal.grade, conf: signal.confidence, agreement: signal.agreement },
        reason: [verdict.reason, synthNote, fitNote, levNote, floorNote, minQtyNote].filter(Boolean).join(' · '),
      });
      saveJournalFresh(j);
      return {
        ok: true, mode: 'paper', position,
        filled: { qty, price: pRound(price), notionalUSDT, notionalINR: inrOfUsdt(notionalUSDT, usdInr), leverage: lev, marginUSDT: marginUsed },
        ...(walletNote || synthNote || fitNote || levNote || floorNote || minQtyNote ? { fitted: [walletNote, synthNote, fitNote, levNote, floorNote, minQtyNote].filter(Boolean).join(' · ') } : {}),
      };
    }

    // --- LIVE execution ---
    try {
      const orderRes = await createFuturesOrder({ pair, side: effectiveSignal.side, qty, leverage: lev });
      const orderId = orderRes?.orderId ?? null;
      // v20.7.12 [H2-1]: createFuturesOrder ab 200-wrapped rejections ko
      // {orderId:null, error} me return karta hai — pehle ye path journal me
      // 'SUBMITTED' + ok:true likh deta tha jabki order REJECT ho chuka tha.
      // Explicit rejection → honest FAILED + no phantom position.
      if (orderRes?.error) {
        pushEntry(j, { ...entry, status: 'FAILED', reason: `exchange rejected: ${String(orderRes.error).slice(0, 160)}` });
        saveJournalFresh(j);
        return { ok: false, error: `CoinDCX futures order rejected: ${orderRes.error}` };
      }
      // Resolve the exchange position id (needed for exit + native TP/SL).
      let exchangePositionId = null, exchangeLiq = null;
      for (let i = 0; i < 3 && !exchangePositionId; i++) {
        await new Promise(r => setTimeout(r, 1200));
        const positions = await listFuturesPositions().catch(() => []);
        const row = positions.find(p => p.pair === pair && p.activePos !== 0);
        if (row) { exchangePositionId = row.id; exchangeLiq = row.liquidationPrice > 0 ? row.liquidationPrice : null; }
      }
      // Native TP/SL — belt + suspenders (works while this server sleeps).
      // v21.1.0 PROTECTION-FIRST (Phase-2 audit fix #3): tpsl fail → 2s baad
      // EK retry; phir bhi fail → FLATTEN (positionManager.js ka core rule
      // port: "no protection = no position"). Pehle ye position OPEN book
      // karta tha sirf ek note ke saath — leveraged position exchange-resident
      // stop ke bina 30s server-watcher ke bharose reh jati thi.
      let tpslNote = null;
      let tpslFailed = false;
      if (exchangePositionId) {
        const tp = effectiveSignal.plan?.target2 ?? null;
        const sl = effectiveSignal.plan?.stopLoss ?? null;
        let tpsl = await createFuturesTpsl({ positionId: exchangePositionId, stopLoss: sl, takeProfit: tp }).catch(e => ({ ok: false, error: String(e?.message || e) }));
        if (!tpsl?.ok) {
          await new Promise(r => setTimeout(r, 2000)); // ek bounded retry — transient API hiccup
          tpsl = await createFuturesTpsl({ positionId: exchangePositionId, stopLoss: sl, takeProfit: tp }).catch(e => ({ ok: false, error: String(e?.message || e) }));
        }
        if (tpsl?.ok) {
          tpslNote = `native TP/SL armed on the exchange (SL ${sl} · TP ${tp})`;
        } else {
          tpslFailed = true;
          tpslNote = `native TP/SL FAILED twice (${String(tpsl?.error || '').slice(0, 80)}) — PROTECTION-FIRST flatten triggered`;
        }
      }
      // v21.1.0: tpsl fail → flatten the just-opened position. Flatten bhi
      // fail ho (API down) → honest booking + watcher-guard note (purana
      // behavior) — kabhi bhi "armed" ka jhootha claim nahi.
      if (tpslFailed) {
        let flattenErr = null;
        try {
          const fx = await exitFuturesPosition(exchangePositionId).catch(e => ({ ok: false, error: String(e?.message || e) }));
          if (!fx?.ok) flattenErr = fx?.error || 'wrapped rejection';
        } catch (e) { flattenErr = String(e?.message || e); }
        if (!flattenErr) {
          const usdInrFx = await fetchUsdInr().catch(() => 84);
          pushEntry(j, {
            ...entry, status: 'CLOSED', qty, price: pRound(price), notionalUSDT, notionalINR: inrOfUsdt(notionalUSDT, usdInrFx),
            leverage: lev, marginUSDT: marginUsed, exchangeOrderId: orderId ?? null, exchangePositionId,
            reason: `PROTECTION-FIRST FLATTEN: native TP/SL do attempt me arm nahi hua — entry turant close kar di gayi (scratch exit, fee-only). Original tpsl error: ${tpslNote}`,
          });
          saveJournalFresh(j);
          return { ok: false, error: `Futures entry flattened (protection-first): native TP/SL arm nahi hua — ${tpslNote}. Position close ho gayi, scratch exit (fee-only).` };
        }
        // flatten fail — honest booking + watcher guard (existing path)
        tpslNote = `native TP/SL NOT armed + FLATTEN BHI FAIL (${String(flattenErr).slice(0, 60)}) — server watcher hi exit guard hai; manual verify karo`;
      }
      let ledgerEntryId = null;
      try { ledgerEntryId = recordExecution(signal, { mode: 'live', market: 'FUTURES', source })?.id || null; } catch { /* best-effort */ }
      const position = mkPosition({
        exchangeOrderId: orderId ?? null,
        ...(exchangePositionId ? { exchangePositionId } : {}),
        ...(exchangeLiq ? { liquidation: exchangeLiq, liquidationSource: 'exchange' } : {}),
        ...(ledgerEntryId ? { ledgerEntryId } : {}),
        status: 'OPEN',
      });
      j.positions.push(position);
      pushEntry(j, {
        ...entry, status: orderId || exchangePositionId ? 'SUBMITTED' : 'SUBMITTED_UNKNOWN',
        qty, price: pRound(price), notionalUSDT, notionalINR: inrOfUsdt(notionalUSDT, usdInr),
        leverage: lev, marginUSDT: marginUsed, exchangeOrderId: orderId ?? null,
        signal: { grade: signal.grade, conf: signal.confidence, agreement: signal.agreement },
        reason: [verdict.reason, fitNote, levNote, walletNote, tpslNote].filter(Boolean).join(' · '),
      });
      saveJournalFresh(j);
      return {
        ok: true, mode: 'live', orderId, position,
        filled: { qty, price: pRound(price), notionalUSDT, notionalINR: inrOfUsdt(notionalUSDT, usdInr), leverage: lev, marginUSDT: marginUsed },
        ...(walletNote || fitNote || levNote || tpslNote ? { fitted: [walletNote, fitNote, levNote, tpslNote].filter(Boolean).join(' · ') } : {}),
      };
    } catch (e) {
      pushEntry(j, { ...entry, status: 'FAILED', reason: String(e?.message || e).slice(0, 200) });
      saveJournalFresh(j);
      return { ok: false, error: `CoinDCX futures order failed: ${e?.message || e}` };
    }
  });
}

/** Spot ↔ futures margin transfer ("deposit" moves spot → futures). */
export async function transferSpotToFutures({ amount, currency = 'USDT' }) {
  const { apiKey, secret } = credGuard();
  const body = { timestamp: Date.now(), transfer_type: 'deposit', amount: Number(amount), currency_short_name: String(currency).toUpperCase() };
  return coindcxPrivate('/exchange/v1/derivatives/futures/wallets/transfer', apiKey, secret, body);
}

// ---------------- journal helpers (same files as coindcxOrders) ----------------
const JOURNAL_FILE = 'ai-trading-journal.json';
const MAX_JOURNAL = 500;
const CLOSED_POSITION_TTL = 90 * 24 * 3600_000; // v7.0.2: closed positions pruned after 90d
function loadJournalFresh() {
  return loadJSON(JOURNAL_FILE, { entries: [], positions: [] });
}
// v7.0.2: futures writes now prune like the spot desk — saveJournalFresh
// previously capped NOTHING, so TRAIL/WATCH_ERROR entries and every closed
// position grew the file forever (multi-MB reloads on every route hit).
function saveJournalFresh(j) {
  if (Array.isArray(j.entries) && j.entries.length > MAX_JOURNAL) {
    j.entries = j.entries.slice(-MAX_JOURNAL);
  }
  if (Array.isArray(j.positions)) {
    const cutoff = Date.now() - CLOSED_POSITION_TTL;
    const keep = j.positions.filter(p => p.status !== 'CLOSED' || (p.closedAt || p.openedAt || 0) >= cutoff);
    if (keep.length !== j.positions.length) j.positions = keep;
  }
  try { durablePut(JOURNAL_FILE, j); } catch { /* best-effort */ }
  saveJSON(JOURNAL_FILE, j);
  return j;
}

// ---------------- FUTURES POSITION WATCHER ----------------
/**
 * Runs under the journal lock every 60s (routes.js interval):
 *   • LIVE reconcile: the exchange position list is truth — if the
 *     exchange closed the position (native TP/SL, app close, liq),
 *     ours closes with an honest reason. avg/trigger prices approximate
 *     the exit (CoinDCX doesn't expose the fill price here).
 *   • SL / TP2 / trailing / liquidation on the RT futures price
 *     (paper closes simulated, live exits via /positions/exit).
 *   • watch errors persist — a dead stop never looks healthy.
 */
export async function watchFuturesPositions({ sendTelegram, getDeepSignal } = {}) {
  return withJournalLock(async () => {
    const j = loadJournalFresh();
    const closures = [];
    const watchErrors = [];
    let dirty = false;
    const cfg = await import('./coindcxOrders.js').then(m => m.loadConfig());
    const pro = loadProTraderConfig(); // v7.0 partial-TP settings

    // v12.8 SUPERINTELLIGENCE REVERSAL RECOVERY — ₹ loss-cap cut →
    // stop-and-reverse → ₹ target booking (opt-in; guards inside
    // reversalEngine.js). Deps injected → zero import cycles.
    const rev = await import('./reversalEngine.js');
    const revCfg = rev.loadReversalConfig();
    // v20.9.4 [H1]: listFuturesPositions bhi inject — openReversalLeg ab
    // real POSITION id (row.id) resolve karta hai, order id nahi.
    const revDeps = { exitFuturesPosition, createFuturesOrder, createFuturesTpsl, roundFuturesQty, coindcxConnected, listFuturesPositions };
    const revCtxBase = { cfg: revCfg, getDeepSignal, deps: revDeps, sendTelegram };

    let openFut = j.positions.filter(p => p.market === 'FUTURES' && (p.status === 'OPEN' || p.status === 'UNKNOWN')
      // v20.9.3 FIX (M): PM-owned exec positions (protectionFirstEntry) —
      // the PositionManager 15m ladder manages these (boot-hydrated from
      // these same rows). Skip while the exec stack is armed so T1/T2/trail
      // don't double-fire (PM reduce + watcher close = double exit); if the
      // stack failed to arm, the watcher adopts them (protection never drops).
      && !(p.execManaged && globalThis.__positionManager));
    if (openFut.length === 0) {
      // v12.8: waiting windows STILL need their pass when flat (the last
      // leg closed — re-entry window is exactly the interesting part).
      // Prices are 20s-cached → this flat-pass is free.
      if (revCfg.enabled) {
        try {
          const prices0 = await fetchFuturesPrices().catch(() => null);
          const byPair0 = new Map((prices0 || []).map(p => [p.pair, p.last]));
          const rr = await rev.processReversalWaiting(j, byPair0, revCtxBase);
          if (rr?.dirty) saveJournalFresh(j);
        } catch { /* non-fatal */ }
      }
      return closures;
    }

    const prices = await fetchFuturesPrices({
      // v20.8.5: TP1/TP2 partial-booking + SL decisions ≤5s-old prices pe
      // chalte hain (default 20s cache ek hit ko 20-80s late detect kar
      // sakta tha — "profit book late ho raha hai" ka latency hissa).
      // Public REST + single-flight — har watcher pass max 1 fresh fetch.
      maxAgeMs: 5_000,
    }).catch(() => null);
    const byPair = new Map((prices || []).map(p => [p.pair, p.last]));
    // v12.8: the reversal pass needs INR twins — resolve once per pass
    // (10-min cached) so loss-cap ₹ math is consistent within the sweep.
    const revCtx = revCfg.enabled ? { ...revCtxBase, usdInr: await fetchUsdInr().catch(() => 84) } : null;

    // --- LIVE reconcile against the exchange's own position list ---
    if (coindcxConnected() && openFut.some(p => p.mode === 'live')) {
      const exch = await listFuturesPositions().catch(() => null);
      if (exch) {
        const byExchPair = new Map(exch.map(p => [p.pair, p]));
        for (const p of openFut.filter(x => x.mode === 'live')) {
          if (cfg.killSwitch) break;
          const row = byExchPair.get(p.pair);
          if (!row) continue; // pair absent this page — retry next pass
          if (row.activePos !== 0) {
            // v7.0.2 CRITICAL FIX: adopt the exchange position id when the
            // entry-time polls missed it (fill latency). Without the id NO
            // exit path can reach the exchange — the position would be
            // "closed" on paper only while real margin bleeds with no stop.
            if (!p.exchangePositionId && row.id) {
              p.exchangePositionId = row.id;
              dirty = true;
              pushEntry(j, {
                kind: 'WATCH_ERROR', day: todayIST(), pair: p.pair, market: 'FUTURES',
                reason: `exchange position id adopted late (${row.id}) — exit paths now armed`,
              });
            }
            // still open — refresh the exchange's own numbers.
            // v7.0: partial legs shrink activePos — sync our qty to the
            // exchange's truth (a native/app partial close shows up here)
            if (row.avgPrice > 0 && row.avgPrice !== p.entryPrice) { p.entryPrice = row.avgPrice; dirty = true; }
            if (row.liquidationPrice > 0 && row.liquidation !== row.liquidationPrice) { p.liquidation = row.liquidationPrice; p.liquidationSource = 'exchange'; dirty = true; }
            if (Math.abs(row.activePos) > 0 && Math.abs(row.activePos) !== Number(p.qty)) {
              // v7.0 comment claimed app/native partial closes sync here,
              // but the old `(p.tp1Hit || p.tp2Hit)` guard required OUR OWN
              // stamps — an external partial close never synced, leaving
              // book qty stale for every P&L/daily-cap computation until
              // full close. v20.3: sync on ANY divergence.
              pushEntry(j, {
                kind: 'WATCH_ERROR', day: todayIST(), pair: p.pair, market: 'FUTURES',
                reason: `partial-sync: exchange qty ${Math.abs(row.activePos)} vs book ${p.qty} — syncing (native/app partial close)`,
              });
              p.qty = Math.abs(row.activePos);
              dirty = true;
            }
            continue;
          }
          // exchange says flat → it closed out from under us (native TP/SL
          // or app close). Exit price ≈ the trigger level we armed.
          const long = p.side === 'LONG';
          let exitPrice = null, reason = 'Exchange closed (reconciled)';
          const ltp = byPair.get(p.pair);
          if (row.sl != null && row.sl > 0) { exitPrice = row.sl; reason = 'Exchange SL (native)'; }
          else if (row.tp != null && row.tp > 0) { exitPrice = row.tp; reason = 'Exchange TP (native)'; }
          else if (ltp > 0) { exitPrice = ltp; reason = 'Exchange closed (app/manual)'; }
          const usdInr = await fetchUsdInr();
          const pnlUSDT = exitPrice != null ? (long ? exitPrice - p.entryPrice : p.entryPrice - exitPrice) * p.qty : 0;
          p.status = 'CLOSED'; p.closedAt = Date.now();
          if (exitPrice != null) p.closePrice = exitPrice;
          p.pnlUSDT = r2(pnlUSDT);
          p.pnlINR = inrOfUsdt(pnlUSDT, usdInr);
          p.closeReason = reason;
          try { settlePositionOutcome(p, reason); } catch { /* best-effort */ }
          dirty = true;
          pushEntry(j, { kind: 'CLOSE', day: todayIST(), pair: p.pair, market: 'FUTURES', mode: p.mode, source: p.source, qty: p.qty, entryPrice: p.entryPrice, closePrice: exitPrice, pnlUSDT: p.pnlUSDT, pnlINR: p.pnlINR, reason });
          closures.push({ pair: p.pair, mode: p.mode, pnlINR: p.pnlINR, reason });
        }
      }
    }

    openFut = j.positions.filter(p => p.market === 'FUTURES' && p.status === 'OPEN');

    // v10.6 CROSS-EXCHANGE VALIDATION (Pro Upgrade #3): perp prices are
    // natively USDT → compared 1:1 against Binance perps (no conversion).
    // A fresh cross-venue gap skips all liq/trailing/SL/TP checks for
    // that base this pass; a reverted wick lands in the journal; a
    // sustained gap is accepted (real move).
    const _futWick = new Map(); // base → verdict|null
    for (const p of openFut) {
      const base = String(p.pair || '').replace(/^B-/, '').replace(/_USDT$/, '');
      if (!base || _futWick.has(base)) continue;
      _futWick.set(base, await validateTick({ market: 'FUTURES', base, price: byPair.get(p.pair) }).catch(() => null));
    }
    for (const [base, wv] of _futWick.entries()) {
      if (wv?.episode === 'wick') {
        const entry = wickJournalEntry({ market: 'FUTURES', base, pair: `B-${base}_USDT`, verdict: wv });
        entry.day = todayIST();
        pushEntry(j, entry);
        dirty = true;
      }
    }

    for (const p of openFut) {
      const price = byPair.get(p.pair);
      if (!(price > 0)) continue;
      const _wv = _futWick.get(String(p.pair || '').replace(/^B-/, '').replace(/_USDT$/, ''));
      if (_wv?.action === 'SUPPRESS') continue; // fresh bad print — no action this pass
      const long = p.side === 'LONG';

      // liquidation estimate first (paper sim + live backstop)
      if (p.leverage > 1 && p.liquidation != null && p.liquidation > 0) {
        if (long ? price <= p.liquidation : price >= p.liquidation) {
          let closed = false;
          if (p.mode === 'live' && p.exchangePositionId && coindcxConnected()) {
            try {
              const xr = await exitFuturesPosition(p.exchangePositionId);
              // v20.9.1 [H1]: 200-wrapped rejection throw NAHI karta — {ok:false}
              // verdict check kiye bina closed=true fake LIQUIDATION close book
              // hota tha jabki exchange position khuli reh jati thi.
              if (!xr?.ok) throw new Error(xr?.error || 'wrapped rejection (200 body me error)');
              closed = true;
            }
            catch (e) {
              pushEntry(j, { kind: 'WATCH_ERROR', day: todayIST(), pair: p.pair, reason: `futures liq exit failed: ${String(e?.message || e).slice(0, 160)}` });
              dirty = true; watchErrors.push({ pair: p.pair, reason: String(e?.message || e).slice(0, 120) });
            }
          } else if (p.mode !== 'live') {
            closed = true; // paper liquidation always executes
          } else {
            // v7.0.2 CRITICAL FIX: LIVE without id/creds used to be
            // paper-simulated closed — orphaning the real exchange
            // position. Persist + retry instead; the reconcile pass will
            // adopt the id or close it honestly when the exchange reports flat.
            pushEntry(j, { kind: 'WATCH_ERROR', day: todayIST(), pair: p.pair, market: 'FUTURES', reason: `LIVE liq-exit BLOCKED (no exchange position id / CoinDCX disconnected) — NOT paper-closing, will retry` });
            dirty = true; watchErrors.push({ pair: p.pair, reason: 'live liq-exit blocked (no id/creds) — retrying' });
          }
          if (closed) {
            const usdInr = await fetchUsdInr();
            const liq = p.liquidation;
            const pnlUSDT = (long ? liq - p.entryPrice : p.entryPrice - liq) * p.qty;
            p.status = 'CLOSED'; p.closedAt = Date.now(); p.closePrice = liq;
            p.pnlUSDT = r2(pnlUSDT); p.pnlINR = inrOfUsdt(pnlUSDT, usdInr);
            p.closeReason = 'LIQUIDATED (est.)';
            try { settlePositionOutcome(p, 'LIQUIDATED (est.)'); } catch { /* best-effort */ }
            dirty = true;
            pushEntry(j, { kind: 'CLOSE', day: todayIST(), pair: p.pair, market: 'FUTURES', mode: p.mode, source: p.source, qty: p.qty, entryPrice: p.entryPrice, closePrice: liq, pnlUSDT: p.pnlUSDT, pnlINR: p.pnlINR, reason: 'LIQUIDATED (est. — price crossed the liquidation level)' });
            closures.push({ pair: p.pair, mode: p.mode, pnlINR: p.pnlINR, reason: 'LIQUIDATED (est.)' });
          }
          continue;
        }
      }

      // v12.8 SUPERINTELLIGENCE REVERSAL RECOVERY — ₹-denominated loss-cap
      // cut + stop-and-reverse + ₹ profit booking. Runs BEFORE trail/SL/TP
      // (the ₹ thresholds ARE the position's discipline when enabled; the
      // stamped price SL/TP below stays as redundant second guard). The
      // engine sends its own Telegram — closures array untouched (no
      // double push), LIVE honesty per v7.0.2 inside closeLeg().
      if (revCtx && (p.status === 'OPEN' || p.status === 'UNKNOWN')) {
        try {
          const rres = await rev.evaluateReversalForPosition(j, p, price, revCtx);
          if (rres?.dirty) dirty = true;
          if (rres?.closed) {
            console.log(`[ai] reversal: ${rres.closed.pair} leg cut — ${rres.closed.reason} → ₹${rres.closed.pnlINR}${rres.opened ? ` · FLIP leg-${rres.opened.reversal?.leg} ${rres.opened.side}` : ''}`);
          }
        } catch (e) {
          pushEntry(j, { kind: 'WATCH_ERROR', day: todayIST(), pair: p.pair, market: 'FUTURES', reason: `reversal pass error: ${String(e?.message || e).slice(0, 160)}` });
          dirty = true;
        }
        if (p.status !== 'OPEN' && p.status !== 'UNKNOWN') continue;
      }

      // trailing SL (USDT domain, same ratchet math)
      if (cfg.trailEnabled && p.sl != null && p.sl > 0) {
        const prevPeak = Number(p.peakPrice);
        const peak = long
          ? Math.max(Number.isFinite(prevPeak) && prevPeak > 0 ? prevPeak : price, price)
          : Math.min(Number.isFinite(prevPeak) && prevPeak > 0 ? prevPeak : price, price);
        p.peakPrice = pRound(peak);
        const risk = Number(p.initialRisk) > 0 ? Number(p.initialRisk) : Math.abs(p.entryPrice - p.sl);
        if (risk > 0) {
          const trail = computeTrailSl({ side: p.side, entryPrice: p.entryPrice, peakPrice: peak, currentSl: p.sl, initialRisk: risk, price, armR: cfg.trailArmR, offsetR: cfg.trailOffsetR });
          if (trail) {
            pushEntry(j, { kind: 'TRAIL', day: todayIST(), pair: p.pair, market: 'FUTURES', reason: `SL ${trail.stage}: ${p.sl} → ${trail.sl} (peak ${pRound(peak)})`, from: p.sl, to: trail.sl });
            p.sl = trail.sl; p.trailing = trail.stage;
            // LIVE: nudge the native stop too (ratchet-only on the exchange)
            if (p.mode === 'live' && p.exchangePositionId && coindcxConnected()) {
              try { await createFuturesTpsl({ positionId: p.exchangePositionId, stopLoss: trail.sl }); } catch { /* watcher remains the guard */ }
            }
          }
        }
        dirty = true;
      }

      // v7.0 PRO TRADER — 3-tier partial take-profit (agent-sourced
      // positions): T1 → close pct% + SL → breakeven; T2 → close pct% +
      // SL → T1; runner trails until time-exit/SL. LIVE legs go through
      // partialFuturesExit (opposite-side market order — /positions/exit
      // is full-exit only) and nudge the native stop to the locked level.
      if (pro.partialTpEnabled && p.source === 'agent' && !p.partialTpOff) {
        const t1 = Number(p.tp) > 0 ? Number(p.tp) : null;
        const t2 = Number(p.tp2) > 0 ? Number(p.tp2) : null;
        const hit = (lvl) => lvl != null && (long ? price >= lvl : price <= lvl);
        const partialNotes = [];

        // T1 leg
        // v20.3: a PARTIAL-RETRY hold (ambiguous transport error on the
        // previous attempt — the market order MAY have filled) blocks the
        // gate, else the 60s watcher would re-send the SAME market order
        // and shrink the book again (the spot desk's v18.9 double-sell
        // fix, ported to futures).
        if (!p.tp1Hit && hit(t1) && !(p.partialRetryAfter && Date.now() < p.partialRetryAfter)) {
          const leg = await partialCloseFuturesLeg(j, p, price, { stage: 'T1', pct: pro.tp1ClosePct });
          if (leg.ok) {
            if (pro.breakEvenAfterTp1 && p.status !== 'CLOSED') {
              const prevSl = p.sl;
              p.sl = ratchetSl(p.side, p.sl, p.entryPrice);
              if (prevSl !== p.sl) {
                pushEntry(j, { kind: 'TRAIL', day: todayIST(), pair: p.pair, market: 'FUTURES', reason: `BREAKEVEN LOCK (T1 hit): SL ${pRound(prevSl)} → ${pRound(p.sl)} — runner risk-free`, from: prevSl, to: p.sl });
                if (p.mode === 'live' && p.exchangePositionId && coindcxConnected()) {
                  try { await createFuturesTpsl({ positionId: p.exchangePositionId, stopLoss: p.sl }); } catch { /* watcher remains the guard */ }
                }
              }
            }
            partialNotes.push(`T1 ${leg.closedQty} @ ${pRound(price)} → +₹${r2(leg.legPnlINR)}`);
          } else {
            pushEntry(j, { kind: 'WATCH_ERROR', day: todayIST(), pair: p.pair, reason: `T1 futures partial failed: ${String(leg.error || '').slice(0, 160)}` });
            watchErrors.push({ pair: p.pair, reason: `T1 partial failed: ${String(leg.error || '').slice(0, 120)}` });
          }
          dirty = true;
        }

        // T2 leg (same pass when price gapped past both)
        if (p.tp1Hit && !p.tp2Hit && hit(t2) && p.status === 'OPEN' && !(p.partialRetryAfter && Date.now() < p.partialRetryAfter)) {
          const leg = await partialCloseFuturesLeg(j, p, price, { stage: 'T2', pct: pro.tp2ClosePct });
          if (leg.ok) {
            if (t1 != null && p.status !== 'CLOSED') {
              const prevSl = p.sl;
              p.sl = ratchetSl(p.side, p.sl, t1);
              if (prevSl !== p.sl) {
                pushEntry(j, { kind: 'TRAIL', day: todayIST(), pair: p.pair, market: 'FUTURES', reason: `PROFIT LOCK (T2 hit): SL ${pRound(prevSl)} → T1 ${pRound(p.sl)}`, from: prevSl, to: p.sl });
                if (p.mode === 'live' && p.exchangePositionId && coindcxConnected()) {
                  try { await createFuturesTpsl({ positionId: p.exchangePositionId, stopLoss: p.sl }); } catch { /* watcher remains the guard */ }
                }
              }
            }
            partialNotes.push(`T2 ${leg.closedQty} @ ${pRound(price)} → +₹${r2(leg.legPnlINR)}`);
          } else {
            pushEntry(j, { kind: 'WATCH_ERROR', day: todayIST(), pair: p.pair, reason: `T2 futures partial failed: ${String(leg.error || '').slice(0, 160)}` });
            watchErrors.push({ pair: p.pair, reason: `T2 partial failed: ${String(leg.error || '').slice(0, 120)}` });
          }
          dirty = true;
        }

        if (partialNotes.length > 0) {
          closures.push({ pair: p.pair, mode: p.mode, pnlINR: null, partial: true, reason: `PARTIAL TP — ${partialNotes.join(' · ')}` });
        }
        if (p.status !== 'OPEN') continue; // partials closed the whole book
      }

      let close = null;
      if (p.sl != null && (long ? price <= p.sl : price >= p.sl)) close = { reason: 'STOP-LOSS hit', price, kind: 'SL' };
      else if (p.tp2 != null && !p.tp2Hit && (long ? price >= p.tp2 : price <= p.tp2)) close = { reason: 'TARGET-2 hit', price, kind: 'TP2' };
      if (!close) continue;

      let closed = false;
      if (p.mode === 'live' && p.exchangePositionId && coindcxConnected()) {
        try {
          const xr = await exitFuturesPosition(p.exchangePositionId);
          // v20.9.1 [H1]: wrapped rejection (HTTP 200 + {code,message} body)
          // resolve hota hai, throw nahi — verdict ignore karke closed=true
          // banana = fake CLOSE + fabricated PnL + real position unmonitored.
          if (!xr?.ok) throw new Error(xr?.error || 'wrapped rejection (200 body me error)');
          closed = true;
        }
        catch (e) {
          pushEntry(j, { kind: 'WATCH_ERROR', day: todayIST(), pair: p.pair, reason: `futures exit failed: ${String(e?.message || e).slice(0, 160)}` });
          dirty = true; watchErrors.push({ pair: p.pair, reason: String(e?.message || e).slice(0, 120) });
          continue;
        }
      } else if (p.mode !== 'live') {
        closed = true; // paper close is always executable
      } else {
        // v7.0.2 CRITICAL FIX: never paper-simulate a LIVE close. The real
        // leveraged position stays open on the exchange — persist + retry.
        pushEntry(j, { kind: 'WATCH_ERROR', day: todayIST(), pair: p.pair, market: 'FUTURES', reason: `LIVE ${close.kind} exit BLOCKED (no exchange position id / CoinDCX disconnected) — NOT paper-closing, will retry` });
        dirty = true; watchErrors.push({ pair: p.pair, reason: `live ${close.kind} exit blocked (no id/creds) — retrying` });
        continue;
      }
      if (!closed) continue;

      const usdInr = await fetchUsdInr();
      const pnlUSDT = (long ? price - p.entryPrice : p.entryPrice - price) * p.qty;
      p.status = 'CLOSED'; p.closedAt = Date.now(); p.closePrice = price;
      p.pnlUSDT = r2(pnlUSDT); p.pnlINR = inrOfUsdt(pnlUSDT, usdInr);
      p.closeReason = close.reason;
      try { settlePositionOutcome(p, close.reason); } catch { /* best-effort */ }
      dirty = true;
      pushEntry(j, { kind: 'CLOSE', day: todayIST(), pair: p.pair, market: 'FUTURES', mode: p.mode, source: p.source, qty: p.qty, entryPrice: p.entryPrice, closePrice: price, pnlUSDT: p.pnlUSDT, pnlINR: p.pnlINR, reason: close.reason });
      closures.push({ pair: p.pair, mode: p.mode, pnlINR: p.pnlINR, reason: close.reason });
    }

    // v12.8 REVERSAL: waiting windows — confirmed re-entry legs open
    // here, expired windows END the cycle (both journal-persisted).
    if (revCfg.enabled) {
      try {
        const rr = await rev.processReversalWaiting(j, byPair, revCtx);
        if (rr?.dirty) dirty = true;
      } catch (e) {
        pushEntry(j, { kind: 'WATCH_ERROR', day: todayIST(), market: 'FUTURES', reason: `reversal waiting pass error: ${String(e?.message || e).slice(0, 160)}` });
        dirty = true;
      }
    }

    if (dirty) saveJournalFresh(j);
    if (typeof sendTelegram === 'function' && (closures.length > 0 || watchErrors.length > 0)) {
      try {
        const fullClosures = closures.filter(c => !c.partial);
        const partialClosures = closures.filter(c => c.partial);
        await sendTelegram(`🤖 <b>AI Trading · Futures</b>\n${[
          ...fullClosures.map(c => `• ${c.pair} (${c.mode}) — ${c.reason}: ₹${c.pnlINR > 0 ? '+' : ''}${c.pnlINR}`),
          ...partialClosures.map(c => `💰 ${c.reason}`),
          ...watchErrors.map(c => `⚠️ ${c.pair} — ${c.reason}`),
        ].join('\n')}`);
      } catch { /* best-effort */ }
    }
    return closures;
  });
}

// ---------------- v7.0 PRO TRADER: partial close leg (futures desk) ----------------
/**
 * Books ONE partial take-profit leg on an agent FUTURES position (USDT
 * domain, INR twin at the live USDINR):
 *   • qty = pct% of the ORIGINAL entry qty (frozen at the first leg)
 *   • LIVE: partialFuturesExit → OPPOSITE-side market order for the
 *     fraction (positions/exit is full-exit only; the exchange nets
 *     the opposite order against the open position)
 *   • PAPER: simulated (always executable)
 *   • journals a PARTIAL_TP entry + stamps the tamper-evident ledger leg
 *   • edge cases identical to the spot desk: qty rounds to 0 → partials
 *     disabled for the position; remaining rounds to 0 → full book
 *     closes as the final leg.
 * Returns { ok, closedQty, legPnlINR, legPnlUSDT?, error?, disabled? }.
 */
async function partialCloseFuturesLeg(j, p, price, { stage, pct }) {
  try {
    const long = p.side === 'LONG';
    const originalQty = Number(p.originalQty) > 0 ? Number(p.originalQty) : Number(p.qty);
    // v20.9.1 [H3]: reconcile/manual-partial ne p.qty shrink ki ho to ORIGINAL
    // ka pct dobara bhejna over-close karta — opposite-side residual position
    // khul jati. Cap: pct% of original, par CURRENT qty se zyada kabhi nahi.
    const partialQty = roundFuturesQty(p.pair, Math.min((originalQty * pct) / 100, Number(p.qty)));

    // too small to slice at instrument precision → tiered exits off
    if (!(partialQty > 0)) {
      p.partialTpOff = true;
      pushEntry(j, {
        kind: 'WATCH_ERROR', day: todayIST(), pair: p.pair, market: 'FUTURES',
        reason: `partial TP disabled for this position — ${pct}% of ${originalQty} rounds to 0 at ${p.pair} precision (classic full TP2 exit applies)`,
      });
      return { ok: false, disabled: true, error: 'qty rounds to 0' };
    }

    // LIVE: move the fraction on the exchange BEFORE booking anything
    if (p.mode === 'live') {
      if (!coindcxConnected()) {
        // v20.9.1 [H2]: LIVE + disconnected pe paper-book KABHI NAHI — leg
        // book hua to journal/PnL/daily-cap jhooth bolte jabki exchange
        // position untouched hai (file ka apna "never paper-simulate a LIVE
        // close" discipline hi partial path pe toota tha).
        pushEntry(j, { kind: 'WATCH_ERROR', day: todayIST(), pair: p.pair, market: 'FUTURES', reason: `LIVE ${stage} partial BLOCKED (CoinDCX disconnected) — NOT paper-booking the leg, will retry` });
        return { ok: false, error: 'LIVE partial blocked (no CoinDCX connection) — retrying next pass' };
      }
      const xr = await partialFuturesExit({ pair: p.pair, qty: partialQty, side: p.side, leverage: p.leverage });
      // v20.9.1 [H1-class]: 200-wrapped rejection ({orderId:null,error})
      // resolve hota hai, throw nahi — verdict ignore karke leg book karna
      // = phantom T1 latch + BE-lock + bookedPnl jabki exchange unchanged.
      if (!xr?.orderId || xr?.error) {
        return { ok: false, error: `exchange rejected ${stage} partial: ${String(xr?.error || 'no order id').slice(0, 160)}` };
      }
    }

    // ---- book the leg (USDT domain + INR twin) ----
    const usdInr = await fetchUsdInr();
    const legPnlUSDT = (long ? price - p.entryPrice : p.entryPrice - price) * partialQty;
    const legPnlINR = inrOfUsdt(legPnlUSDT, usdInr);
    p.originalQty = originalQty;
    // remaining qty rounds at the INSTRUMENT precision (r2 would eat
    // sub-0.01 runners alive: 0.006 → 0.01)
    p.qty = roundFuturesQty(p.pair, Number(p.qty) - partialQty);
    p.bookedPnlUSDT = r2((Number(p.bookedPnlUSDT) || 0) + legPnlUSDT);
    p.bookedPnlINR = r2((Number(p.bookedPnlINR) || 0) + legPnlINR);
    if (stage === 'T1') p.tp1Hit = true;
    if (stage === 'T2') p.tp2Hit = true;
    p.exitStage = exitStageOf(p);

    // remaining book too small to keep? → this leg closes the position
    if (!(Number(p.qty) > 0)) {
      p.status = 'CLOSED';
      p.closedAt = Date.now();
      p.closePrice = price;
      p.pnlUSDT = 0; // fully realized via partial legs (bookedPnlUSDT carries it)
      p.pnlINR = 0;
      p.closeReason = `PARTIAL TP (${stage}) closed the full book`;
      try { settlePositionOutcome(p, p.closeReason); } catch { /* best-effort */ }
      pushEntry(j, {
        kind: 'CLOSE', day: todayIST(), pair: p.pair, market: 'FUTURES', mode: p.mode, source: p.source,
        qty: 0, entryPrice: p.entryPrice, closePrice: price, pnlUSDT: 0, pnlINR: 0,
        reason: `${stage} leg closed the full remaining book (qty too small to split)`,
      });
    }

    pushEntry(j, {
      kind: 'PARTIAL_TP', day: todayIST(), pair: p.pair, mode: p.mode, market: 'FUTURES',
      source: p.source, stage,
      qty: partialQty, price: r2(price), pnlUSDT: r2(legPnlUSDT), pnlINR: r2(legPnlINR),
      remainingQty: p.qty, bookedPnlINR: p.bookedPnlINR, exitStage: p.exitStage,
      reason: `${stage} partial: closed ${pct}% (${partialQty} of ${originalQty}) @ ${r2(price)} — booked ${r2(legPnlUSDT)} USDT / ₹${r2(legPnlINR)} · remaining ${p.qty}`,
    });
    try { markPartialOutcome(p.ledgerEntryId, { stage, qty: partialQty, price, pnlINR: legPnlINR }); } catch { /* best-effort */ }

    return { ok: true, closedQty: partialQty, legPnlINR: r2(legPnlINR), legPnlUSDT: r2(legPnlUSDT), remainingQty: p.qty };
  } catch (e) {
    // v20.3 AMBIGUOUS-RETRY GUARD: a timeout/abort/network failure on the
    // LIVE market order means the partial MAY have filled — re-sending it
    // every 60s would slice the book again (40% + 40% + …). Park the
    // partial gates for 5 minutes and let the 60s reconcile pass settle
    // the exchange's qty truth first (the exchange IS reachable between
    // hiccups; a definitive HTTP 4xx/5xx rejection is safe to retry).
    if (p.mode === 'live' && isAmbiguousTransportError(e)) {
      p.partialRetryAfter = Date.now() + 5 * 60_000;
      try {
        pushEntry(j, {
          kind: 'WATCH_ERROR', day: todayIST(), pair: p.pair, market: 'FUTURES',
          reason: `partial ${stage} order AMBIGUOUS (${String(e?.message || e).slice(0, 120)}) — 5 min retry hold (double-sell guard; reconcile pass will sync exchange qty)`,
        });
      } catch { /* best-effort journal */ }
    }
    return { ok: false, error: String(e?.message || e) };
  }
}

// ---------------- manual close ----------------
export async function closeFuturesPosition(positionId) {
  return withJournalLock(async () => {
    const j = loadJournalFresh();
    const p = j.positions.find(x => x.id === positionId || x.exchangePositionId === positionId);
    if (!p || (p.status !== 'OPEN' && p.status !== 'UNKNOWN')) return { ok: false, error: 'Position not found / already closed' };
    const prices = await fetchFuturesPrices().catch(() => null);
    const ltp = (prices || []).find(x => x.pair === p.pair)?.last;
    // v7.0.2: no live price → HONEST reject. The old `|| p.entryPrice`
    // booked a fake ₹0-P&L close for a trade that really moved money
    // (and silently understated the daily-loss cap).
    if (!(ltp > 0)) {
      return { ok: false, error: `No live futures price for ${p.pair} — thodi der baad try karo (honest close, no fake P&L)` };
    }
    // v7.0.2: LIVE without id/connection → reject honestly (reconciler
    // adopts the id on its next pass). Never book a paper close for it.
    if (p.mode === 'live' && (!p.exchangePositionId || !coindcxConnected())) {
      return { ok: false, error: 'LIVE position without exchange connection/id — reconcile ho raha hai, kuch second baad retry karo' };
    }
    if (p.mode === 'live' && p.exchangePositionId && coindcxConnected()) {
      try {
        const xr = await exitFuturesPosition(p.exchangePositionId);
        // v20.9.1 [H1]: wrapped rejection pehle silently pass hota tha —
        // user ko {ok:true} milta tha jabki close hua hi nahi.
        if (!xr?.ok) return { ok: false, error: `Exchange close failed: ${xr?.error || 'wrapped rejection (200 body)'}` };
      }
      catch (e) { return { ok: false, error: `Exchange close failed: ${e?.message || e}` }; }
    }
    const long = p.side === 'LONG';
    const usdInr = await fetchUsdInr();
    const pnlUSDT = (long ? ltp - p.entryPrice : p.entryPrice - ltp) * p.qty;
    p.status = 'CLOSED'; p.closedAt = Date.now(); p.closePrice = ltp;
    p.pnlUSDT = r2(pnlUSDT); p.pnlINR = inrOfUsdt(pnlUSDT, usdInr);
    p.closeReason = 'Manual close';
    try { settlePositionOutcome(p, 'Manual close'); } catch { /* best-effort */ }
    pushEntry(j, { kind: 'CLOSE', day: todayIST(), pair: p.pair, market: 'FUTURES', mode: p.mode, source: p.source, qty: p.qty, entryPrice: p.entryPrice, closePrice: ltp, pnlUSDT: p.pnlUSDT, pnlINR: p.pnlINR, reason: 'Manual close' });
    saveJournalFresh(j);
    return { ok: true, position: p };
  });
}

// ---------------- futures markets view (UI) ----------------
/** Top futures markets by 24h volume + our universe rows first. */
export async function futuresMarketsView(limit = 24) {
  const rows = await fetchFuturesPrices().catch(() => []);
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: 'Futures market data unreachable right now', markets: [] };
  }
  const universeSet = new Set(FUTURES_UNIVERSE);
  const sorted = rows.slice().sort((a, b) => {
    const au = universeSet.has(a.base) ? 1 : 0, bu = universeSet.has(b.base) ? 1 : 0;
    if (au !== bu) return bu - au;
    return (b.volume || 0) - (a.volume || 0);
  }).slice(0, limit);
  return {
    ok: true, count: rows.length,
    markets: sorted.map(m => ({
      pair: m.pair, base: m.base, last: m.last, mark: m.mark, changePct: m.changePct,
      high: m.high, low: m.low, volumeUSDT: m.volume,
    })),
    fetchedAt: Date.now(),
  };
}

// ---------------- test hooks ----------------
export function __resetFuturesForTests() {
  _pricesCache = null; _pricesAt = 0; _pricesInflight = null;
  _synthDownUntil = 0; // v11.3: the Binance/Bybit synth negative cache
  _instrumentsCache = null; _instrumentsAt = 0;
  _instrumentMetaCache = new Map();
  _walletsTransport.mode = null;
  _walletsTransport.coolUntil = 0;
  _walletsTransport.probesSinceSweep = 0; // v20.8.5: gap fix — counter file-wide accumulate hota tha, 10 pe forceSweep cooldown-bypass karke call-count locks todta tha
  _scopeProbe = null; // v12.2: the cached key-scope verdict
  _scopeProbeInflight = null;
  _walletLegBudgetMs = WALLET_LEG_BUDGET_MS;
  _usdInr = null; _usdInrAt = 0;
  _walletSnapCache = null; _walletSnapInflight = null; // v20.8.5: snapshot mini-cache
}
export function __setUsdInrForTests(v) { _usdInr = v; _usdInrAt = Date.now(); }
/** v10.14 test hook: shrink the wallet-leg deadline so budget tests run in ms. */
export function __setWalletLegBudgetForTests(ms) { _walletLegBudgetMs = Math.max(1, Number(ms) || WALLET_LEG_BUDGET_MS); }
/** v12.2 test hook: the wallet-transport probe state (sticky rung,
 *  cooldown armed?, last key-scope verdict) for reconnect-reset locks. */
export function __walletTransportStateForTests() {
  return {
    mode: _walletsTransport.mode,
    cooling: Date.now() < _walletsTransport.coolUntil,
    scopeVerdict: _scopeProbe?.verdict || null,
  };
}
export { inrOfUsdt };
