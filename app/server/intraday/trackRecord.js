// ============================================================
// intraday/trackRecord — signal accountability engine
// ------------------------------------------------------------
// Every published scanner signal is PERSISTED and then tracked to
// its outcome against live prices (via the stream.js watcher):
//   OPEN → (SL first) SL_HIT
//   OPEN → (T1) PARTIAL: book 50% at T1, trail rest to breakeven
//          → then BE_TRAIL_EXIT | T2_HIT | SL_HIT(breakeven floor)
//   15:25 IST / market close → EOD_EXIT at last price
//
// P&L model mirrors the site's own execution discipline:
//   qty = qtyPerLakh (1% risk sizing per ₹1L capital)
//   disciplined pnl = 50%×(T1−entry) + 50%×(exit−entry)  [if T1 hit]
//                   = 100%×(exit−entry)                   [otherwise]
//   rMultiple = pnl / (qty × riskPerShare)
//
// Persistence: server/data/tracked-signals.json (atomic writes,
// survives restarts). Stale OPEN rows from previous days are
// reconciled on boot.
// ============================================================
import { loadJSON, saveJSON } from './store.js';
import { istDayKey, istMinutes, isNseMarketOpen, dayKeyFor } from './time.js';
import { isCryptoSymbolBase } from './engine.js';
// v10.3.1: encrypted durable mirror (paper-trades already had the raw
// scheduleBackup; the track record now rides the same encrypted
// durableBootRestore path as the trading journal) — a Render spin-down
// can no longer reset the accountability history to zero.
import { durablePut } from '../mcp/durable.js';

const FILE = 'tracked-signals.json';
const MAX_ROWS = 800;          // ~40/day × 20 days of history
const MAX_PER_DAY = 40;
const EOD_SQOFF_MIN = 15 * 60 + 25; // 15:25 IST — reconcile & close

const _marketOf = (rowOrSig) => {
  const m = String(rowOrSig?.market || '').toUpperCase();
  if (m === 'CRYPTO') return 'CRYPTO';
  if (m === 'INDIA') return 'INDIA';
  // Legacy rows / engine payloads without the field: base-symbol heuristic.
  return isCryptoSymbolBase(rowOrSig?.symbol) ? 'CRYPTO' : 'INDIA';
};

let _state = loadJSON(FILE, { signals: [] });
let _saveTimer = null;
// v20.3: cross-source flip cooldown — "symbol|dayKey" → last flip ts.
// Bounded: flip keys are day-scoped; anything over 500 keys is a runaway
// (historically impossible — 40 rows/day cap) and gets swept.
const _flipGuard = new Map();

/** v10.3.1: durable boot-restore hook — _state was loaded at module-eval
 * time (before the pre-listen durable restore rehydrated the disk file).
 * Re-read so the accountability history survives Render spin-downs. */
export function __reloadTrackRecordForBoot() { _state = loadJSON(FILE, { signals: [] }); }

function _persist() {
  // Debounced write (max one write/sec under bursty updates).
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    saveJSON(FILE, _state);
    try { durablePut(FILE, _state); } catch { /* durable optional */ }
  }, 1000);
  if (typeof _saveTimer.unref === 'function') _saveTimer.unref();
}

/** v20.3: test reset for the cross-source flip guard (module state). */
export function __resetFlipGuardForTests() { _flipGuard.clear(); }

/** v9.1: synchronous flush for graceful shutdown (see flushPaperState). */
export function flushTrackRecordState() {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  saveJSON(FILE, _state);
}

function _id(symbol, market = 'INDIA') { return `${symbol}:${dayKeyFor(market)}`; }

export function trackedSymbolsForToday() {
  return _state.signals
    .filter(s => s.status === 'OPEN' && s.dayKey === dayKeyFor(_marketOf(s)))
    .map(s => s.symbol);
}

// Which symbols does the watcher need quotes for? OPEN tracked
// signals only (paper trades are handled by their own module).
export function watcherSymbols() {
  return [...new Set(trackedSymbolsForToday())];
}

// 2026-09 multi-market: same watch set, classified per market so the
// watcher routes INDIA → Groww and CRYPTO → CoinDCX.
export function watcherSymbolsByMarket() {
  const india = [];
  const crypto = [];
  for (const s of _state.signals) {
    if (s.status !== 'OPEN' && s.status !== 'PARTIAL') continue;
    if (s.dayKey !== dayKeyFor(_marketOf(s))) continue; // stale rows handled by reconcile
    (_marketOf(s) === 'CRYPTO' ? crypto : india).push(s.symbol);
  }
  return { india: [...new Set(india)], crypto: [...new Set(crypto)] };
}

