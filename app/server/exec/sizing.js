// ============================================================
// server/exec/sizing.js — v20.6 WALLET-RISK-BASED POSITION SIZING
// ------------------------------------------------------------
// The user's auto-trading plan calls for wallet-equity × risk% sizing
// instead of the legacy fixed `stakeINR` (₹500). This module is the
// pure-functional core that takes:
//   • wallet equity (totalUSDT for futures, INR for India spot)
//   • live LTP / entry plan
//   • SL distance
//   • signal tier (affects leverage cap)
//   • instrument metadata (maxLeverage, minQty, qtyStep)
//
// …and returns:
//   • qty            (rounded to qtyStep, ≥ minQty)
//   • notional       (= qty × entry)
//   • margin         (= notional / leverage)
//   • leverage       (clamped to [5, 10] AND maxSaneLeverage AND
//                    instrument.maxLeverage)
//   • riskUSDT       (= equity × riskPct — the MAX loss if SL hits)
//   • liqDistancePct (= 95/lev % — the liquidation distance)
//   • guards         ({ marginOK, marginCapUsed, liqGuard, minQtyOK })
//   • verdict        ('OK' | 'SKIP_LOW_EQUITY' | 'SKIP_MIN_QTY' |
//                    'SKIP_MARGIN_CAP' | 'SKIP_LIQ_TOO_CLOSE')
//
// CORE INVARIANTS (locked by tests):
//   1. qty × slDistPct × entry ≤ riskUSDT × 1.001   (rounding slack)
//   2. liqDistancePct ≥ 2.5 × slDistPct              (SL inside liq)
//   3. margin ≤ freeUSDT × 0.9                       (cash headroom)
//   4. leverage = clamp(tierCap, 5, 10) ∧ ≤ maxSaneLeverage(slDist) ∧ ≤ instrument.maxLeverage
//
// Worked example (from the user's plan):
//   wallet 1,000 USDT · risk 1% = 10 USDT · SL 1.5% → notional ≈ 667 USDT
//   5x → margin ≈ 133 (13%); 10x → margin ≈ 67 (6.7%).
//   Both have MAX LOSS ≈ 10 USDT (SL hit). Leverage doesn't change
//   RISK, it changes MARGIN + LIQ DISTANCE only. This is the lesson
//   the module enforces.
// ============================================================

const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Liquidation-distance heuristic for CoinDCX USDT-margined perps.
 * Liquidation ≈ entry × (1 ∓ 0.95/leverage). The 0.95 factor matches
 * the futures.js / ensemble.js `computeLeverageView` math so the
 * guard rails agree across the stack.
 */
export function liqDistancePct(leverage) {
  const lev = Math.max(1, Number(leverage) || 1);
  return (0.95 / lev) * 100; // 5x → 19%, 10x → 9.5%
}

/**
 * Max sane leverage so the SL distance stays INSIDE the liquidation
 * distance with a ≥2.5× safety ratio. Slapped on top of the user's
 * chosen tier to prevent "10x with a 4% SL" (liq at 9.5% — fine, but
 * a 4% wick on a 10x leveraged perp is uncomfortably common).
 *
 * Math: `liqDistancePct(lev) ≥ ratio × slDistPct` (both in percent).
 *   (0.95/lev) × 100 ≥ ratio × slDistPct × 100   (slDistPct is fraction)
 *   0.95/lev ≥ ratio × slDistPct
 *   lev ≤ 0.95 / (ratio × slDistPct)
 * With ratio=2.5: lev ≤ 0.95/(2.5 × sd) = 0.38/sd.
 *   sd=0.01 → 38 (clamped to hardCap)
 *   sd=0.05 → 7.6 → floored to 7
 *   sd=0.08 → 4.75 → floored to 4
 */
export function maxSaneLeverage(slDistPct, hardCap = 10) {
  const sd = Math.max(0.0001, Number(slDistPct) || 0.0001);
  const lev = 0.95 / (2.5 * sd);  // = 0.38 / sd
  return Math.max(1, Math.min(Math.floor(lev), Math.max(1, hardCap)));
}

/**
 * Pure-functional sizing. Never throws; returns a SKIP verdict on
 * bad input so the caller can skip the trade cleanly.
 *
 * @param {object} p
 * @param {number} p.equity          wallet equity (USDT or INR)
 * @param {number} p.freeUSDT        free cash (for margin cap)
 * @param {number} p.entry           planned entry price
 * @param {number} p.stopLoss        planned stop-loss price
 * @param {number} [p.riskPct=1]     per-trade risk as % of equity (1 = 1%)
 * @param {number} [p.riskPctMax=2]  hard ceiling for risk% (clamps)
 * @param {number} [p.tierLeverage=5] desired leverage from signal tier
 * @param {number} [p.levMin=5]      leverage floor
 * @param {number} [p.levMax=10]     leverage ceiling
 * @param {number} [p.liqToSlRatio=2.5]  minimum liq-distance / SL-distance
 * @param {number} [p.maxMarginUsePct=35]  total margin cap as % of equity
 * @param {number} [p.openMargin=0]  existing open margin (for Σ cap)
 * @param {object} [p.instrument]    { maxLeverage, minQty, qtyStep }
 * @returns {object} sizing result
 */
