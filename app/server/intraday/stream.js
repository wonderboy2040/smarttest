// ============================================================
// intraday/stream — SSE live-quote push + outcome watcher
// ------------------------------------------------------------
// ONE shared watcher loop (5s cadence, failure-backoff to 30s):
//   symbols = latest scan signals ∪ open tracked signals ∪ open
//   paper trades → per-market quotes (Groww NSE for INDIA,
//   CoinDCX INR for CRYPTO) →
//     1. evaluate tracked-signal outcomes (T1/T2/SL/trail/EOD)
//     2. evaluate paper trades (auto-manage + square-off)
//     3. broadcast fresh quotes + outcome events to SSE clients
//     4. push outcome alerts to Telegram
//
// 2026-09 multi-market pass: the watcher runs while the NSE window
// is open OR any CRYPTO symbol is in the watch set (24/7 market).
// Regime frames are market-tagged: `regime` (NIFTY/VIX) and
// `crypto-regime` (BTC) — clients render the one they need.
//
// The watcher runs on its own during NSE hours (09:15–15:40 IST
// grace window) so the track record + Telegram outcome alerts work
// even with ZERO connected browser clients. SSE clients simply
// attach to the broadcast; N clients still cost ONE poller.
// ============================================================
import { istMinutes, getISTParts, istDayKey, dayKeyFor, isNseHoliday } from './time.js';
import { isCryptoSymbolBase } from './engine.js';
import { evaluateTracked, watcherSymbolsByMarket } from './trackRecord.js';
// v13.2 B6: SSE frame byte telemetry
import { trackSseWrite } from '../ai/bandwidth.js';
import { evaluatePaper, paperSymbolsByMarket, injectOptionPaperQuotes, optionUnderlyingsForWatcher, paperCircuitWatch } from './paperTrading.js';
import { getMarketRegime, getCryptoRegime } from './regime.js';

const POLL_MS = 5000;
const BACKOFF_MS = 30000;
const FAILURE_STREAK_LIMIT = 3;
// v9.5: index symbols the option paper-trades re-price from (Groww has
// no index quotes — these ride the Yahoo map in _fetchQuotes).
// v10.13 (deep-recheck L9): UNION with inStream's INDEX_SYMBOLS — the old
// 7-name subset let a paper trade on NIFTY50/NIFTYBANK/CNXIT fall through
// to Groww's garbage index ltp (the exact v10.12.1 bug class, verified live
// 19425-vs-23398). Every name here has a YF_INDEX_MAP entry.
const INDEX_SYMBOLS = new Set([
  'NIFTY', 'NIFTY50', 'BANKNIFTY', 'NIFTYBANK', 'SENSEX', 'INDIAVIX',
  'CNXIT', 'FINNIFTY', 'MIDCPNIFTY', 'NIFTYNXT50',
]);
// v9.4: 24 → 34. The watch set = paper ∪ scan ∪ tracked, and tracked rows
// accumulate through the day (MAX_PER_DAY=40). With the old 24 cap the
// paper symbols — inserted last — were the FIRST to be silently dropped
// once the desk had been running for a few hours, exactly the "paper
// trade lagane par realtime price fetch nahi ho raha" report: the
// position card froze at entry while the quotes ticked for everyone else.
// Groww calls ride the 3s micro-cache shared with /api/quote + the SSE
// poller, so 34 symbols × every 5s is still one digit % of the cache's
// dedupe budget.
const MAX_WATCH_NSE = 34;
const MAX_WATCH_CRYPTO = 14;

let _deps = null;               // { fetchGrowwNseQuote, fetchCoinDcxTickers, sendTelegramRaw, escapeHtml, dispatchOutcomeAlert }
// v10.13 (deep-recheck M4): per-market scan sets. The old single
// _scanSymbols was wholesale-replaced by EVERY completed scan — an India
// scan evicted the crypto scanner's signal symbols (and vice versa), so
// the other market's signal-card quotes froze until ITS next scan ran.
// Each market now owns its own set; _watchSet() unions both.
let _scanIndia = new Set();     // latest INDIA scan's published signal symbols
let _scanCrypto = new Set();    // latest CRYPTO scan's published signal symbols
let _latestQuotes = { data: {}, ts: 0, day: '', utcDay: '' };
let _clients = new Set();       // SSE response writers
let _timer = null;
let _currentPollMs = POLL_MS;
let _failureStreak = 0;
let _lastRegimePush = 0;
let _lastCryptoRegimePush = 0;
let _ticking = false; // v10.13 (deep-recheck L1): poll re-entrancy guard
let _lastSentQuotes = {}; // v12.10 BANDWIDTH: per-symbol dead-tick filter

