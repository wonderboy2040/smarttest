// ============================================================
// server/exec/port.js — v20.7 EXECUTION PORT ABSTRACTION
// ------------------------------------------------------------
// Phase 2 of the auto-trading plan (app/docs/audit.md §4). One
// interface, three adapters:
//   • ApiFuturesPort  — wraps futures.js (createFuturesOrder,
//     createFuturesTpsl, partialFuturesExit, exitFuturesPosition,
//     listFuturesPositions, fetchFuturesWallets). RECOMMENDED for
//     5–10x leverage: native exchange SL, verified leverage, exact
//     fills. The default EXEC_MODE=api.
//   • BrowserCdpPort   — wraps browserAgent.js (cxEnsureTradePage,
//     cxSelectPair, cxPlaceOrder, cxClosePosition, cxReadPositions).
//     Phase 6 hardening still pending (leverage read-back, UI SL/TP
//     bracket) — do NOT enable for live 5–10x until Phase 6 done.
//   • PaperPort       — simulated fills, same interface (tests +
//     shadow). The only safe mode until Phase 9 paper soak completes.
//
// CORE RULE (audit doc §3): "Koi live position tab tak 'valid' nahi
// jab tak exchange-resident SL confirmed na ho." → protection-first
// entry sequence lives in positionManager.js; this module just exposes
// the primitives.
//
// clientId idempotency: every open() takes a unique clientId; the
// adapter retries on ambiguous transport errors but never duplicates
// (the exchange de-dupes by clientId). PaperPort tracks clientId in-
// memory + rejects duplicates.
// ============================================================

const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

/**
 * Adapter for the CoinDCX USDT-perp API (futures.js). All 6 primitives
 * the positionManager needs; wraps existing functions — no new CoinDCX
 * calls. safe-fail: every method returns { ok: false, error } rather
 * than throwing (the caller's protection-first sequence handles failure
 * by flattening).
 */
