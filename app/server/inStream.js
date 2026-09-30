// ============================================================
// inStream — server-side INDIA equity/ETF push into liveFeed (/api/stream)
// ------------------------------------------------------------
// 2026 realtime audit (RC5): the main SSE stream previously had ZERO
// server-side sources for Indian equities — only US_ (Finnhub) and crypto
// IN_ (CoinDCX) ticks were written to liveFeed. India realtime relied
// entirely on the browser TradingView WebSocket, which is blocked on many
// office/campus networks → "India prices not streaming" in those conditions.
//
// This module closes that gap with the same self-managing lifecycle as
// cryptoStream: polls Groww NSE live quotes every 3s ONLY while SSE clients
// are connected AND the NSE window is open (09:15–15:40 IST). Indices
// (NIFTY/BANKNIFTY/… — Groww has no index quotes) fall back to Yahoo.
// Outside NSE hours a one-shot refresh per newly-subscribed symbol still
// seeds the SSE snapshot so a freshly-loaded site paints India prices.
//
// All upstream calls go through the injected deps from index.js, which are
// 3s micro-cached there — the 3s poll is shared with the browser pollers,
// so N SSE clients still cost ONE upstream round-trip per symbol.
// ============================================================
import { setTick } from './liveFeed.js';

// 2026-09 ultra-fast pass: 5s → 3s — India ticks at the same cadence as the
// US TV-batch stream. Upstream cost is absorbed by the shared 3s Groww
// micro-cache in index.js, so N SSE clients still cost ONE round-trip/symbol.
const POLL_MS = 3000;
const BACKOFF_MS = 30000;
const FAILURE_STREAK_LIMIT = 3;
const BATCH = 24;
// v10.13 (deep-recheck M8): fresh-symbol one-shot refreshes run through a
// bounded semaphore (usStream's BOOT_CONCURRENCY pattern). A first page-load
// subscribing ~60 India symbols used to fire 60 PARALLEL Groww round-trips
// (each with its own ~300-500ms retry + 5s timeout → up to ~10.4s of burst)
// — burst CPU + rate-limit exposure exactly at page-load. 6 at a time, the
// rest queue behind it (the 3s poll loop covers them anyway).
const FRESH_CONCURRENCY = 6;

// Crypto bases are owned by cryptoStream (IN_BTC etc.) — never poll them here.
const CRYPTO_BASES = new Set(['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'DOT', 'MATIC', 'LINK', 'UNI']);

// v10.12.1 FIX (deep-recheck live find): indices have NO honest Groww quote —
// Groww's CASH/<INDEX> endpoint serves a garbage STALE ltp for index names
// (observed live on the /api/stream wire: 19425.35 with lastTradeTime from
// Nov-2023 while Yahoo's ^NSEI was current — the same v9.5 note that made
// intraday/stream.js route indices to Yahoo). /api/quote already skips Groww
// for INDIAN_INDICES; the inStream poller MUST do the same or the SSE push
// serves a WRONG price tagged 'groww-live' — the exact opposite of the
// v10.12 honest-badge goal. Set = union of stream.js INDEX_SYMBOLS and
// index.js INDIAN_INDICES (every name has a YF_INDEX_MAP entry).
const INDEX_SYMBOLS = new Set([
  'NIFTY', 'NIFTY50', 'BANKNIFTY', 'NIFTYBANK', 'SENSEX', 'INDIAVIX',
  'CNXIT', 'FINNIFTY', 'MIDCPNIFTY', 'NIFTYNXT50',
]);

let _deps = null;               // { fetchGrowwNseQuote, fetchYahooQuote, toYahooSymbol }
const _subscribed = new Set();  // clean NSE symbols (RELIANCE, NIFTY, …)
const _refcounts = new Map();   // sym -> interested SSE clients (2026 perf audit M2)
const _evictTimers = new Map(); // sym -> pending unsubscribe timer
let _timer = null;
let _openTimer = null; // one-shot "retry at the next NSE window open"
let _activeClients = 0;
let _failureStreak = 0;
let _ticking = false; // v10.13 (deep-recheck L1): poll re-entrancy guard

// ---------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------

// 2026 perf audit (L2): hoisted stateless formatter — was rebuilt on every
// nseWindow() call (10-30/s on the hot poll path).
const _istFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
});

/** NSE session window (with 15:40 reconcile grace), IST, Mon-Fri. */
export function nseWindow(date = new Date()) {
  const parts = _istFmt.formatToParts(date);
  const get = (t) => parts.find(p => p.type === t)?.value || '';
  const weekday = get('weekday').substring(0, 3);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  let h = parseInt(get('hour'), 10);
  if (isNaN(h) || h === 24) h = 0;
  const m = parseInt(get('minute'), 10) || 0;
  const mins = h * 60 + m;
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 40;
}