export function computeSizing(p) {
  if (!p || typeof p !== 'object') return _skip('SKIP_BAD_INPUT', 'no params');
  const equity = Number(p.equity);
  const freeUSDT = Number(p.freeUSDT ?? p.equity);
  const entry = Number(p.entry);
  const stopLoss = Number(p.stopLoss);
  if (!Number.isFinite(equity) || equity <= 0) return _skip('SKIP_LOW_EQUITY', 'equity ≤ 0');
  if (!Number.isFinite(entry) || entry <= 0) return _skip('SKIP_BAD_INPUT', 'entry ≤ 0');
  if (!Number.isFinite(stopLoss) || stopLoss <= 0) return _skip('SKIP_BAD_INPUT', 'stopLoss ≤ 0');
  if (stopLoss === entry) return _skip('SKIP_BAD_INPUT', 'stopLoss === entry');

  const riskPct = clamp(Number(p.riskPct ?? 1), 0.05, Number(p.riskPctMax ?? 2));
  const slDistPct = Math.abs(entry - stopLoss) / entry;
  if (!(slDistPct > 0)) return _skip('SKIP_BAD_INPUT', 'slDistPct ≤ 0');
  const riskUSDT = equity * (riskPct / 100);
  if (!(riskUSDT > 0)) return _skip('SKIP_LOW_EQUITY', 'riskUSDT ≤ 0');

  // ---- leverage resolution (4 clamps, in order) ----
  const tierLev = Number(p.tierLeverage ?? 5);
  const levMin = Math.max(1, Number(p.levMin ?? 5));
  const levMax = Math.max(levMin, Number(p.levMax ?? 10));
  const instrumentMax = Number(p.instrument?.maxLeverage ?? levMax);
  const saneLev = maxSaneLeverage(slDistPct, levMax);
  let leverage = clamp(tierLev, levMin, levMax);
  leverage = Math.min(leverage, saneLev);
  leverage = Math.min(leverage, instrumentMax);
  // v20.7.3 FIX: the old bare `Math.max(levMin, leverage)` re-raised leverage
  // ABOVE the instrument cap whenever instrument.maxLeverage < levMin —
  // breaking invariant 4 (leverage ≤ instrument.maxLeverage). The levMin
  // floor itself is INTENTIONAL (test-locked): a sane-lev cap below levMin
  // must lead to the invariant-2 SKIP path ("can't fit even at levMin"),
  // never to a quiet sub-floor trade. So: floor at levMin, but the
  // instrument cap stays the final authority.
  leverage = Math.min(Math.max(levMin, leverage), instrumentMax);

  // ---- invariant 2: liq distance ≥ ratio × SL distance ----
  // liqDistancePct(lev) returns PERCENT (e.g. 19 for 5x).
  // slDistPct here is a FRACTION (e.g. 0.05 for 5%) — multiply by 100
  // so both sides of the comparison are in the same unit.
  const liqDist = liqDistancePct(leverage);
  const liqToSlRatio = Number(p.liqToSlRatio ?? 2.5);
  if (liqDist < liqToSlRatio * slDistPct * 100) {
    // try to reduce leverage until it fits — if levMin still doesn't fit, SKIP
    let lev = leverage;
    while (lev >= levMin && liqDistancePct(lev) < liqToSlRatio * slDistPct * 100) lev -= 1;
    if (lev < levMin) return _skip('SKIP_LIQ_TOO_CLOSE', `liq ${liqDist.toFixed(2)}% < ${liqToSlRatio}×SL ${(slDistPct * 100).toFixed(2)}%`);
    leverage = lev;
  }

  // ---- notional + margin + qty ----
  const notional = riskUSDT / slDistPct;
  const margin = notional / leverage;

  // ---- invariant 3: margin ≤ freeUSDT × 0.9 ----
  const marginCap = Math.max(0, freeUSDT * 0.9);
  if (margin > marginCap) {
    // cap the notional to the margin cap → qty shrinks, risk stays bounded
    const cappedNotional = marginCap * leverage;
    const cappedQty = cappedNotional / entry;
    const cappedRisk = cappedQty * Math.abs(entry - stopLoss);
    if (cappedRisk < riskUSDT * 0.1) return _skip('SKIP_MARGIN_CAP', `margin ${r2(margin)} > cap ${r2(marginCap)} (free ${r2(freeUSDT)})`);
    if (!_minQtyOK(_roundQty(cappedQty, p.instrument), p.instrument)) return _skip('SKIP_MIN_QTY', `capped qty ${_roundQty(cappedQty, p.instrument)} < minQty ${p.instrument?.minQty ?? '—'}`);
    // accept the capped version — risk is now smaller than asked; that's fine
    return _ok({
      equity, entry, stopLoss, riskPct, slDistPct, riskUSDT: cappedRisk,
      notional: cappedNotional, margin: marginCap, leverage,
      qty: _roundQty(cappedQty, p.instrument),
      guards: {
        marginOK: true, marginCapUsed: true, liqGuard: liqDistancePct(leverage) >= liqToSlRatio * slDistPct * 100,
        minQtyOK: _minQtyOK(_roundQty(cappedQty, p.instrument), p.instrument),
        cappedReason: `margin capped to free×0.9 (${r2(marginCap)}); risk reduced to ${r2(cappedRisk)}`,
      },
    });
  }

  // ---- total margin cap (existing open positions + this one) ----
  const maxMarginUsePct = Number(p.maxMarginUsePct ?? 35);
  const maxMarginUse = equity * (maxMarginUsePct / 100);
  const openMargin = Math.max(0, Number(p.openMargin ?? 0));
  if (openMargin + margin > maxMarginUse) {
    const headroom = Math.max(0, maxMarginUse - openMargin);
    if (headroom < marginCap * 0.1) return _skip('SKIP_MARGIN_CAP', `Σmargin ${r2(openMargin + margin)} > cap ${r2(maxMarginUse)} (${maxMarginUsePct}% equity)`);
    // reduce notional to fit the headroom, recompute qty
    const reducedNotional = headroom * leverage;
    const reducedQty = reducedNotional / entry;
    const reducedRisk = reducedQty * Math.abs(entry - stopLoss);
    if (!_minQtyOK(_roundQty(reducedQty, p.instrument), p.instrument)) return _skip('SKIP_MIN_QTY', `reduced qty ${_roundQty(reducedQty, p.instrument)} < minQty ${p.instrument?.minQty ?? '—'}`);
    return _ok({
      equity, entry, stopLoss, riskPct, slDistPct, riskUSDT: reducedRisk,
      notional: reducedNotional, margin: headroom, leverage,
      qty: _roundQty(reducedQty, p.instrument),
      guards: {
        marginOK: true, marginCapUsed: false, liqGuard: liqDistancePct(leverage) >= liqToSlRatio * slDistPct * 100,
        minQtyOK: _minQtyOK(_roundQty(reducedQty, p.instrument), p.instrument),
        cappedReason: `Σ-margin headroom ${r2(headroom)} < full margin ${r2(margin)}; risk reduced to ${r2(reducedRisk)}`,
      },
    });
  }

  // ---- qty rounding + minQty ----
  const rawQty = notional / entry;
  const qty = _roundQty(rawQty, p.instrument);
  if (!_minQtyOK(qty, p.instrument)) return _skip('SKIP_MIN_QTY', `qty ${qty} < minQty ${p.instrument?.minQty ?? '—'}`);

  return _ok({
    equity, entry, stopLoss, riskPct, slDistPct, riskUSDT,
    notional, margin, leverage, qty,
    guards: {
      marginOK: margin <= marginCap, marginCapUsed: false,
      liqGuard: liqDistancePct(leverage) >= liqToSlRatio * slDistPct * 100,
      minQtyOK: true,
    },
  });
}

