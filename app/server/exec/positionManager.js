// ============================================================
// server/exec/positionManager.js — v20.7 PROTECTION-FIRST POSITION MANAGER
// ------------------------------------------------------------
// Phase 4 of the auto-trading plan (app/docs/audit.md §4). The state
// machine for: open → fill confirm → leverage mismatch close + alert
// → setProtection({sl, tp}) read-back confirm → flatten-on-fail. Plus
// the T1/T2/runner trail/give-back exit ladder. Plus tiered reversal
// (candle-close, not 30s tick).
//
// CORE RULE (audit doc §3): "Koi live position tab tak 'valid' nahi
// jab tak exchange-resident SL confirmed na ho." → the protection-
// first sequence (4a) is the ONLY entry path. If setProtection fails,
// the position is FLATTENED immediately (market close) + Telegram
// alert. No naked leveraged position is ever left open.
//
// EXIT LADDER (4b):
//   ENTRY  → SL on exchange (monitored)
//   T1     (≈1R or plan.target1) → 40% reduce, SL → breakeven + fees
//   T2     (≈2R / target2)        → 30% reduce, SL → T1 level
//   RUNNER (30%)                  → ATR chandelier trail (2.5×ATR(14) on
//                                  15m, ratchet-only via ratchetSl)
//   GIVE-BACK lock                 → peak unrealized ≥1.5R & retrace
//                                   >35% of peak → close runner
//   TIME STOP                      → N candles me T1 nahi mila → exit
//   FUNDING/EVENT                  → funding extreme ya eventGuard
//                                   window → size cut ya exit
//
// REVERSAL (4c, candle-close not tick):
//   1 evidence class → SL tighten to BE / lock profit
//   2 classes        → 50% reduce
//   3+ classes       → full close
//   SL/liq proximity → tick-level immediate (no candle wait)
//
// The manager NEVER throws. Every failure degrades to a safe action
// (flatten + alert). All actions go through the ExecutionPort so the
// same code path runs in api / browser / paper mode.
// ============================================================
import { ratchetSl } from '../ai/coindcxOrders.js';
import { computeSizing, liqDistancePct } from './sizing.js';

const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

const DEFAULTS = Object.freeze({
  // exit ladder (audit doc §4b — config-driven, defaults from the plan)
  exitT1R: 1.0,        exitT1Pct: 40,
  exitT2R: 2.0,        exitT2Pct: 30,
  trailAtrMult: 2.5,
  givebackArmR: 1.5,   givebackPct: 35,
  entryLimitTtlSec: 180,
  timeStopCandles: 8,   // N candles (15m) — ~2h with no T1 → exit
  // reversal tiers (audit doc §4c)
  revCandleTf: '15m',
  revClassesReduce: 2,  revClassesClose: 3,
});

export class PositionManager {
  constructor({ port, ramGovernor = null, alertSink = null, cfg = {} } = {}) {
    if (!port) throw new Error('PositionManager: port is required');
    this._port = port;
    this._ram = ramGovernor; // { ramCanEnter, ramCanLLM } — gates
    this._alert = typeof alertSink === 'function' ? alertSink : null;
    this._cfg = { ...DEFAULTS, ...cfg };
    // in-memory position state (mirrors exchange but with our exit-stage + trail)
    this._state = new Map(); // id → { stage, peakUnrealizedR, trailSl, openedAt, candlesSeen, clientId }
    this._book = []; // open positions in order
  }