// Test hooks
export function _resetInStreamForTest() {
  _stop();
  _subscribed.clear();
  _refcounts.clear();
  for (const t of _evictTimers.values()) clearTimeout(t);
  _evictTimers.clear();
  if (_openTimer) { clearTimeout(_openTimer); _openTimer = null; }
  _activeClients = 0; _failureStreak = 0;
}
export function inDebugState() {
  return { activeClients: _activeClients, subscribed: [..._subscribed], timer: !!_timer, failureStreak: _failureStreak };
}

export function initInStream(deps) {
  _deps = deps || {};
}

// ---------------------------------------------------------------
// Quote fetch: Groww first (genuine NSE LTP, stocks + ETFs), Yahoo for
// indices / Groww misses. Both are micro-cached in index.js (3s shared).
//
// v10.12 (#1 source transparency): every tick carries WHICH upstream
// served it — the wire label is liveFeed's `source` field and the values
// are the plan's canonical India tags:
//   'groww-live'      Groww NSE served the tick (the app-parity LTP)
//   'yahoo-delayed'   the Yahoo fallback served it (indices — Groww has
//                     no index quotes — or a Groww miss)
// The browser maps them to the Groww·live / Yahoo·delayed pills via
// LiveSourceBadge; the TradingView browser socket tags its own ticks
// 'tv-ws' (tvWebsocket.ts) so all three India paths are honest.
// ---------------------------------------------------------------
async function _fetchInQuote(sym) {
  // v10.12.1: indices skip Groww ENTIRELY (garbage stale ltp — see the
  // INDEX_SYMBOLS note above) and go straight to the Yahoo fallback, which
  // serves them honestly labeled 'yahoo-delayed'.
  if (!INDEX_SYMBOLS.has(sym) && typeof _deps?.fetchGrowwNseQuote === 'function') {
    try {
      const q = await _deps.fetchGrowwNseQuote(sym);
      if (q && q.price > 0) return { q, source: 'groww-live' };
    } catch { /* fall through */ }
  }
  if (typeof _deps?.fetchYahooQuote === 'function' && typeof _deps?.toYahooSymbol === 'function') {
    try {
      const ysym = _deps.toYahooSymbol(sym, 'IN');
      const q = await _deps.fetchYahooQuote(ysym);
      if (q && q.price > 0) return { q, source: 'yahoo-delayed' };
    } catch { /* give up this round */ }
  }
  return null;
}

function _pushTick(sym, q, source) {
  setTick(`IN_${sym}`, {
    price: q.price,
    change: typeof q.change === 'number' ? q.change : 0,
    high: q.high || q.price,
    low: q.low || q.price,
    volume: q.volume || 0,
    time: q.time || Date.now(),
    prevClose: q.prevClose, // Groww: ltp - dayChange; Yahoo: previousClose
  }, source);
}

/** One-shot refresh — used for fresh subscriptions (incl. after-hours snapshot). */
async function _refreshSymbol(sym) {
  const got = await _fetchInQuote(sym);
  if (got) _pushTick(sym, got.q, got.source);
  return !!got;
}

// ---------------------------------------------------------------
// Client lifecycle (called from /api/stream)
// ---------------------------------------------------------------
export function inClientUp() {
  _activeClients++;
  _startIfNeeded();
}
export function inClientDown() {
  _activeClients = Math.max(0, _activeClients - 1);
  if (_activeClients === 0) _stop();
}

function _startIfNeeded() {
  if (_timer || _subscribed.size === 0) return;
  if (!nseWindow()) {
    // Outside NSE hours: schedule a one-shot retry at the next window
    // open. Without this, a page connected pre-market (or a stream that
    // outlived the 15:40 close) keeps its SSE alive via keepalives but
    // the 3s loop NEVER starts — frozen India prices for the whole
    // session. inClientUp/ensureInSubscribed ran while the market was
    // closed and nothing would ever retry.
    _scheduleNextOpen();
    return;
  }
  _timer = setInterval(_tick, POLL_MS);
  if (typeof _timer.unref === 'function') _timer.unref();
  _tick(); // immediate first round
}

/** Minutes-until-open math in IST, weekday-aware (Mon-Fri). */
function _msUntilNextNseOpen(date = new Date()) {
  const parts = _istFmt.formatToParts(date);
  const get = (t) => parts.find(p => p.type === t)?.value || '';
  const weekday = get('weekday').substring(0, 3);
  let h = parseInt(get('hour'), 10);
  if (isNaN(h) || h === 24) h = 0;
  const m = parseInt(get('minute'), 10) || 0;
  const mins = h * 60 + m;
  const OPEN = 9 * 60 + 15;
  const dayIdx = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(weekday);
  let days = 0;
  if (dayIdx === 5) days = 2;        // Saturday → Monday
  else if (dayIdx === 6) days = 1;    // Sunday → Monday
  else if (mins >= OPEN) days = dayIdx === 4 ? 3 : 1; // post-session weekday (Fri → Mon)
  const waitMins = days * 24 * 60 + OPEN - mins;
  return Math.max(60_000, waitMins * 60_000);
}

function _scheduleNextOpen() {
  if (_openTimer || _timer) return;
  const ms = _msUntilNextNseOpen();
  _openTimer = setTimeout(() => {
    _openTimer = null;
    _startIfNeeded(); // starts the 3s loop if clients + subscriptions exist
  }, ms);
  if (typeof _openTimer.unref === 'function') _openTimer.unref();
}