function _debug() { return process.env.INTRADAY_DEBUG === '1'; }

// Weekday window: 09:15 → 15:40 IST (grace past close for EOD reconcile).
function _inWindow() {
  if (_debug()) return true;
  const { weekday } = getISTParts();
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  // v18.9: weekday HOLIDAYS — the v11.4 calendar existed only in the
  // scanner route; this watcher used to poll a frozen closed tape for
  // 6.5h on Republic Day / Diwali and evaluate paper/track outcomes
  // against frozen prints.
  try { if (isNseHoliday()) return false; } catch { /* fail-open: poll */ }
  const m = istMinutes();
  return m >= 9 * 60 + 15 && m <= 15 * 60 + 40;
}

export function initIntradayStream(deps) {
  _deps = deps || {};
  if (_timer) return;
  _timer = setInterval(_tick, POLL_MS);
  if (typeof _timer.unref === 'function') _timer.unref();
  console.log('[intraday-stream] watcher initialised (5s cadence, NSE-hours gated + 24/7 CRYPTO)');
}

export function setScanSymbols(symbols, market = 'INDIA') {
  const list = Array.isArray(symbols) ? symbols.map(s => String(s).toUpperCase()) : [];
  const isCrypto = String(market).toUpperCase() === 'CRYPTO';
  // v10.13 (M4): write ONLY this market's set — a scan for one market must
  // never evict the other market's symbols (see the _scanIndia note).
  // The crypto-base heuristic is kept for INDIA scans that somehow carry
  // crypto names (legacy rows) — those route to the crypto set so Groww is
  // never asked for a coin.
  if (isCrypto) {
    _scanCrypto = new Set(list);
  } else {
    _scanIndia = new Set(list.filter(s => !isCryptoSymbolBase(s)));
    // v11.4 recheck: UNION, not replace — assigning `new Set(strays)` here
    // evicted the real crypto scan set whenever an INDIA scan carried stray
    // crypto names (the exact bug class the v10.13 M4 note above forbids).
    const strays = list.filter(s => isCryptoSymbolBase(s));
    if (strays.length) _scanCrypto = new Set([..._scanCrypto, ...strays]);
  }
}

export function getLatestQuotes() {
  return _latestQuotes;
}

// ------------------------------------------------------------
// Watch-set assembly: symbol → market classification. Legacy rows
// (persisted before the market field existed) fall back to the
// crypto-base heuristic so BTC rows are never routed to Groww.
// v9.4 PRIORITY ORDER: PAPER first, then the latest scan, then
// tracked rows. Map preserves insertion order and _fetchQuotes slices
// to MAX_WATCH_NSE — the user's open paper positions have live P&L
// on screen, so they must be the LAST symbols anyone would drop when
// the tracked set fills up through the day.
// ------------------------------------------------------------
function _watchSet() {
  const symMarket = new Map();
  const mark = (sym, isCrypto) => {
    if (!sym) return;
    const s = String(sym).toUpperCase();
    if (!symMarket.has(s)) symMarket.set(s, isCrypto ? 'CRYPTO' : 'INDIA');
  };
  const paper = paperSymbolsByMarket();
  paper.india.forEach(s => mark(s, false));
  paper.crypto.forEach(s => mark(s, true));
  // v9.5: open OPTION paper trades need their UNDERLYING index spot
  // (NIFTY/SENSEX) for the BS premium re-pricing below. Indices skip
  // the Groww equity feed, so _fetchQuotes routes them to Yahoo.
  optionUnderlyingsForWatcher().forEach(s => mark(s, false));
  // v11.4 recheck: TRACKED rows come BEFORE the scan set. _fetchQuotes
  // slices to MAX_WATCH_NSE (34) — with tracked LAST, a busy day (10 paper
  // + 5 scan + 40 tracked) starved the last ~21 tracked rows of quotes,
  // so their SL/T1/T2 outcomes were never evaluated and the rows turned
  // into reconcile zombies. A tracked row is an open accountability
  // position — same priority class as a paper trade; the scan set is a
  // signal-refresh nicety and can absorb the cut.
  const tracked = watcherSymbolsByMarket();
  tracked.india.forEach(s => mark(s, false));
  tracked.crypto.forEach(s => mark(s, true));
  // v10.13 (M4): union of BOTH markets' scan sets — neither scan evicts the
  // other's symbols any more.
  _scanIndia.forEach(s => mark(s, false));
  _scanCrypto.forEach(s => mark(s, true));
  return symMarket;
}