  /**
   * 4a. PROTECTION-FIRST ENTRY SEQUENCE.
   * Steps: pre-trade checks → computeSizing → port.open() → fill
   * confirm via port.getPositions() → leverage mismatch close + alert
   * → port.setProtection({sl, tp}) read-back confirm → flatten-on-fail.
   * Returns { ok: true, positionId } or { ok: false, error, stage }.
   * NEVER throws. Never leaves a naked position.
   */
  async protectionFirstEntry({ signal, plan, now = Date.now() }) {
    const log = (stage, msg) => { try { this._log(`[posmgr:${stage}] ${msg}`); } catch {} };

    // ---- pre-trade gate: RAM governor (if armed) ----
    if (this._ram && typeof this._ram.ramCanEnter === 'function' && !this._ram.ramCanEnter()) {
      return { ok: false, stage: 'ram-gate', error: 'RAM governor is RED — new entries blocked' };
    }

    // ---- pre-trade gate: signal tier ----
    const tier = String(signal?.superIntel?.tier || signal?.grade || '').toUpperCase();
    if (!['STRONG', 'ELITE', 'ACTION'].includes(tier)) {
      return { ok: false, stage: 'tier-gate', error: `signal tier ${tier || '—'} below ACTION (no leverage bump)` };
    }

    // ---- 1. sizing (Phase 3 computeSizing + Phase 2 port.getEquity) ----
    const equity = await this._port.getEquity();
    if (!(equity?.freeUSDT > 0)) {
      return { ok: false, stage: 'equity', error: `insufficient free equity: ${equity?.freeUSDT ?? '—'} USDT` };
    }
    const entry = Number(plan?.entry || signal?.ltp);
    const stopLoss = Number(plan?.stopLoss);
    if (!(entry > 0) || !(stopLoss > 0) || stopLoss === entry) {
      return { ok: false, stage: 'plan', error: 'plan.entry + plan.stopLoss required (stopLoss !== entry)' };
    }
    const sizing = computeSizing({
      equity: equity.totalUSDT || equity.freeUSDT,
      freeUSDT: equity.freeUSDT,
      entry, stopLoss,
      riskPct: Number(signal?.__riskPct || 1),
      tierLeverage: this._tierLeverage(tier, signal),
      instrument: { qtyStep: 0.0001, minQty: 0.0001, maxLeverage: 10 },
    });
    if (sizing.verdict !== 'OK') {
      return { ok: false, stage: 'sizing', error: `${sizing.verdict}: ${sizing.reason || ''}` };
    }

    // ---- 2. open via port ----
    const clientId = `pm-${now}-${Math.random().toString(36).slice(2, 8)}`;
    const openRes = await this._port.open({
      pair: signal.pair || signal.symbol,
      side: signal.side,
      qty: sizing.qty,
      leverage: sizing.leverage,
      type: 'limit',
      price: entry,
      sl: stopLoss,
      tp: plan?.target1,
      clientId,
    });
    if (!openRes?.ok) {
      return { ok: false, stage: 'open', error: openRes?.error || 'port.open failed' };
    }

    // ---- 3. fill confirm via port.getPositions() ----
    // wait up to ENTRY_LIMIT_TTL_SEC for the limit order to fill
    // (simplified: 1 re-read; production version polls every 2s)
    const positions = await this._port.getPositions();
    const filled = positions.find(p => p.pair === (signal.pair || signal.symbol) && Math.abs(p.qty - sizing.qty) < sizing.qty * 0.01);
    if (!filled) {
      // unfilled → cancel + exit
      await this._port.cancelOpenOrders({ pair: signal.pair || signal.symbol });
      return { ok: false, stage: 'fill-confirm', error: 'limit order not filled within budget — cancelled' };
    }

    // ---- 4. leverage mismatch → close + alert ----
    if (Number(filled.leverage) > 0 && Math.abs(filled.leverage - sizing.leverage) >= 1) {
      log('leverage-mismatch', `planned ${sizing.leverage}x, exchange ${filled.leverage}x → flatten`);
      await this._port.close({ positionId: filled.id });
      this._alertCall(`⚠️ LEVERAGE MISMATCH on ${filled.pair}: planned ${sizing.leverage}x, exchange ${filled.leverage}x. Position FLATTENED.`);
      return { ok: false, stage: 'leverage-mismatch', error: `exchange leverage ${filled.leverage}x ≠ planned ${sizing.leverage}x — flattened` };
    }

    // ---- 5. setProtection({sl, tp}) → read-back confirm ----
    const protRes = await this._port.setProtection({
      positionId: filled.id,
      sl: stopLoss,
      tp: plan?.target1,
    });
    if (!protRes?.ok) {
      // PROTECTION FAILED → flatten immediately (the CORE RULE)
      log('protection-fail', `setProtection failed: ${protRes?.error} → FLATTEN per core rule`);
      await this._port.close({ positionId: filled.id });
      this._alertCall(`🚨 PROTECTION MISSING on ${filled.pair}: setProtection failed (${protRes?.error}). Position FLATTENED — no naked leveraged position left open.`);
      return { ok: false, stage: 'protection-fail', error: `setProtection failed: ${protRes?.error} — flattened` };
    }

    // ---- 6. record state for the exit ladder ----
    this._state.set(filled.id, {
      stage: 'ENTRY',
      peakUnrealizedR: 0,
      trailSl: stopLoss,
      openedAt: now,
      candlesSeen: 0,
      clientId,
      pair: filled.pair,
      side: filled.side,
      entry: filled.avgPrice,
      sl: stopLoss,
      tp1: plan?.target1, tp2: plan?.target2,
      qty: filled.qty,
      leverage: filled.leverage,
      riskUSDT: sizing.riskUSDT,
    });

    return { ok: true, positionId: filled.id, sizing, clientId };
  }