function _stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  _failureStreak = 0;
  // Keep the next-open retry while clients remain connected (they need
  // the loop back at 09:15); drop it only when the last client is gone.
  if (_activeClients === 0 && _openTimer) { clearTimeout(_openTimer); _openTimer = null; }
}

// ---------------------------------------------------------------
// Poll loop
// ---------------------------------------------------------------
async function _tick() {
  // v10.13: a slow Groww round (24-symbol batches × retries) can exceed the
  // 3s interval — overlapping ticks stack upstream load exactly when the
  // upstream is unhealthy. Skip while one is still in flight.
  if (_ticking) return;
  _ticking = true;
  try {
    if (_activeClients === 0 || _subscribed.size === 0) return;
    if (!nseWindow()) { _stop(); _scheduleNextOpen(); return; }

    const symbols = [..._subscribed];
    let got = 0;
    for (let i = 0; i < symbols.length; i += BATCH) {
      const batch = symbols.slice(i, i + BATCH);
      const results = await Promise.allSettled(batch.map(s => _fetchInQuote(s)));
      results.forEach((r, idx) => {
        if (r.status === 'fulfilled' && r.value) {
          _pushTick(batch[idx], r.value.q, r.value.source);
          got++;
        }
      });
    }

    if (got === 0) {
      _failureStreak++;
      if (_failureStreak >= FAILURE_STREAK_LIMIT && _timer) {
        clearInterval(_timer);
        _timer = setInterval(_tick, BACKOFF_MS);
        if (typeof _timer.unref === 'function') _timer.unref();
      }
      return;
    }
    if (_failureStreak >= FAILURE_STREAK_LIMIT && _timer) {
      // Recovered — restore fast cadence.
      clearInterval(_timer);
      _timer = setInterval(_tick, POLL_MS);
      if (typeof _timer.unref === 'function') _timer.unref();
    }
    _failureStreak = 0;
  } catch (e) {
    console.warn('[in-stream] tick error:', e?.message);
  } finally {
    _ticking = false;
  }
}

// ---------------------------------------------------------------
// Subscription API (called from /api/stream with the `in` symbols)
// ---------------------------------------------------------------
export function ensureInSubscribed(symbols) {
  const fresh = [];
  for (const s of symbols || []) {
    const sym = String(s).replace('.NS', '').replace('.BO', '').trim().toUpperCase();
    if (!sym || CRYPTO_BASES.has(sym)) continue; // cryptoStream owns crypto keys
    // Refcount up + cancel pending eviction (2026 perf audit M2).
    if (_evictTimers.has(sym)) {
      clearTimeout(_evictTimers.get(sym));
      _evictTimers.delete(sym);
    }
    _refcounts.set(sym, (_refcounts.get(sym) || 0) + 1);
    if (!_subscribed.has(sym)) { _subscribed.add(sym); fresh.push(sym); }
  }
  // One-shot snapshot for fresh symbols (works even outside NSE hours —
  // Groww/Yahoo serve the last traded price, which is correct when closed).
  // v10.13: bounded concurrency (see FRESH_CONCURRENCY note above).
  const _freshSem = { active: 0, queue: [] };
  fresh.forEach(sym => {
    const run = () => { _refreshSymbol(sym).catch(() => { }).finally(() => {
      _freshSem.active--;
      while (_freshSem.queue.length && _freshSem.active < FRESH_CONCURRENCY) {
        _freshSem.active++;
        _freshSem.queue.shift()();
      }
    }); };
    if (_freshSem.active < FRESH_CONCURRENCY) { _freshSem.active++; run(); }
    else _freshSem.queue.push(run);
  });
  // If clients are already connected and the NSE window is open, ensure the
  // 3s loop covers the new symbols too.
  if (_activeClients > 0 && _subscribed.size > 0) _startIfNeeded();
}

/**
 * Refcount release (2026 perf audit M2) — mirrors usStream/cryptoStream: the
 * NSE symbol set used to grow for the whole process lifetime; now the last
 * interested client leaving schedules a graceful unsubscribe (survives
 * EventSource auto-reconnect blips).
 */
export function releaseInSubscribed(symbols) {
  for (const s of symbols || []) {
    const sym = String(s).replace('.NS', '').replace('.BO', '').trim().toUpperCase();
    if (!sym || CRYPTO_BASES.has(sym)) continue;
    const n = (_refcounts.get(sym) || 1) - 1;
    if (n > 0) { _refcounts.set(sym, n); continue; }
    _refcounts.delete(sym);
    if (_evictTimers.has(sym)) continue;
    const t = setTimeout(() => {
      _evictTimers.delete(sym);
      if (_refcounts.has(sym)) return; // re-subscribed meanwhile
      _subscribed.delete(sym);
    }, 90 * 1000);
    if (typeof t.unref === 'function') t.unref();
    _evictTimers.set(sym, t);
  }
}