// ------------------------------------------------------------
// Record the LATEST scan's published signals.
//  • brand-new symbol → open a tracked row
//  • same symbol, same direction → refresh levels/confidence only
//  • same symbol, direction FLIPPED → close old row (FLIP) + open new
// Signals published after 15:00 (no-fresh-entry window) are tracked
// for accountability but flagged `lateEntry`.
// ------------------------------------------------------------
export function recordSignals(signals) {
  if (!Array.isArray(signals) || signals.length === 0) return [];
  const today = istDayKey();
  const events = [];
  if (_state.dayKey !== today) _state.dayKey = today;
  // v20.3: flip-guard sweep (day-scoped keys; >500 = runaway, reset).
  if (_flipGuard.size > 500) _flipGuard.clear();

  const todayRows = _state.signals.filter(s => s.dayKey === dayKeyFor(_marketOf(s)));
  // v11.4 recheck: count OPEN *and* PARTIAL — a PARTIAL row is still one
  // live tracked trade and must consume a MAX_PER_DAY slot (previously
  // uncapped once every row had booked T1).
  if (todayRows.filter(s => s.status === 'OPEN' || s.status === 'PARTIAL').length >= MAX_PER_DAY) return [];

  for (const sig of signals) {
    const market = _marketOf(sig);
    const sigDay = dayKeyFor(market);
    // v11.4 recheck: dedup must match PARTIAL rows too — once a row booked
    // T1 it escaped the OPEN-only lookup and the next scan opened a SECOND
    // row with the SAME id (symbol:dayKey), double-counting the trade.
    const existing = _state.signals.find(
      s => s.symbol === sig.symbol && s.dayKey === sigDay && (s.status === 'OPEN' || s.status === 'PARTIAL')
    );
    if (existing) {
      if (existing.direction !== sig.direction) {
        // v20.3 FLIP-COOLDOWN: the legacy scanner (60s cache) AND the AI
        // board (30s client cadence) both feed this book. When the two
        // systems DISAGREE on direction, the old code flip-closed +
        // re-opened the row every cycle — the row's plan churned all day
        // (40/day cap burn, journal noise, whichever system polled last
        // "owned" the trade). A genuine flip still goes through (once per
        // symbol per 30 min); the churn between polls does not.
        const flipKey = `${sig.symbol}|${sigDay}`;
        const lastFlip = _flipGuard.get(flipKey) || 0;
        if (Date.now() - lastFlip > 30 * 60_000) {
          _flipGuard.set(flipKey, Date.now());
          _closeRow(existing, sig.ltp, 'FLIP', events);
          _openRow(sig, sigDay, events, true);
        } else {
          existing.confidence = sig.confidence;
          existing.lastPrice = sig.ltp;
        }
      } else if (existing.status === 'PARTIAL') {
        // T1 already booked against the OLD levels — refreshing entry/target1
        // would rewrite booked P&L retroactively. Confidence/last-price only.
        existing.confidence = sig.confidence;
        existing.lastPrice = sig.ltp;
      } else {
        // v18.9 LEVEL FREEZE — an OPEN row's entry/SL/targets were set at
        // publish time; refreshing them mid-life rewrote the P&L basis AFTER
        // the fact (a 14:00 refresh that lifted `entry` above the current
        // price made the very next tick book an SL_HIT that never happened
        // at the original plan — win-rate/avgR measured the LAST refresh,
        // not the published signal). Only live fields refresh now.
        existing.confidence = sig.confidence;
        existing.lastPrice = sig.ltp;
        existing.qtyPerLakh = sig.qtyPerLakh ?? existing.qtyPerLakh;
      }
    } else {
      _openRow(sig, sigDay, events, false);
    }
  }

  // Trim history.
  if (_state.signals.length > MAX_ROWS) {
    _state.signals = _state.signals
      .sort((a, b) => (a.openedAt || 0) - (b.openedAt || 0))
      .slice(_state.signals.length - MAX_ROWS);
  }
  _persist();
  return events; // [{type:'OPEN'|'FLIP', ...}] for stream broadcast
}

