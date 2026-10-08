// ============================================================
// intraday/paperTrading — virtual-trade simulator engine
// ------------------------------------------------------------
// Users open VIRTUAL positions from any scanner signal (or manual
// levels) with zero real money. The watcher in stream.js evaluates
// them against live prices and auto-manages them exactly like the
// site's published execution discipline:
//   • T1 hit  → book 50%, trail remaining to breakeven (entry)
//   • T2 hit  → close remaining (full target run)
//   • SL hit  → close remaining at stop
//   • 15:10 IST → hard square-off of whatever is left
// Manual close anytime at live LTP. All trades persist to
// server/data/paper-trades.json with realized + unrealized P&L.
// ============================================================
import { loadJSON, saveJSON } from './store.js';
import { istDayKey, istMinutes, dayKeyFor } from './time.js';
import { isCryptoSymbolBase } from './engine.js';
import { recordTradeClose } from './journal.js';
import { restoreBackup, backupConfigured } from './backup.js';
// v12.7 (recheck R3-HIGH-1): paper-trade state rides the ENCRYPTED durable
// channel (AES-256-GCM envelope → GitHub backup branch). The plaintext
// scheduleBackup push put symbols/qty/entries/P&L on a public repo branch
// while every other state file already rode durable.js's promise that "a
// public repo backup branch can never leak keys or holdings".
import { durablePut, decryptJSON } from '../mcp/durable.js';
import { pRound } from '../ai/lib/priceRound.js';
import { bsPrice, yearsToExpiry } from '../ai/lib/blackScholes.js';
// v11.1 GAP 3 — real transaction costs (brokerage/STT/txn/GST/SEBI/stamp)
import { costsForPaperTrade } from '../ai/tradingCosts.js';
// v11.1 GAP 2 — adverse-circuit risk for open equity positions
import { adverseCircuitRisk } from '../ai/circuitGuard.js';

const FILE = 'paper-trades.json';
const MAX_TRADES = 500;
const PAPER_SQOFF_MIN = 15 * 60 + 10; // 15:10 IST hard square-off (NSE only)

// Per-trade market: CRYPTO trades 24/7 with fractional units (0.0027 BTC);
// INDIA stays whole-share with the 15:10 IST square-off.
const _marketOfTrade = (t) => {
  const m = String(t?.market || '').toUpperCase();
  if (m === 'CRYPTO') return 'CRYPTO';
  if (m === 'INDIA') return 'INDIA';
  return isCryptoSymbolBase(t?.symbol) ? 'CRYPTO' : 'INDIA';
};

// Fractional-safe qty normalizer: INDIA → integer shares; CRYPTO → 4dp units.
function _normQty(raw, market) {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (market === 'CRYPTO') return +n.toFixed(4);
  return Math.floor(n);
}

let _state = loadJSON(FILE, { trades: [], nextId: 1, dayKey: '' });
let _saveTimer = null;

function _persist() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    saveJSON(FILE, _state);
    // DURABLE HISTORY: Render's free plan wipes server/data/ on every
    // restart — mirror the state (ENCRYPTED, v12.7) to the GitHub backup
    // branch so the paper-trading track record survives (see backup.js
    // + mcp/durable.js).
    try { durablePut(FILE, _state); } catch { /* backup optional */ }
  }, 1000);
  if (typeof _saveTimer.unref === 'function') _saveTimer.unref();
}

/** v9.1: synchronous flush for graceful shutdown — the 1s debounce loses
 *  the very last state change (an open/close, a T1 partial book) if the
 *  process dies inside the window (deploy/restart races).
 *  v12.7 (recheck R3-#4): the flush ALSO re-arms the durable push so the
 *  REMOTE copy rides index.js's flushBackupNow() in the same shutdown. */
export function flushPaperState() {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  saveJSON(FILE, _state);
  try { durablePut(FILE, _state); } catch { /* backup optional */ }
}

function _validateSym(sym) {
  return typeof sym === 'string' && /^[A-Z0-9&-]{2,15}$/.test(sym.trim().toUpperCase());
}