// v9.4: test hook — the watch-set ORDER is a user-facing contract now
// (paper trades must always receive quotes). Exposed for the
// regression suite; production code uses _watchSet directly.
export function watchSetForTests() {
  return _watchSet();
}

async function _fetchQuotes(symMarket) {
  const out = {};
  const india = [];
  const crypto = [];
  for (const [sym, mkt] of symMarket.entries()) {
    (mkt === 'CRYPTO' ? crypto : india).push(sym);
  }

  // INDIA: Groww NSE quotes (≤34 watcher symbols in ONE parallel round —
  // the server-side Groww micro-cache de-dupes these against the
  // /api/quote poll flood).
  // v10.12 (#1 source transparency): every quote is tagged with the
  // upstream that actually served it — the intraday signal cards render
  // the Groww·live / Yahoo·delayed pill from this field (LiveQuote.src →
  // LiveSourceBadge). Groww → 'groww-live'; indices below → 'yahoo-delayed';
  // crypto → 'coindcx-inr'.
  if (india.length && typeof _deps.fetchGrowwNseQuote === 'function') {
    for (let i = 0; i < Math.min(india.length, MAX_WATCH_NSE); i += 24) {
      const batch = india.slice(i, i + 24);
      await Promise.allSettled(batch.map(async (sym) => {
        try {
          const q = await _deps.fetchGrowwNseQuote(sym);
          // v11.1 GAP 2: Groww's day price band (upper/lower circuit) rides
          // the quote through to the circuit-limit watch — same fetch,
          // zero extra upstream cost. Absent bands → fields simply omitted.
          if (q && q.price > 0) out[sym] = {
            price: q.price, change: q.change ?? 0, ts: Date.now(), src: 'groww-live',
            ...(q.upperCircuit > 0 && q.lowerCircuit > 0 ? { upperCircuit: q.upperCircuit, lowerCircuit: q.lowerCircuit } : {}),
          };
        } catch { /* skip */ }
      }));
    }
  }

  // v9.5: INDEX symbols (NIFTY/SENSEX — needed by open OPTION paper
  // trades) have no honest Groww equity quote — Groww's CASH/NIFTY
  // endpoint actually serves a garbage ltp for the index name (observed
  // live: 19425 when ^NSEI was 23398). Yahoo's index tickers are the
  // truth here, so they OVERRIDE anything Groww set for indices.
  if (typeof _deps.fetchIndexSpot === 'function') {
    await Promise.allSettled(india.filter(s => INDEX_SYMBOLS.has(s)).map(async (sym) => {
      try {
        const q = await _deps.fetchIndexSpot(sym);
        // fetchIndexSpot = the Yahoo index fetcher (^NSEI etc.) — honestly
        // labeled 'yahoo-delayed' (Groww serves stocks/ETFs only, and its
        // CASH/NIFTY endpoint serves a garbage index ltp — see the v9.5 note
        // above, verified live 19425 vs 23398).
        if (q?.price > 0) out[sym] = { price: q.price, change: q.change ?? 0, ts: Date.now(), src: 'yahoo-delayed' };
      } catch { /* skip */ }
    }));
  }

  // CRYPTO: CoinDCX INR quotes — ONE shared 2s-cached ticker round-trip
  // (same cache the live /api/crypto-prices + SSE price stream use).
  if (crypto.length && typeof _deps.fetchCoinDcxTickers === 'function') {
    try {
      const tickers = await _deps.fetchCoinDcxTickers();
      const byMkt = new Map();
      for (const t of tickers) byMkt.set(t.market, t);
      for (const sym of crypto.slice(0, MAX_WATCH_CRYPTO)) {
        const t = byMkt.get(`${sym}INR`);
        const price = parseFloat(t?.last_price);
        if (price > 0) {
          out[sym] = { price, change: parseFloat(t.change_24_hour) || 0, ts: Date.now(), src: 'coindcx-inr' };
        }
      }
    } catch { /* CoinDCX transient */ }
  }
  return out;
}