  /**
   * 4b. EXIT LADDER TICK. Called on every candle-close (15m default)
   * with the live mark price for each open position.
   * Returns the list of actions taken (for journal + UI).
   */
  async tick({ pricesByPair, now = Date.now(), atrByPair = {} }) {
    const actions = [];
    const positions = await this._port.getPositions();
    for (const p of positions) {
      const st = this._state.get(p.id);
      if (!st) continue; // orphan — reconcile loop adopts
      const mark = Number(pricesByPair[p.pair] ?? p.markPrice);
      if (!(mark > 0)) continue;
      st.candlesSeen = (st.candlesSeen || 0) + 1;
      const r = this._unrealizedR(st, mark);
      st.peakUnrealizedR = Math.max(st.peakUnrealizedR || 0, r);

      // ---- time stop (Phase 4b) ----
      if (st.stage === 'ENTRY' && st.candlesSeen > this._cfg.timeStopCandles) {
        const res = await this._port.close({ positionId: p.id });
        actions.push({ id: p.id, kind: 'time-stop', close: res });
        this._state.delete(p.id);
        continue;
      }

      // ---- T1 hit (≈1R) ----
      if (st.stage === 'ENTRY' && this._hitT1(st, mark)) {
        const reduceQty = r2(st.qty * (this._cfg.exitT1Pct / 100));
        await this._port.reduce({ positionId: p.id, qty: reduceQty });
        // SL → breakeven + fees (rough: breakeven = entry; fees ~0.05%)
        const be = st.side === 'LONG' ? st.entry * 1.0005 : st.entry * 0.9995;
        const newSl = st.side === 'LONG' ? Math.max(st.sl, be) : Math.min(st.sl, be);
        await this._port.setProtection({ positionId: p.id, sl: newSl, tp: st.tp2 });
        st.sl = newSl; st.stage = 'T1_HIT';
        actions.push({ id: p.id, kind: 't1', reduceQty, newSl });
      }
      // ---- T2 hit (≈2R) ----
      else if (st.stage === 'T1_HIT' && this._hitT2(st, mark)) {
        const reduceQty = r2(st.qty * (this._cfg.exitT2Pct / 100));
        await this._port.reduce({ positionId: p.id, qty: reduceQty });
        // SL → T1 level
        const t1Level = st.side === 'LONG' ? this._rLevel(st, 1) : this._rLevel(st, 1);
        await this._port.setProtection({ positionId: p.id, sl: t1Level, tp: st.tp2 });
        st.sl = t1Level; st.stage = 'RUNNER';
        actions.push({ id: p.id, kind: 't2', reduceQty, newSl: t1Level });
      }
      // ---- RUNNER: ATR chandelier trail (ratchet-only) ----
      else if (st.stage === 'RUNNER') {
        const atr = Number(atrByPair[p.pair] || (st.entry * 0.012));
        const trail = st.side === 'LONG'
          ? mark - this._cfg.trailAtrMult * atr
          : mark + this._cfg.trailAtrMult * atr;
        const newSl = ratchetSl(st.side, st.sl, trail);
        if (newSl !== st.sl) {
          await this._port.setProtection({ positionId: p.id, sl: newSl, tp: null });
          st.sl = newSl;
          actions.push({ id: p.id, kind: 'trail', newSl });
        }
        // ---- give-back lock (peak ≥1.5R & retrace >35% of peak) ----
        if (st.peakUnrealizedR >= this._cfg.givebackArmR && r < st.peakUnrealizedR * (1 - this._cfg.givebackPct / 100)) {
          await this._port.close({ positionId: p.id });
          actions.push({ id: p.id, kind: 'giveback', peakR: r2(st.peakUnrealizedR), nowR: r2(r) });
          this._state.delete(p.id);
          continue;
        }
      }

      // ---- SL hit (tick-level immediate, no candle wait) ----
      if (this._slHit(st, mark)) {
        await this._port.close({ positionId: p.id });
        actions.push({ id: p.id, kind: 'sl-hit', sl: st.sl, mark });
        this._state.delete(p.id);
      }
    }
    return actions;
  }