// ------------------------------------------------------------
// v9.5 F&O OPTION PAPER TRADES — "Nifty50 15Sep 23400 CE" cards
// can now be paper-traded through the SAME engine. An option buy is
// a premium-LONG position (BUY CE on a LONG index consensus, BUY PE
// on SHORT): the card's Entry/Target/SL are premium levels, so the
// existing LONG level-sanity (SL < E < T1 < T2) holds as-is.
//   qty      = LOTS (integer); P&L multiplies by lotSize
//   pricing  = the watcher injects a live BS-model premium quote
//              per tick (spot via Yahoo ^NSEI/^BSESN — see
//              injectOptionPaperQuotes below), so SL/T1/T2/EOD
//              auto-management + P&L work exactly like equities
// ------------------------------------------------------------
const OPTION_UNDERLYINGS = new Set(['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'NIFTYNXT50', 'SENSEX']);
const RISK_FREE = 0.065; // matches optionsDesk.js

function _isOptionTrade(t) { return t?.assetKind === 'OPTION'; }

/** v9.5 — called by the watcher tick BEFORE evaluatePaper(): for every
 * open OPTION paper trade, fetch the underlying spot (Yahoo map in
 * index.js) and re-price the premium via Black-Scholes (entry IV held
 * fixed — same basis as the card that opened it). Injected into the
 * quotes map, so evaluatePaper()/closePaperTrade() need zero changes. */
export async function injectOptionPaperQuotes(quotes, fetchIndexSpot) {
  if (typeof fetchIndexSpot !== 'function') return;
  const open = _state.trades.filter(t => _isOptionTrade(t) && t.status !== 'CLOSED');
  if (open.length === 0) return;
  const spotCache = new Map();
  for (const t of open) {
    try {
      if (!spotCache.has(t.underlying)) {
        const q = await fetchIndexSpot(t.underlying);   // {price} | null
        if (q?.price > 0) spotCache.set(t.underlying, q.price);
      }
      const spot = spotCache.get(t.underlying);
      if (!(spot > 0)) continue;
      // T: expiry 15:30 IST; clamp to [0, ∞). T=0 → intrinsic value.
      const T = Math.max(0, yearsToExpiry(`${t.expiry}T15:30:00+05:30`));
      const intrinsic = t.optType === 'CE'
        ? Math.max(0, spot - t.strike)
        : Math.max(0, t.strike - spot);
      // t.iv is stored in PERCENT (e.g. 13.2) — bsPrice wants the decimal
      // sigma (0.132), clamped to the same [6%, 60%] band as the card desk.
      const sigma = Math.min(0.60, Math.max(0.06, (Number(t.iv) || 13) / 100));
      const prem = T > 0
        ? Math.max(0.05, bsPrice(spot, t.strike, T, RISK_FREE, sigma, t.optType))
        : intrinsic;
      quotes[t.symbol] = { price: +prem.toFixed(2), change: 0, ts: Date.now() };
    } catch { /* skip this trade this tick */ }
  }
}

/** Underlying index symbols the watcher must fetch when OPTION paper
 * trades are open (quotes for the CONTRACT itself don't exist on any
 * equity feed — the premium is model-priced from the index spot). */
export function optionUnderlyingsForWatcher() {
  return [...new Set(
    _state.trades
      .filter(t => _isOptionTrade(t) && t.status !== 'CLOSED')
      .map(t => String(t.underlying || '').toUpperCase())
      .filter(u => OPTION_UNDERLYINGS.has(u))
  )];
}

export function openPaperTrade(input) {
  const {
    symbol, direction, entry, qty,
    stopLoss, target1, target2, market,
    // v9.5 F&O option fields (optional):
    assetKind, underlying, strike, optType, expiry, iv, lotSize, label,
  } = input || {};

  if (!_validateSym(symbol)) return { error: 'Invalid symbol format.' };
  const sym = symbol.trim().toUpperCase();
  const isOption = String(assetKind || '').toUpperCase() === 'OPTION';
  if (isOption) {
    const u = String(underlying || '').trim().toUpperCase();
    if (!OPTION_UNDERLYINGS.has(u)) {
      return { error: `Option paper trade: unsupported underlying "${u || '—'}" (NIFTY/SENSEX supported).` };
    }
    const k = Number(strike);
    if (!(Number.isFinite(k) && k > 0)) return { error: 'Option paper trade: valid strike required.' };
    const ot = String(optType || '').toUpperCase();
    if (ot !== 'CE' && ot !== 'PE') return { error: 'Option paper trade: optType must be CE or PE.' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(expiry || ''))) return { error: 'Option paper trade: expiry (YYYY-MM-DD) required.' };
    const ivn = Number(iv);
    if (!(Number.isFinite(ivn) && ivn > 0)) return { error: 'Option paper trade: IV required for premium re-pricing.' };
    const ls = Number(lotSize);
    if (!(Number.isFinite(ls) && ls >= 1 && ls <= 10000)) return { error: 'Option paper trade: lotSize (1..10000) required.' };
    // Option BUY = premium LONG, always. A SHORT/PE-consensus card is
    // still a premium-LONG position — the direction arg must agree.
    if (String(direction || '').toUpperCase() !== 'LONG') {
      return { error: 'Option paper trades are premium-BUY (LONG). Pass direction "LONG".' };
    }
  }
  const mkt = (['INDIA', 'CRYPTO'].includes(String(market || '').toUpperCase())
    ? String(market).toUpperCase()
    : (isCryptoSymbolBase(sym) ? 'CRYPTO' : 'INDIA'));
  if (isOption && mkt !== 'INDIA') return { error: 'Option paper trades are INDIA-market only.' };
  const dir = direction === 'SHORT' ? 'SHORT' : 'LONG';
  const n = (v) => (typeof v === 'number' && isFinite(v) && v > 0) ? v : null;
  const e = n(entry), sl = n(stopLoss);
  const t1 = n(target1), t2 = n(target2);
  const q = _normQty(n(qty) || 0, mkt);
  if (!e) return { error: 'Valid entry price required.' };
  if (!q || q < (mkt === 'CRYPTO' ? 0.0001 : 1) || q > 100000) {
    return { error: mkt === 'CRYPTO'
      ? 'Qty must be ≥0.0001 (max 100000, 4dp).' 
      : 'Qty must be 1..100000.' };
  }
  if (!sl) return { error: 'Valid stop-loss required.' };
  // Level sanity — direction-consistent ordering.
  if (dir === 'LONG' && (sl >= e || (t1 && t1 <= e) || (t2 && t2 <= e))) {
    return { error: 'LONG levels must satisfy SL < entry < T1 < T2.' };
  }
  if (dir === 'SHORT' && (sl <= e || (t1 && t1 >= e) || (t2 && t2 >= e))) {
    return { error: 'SHORT levels must satisfy SL > entry > T1 > T2.' };
  }
  // Risk guard: max 1 lakh units / trade and max 10 concurrent open trades.
  const today = dayKeyFor(mkt);
  if (_state.dayKey !== today) _state.dayKey = today;
  const openNow = _state.trades.filter(t => t.status === 'OPEN' || t.status === 'PARTIAL');
  if (openNow.length >= 10) return { error: 'Max 10 open paper trades.' };
  if (openNow.some(t => t.symbol === sym && t.direction === dir && _marketOfTrade(t) === mkt)) {
    return { error: `Paper trade already open for ${sym} ${dir}.` };
  }

  const trade = {
    id: _state.nextId++,
    symbol: sym, market: mkt, direction: dir,
    entry: pRound(e), qty: q,
    stopLoss: pRound(sl),
    target1: t1 ? pRound(t1) : null,
    target2: t2 ? pRound(t2) : null,
    remainingQty: q,
    t1Hit: false,
    status: 'OPEN',           // OPEN | PARTIAL | CLOSED
    openedAt: Date.now(),
    closedAt: null, closeReason: null,
    realizedPnl: 0,
    unrealizedPnl: 0,
    lastPrice: pRound(e),
    parts: [],                // [{qty, exitPrice, ts, reason}]
    dayKey: today,
    capital: +(q * e).toFixed(2), // notionally deployed
  };
  if (isOption) {
    // v9.5 F&O: contract identity + re-pricing inputs + lot multiplier.
    trade.assetKind = 'OPTION';
    trade.underlying = String(underlying).trim().toUpperCase();
    trade.strike = Number(strike);
    trade.optType = String(optType).toUpperCase();
    trade.expiry = String(expiry).slice(0, 10);
    trade.iv = Number(iv);                 // entry IV, held fixed
    trade.lotSize = Number(lotSize);       // P&L multiplier (qty = lots)
    trade.label = String(label || '').slice(0, 40) || null; // "Nifty50 15Sep 23400 CE"
    trade.capital = +(q * trade.lotSize * e).toFixed(2);     // 1 lot premium × lots
  }
  _state.trades.push(trade);
  if (_state.trades.length > MAX_TRADES) {
    _state.trades = _state.trades.slice(_state.trades.length - MAX_TRADES);
  }
  _persist();
  return { ok: true, trade };
}

function _closePart(trade, qty, price, reason) {
  const use = Math.min(qty, trade.remainingQty);
  if (use <= 0) return;
  const sign = trade.direction === 'LONG' ? 1 : -1;
  const mult = _isOptionTrade(trade) ? (trade.lotSize || 1) : 1; // v9.5: lots × lotSize
  trade.remainingQty -= use;
  trade.realizedPnl += use * (price - trade.entry) * sign * mult;
  trade.parts.push({ qty: use, exitPrice: pRound(price), ts: Date.now(), reason });
  // v11.1 GAP 3: re-annotate gross/costs/net on every part close — the
  // numbers are derived deterministically from (qty, entry, parts), so
  // recomputing is idempotent and works for restored/legacy trades too.
  try {
    const costs = costsForPaperTrade(trade);
    if (costs && costs.total != null) {
      trade.grossPnl = +(+trade.realizedPnl).toFixed(2);
      trade.costs = +(costs.total).toFixed(2);
      trade.netPnl = +(trade.realizedPnl - costs.total).toFixed(2);
      trade.costsBreakdown = {
        instrumentType: costs.instrumentType,
        brokerage: costs.brokerage ?? 0, stt: costs.stt ?? 0,
        exchangeTxn: costs.exchangeTxn ?? 0, sebi: costs.sebi ?? 0,
        gst: costs.gst ?? 0, stampDuty: costs.stampDuty ?? 0,
        takerFee: costs.takerFee ?? null, orders: costs.orders ?? null,
        ...(costs.note ? { note: costs.note } : {}),
      };
    }
  } catch { /* costs optional — gross stays the honest fallback */ }
  if (trade.remainingQty <= 0) {
    trade.status = 'CLOSED';
    trade.closedAt = Date.now();
    trade.closeReason = reason;
    trade.unrealizedPnl = 0;
    // AUTO TRADE JOURNAL — every close path (SL/T1/T2/trail/EOD/
    // manual/stale) lands here exactly once. Pure data capture;
    // the AI review runs later (EOD cron / on-demand endpoint).
    try { recordTradeClose(trade); } catch { /* journal optional */ }
  }
}

// ------------------------------------------------------------
// Live evaluation — called by the watcher with fresh quotes.
// ------------------------------------------------------------
export function evaluatePaper(quotes, events) {
  const m = istMinutes();
  let changed = false;

  for (const t of _state.trades) {
    if (t.status === 'CLOSED') continue;
    const mkt = _marketOfTrade(t);
    // v18.9 DAY-ROLLOVER GUARD — the boot/restore path had the stale-day
    // check but the PER-TICK loop did not: if the quote feed stayed dead
    // through the 15:10 square-off (watcher backs off when got===0) and the
    // process kept running, a non-CRYPTO trade survived into the NEXT
    // session and got auto-managed against next-day prices (two sessions
    // mixed into one P&L — the "NEVER carry intraday overnight" rule
    // broken). Mirrors trackRecord's v11.4 reconcileStale fix.
    if (mkt !== 'CRYPTO' && t.dayKey && t.dayKey !== dayKeyFor(mkt)) {
      const lastPx = Number(t.lastPrice) > 0 ? Number(t.lastPrice) : Number(t.entry);
      _closePart(t, t.remainingQty, lastPx, 'STALE_SQOFF');
      events.push({ type: 'PAPER_CLOSE', symbol: t.symbol, direction: t.direction, price: lastPx, pnl: t.realizedPnl, pnlNet: t.netPnl ?? null, note: 'Paper: stale-day square-off (feed was down at EOD, position was carried)' });
      changed = true;
      continue;
    }
    // NSE hard square-off 15:10 IST — crypto is 24/7, no EOD (it rolls
    // at the UTC day boundary via the boot/restore stale checks).
    const afterSqOff = mkt !== 'CRYPTO' && m >= PAPER_SQOFF_MIN;
    const q = quotes[t.symbol];
    const price = q?.price;
    if (price > 0) t.lastPrice = pRound(price);
    const p = t.lastPrice;
    if (!(p > 0)) continue;

    const isLong = t.direction === 'LONG';
    const hitSL = isLong ? p <= t.stopLoss : p >= t.stopLoss;
    const hitT1 = t.target1 && !t.t1Hit && (isLong ? p >= t.target1 : p <= t.target1);
    const hitT2 = t.target2 && (isLong ? p >= t.target2 : p <= t.target2);

    if (t.status === 'OPEN') {
      if (hitSL) {
        // v20.9.1 [H3]: SL gap-through fill TRADED price pe — trigger level
        // (t.stopLoss) decide karta hai KAB band hona hai; fill wahi hota hai
        // jo market order ko milega (LTP gap karke SL ke paar gaya ho to
        // worst-side price, engine ke gap-through-stop fix jaisa). Pehle
        // level pe book hota tha → violent bars pe systematically flattered
        // track-record.
        const slFill = isLong ? Math.min(p, t.stopLoss) : Math.max(p, t.stopLoss);
        _closePart(t, t.remainingQty, slFill, 'SL_HIT');
        events.push({ type: 'PAPER_CLOSE', symbol: t.symbol, direction: t.direction, price: slFill, pnl: t.realizedPnl, pnlNet: t.netPnl ?? null, note: 'Paper trade SL hit' });
        changed = true; continue;
      }
      if (hitT2) {
        _closePart(t, t.remainingQty, t.target2, 'T2_HIT');
        events.push({ type: 'PAPER_CLOSE', symbol: t.symbol, direction: t.direction, price: t.target2, pnl: t.realizedPnl, pnlNet: t.netPnl ?? null, note: 'Paper trade T2 hit' });
        changed = true; continue;
      }
      if (hitT1) {
        t.t1Hit = true;
        // Fractional-safe T1 booking: half the position (4dp for crypto).
        const half = _marketOfTrade(t) === 'CRYPTO'
          ? +((t.qty / 2).toFixed(4))
          : Math.ceil(t.qty / 2);
        _closePart(t, half, t.target1, 'T1_BOOK');
        if (t.status !== 'CLOSED') t.status = 'PARTIAL';
        events.push({ type: 'PAPER_CLOSE', symbol: t.symbol, direction: t.direction, price: t.target1, pnl: t.realizedPnl, pnlNet: t.netPnl ?? null, note: 'Paper: booked 50% at T1, trail to entry' });
        changed = true; continue;
      }
    } else if (t.status === 'PARTIAL') {
      if (hitSL) {
        // v20.9.1 [H3]: trail-stop me bhi wahi gap-through honesty.
        const slFill2 = isLong ? Math.min(p, t.stopLoss) : Math.max(p, t.stopLoss);
        _closePart(t, t.remainingQty, slFill2, 'SL_TRAIL_HIT');
        events.push({ type: 'PAPER_CLOSE', symbol: t.symbol, direction: t.direction, price: slFill2, pnl: t.realizedPnl, pnlNet: t.netPnl ?? null, note: 'Paper trade trail-stop hit' });
        changed = true; continue;
      }
      if (hitT2) {
        _closePart(t, t.remainingQty, t.target2, 'T2_HIT');
        events.push({ type: 'PAPER_CLOSE', symbol: t.symbol, direction: t.direction, price: t.target2, pnl: t.realizedPnl, pnlNet: t.netPnl ?? null, note: 'Paper trade T2 hit' });
        changed = true; continue;
      }
      const hitTrail = isLong ? p <= t.entry : p >= t.entry;
      if (hitTrail) {
        // v20.9.1 [H3]: BE-trail bhi gap-through worst-side fill pe.
        const beFill = isLong ? Math.min(p, t.entry) : Math.max(p, t.entry);
        _closePart(t, t.remainingQty, beFill, 'BE_TRAIL');
        events.push({ type: 'PAPER_CLOSE', symbol: t.symbol, direction: t.direction, price: beFill, pnl: t.realizedPnl, pnlNet: t.netPnl ?? null, note: 'Paper: breakeven trail exit' });
        changed = true; continue;
      }
    }

    if (afterSqOff && t.status !== 'CLOSED') {
      _closePart(t, t.remainingQty, p, 'EOD_SQOFF');
      events.push({ type: 'PAPER_CLOSE', symbol: t.symbol, direction: t.direction, price: p, pnl: t.realizedPnl, pnlNet: t.netPnl ?? null, note: 'Paper: 15:10 auto square-off' });
      changed = true;
    }
  }

  // Refresh unrealized P&L for still-open trades.
  for (const t of _state.trades) {
    if (t.status === 'CLOSED') continue;
    const sign = t.direction === 'LONG' ? 1 : -1;
    const mult = _isOptionTrade(t) ? (t.lotSize || 1) : 1; // v9.5 option lots
    t.unrealizedPnl = +(t.remainingQty * (t.lastPrice - t.entry) * sign * mult).toFixed(2);
  }
  if (changed) _persist();
  return changed;
}

// ------------------------------------------------------------
// v11.1 GAP 2 — CIRCUIT-LIMIT WATCH for open equity paper positions.
// Called by the stream watcher on every tick (after evaluatePaper):
// a LONG drifting into the LOWER circuit / a SHORT into the UPPER
// circuit is approaching a state where the EXIT itself cannot fill —
// the usual "tighten the stop" playbook is useless there. Emits
// URGENT CIRCUIT_RISK events (distinct from SL-approach warnings)
// with a per-symbol 10-min cooldown. NSE equities only — crypto has
// no circuits and option premiums are not band-bound.
// ------------------------------------------------------------
const _circuitAlertAt = new Map(); // `${symbol}:${direction}` → last-alert ts
export function paperCircuitWatch(quotes, events, opts = {}) {
  const cooldownMs = Number(opts.cooldownMs) > 0 ? Number(opts.cooldownMs) : 10 * 60 * 1000;
  const now = Date.now();
  let fired = 0;
  for (const t of _state.trades) {
    if (t.status === 'CLOSED') continue;
    if (_marketOfTrade(t) !== 'INDIA') continue;
    if (_isOptionTrade(t)) continue;
    const q = quotes?.[t.symbol];
    if (!q || !(Number(q.price) > 0)) continue;
    const risk = adverseCircuitRisk({ side: t.direction }, q);
    if (!risk || !risk.adverse) continue;
    const key = `${t.symbol}:${t.direction}`;
    if (now - (_circuitAlertAt.get(key) || 0) < cooldownMs) continue;
    _circuitAlertAt.set(key, now);
    events.push({
      type: 'CIRCUIT_RISK',
      symbol: t.symbol,
      direction: t.direction,
      price: Number(q.price),
      band: risk.band,
      frozen: !!risk.frozen,
      distPct: risk.distPct,
      note: risk.note,
    });
    fired++;
  }
  return fired;
}

export function closePaperTrade(id, quotes) {
  const t = _state.trades.find(x => x.id === id && x.status !== 'CLOSED');
  if (!t) return { error: 'Open paper trade not found.' };
  const q = quotes?.[t.symbol];
  const price = (q?.price > 0) ? q.price : t.lastPrice;
  if (!(price > 0)) return { error: 'No live price available — try again shortly.' };
  _closePart(t, t.remainingQty, price, 'MANUAL');
  _persist();
  return { ok: true, trade: t };
}

export function paperSymbolsForWatcher() {
  return [...new Set(
    _state.trades.filter(t => t.status === 'OPEN' || t.status === 'PARTIAL').map(t => t.symbol)
  )];
}

// 2026-09 multi-market: watch set classified per market so the watcher
// routes INDIA → Groww and CRYPTO → CoinDCX quotes.
export function paperSymbolsByMarket() {
  const india = [];
  const crypto = [];
  for (const t of _state.trades) {
    if (t.status !== 'OPEN' && t.status !== 'PARTIAL') continue;
    (_marketOfTrade(t) === 'CRYPTO' ? crypto : india).push(t.symbol);
  }
  return { india: [...new Set(india)], crypto: [...new Set(crypto)] };
}

export function getPaperSummary() {
  // v11.4 recheck: compare each trade against ITS OWN market day — INDIA
  // rows bucket on the IST day, CRYPTO rows on the UTC day. The old
  // single IST-day filter dropped every crypto trade opened (and closed)
  // in the 00:00–05:30 IST window from closedToday/dayRealizedPnl/dayNetPnl.
  const open = _state.trades.filter(t => t.status === 'OPEN' || t.status === 'PARTIAL');
  const closedToday = _state.trades.filter(
    t => t.dayKey === dayKeyFor(_marketOfTrade(t)) && t.status === 'CLOSED'
  );
  const allClosed = _state.trades.filter(t => t.status === 'CLOSED');
  const sum = (arr, f) => arr.reduce((s, t) => s + (f(t) || 0), 0);
  // v11.1 GAP 3: costs are derived per trade (pure, deterministic) — the
  // same numbers _publicTrade serves, so summary and rows always agree.
  const costsOf = (t) => {
    try { return costsForPaperTrade(t)?.total ?? 0; } catch { return 0; }
  };

  return {
    open: open.map(_publicTrade),
    closedToday: closedToday.slice(-15).reverse().map(_publicTrade),
    stats: {
      openCount: open.length,
      dayRealizedPnl: +sum(closedToday, t => t.realizedPnl).toFixed(2),
      dayUnrealizedPnl: +sum(open, t => t.unrealizedPnl).toFixed(2),
      totalRealizedPnl: +sum(allClosed, t => t.realizedPnl).toFixed(2),
      wins: allClosed.filter(t => t.realizedPnl > 0).length,
      losses: allClosed.filter(t => t.realizedPnl < 0).length,
      // v11.1 GAP 3: net-of-costs variants (costs = brokerage + STT +
      // exchange txn + SEBI + GST + stamp — env-tunable to your broker)
      dayCosts: +sum(closedToday, costsOf).toFixed(2),
      dayNetPnl: +sum(closedToday, t => t.realizedPnl - costsOf(t)).toFixed(2),
      totalCosts: +sum(allClosed, costsOf).toFixed(2),
      totalNetPnl: +sum(allClosed, t => t.realizedPnl - costsOf(t)).toFixed(2),
    },
  };
}

function _publicTrade(t) {
  // v11.1 GAP 3: live-derived cost annotation — works for legacy and
  // restored trades too (pure function of qty/entry/parts).
  let costs = null;
  try { costs = costsForPaperTrade(t); } catch { /* gross fallback */ }
  return {
    id: t.id, symbol: t.symbol, market: _marketOfTrade(t), direction: t.direction,
    entry: t.entry, qty: t.qty, remainingQty: t.remainingQty,
    stopLoss: t.stopLoss, target1: t.target1, target2: t.target2,
    status: t.status, t1Hit: t.t1Hit, dayKey: t.dayKey,
    openedAt: t.openedAt, closedAt: t.closedAt, closeReason: t.closeReason,
    lastPrice: t.lastPrice, realizedPnl: +(+t.realizedPnl).toFixed(2),
    unrealizedPnl: +(+t.unrealizedPnl).toFixed(2),
    parts: t.parts, capital: t.capital,
    ...(costs && costs.total != null ? {
      grossPnl: +(+t.realizedPnl).toFixed(2),
      costs: +(costs.total).toFixed(2),
      netPnl: +(t.realizedPnl - costs.total).toFixed(2),
      costsBreakdown: {
        instrumentType: costs.instrumentType,
        brokerage: costs.brokerage ?? 0, stt: costs.stt ?? 0,
        exchangeTxn: costs.exchangeTxn ?? 0, sebi: costs.sebi ?? 0,
        gst: costs.gst ?? 0, stampDuty: costs.stampDuty ?? 0,
        takerFee: costs.takerFee ?? null, orders: costs.orders ?? null,
      },
    } : {}),
    // v9.5 F&O option identity (absent on equity/crypto rows). iv is
    // included — the device-mirror restore needs it to re-price.
    ...(t.assetKind === 'OPTION' ? {
      assetKind: 'OPTION', underlying: t.underlying, strike: t.strike,
      optType: t.optType, expiry: t.expiry, lotSize: t.lotSize,
      iv: t.iv, label: t.label || null,
    } : {}),
  };
}

// Boot-time cleanup: anything left open from a previous day (per-market
// day key) gets squared off at its last known price. Crypto rolls at
// UTC midnight; NSE at IST midnight.
export function initPaperTrading() {
  const events = [];
  for (const t of _state.trades) {
    if (t.dayKey !== dayKeyFor(_marketOfTrade(t)) && t.status !== 'CLOSED') {
      _closePart(t, t.remainingQty, t.lastPrice || t.entry, 'STALE_SQOFF');
      events.push({ type: 'PAPER_CLOSE', symbol: t.symbol, direction: t.direction, price: t.lastPrice || t.entry, pnl: t.realizedPnl, note: 'Stale paper trade squared off on restart' });
    }
  }
  _persist();

  // DURABLE HISTORY — Render free plan wipes server/data/ on restart.
  // If local state came up empty, pull the last remote backup and
  // merge it back BEFORE the first client sees a wiped history.
  if (_state.trades.length === 0 && backupConfigured()) {
    _bootRestore();
  }
  return events;
}

let _bootRestoring = false;
async function _bootRestore() {
  if (_bootRestoring) return;
  _bootRestoring = true;
  try {
    const remote = await restoreBackup(FILE);
    // v12.7: the remote copy is now an AES-256-GCM durable envelope; a
    // legacy plaintext blob still restores (migration grace — whichever
    // form the branch holds, the fresher trades win).
    const remoteState = remote && remote.alg === 'aes-256-gcm' ? decryptJSON(remote) : remote;
    const remoteTrades = Array.isArray(remoteState?.trades) ? remoteState.trades : [];
    if (remoteTrades.length > _state.trades.length) {
      _mergeRestoredState(remoteState);
      _persist();
      console.log(`[paper] boot-restore: recovered ${remoteTrades.length} trades from remote backup`);
    }
  } catch (e) {
    console.warn('[paper] boot-restore failed:', e?.message || e);
  } finally {
    _bootRestoring = false;
  }
}

// ------------------------------------------------------------
// HISTORY — full cross-day track record for the accuracy audit.
// Day-grouped closed trades + win-rate stats, so the user can see
// whether the paper-trading signal testing was actually accurate.
// ------------------------------------------------------------
export function getPaperHistory(days = 90) {
  const windowDays = Math.max(1, Math.min(365, Math.floor(days) || 90));
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;

  const closed = _state.trades
    .filter(t => t.status === 'CLOSED' && (t.closedAt || t.openedAt) >= cutoff)
    .sort((a, b) => (b.closedAt || b.openedAt) - (a.closedAt || a.openedAt));

  // Day buckets (newest first).
  const byDay = new Map();
  for (const t of closed) {
    const key = t.dayKey || istDayKey(new Date(t.openedAt || Date.now()));
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(t);
  }

  const groups = [...byDay.entries()].map(([dayKey, list]) => {
    const wins = list.filter(t => t.realizedPnl > 0).length;
    const losses = list.filter(t => t.realizedPnl < 0).length;
    const dayCosts = list.reduce((s, t) => {
      try { return s + (costsForPaperTrade(t)?.total ?? 0); } catch { return s; }
    }, 0);
    const dayGross = +list.reduce((s, t) => s + (t.realizedPnl || 0), 0).toFixed(2);
    return {
      dayKey,
      trades: list.length,
      wins, losses,
      winRate: list.length ? +((wins / list.length) * 100).toFixed(1) : 0,
      realizedPnl: dayGross,
      // v11.1 GAP 3: the honest net line (costs deducted)
      costs: +dayCosts.toFixed(2),
      netPnl: +(dayGross - dayCosts).toFixed(2),
    };
  }).sort((a, b) => (a.dayKey < b.dayKey ? 1 : -1));

  const wins = closed.filter(t => t.realizedPnl > 0);
  const losses = closed.filter(t => t.realizedPnl < 0);
  const grossWin = wins.reduce((s, t) => s + t.realizedPnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.realizedPnl, 0));
  const totalPnl = +(grossWin - grossLoss).toFixed(2);
  // v11.1 GAP 3: all-time net + total costs (the "is this strategy
  // real-money viable or only paper-viable" number)
  const totalCosts = +closed.reduce((s, t) => {
    try { return s + (costsForPaperTrade(t)?.total ?? 0); } catch { return s; }
  }, 0).toFixed(2);

  let bestDay = null, worstDay = null;
  for (const g of groups) {
    if (!bestDay || g.realizedPnl > bestDay.pnl) bestDay = { dayKey: g.dayKey, pnl: g.realizedPnl };
    if (!worstDay || g.realizedPnl < worstDay.pnl) worstDay = { dayKey: g.dayKey, pnl: g.realizedPnl };
  }

  return {
    days: windowDays,
    totalClosed: closed.length,
    groups,
    overall: {
      totalTrades: closed.length,
      wins: wins.length,
      losses: losses.length,
      winRate: closed.length ? +((wins.length / closed.length) * 100).toFixed(1) : 0,
      avgWin: wins.length ? +(grossWin / wins.length).toFixed(2) : 0,
      avgLoss: losses.length ? +(-grossLoss / losses.length).toFixed(2) : 0,
      profitFactor: grossLoss > 0 ? +(grossWin / grossLoss).toFixed(2) : (grossWin > 0 ? null : 0),
      totalPnl,
      // v11.1 GAP 3: net-of-costs view
      totalCosts,
      totalNetPnl: +(totalPnl - totalCosts).toFixed(2),
      costsPctOfGrossProfit: grossWin > 0 ? +((totalCosts / grossWin) * 100).toFixed(1) : null,
      bestDay, worstDay,
    },
    // Full closed-trade list (newest first) — the client mirrors this
    // into IndexedDB so a wiped server can be auto-restored from it.
    trades: closed.map(_publicTrade),
  };
}