function _roundQty(rawQty, instrument) {
  const step = Number(instrument?.qtyStep);
  if (!Number.isFinite(step) || step <= 0) {
    // default: 4 decimal places (USDT perp convention)
    return Math.round(rawQty * 10000) / 10000;
  }
  // floor to the step, then trim float noise (0.30000000000000004 → 0.3)
  const decimals = Math.min(12, (String(step).split('.')[1] || '').replace(/e.*$/, '').length || 0);
  const floored = Math.floor(rawQty / step + 1e-9) * step;
  return Number(floored.toFixed(decimals));
}
function _minQtyOK(qty, instrument) {
  const min = Number(instrument?.minQty);
  if (!Number.isFinite(min) || min <= 0) return true; // no min enforced
  return qty >= min;
}

function _ok(payload) {
  return { verdict: 'OK', ...payload, _t: Date.now() };
}
function _skip(verdict, reason) {
  return { verdict, reason, _t: Date.now() };
}

// ---- tier→leverage mapping (config-driven; defaults from the plan) ----
/**
 * Map an AI signal tier to a desired leverage.
 *   ELITE/STRONG (85+/80+) → 5x default, 7x when verified ≥ 95 + regime trending
 *   ACTION (65+)           → 5x
 *   below                  → no leverage bump (caller skips)
 */
export function tierLeverage({ tier, verifiedScore, regimeAligned, slDistPct, fundingNormal }) {
  const t = String(tier || '').toUpperCase();
  const v = Number(verifiedScore ?? 0);
  if (t === 'ELITE' || t === 'STRONG') {
    if (v >= 95 && regimeAligned && fundingNormal && slDistPct <= 0.012) return 10;
    if (v >= 95 && regimeAligned && fundingNormal) return 7;
    return 5;
  }
  if (t === 'ACTION') return 5;
  return null; // WATCH / NEUTRAL — caller should skip the trade
}