async function _tick() {
  // v10.13 (deep-recheck L1): re-entrancy guard — a slow quote round can
  // exceed the 5s interval; overlapping ticks stack upstream load exactly
  // when the upstream is unhealthy.
  if (_ticking) return;
  _ticking = true;
  try {
    const symMarket = _watchSet();
    const hasCrypto = [...symMarket.values()].includes('CRYPTO');
    // Run while the NSE window is open OR any crypto symbol is watched (24/7).
    if (!_inWindow() && !hasCrypto) return;
    if (symMarket.size === 0) return;

    const quotes = await _fetchQuotes(symMarket);
    const got = Object.keys(quotes).length;
    if (got === 0) {
      _failureStreak++;
      if (_failureStreak >= FAILURE_STREAK_LIMIT) {
        // Back off: clear the timer and retry slowly until success.
        clearInterval(_timer);
        _currentPollMs = BACKOFF_MS;
        _timer = setInterval(_tick, BACKOFF_MS);
        if (typeof _timer.unref === 'function') _timer.unref();
      }
      return;
    }
    if (_failureStreak >= FAILURE_STREAK_LIMIT) {
      // Recovered — restore fast cadence.
      clearInterval(_timer);
      _currentPollMs = POLL_MS;
      _timer = setInterval(_tick, POLL_MS);
      if (typeof _timer.unref === 'function') _timer.unref();
    }
    _failureStreak = 0;

    // Idle backoff: when no SSE clients are listening and NSE window is closed,
    // slow down watcher to 30s so 24/7 crypto doesn't hammer outbound bandwidth when unused
    if (_clients.size === 0 && !_inWindow() && _failureStreak === 0) {
      if (_currentPollMs !== BACKOFF_MS) {
        clearInterval(_timer);
        _currentPollMs = BACKOFF_MS;
        _timer = setInterval(_tick, BACKOFF_MS);
        if (typeof _timer.unref === 'function') _timer.unref();
      }
    } else if ((_clients.size > 0 || _inWindow()) && _currentPollMs !== POLL_MS && _failureStreak === 0) {
      clearInterval(_timer);
      _currentPollMs = POLL_MS;
      _timer = setInterval(_tick, POLL_MS);
      if (typeof _timer.unref === 'function') _timer.unref();
    }

    // v9.5 F&O: re-price open OPTION paper trades (BS model on the live
    // underlying spot) and inject their premiums into this tick's quotes
    // BEFORE the latest-quotes merge + evaluation — SL/T1/T2/EOD, P&L and
    // manual close (getLatestQuotes) then see them like any equity LTP.
    try { await injectOptionPaperQuotes(quotes, _deps.fetchIndexSpot); } catch (e) { console.warn('[intraday-stream] option reprice:', e?.message); }

    // 2026 perf audit (M2): reset at the IST day boundary (NSE session) AND
    // the UTC day boundary (crypto session) — each market starts its own
    // session with a clean, live-only map.
    const today = istDayKey();
    const utcDay = dayKeyFor('CRYPTO');
    if (_latestQuotes.day !== today || _latestQuotes.utcDay !== utcDay) {
      _latestQuotes = { data: {}, ts: 0, day: today, utcDay };
      _lastSentQuotes = {};
    }
    _latestQuotes = { data: { ..._latestQuotes.data, ...quotes }, ts: Date.now(), day: today, utcDay };
    // v10.13 (deep-recheck L7): prune departed symbols. The map was
    // merge-only — symbols that left the watch set kept their frozen last
    // quote forever and a fresh client's initial snapshot served them as if
    // live. A key absent from the CURRENT watch set for >10 minutes can
    // never refresh again — drop it (paper/tracked legs are always in the
    // watch set, so live positions are never pruned).
    {
      const cutoff = Date.now() - 10 * 60 * 1000;
      for (const k of Object.keys(_latestQuotes.data)) {
        if (!symMarket.has(k) && (_latestQuotes.data[k]?.ts || 0) < cutoff) {
          delete _latestQuotes.data[k];
        }
      }
    }

    // Outcome evaluation (tracked signals + paper trades).
    const events = [];
    try { evaluateTracked(quotes, events); } catch (e) { console.warn('[intraday-stream] track eval:', e?.message); }
    try { evaluatePaper(quotes, events); } catch (e) { console.warn('[intraday-stream] paper eval:', e?.message); }
    // v11.1 GAP 2: circuit-limit watch — open equity paper positions
    // drifting toward an ADVERSE circuit (LONG→lower / SHORT→upper)
    // emit URGENT CIRCUIT_RISK events (10-min per-symbol cooldown).
    // Rides the SAME quotes the watcher already fetched — zero extra
    // upstream cost; inert when Groww serves no bands for a symbol.
    try { paperCircuitWatch(quotes, events); } catch (e) { console.warn('[intraday-stream] circuit watch:', e?.message); }

    // v12.10 BANDWIDTH: Only broadcast quotes that changed (|Δprice| ≥ 0.05% or new).
    // The client merges incoming updates into its livePrices map, so sending only changed
    // rows cuts ~95% of egress on this 5s stream.
    if (_clients.size > 0) {
      const changed = {};
      for (const [sym, q] of Object.entries(quotes)) {
        const prev = _lastSentQuotes[sym];
        const price = Number(q?.price);
        if (!prev || !Number.isFinite(prev.price) || (Number.isFinite(price) && Math.abs(price - prev.price) / (prev.price || 1) >= 0.0005)) {
          changed[sym] = q;
          _lastSentQuotes[sym] = { price, ts: Date.now() };
        }
      }
      if (Object.keys(changed).length > 0) {
        _broadcast('quotes', changed);
      }
    }
    for (const ev of events) {
      _broadcast('outcome', ev);
      if (typeof _deps.dispatchOutcomeAlert === 'function') {
        _deps.dispatchOutcomeAlert(ev, {
          sendTelegramRaw: _deps.sendTelegramRaw,
          escapeHtml: _deps.escapeHtml,
        }).catch(() => { });
      }
    }

    // Regime pushes every 60s — NIFTY (India) + BTC (crypto), tagged.
    if (Date.now() - _lastRegimePush > 60 * 1000) {
      _lastRegimePush = Date.now();
      getMarketRegime(_debug()).then(r => { if (r) _broadcast('regime', r); }).catch(() => { });
    }
    if (Date.now() - _lastCryptoRegimePush > 60 * 1000) {
      _lastCryptoRegimePush = Date.now();
      getCryptoRegime(_debug()).then(r => { if (r) _broadcast('crypto-regime', r); }).catch(() => { });
    }
  } catch (e) {
    console.warn('[intraday-stream] tick error:', e?.message);
  } finally {
    _ticking = false;
  }
}