// ------------------------------------------------------------
// RESTORE — rebuild state after a server filesystem wipe, from the
// client's device mirror (POST /api/intraday-paper/restore) or the
// remote GitHub backup (boot path). Merge-by-id keeps any trades
// the still-running instance already knows about.
// ------------------------------------------------------------
function _num(v, fallback = 0) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function _sanitizeRestoredTrade(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = Number.isInteger(raw.id) ? raw.id : parseInt(raw.id, 10);
  if (!Number.isInteger(id) || id < 1 || id > 1e9) return null;
  const symbol = typeof raw.symbol === 'string' ? raw.symbol.trim().toUpperCase() : '';
  if (!/^[A-Z0-9&-]{2,15}$/.test(symbol)) return null;
  const direction = raw.direction === 'SHORT' ? 'SHORT' : 'LONG';
  const market = (['INDIA', 'CRYPTO'].includes(String(raw.market || '').toUpperCase())
    ? String(raw.market).toUpperCase()
    : (isCryptoSymbolBase(symbol) ? 'CRYPTO' : 'INDIA'));
  const entry = _num(raw.entry); if (!(entry > 0)) return null;
  const qty = _normQty(_num(raw.qty), market); if (!(qty >= (market === 'CRYPTO' ? 0.0001 : 1)) || qty > 100000) return null;
  const status = ['OPEN', 'PARTIAL', 'CLOSED'].includes(raw.status) ? raw.status : 'CLOSED';
  const openedAt = _num(raw.openedAt, Date.now());
  const parts = Array.isArray(raw.parts)
    ? raw.parts.slice(0, 20).map(p => ({
        qty: _normQty(_num(p?.qty, 1), market) || (market === 'CRYPTO' ? 0.0001 : 1),
        exitPrice: pRound(_num(p?.exitPrice, entry)),
        ts: _num(p?.ts, openedAt),
        reason: String(p?.reason || 'RESTORE').slice(0, 20),
      }))
    : [];
  const remainingQty = status === 'CLOSED'
    ? 0
    : Math.min(qty, _normQty(_num(raw.remainingQty, qty), market));
  const realizedPnl = +_num(raw.realizedPnl).toFixed(2);
  const t = {
    id, symbol, market, direction,
    entry: pRound(entry), qty,
    stopLoss: pRound(_num(raw.stopLoss, entry)),
    target1: _num(raw.target1) > 0 ? pRound(_num(raw.target1)) : null,
    target2: _num(raw.target2) > 0 ? pRound(_num(raw.target2)) : null,
    remainingQty,
    t1Hit: !!raw.t1Hit,
    status,
    openedAt,
    closedAt: status === 'CLOSED' ? _num(raw.closedAt, openedAt) : null,
    closeReason: status === 'CLOSED' ? String(raw.closeReason || 'RESTORED').slice(0, 20) : null,
    realizedPnl,
    unrealizedPnl: status === 'CLOSED' ? 0 : +_num(raw.unrealizedPnl).toFixed(2),
    lastPrice: pRound(_num(raw.lastPrice, entry)),
    parts,
    dayKey: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.dayKey)) ? raw.dayKey : dayKeyFor(market, new Date(openedAt)),
    capital: +_num(raw.capital, qty * entry).toFixed(2),
  };
  // v9.5: option fields survive the device-mirror/backup round-trip.
  if (raw.assetKind === 'OPTION' && OPTION_UNDERLYINGS.has(String(raw.underlying || '').toUpperCase())) {
    const k = _num(raw.strike, 0), ls = Math.round(_num(raw.lotSize, 0));
    const ot = String(raw.optType || '').toUpperCase();
    if (k > 0 && ls >= 1 && (ot === 'CE' || ot === 'PE') && /^\d{4}-\d{2}-\d{2}$/.test(String(raw.expiry || '')) && _num(raw.iv, 0) > 0) {
      t.assetKind = 'OPTION';
      t.underlying = String(raw.underlying).trim().toUpperCase();
      t.strike = k; t.optType = ot;
      t.expiry = String(raw.expiry).slice(0, 10);
      t.iv = _num(raw.iv);
      t.lotSize = ls;
      t.label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim().slice(0, 40) : null;
    }
  }
  return t;
}