function _openRow(sig, today, events, isFlip) {
  const market = _marketOf(sig);
  const row = {
    id: _id(sig.symbol, market),
    symbol: sig.symbol, exchange: sig.exchange || (market === 'CRYPTO' ? 'BINANCE' : 'NSE'),
    market,
    direction: sig.direction,
    entry: sig.entry, stopLoss: sig.stopLoss,
    target1: sig.target1, target2: sig.target2,
    qtyPerLakh: sig.qtyPerLakh || 0,
    risk: +(Math.abs(sig.entry - sig.stopLoss)).toFixed(2),
    confidence: sig.confidence, quantConfidence: sig.quantConfidence,
    aiModel: sig.aiModel || '', aiNote: sig.aiNote || '',
    counterTrend: !!sig.counterTrend,
    trendStrength: sig.trendStrength || '',
    dayKey: today,
    openedAt: Date.now(),
    lastPrice: sig.ltp,
    status: 'OPEN',          // OPEN | PARTIAL | SL_HIT | T2_HIT | BE_TRAIL_EXIT | EOD_EXIT | FLIP
    t1Hit: false,
    events: [{ ts: Date.now(), type: 'OPEN', price: sig.ltp }],
    exitPrice: null, closedAt: null,
    realizedPnlPerLakh: null, disciplinedPnlPerLakh: null, rMultiple: null,
    // CRYPTO is 24/7 — there is no 15:00 IST fresh-entry cutoff.
    lateEntry: market === 'CRYPTO' ? false : istMinutes() >= 15 * 60,
  };
  _state.signals.push(row);
  events.push({ type: isFlip ? 'FLIP' : 'OPEN', symbol: row.symbol, direction: row.direction, price: row.entry, confidence: row.confidence, market });
  return row;
}

function _closeRow(row, exitPrice, reason, events) {
  row.status = reason;
  row.exitPrice = +(+exitPrice).toFixed(2);
  row.closedAt = Date.now();
  row.lastPrice = row.exitPrice;
  row.events.push({ ts: Date.now(), type: reason, price: row.exitPrice });
  _computePnl(row);
  events.push({
    type: reason, symbol: row.symbol, direction: row.direction,
    price: row.exitPrice, pnl: row.disciplinedPnlPerLakh,
    rMultiple: row.rMultiple, qty: row.qtyPerLakh,
  });
}

// Disciplined P&L per ₹1L (matches the published execution rules).
function _computePnl(row) {
  const qty = row.qtyPerLakh || 0;
  if (!qty || row.exitPrice == null) return;
  const sign = row.direction === 'LONG' ? 1 : -1;
  const entry = row.entry, exit = row.exitPrice;
  let pnl;
  if (row.t1Hit) {
    // 50% booked at T1; remainder exited at `exit` (breakeven trail / T2 / EOD).
    pnl = 0.5 * qty * (row.target1 - entry) * sign + 0.5 * qty * (exit - entry) * sign;
  } else {
    pnl = qty * (exit - entry) * sign;
  }
  row.disciplinedPnlPerLakh = +pnl.toFixed(2);
  row.realizedPnlPerLakh = +(qty * (exit - entry) * sign).toFixed(2);
  row.rMultiple = row.risk > 0 ? +(pnl / (qty * row.risk)).toFixed(2) : null;
}

// ------------------------------------------------------------
// Live evaluation — called by the watcher with fresh quotes.
// LONG: SL at ltp<=stopLoss, T1 at ltp>=target1, T2 at ltp>=target2.
// After T1: trail stop = entry (breakeven); if ltp <= entry → out.
// NOTE: uses LTP (not day high/low) because the swing stop sits
// below the day low by construction — dayLow would false-trigger.
// ------------------------------------------------------------
export function evaluateTracked(quotes, events) {
  const m = istMinutes();

  // v11.4 recheck: RUNTIME reconcile — reconcileStale used to run at BOOT
  // ONLY, so on a long-lived process every row that crossed its day
  // boundary while still OPEN/PARTIAL (crypto at UTC midnight — the common
  // case for a 24/7 market; NSE rows left open when quotes stopped) turned
  // into a permanent zombie: skipped by this loop, never counted, and
  // `openCount` grew forever. The loop below is ≤ MAX_ROWS (800) string
  // compares — cheap enough for every watcher tick, idempotent.
  reconcileStale(events);

  for (const row of _state.signals) {
    if (row.status !== 'OPEN' && row.status !== 'PARTIAL') continue;
    const market = _marketOf(row);
    // Per-market day key: IST for NSE, UTC for crypto. Stale rows are
    // handled by reconcile — never mid-session here.
    if (row.dayKey !== dayKeyFor(market)) continue;
    const q = quotes[row.symbol];
    const price = q?.price;
    if (!(price > 0)) continue;
    row.lastPrice = +price.toFixed(2);

    const isLong = row.direction === 'LONG';
    const hitSL = isLong ? price <= row.stopLoss : price >= row.stopLoss;
    const hitT1 = !row.t1Hit && (isLong ? price >= row.target1 : price <= row.target1);
    const hitT2 = isLong ? price >= row.target2 : price <= row.target2;

    if (row.status === 'OPEN') {
      if (hitSL) { _closeRow(row, row.stopLoss, 'SL_HIT', events); continue; }
      if (hitT2) { row.t1Hit = true; _closeRow(row, row.target2, 'T2_HIT', events); continue; }
      if (hitT1) {
        row.t1Hit = true; row.status = 'PARTIAL';
        row.events.push({ ts: Date.now(), type: 'T1_HIT', price: row.target1 });
        events.push({ type: 'T1_HIT', symbol: row.symbol, direction: row.direction, price: row.target1, note: 'Book 50% • trail SL to entry', market });
        continue;
      }
    } else if (row.status === 'PARTIAL') {
      // Trail at breakeven once T1 booked.
      // v11.4 recheck: the original-SL check used to run FIRST — a tick
      // that gapped straight through entry to ≤ stopLoss closed the
      // remainder at the ORIGINAL SL (a full-risk loss on the runner)
      // instead of the documented breakeven floor. For a long, any price
      // ≤ stopLoss is also ≤ entry, so the BE trail subsumes it; T2 stays
      // first so a gap UP still books the win.
      if (hitT2) { _closeRow(row, row.target2, 'T2_HIT', events); continue; }
      const hitTrail = isLong ? price <= row.entry : price >= row.entry;
      if (hitTrail) { _closeRow(row, row.entry, 'BE_TRAIL_EXIT', events); continue; }
    }

    // EOD square-off for anything still open — NSE only (crypto is 24/7
    // and rolls at the UTC day boundary via reconcile).
    const afterEod = market !== 'CRYPTO' && (m >= EOD_SQOFF_MIN || !isNseMarketOpen());
    if (afterEod) { _closeRow(row, price, 'EOD_EXIT', events); }
  }
  if (events.length) _persist();
}