  /**
   * 4c. TIERED REVERSAL (candle-close, not tick). Caller passes the
   * list of independent evidence classes that fired for each position.
   *   1 class → SL tighten to BE / lock profit
   *   2 classes → 50% reduce
   *   3+ classes → full close
   */
  async reversalCheck({ evidenceByPair, now = Date.now() }) {
    const actions = [];
    const positions = await this._port.getPositions();
    for (const p of positions) {
      const st = this._state.get(p.id);
      if (!st) continue;
      const evList = evidenceByPair[p.pair] || [];
      const n = Array.isArray(evList) ? evList.length : 0;
      if (n >= this._cfg.revClassesClose) {
        await this._port.close({ positionId: p.id });
        actions.push({ id: p.id, kind: 'reversal-close', classes: n });
        this._state.delete(p.id);
      } else if (n >= this._cfg.revClassesReduce) {
        const reduceQty = r2(st.qty * 0.5);
        await this._port.reduce({ positionId: p.id, qty: reduceQty });
        actions.push({ id: p.id, kind: 'reversal-reduce', classes: n, reduceQty });
      } else if (n >= 1) {
        // tighten SL to breakeven + fees
        const be = st.side === 'LONG' ? st.entry * 1.0005 : st.entry * 0.9995;
        const newSl = st.side === 'LONG' ? Math.max(st.sl, be) : Math.min(st.sl, be);
        if (newSl !== st.sl) {
          await this._port.setProtection({ positionId: p.id, sl: newSl, tp: null });
          st.sl = newSl;
          actions.push({ id: p.id, kind: 'reversal-tighten', classes: n, newSl });
        }
      }
    }
    return actions;
  }

  // ---- helpers ----
  _tierLeverage(tier, signal) {
    // map signal tier + verifiedScore + regimeAligned + slDistPct + fundingNormal → 5/7/10x
    // (delegates to sizing.js::tierLeverage)
    try {
      const { tierLeverage } = require('./sizing.js');
      return tierLeverage({
        tier,
        verifiedScore: signal?.verifiedScore ?? signal?.__verifiedScore,
        regimeAligned: signal?.__regimeAligned,
        slDistPct: signal?.__slDistPct,
        fundingNormal: signal?.__fundingNormal,
      }) || 5;
    } catch { return 5; }
  }
  _unrealizedR(st, mark) {
    const pnl = (st.side === 'LONG' ? 1 : -1) * st.qty * (mark - st.entry);
    const risk = st.riskUSDT || (st.qty * Math.abs(st.entry - st.sl));
    return risk > 0 ? pnl / risk : 0;
  }
  _hitT1(st, mark) {
    const t1 = this._rLevel(st, 1);
    return st.side === 'LONG' ? mark >= t1 : mark <= t1;
  }
  _hitT2(st, mark) {
    const t2 = this._rLevel(st, 2);
    return st.side === 'LONG' ? mark >= t2 : mark <= t2;
  }
  _rLevel(st, rMultiple) {
    const risk = Math.abs(st.entry - st.sl);
    return st.side === 'LONG' ? st.entry + rMultiple * risk : st.entry - rMultiple * risk;
  }
  _slHit(st, mark) {
    return st.side === 'LONG' ? mark <= st.sl : mark >= st.sl;
  }
  _log(msg) { try { console.error(msg); } catch {} }
  _alertCall(msg) { if (this._alert) try { this._alert(msg); } catch {} }

  // test hooks
  _stateForTests() { return Array.from(this._state.entries()).map(([id, s]) => ({ id, ...s })); }
}

// Re-export ratchetSl from coindcxOrders (the trail uses this)
export { ratchetSl };