function _mergeRestoredState(remote) {
  const incoming = (Array.isArray(remote?.trades) ? remote.trades : [])
    .map(_sanitizeRestoredTrade)
    .filter(Boolean)
    .sort((a, b) => a.openedAt - b.openedAt)
    .slice(0, MAX_TRADES);

  const known = new Map(_state.trades.map(t => [t.id, t])); // server copy wins
  let restored = 0;
  for (const t of incoming) {
    if (!known.has(t.id)) { known.set(t.id, t); restored++; }
  }
  _state.trades = [...known.values()].sort((a, b) => a.openedAt - b.openedAt);
  if (_state.trades.length > MAX_TRADES) {
    _state.trades = _state.trades.slice(_state.trades.length - MAX_TRADES);
  }
  const maxId = _state.trades.reduce((m, t) => Math.max(m, t.id), 0);
  _state.nextId = Math.max(_state.nextId || 1, maxId + 1);
  return restored;
}

export function restorePaperTrades(input) {
  const incoming = Array.isArray(input?.trades) ? input.trades : [];
  if (incoming.length === 0) return { error: 'trades[] required (device mirror payload).' };
  if (incoming.length > MAX_TRADES + 100) return { error: `Too many trades (max ${MAX_TRADES}).` };

  // Nothing to do? A wiped-and-restarted server should accept, but a
  // server that already knows MORE than the mirror is the source of
  // truth — ignore stale mirrors (idempotent client retry safety).
  const knownIds = new Set(_state.trades.map(t => t.id));
  const missing = incoming.filter(t => {
    const id = Number.isInteger(t?.id) ? t.id : parseInt(t?.id, 10);
    return Number.isInteger(id) && !knownIds.has(id);
  });
  if (missing.length === 0) {
    return { ok: true, restored: 0, alreadyKnown: _state.trades.length, summary: getPaperSummary() };
  }

  const restored = _mergeRestoredState({ trades: incoming });

  // Restored trades left "open" from a PREVIOUS day are stale by the
  // same per-market rule as boot-time — square them off at last price.
  for (const t of _state.trades) {
    if (t.dayKey !== dayKeyFor(_marketOfTrade(t)) && t.status !== 'CLOSED') {
      _closePart(t, t.remainingQty, t.lastPrice || t.entry, 'STALE_SQOFF');
    }
  }
  _persist();
  return { ok: true, restored, summary: getPaperSummary() };
}

// Test-only: swap in a clean/seeded state (vitest).
export function _resetForTests(seed) {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  _state = structuredClone(seed || { trades: [], nextId: 1, dayKey: istDayKey() });
  _circuitAlertAt.clear();
}