// Close stale OPEN rows from previous sessions (server restart etc.).
// CRYPTO rows roll at the UTC day boundary (the natural crypto session).
export function reconcileStale(events = []) {
  let changed = false;
  for (const row of _state.signals) {
    if (row.dayKey !== dayKeyFor(_marketOf(row)) && (row.status === 'OPEN' || row.status === 'PARTIAL')) {
      _closeRow(row, row.lastPrice || row.entry, 'EOD_EXIT', events);
      changed = true;
    }
  }
  if (changed) _persist();
  return changed;
}

// ------------------------------------------------------------
// Stats for the UI: win-rate, avg R, disciplined P&L — last N days.
// ------------------------------------------------------------
export function getTrackRecord(days = 30) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const rows = _state.signals
    .filter(s => (s.openedAt || 0) >= cutoff && s.status !== 'FLIP' && s.status !== 'OPEN' && s.status !== 'PARTIAL')
    .sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));
  const open = _state.signals.filter(s => s.status === 'OPEN' || s.status === 'PARTIAL');

  let wins = 0, losses = 0, rSum = 0, rCount = 0, pnlSum = 0;
  const byStatus = { T2_HIT: 0, BE_TRAIL_EXIT: 0, SL_HIT: 0, EOD_EXIT: 0 };
  for (const r of rows) {
    if (byStatus[r.status] != null) byStatus[r.status]++;
    const pnl = r.disciplinedPnlPerLakh;
    if (pnl != null) {
      pnlSum += pnl;
      if (pnl > 0) wins++; else if (pnl < 0) losses++;
    }
    if (r.rMultiple != null) { rSum += r.rMultiple; rCount++; }
  }
  const resolved = wins + losses;
  return {
    days,
    totalTracked: _state.signals.length,
    openCount: open.length,
    resolved,
    wins, losses,
    winRate: resolved > 0 ? +((wins / resolved) * 100).toFixed(1) : null,
    avgR: rCount > 0 ? +(rSum / rCount).toFixed(2) : null,
    disciplinedPnlPerLakh: +pnlSum.toFixed(2),
    byStatus,
    open: open.map(s => ({
      symbol: s.symbol, market: s.market, direction: s.direction, entry: s.entry,
      stopLoss: s.stopLoss, target1: s.target1, target2: s.target2,
      status: s.status, lastPrice: s.lastPrice, confidence: s.confidence,
      openedAt: s.openedAt, t1Hit: s.t1Hit,
    })),
    history: rows.slice(0, 40).map(s => ({
      symbol: s.symbol, market: s.market, direction: s.direction, dayKey: s.dayKey,
      entry: s.entry, exitPrice: s.exitPrice, status: s.status,
      confidence: s.confidence, t1Hit: s.t1Hit,
      pnl: s.disciplinedPnlPerLakh, rMultiple: s.rMultiple,
      openedAt: s.openedAt, closedAt: s.closedAt,
    })),
  };
}

// Boot-time reconciliation (called once from routes.js init).
export function initTrackRecord() {
  const events = [];
  reconcileStale(events);
  return events;
}