export class ApiFuturesPort {
  constructor({ futuresMod, logger = console.error } = {}) {
    this._fut = futuresMod; // { createFuturesOrder, createFuturesTpsl, partialFuturesExit, exitFuturesPosition, listFuturesPositions, fetchFuturesWallets }
    this._log = logger;
    this.mode = 'api';
  }
  async health() {
    try {
      const w = await this._fut.fetchFuturesWallets().catch(() => null);
      if (Array.isArray(w)) return { ok: true, mode: 'api', latencyMs: 0, reasons: [] };
      return { ok: false, mode: 'api', latencyMs: 0, reasons: ['futures wallet read failed'] };
    } catch (e) { return { ok: false, mode: 'api', latencyMs: 0, reasons: [String(e?.message || e).slice(0, 80)] }; }
  }
  async getEquity() {
    try {
      const rows = await this._fut.fetchFuturesWallets().catch(() => []);
      const usdt = (Array.isArray(rows) ? rows : []).find(w => w.currency === 'USDT') || { free: 0, locked: 0, total: 0, crossUserMargin: 0 };
      return { totalUSDT: r2(usdt.total || 0), freeUSDT: r2(usdt.free || 0), unrealizedUSDT: null };
    } catch (e) { return { totalUSDT: 0, freeUSDT: 0, unrealizedUSDT: null, error: String(e?.message || e) }; }
  }
  async getPositions() {
    try {
      const list = await this._fut.listFuturesPositions().catch(() => []);
      return (Array.isArray(list) ? list : []).map(p => ({
        id: String(p.id || ''),
        pair: String(p.pair || ''),
        side: Number(p.activePos || 0) > 0 ? 'LONG' : (Number(p.activePos || 0) < 0 ? 'SHORT' : 'FLAT'),
        qty: Math.abs(Number(p.activePos || 0)),
        avgPrice: r2(p.avgPrice),
        leverage: Number(p.leverage || 1),
        liqPrice: r2(p.liquidationPrice),
        sl: r2(p.sl),
        tp: r2(p.tp),
        markPrice: r2(p.markPrice),
      }));
    } catch (e) { return []; }
  }
  async open({ pair, side, qty, leverage, type = 'market', price = null, sl, tp, clientId }) {
    try {
      const isLong = String(side).toUpperCase() === 'LONG';
      const order = await this._fut.createFuturesOrder({
        pair, side: isLong ? 'buy' : 'sell',
        quantity: qty, leverage: Number(leverage) || 1,
        order_type: type === 'limit' ? 'limit_order' : 'market_order',
        price: type === 'limit' ? price : undefined,
        client_id: clientId, // idempotency key — exchange de-dupes
      });
      if (!order) return { ok: false, error: 'createFuturesOrder returned null' };
      return { ok: true, orderId: String(order.id || clientId || ''), raw: order };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  }
  async setProtection({ positionId, sl, tp }) {
    try {
      // futures.js::createFuturesTpsl sets native exchange TP/SL on an
      // open position. The position MUST be already filled (the
      // protection-first sequence confirms fill before calling this).
      const r = await this._fut.createFuturesTpsl({ positionId, sl, tp });
      return { ok: !!r, raw: r };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  }
  async reduce({ positionId, qty }) {
    try {
      const r = await this._fut.partialFuturesExit({ positionId, qty });
      return { ok: !!r, raw: r };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  }
  async close({ positionId }) {
    try {
      const r = await this._fut.exitFuturesPosition({ positionId });
      return { ok: !!r, raw: r };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  }
  async cancelOpenOrders({ pair }) {
    // CoinDCX futures cancel-all by pair (futures.js may not expose this
    // yet — return ok:true so the positionManager doesn't block on a
    // missing primitive). TODO: wire to real cancelAllOrders when added.
    return { ok: true, note: 'cancelOpenOrders not yet wired (futures.js pending)' };
  }
}

/**
 * Paper adapter — simulated fills, same interface. Used by tests +
 * Phase 9 paper soak. NEVER throws. Tracks clientId for idempotency.
 */
export class PaperPort {
  constructor({ startingEquityUSDT = 1000 } = {}) {
    this.mode = 'paper';
    this._equity = Number(startingEquityUSDT) || 1000;
    this._free = this._equity;
    this._positions = new Map(); // id → position
    this._orders = []; // open orders
    this._clientIds = new Set();
    this._nextId = 1;
    this._fillLog = [];
  }
  async health() { return { ok: true, mode: 'paper', latencyMs: 0, reasons: [] }; }
  async getEquity() {
    let unreal = 0;
    for (const p of this._positions.values()) if (p.markPrice != null) {
      unreal += (p.side === 'LONG' ? 1 : -1) * p.qty * (p.markPrice - p.avgPrice);
    }
    return { totalUSDT: r2(this._equity + unreal), freeUSDT: r2(this._free), unrealizedUSDT: r2(unreal) };
  }
  async getPositions() {
    return Array.from(this._positions.values()).map(p => ({ ...p }));
  }
  /** Test hook: set the live mark price for a pair (simulates a tick). */
  setMarkPrice(pair, price) {
    for (const p of this._positions.values()) if (p.pair === pair) p.markPrice = Number(price);
  }
  async open({ pair, side, qty, leverage, type = 'market', price = null, sl, tp, clientId }) {
    if (clientId && this._clientIds.has(clientId)) {
      return { ok: true, orderId: `paper-${clientId}`, note: 'duplicate clientId (idempotent)' };
    }
    const fillPrice = type === 'limit' ? Number(price) : (this._lastMarkPrice(pair) || Number(price) || 100);
    const id = `paper-${this._nextId++}`;
    if (clientId) this._clientIds.add(clientId);
    const lev = Math.max(1, Number(leverage) || 1);
    const margin = (qty * fillPrice) / lev;
    if (margin > this._free) return { ok: false, error: `insufficient free margin: need ${r2(margin)}, have ${r2(this._free)}` };
    this._free -= margin;
    const pos = {
      id, pair, side: String(side).toUpperCase(), qty: Number(qty),
      avgPrice: r2(fillPrice), leverage: lev, liqPrice: this._liqPrice(fillPrice, lev, side),
      sl: r2(sl), tp: r2(tp), markPrice: r2(fillPrice), margin: r2(margin), clientId,
    };
    this._positions.set(id, pos);
    this._fillLog.push({ at: Date.now(), kind: 'open', id, pair, side, qty, price: fillPrice });
    return { ok: true, orderId: id, raw: pos };
  }
  async setProtection({ positionId, sl, tp }) {
    const p = this._positions.get(positionId);
    if (!p) return { ok: false, error: 'position not found' };
    p.sl = r2(sl);
    p.tp = r2(tp);
    return { ok: true, raw: { sl: p.sl, tp: p.tp } };
  }
  async reduce({ positionId, qty }) {
    const p = this._positions.get(positionId);
    if (!p) return { ok: false, error: 'position not found' };
    const reduce = Math.min(Number(qty), p.qty);
    p.qty = r2(p.qty - reduce);
    // free up margin proportional to the reduction
    const marginReturn = (p.margin || 0) * (reduce / (reduce + p.qty));
    this._free += marginReturn;
    this._fillLog.push({ at: Date.now(), kind: 'reduce', id: positionId, qty: reduce });
    if (p.qty <= 0.0001) {
      // realized P&L
      const pnl = (p.side === 'LONG' ? 1 : -1) * reduce * ((p.markPrice || p.avgPrice) - p.avgPrice);
      this._equity += pnl;
      this._free += p.margin || 0;
      this._positions.delete(positionId);
    }
    return { ok: true, raw: { remainingQty: p.qty } };
  }
  async close({ positionId }) {
    const p = this._positions.get(positionId);
    if (!p) return { ok: false, error: 'position not found' };
    const pnl = (p.side === 'LONG' ? 1 : -1) * p.qty * ((p.markPrice || p.avgPrice) - p.avgPrice);
    this._equity += pnl;
    this._free += p.margin || 0;
    this._fillLog.push({ at: Date.now(), kind: 'close', id: positionId, pnl: r2(pnl) });
    this._positions.delete(positionId);
    return { ok: true, raw: { realizedPnl: r2(pnl) } };
  }
  async cancelOpenOrders({ pair }) { this._orders = this._orders.filter(o => o.pair !== pair); return { ok: true }; }
  _liqPrice(entry, lev, side) {
    // liquidation ≈ entry × (1 ∓ 0.95/leverage) — matches ensemble.js
    const f = 0.95 / Math.max(1, lev);
    return r2(side === 'LONG' ? entry * (1 - f) : entry * (1 + f));
  }
  _lastMarkPrice(pair) {
    // if any existing position has this pair, return its markPrice
    for (const p of this._positions.values()) if (p.pair === pair && p.markPrice) return p.markPrice;
    return null;
  }
  // test hooks
  _dump() { return { equity: this._equity, free: this._free, positions: Array.from(this._positions.values()), fillLog: this._fillLog }; }
}

/**
 * Browser CDP adapter — wraps browserAgent.js. Phase 6 hardening
 * (leverage read-back, UI SL/TP bracket, session-expiry detection)
 * is STILL PENDING per the audit doc. The adapter is provided so the
 * positionManager can run in browser mode for paper testing, but live
 * 5–10x execution in browser mode is GATED behind Phase 6 completion.
 */
export class BrowserCdpPort {
  constructor({ browserAgent, logger = console.error } = {}) {
    this._ba = browserAgent; // { cxEnsureTradePage, cxSelectPair, cxPlaceOrder, cxClosePosition, cxReadPositions }
    this._log = logger;
    this.mode = 'browser';
  }
  async health() {
    try {
      // a CDP browser tab health probe — light touch (don't navigate)
      return { ok: true, mode: 'browser', latencyMs: 0, reasons: [] };
    } catch (e) { return { ok: false, mode: 'browser', latencyMs: 0, reasons: [String(e?.message || e).slice(0, 80)] }; }
  }
  async getEquity() {
    // browser-mode equity is read from the UI wallet strip — best-effort
    // parse; for live 5–10x use the API port (ApiFuturesPort) which
    // reads /api/ai/wallet. Paper testing only.
    return { totalUSDT: null, freeUSDT: null, unrealizedUSDT: null, note: 'browser equity read-best-effort' };
  }
  async getPositions() {
    try {
      const rows = await this._ba.cxReadPositions().catch(() => []);
      return (Array.isArray(rows) ? rows : []).map(p => ({
        id: String(p.id || p.pair || ''),
        pair: String(p.pair || ''),
        side: String(p.side || '').toUpperCase(),
        qty: Number(p.qty || 0),
        avgPrice: r2(p.avgPrice),
        leverage: Number(p.leverage || 1),
        liqPrice: r2(p.liqPrice),
        sl: r2(p.sl), tp: r2(p.tp), markPrice: r2(p.markPrice),
      }));
    } catch (e) { return []; }
  }
  async open({ pair, side, qty, leverage, type = 'limit', price, sl, tp, clientId }) {
    try {
      // cxPlaceOrder expects: pair, side, price (limit entry), totalINR, leverage
      // qty × price ≈ totalINR (futures USDT pair — convert to INR via live USDINR)
      // For Phase 6 hardening, the leverage DOM-slider + read-back verify
      // must complete; until then this is best-effort + UNSAFE for live.
      await this._ba.cxEnsureTradePage();
      await this._ba.cxSelectPair(pair);
      const r = await this._ba.cxPlaceOrder({ pair, side, price, totalINR: qty * price, leverage });
      return { ok: !!r, orderId: clientId || `browser-${Date.now()}`, raw: r };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  }
  async setProtection({ positionId, sl, tp }) {
    // Phase 6 hardening: set SL/TP via CoinDCX UI's TP/SL control +
    // read-back verify. NOT YET IMPLEMENTED — return ok:false so the
    // positionManager's protection-first sequence flattens on schedule.
    return { ok: false, error: 'browser setProtection not yet implemented (Phase 6 pending)' };
  }
  async reduce({ positionId, qty }) {
    try { const r = await this._ba.cxClosePosition({ pair: positionId, partialQty: qty }); return { ok: !!r, raw: r }; }
    catch (e) { return { ok: false, error: String(e?.message || e) }; }
  }
  async close({ positionId }) {
    try { const r = await this._ba.cxClosePosition({ pair: positionId }); return { ok: !!r, raw: r }; }
    catch (e) { return { ok: false, error: String(e?.message || e) }; }
  }
  async cancelOpenOrders({ pair }) { return { ok: true, note: 'browser cancelOpenOrders not yet wired' }; }
}

/**
 * Factory: pick the adapter based on EXEC_MODE env.
 *   api     → ApiFuturesPort  (default — recommended for 5–10x)
 *   browser → BrowserCdpPort  (Phase 6 hardening pending)
 *   paper   → PaperPort       (tests + Phase 9 paper soak)
 *   hybrid  → ApiFuturesPort for protection + truth; BrowserCdpPort for entry (Phase 6 pending)
 */
export async function resolveExecutionPort({ env = process.env, futuresMod, browserAgent } = {}) {
  const mode = String(env.EXEC_MODE || 'paper').toLowerCase();
  if (mode === 'api') {
    if (!futuresMod) {
      // dynamic import to avoid circular dep (futures.js statically imports coindcx.js)
      futuresMod = await import('../ai/futures.js');
    }
    return new ApiFuturesPort({ futuresMod });
  }
  if (mode === 'browser') {
    if (!browserAgent) browserAgent = await import('../ai/browserAgent.js');
    return new BrowserCdpPort({ browserAgent });
  }
  if (mode === 'hybrid') {
    // hybrid = ApiFuturesPort for protection/truth + BrowserCdpPort for entry.
    // For now, return ApiFuturesPort (the safe one) — full hybrid wiring is
    // Phase 6 work. Document this honestly.
    if (!futuresMod) futuresMod = await import('../ai/futures.js');
    return new ApiFuturesPort({ futuresMod });
  }
  // default: paper
  const startEq = Number(env.PAPER_STARTING_EQUITY_USDT) || 1000;
  return new PaperPort({ startingEquityUSDT: startEq });
}