function _broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const write of _clients) {
    try { write(payload); } catch { /* client gone */ }
  }
}

// ------------------------------------------------------------
// SSE endpoint handler — attach to express: app.get('/api/intraday-stream', intradayStreamHandler)
// ------------------------------------------------------------
export function intradayStreamHandler(req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (res.flushHeaders) res.flushHeaders();
  res.write('retry: 3000\n\n');

  const write = trackSseWrite('sse:intraday', (payload) => {
    // 2026 perf audit (H1): backpressure guard — a stalled client (phone
    // sleep / zero-window TCP) makes Node buffer every SSE write forever.
    // Kill the connection once the socket buffer exceeds 128KB; the browser
    // EventSource auto-reconnects when it wakes.
    try {
      const ok = res.write(payload);
      if (ok || !res.socket || res.socket.writableLength <= 128 * 1024) return true;
      try { _clients.delete(write); res.destroy(); } catch { /* noop */ }
      return false;
    } catch {
      return false;
    }
  });
  _clients.add(write);
  // Restore fast 5s cadence if watcher was in idle backoff
  if (_currentPollMs !== POLL_MS && _failureStreak === 0) {
    clearInterval(_timer);
    _currentPollMs = POLL_MS;
    _timer = setInterval(_tick, POLL_MS);
    if (typeof _timer.unref === 'function') _timer.unref();
  }

  // Initial snapshot so a fresh client paints instantly.
  try {
    if (_latestQuotes.ts > 0) {
      write(`event: quotes\ndata: ${JSON.stringify(_latestQuotes.data)}\n\n`);
      // v18.5 FIX: seed the dead-tick map from the snapshot we just sent —
      // otherwise the very next _tick sees every watch-set symbol as
      // "changed" vs a stale/empty _lastSentQuotes and re-broadcasts the
      // full frame to ALL clients (one duplicate full frame per connect).
      for (const [sym, q] of Object.entries(_latestQuotes.data || {})) {
        const price = Number(q?.price);
        if (Number.isFinite(price)) _lastSentQuotes[sym] = { price, ts: Date.now() };
      }
    }
    write(`event: status\ndata: ${JSON.stringify({ watcher: _inWindow() ? 'live' : 'idle', clients: _clients.size, ts: Date.now() })}\n\n`);
    getMarketRegime(_debug()).then(r => { if (r) write(`event: regime\ndata: ${JSON.stringify(r)}\n\n`); }).catch(() => { });
    getCryptoRegime(_debug()).then(r => { if (r) write(`event: crypto-regime\ndata: ${JSON.stringify(r)}\n\n`); }).catch(() => { });
  } catch { /* client gone */ }

  const keepalive = setInterval(() => {
    try {
      write(`event: status\ndata: ${JSON.stringify({ watcher: _inWindow() ? 'live' : 'idle', clients: _clients.size, ts: Date.now() })}\n\n`);
    } catch { /* noop */ }
  }, 15000);
  if (typeof keepalive.unref === 'function') keepalive.unref();

  req.on('close', () => {
    clearInterval(keepalive);
    _clients.delete(write);
    try { res.end(); } catch { /* noop */ }
  });
}
