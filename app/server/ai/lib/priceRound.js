// ============================================================
// server/ai/lib/priceRound.js — adaptive price-level precision
// ------------------------------------------------------------
// v9.2: the plan/blueprint/position layers used to round every
// price to a FIXED 2 decimals (r2). For sub-1 instruments —
// DOGE ~0.08 USDT, SHIB/PEPE sub-cent, JUP micro-ticks — that
// rounding COLLAPSED the levels onto each other:
//      entry 0.08 · SL 0.09 · T1 0.08 · T2 0.08   (DOGE futures)
//      entry 0.10 · SL  0.10 · T1 0.09            (OP futures)
// An SL that equals the entry is an instant stop-out; targets at
// the entry can never pay. To the user this reads as "SHORT lagaya
// aur trade galat direction me gaya" — the position opens and
// immediately closes on a level that was never really there.
//
// The expert-picks desk already had this as its local pR(); this
// module is the ONE shared source for every layer that rounds a
// PRICE (plan levels, liquidation estimates, peak prices, trail
// stops). Rupee/USDT *amounts* (notional, margin, P&L) keep r2.
//
// Rules (mirror expertPicks.pricePrecision):
//   |v| ≥ 1        → 2 decimals   (₹2,590.35 · 2.52 USDT)
//   |v| ≥ 0.01     → 4 decimals   (0.0848 · 0.6400)
//   |v| ≥ 0.0001   → 6 decimals   (0.00000881-class micro ticks)
//   smaller        → 8 decimals   (PEPE-class)
// ============================================================

export function pricePrecision(p) {
  const v = Math.abs(Number(p) || 0);
  if (!Number.isFinite(v) || v === 0) return 2;
  if (v >= 1) return 2;
  if (v >= 0.01) return 4;
  if (v >= 0.0001) return 6;
  return 8;
}

/** Round a PRICE to adaptive precision (null/undefined pass through as null). */
export function pRound(v) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(pricePrecision(n)));
}

/** Max sane stop distance as a fraction of price — a stop further than
 *  this (e.g. a 283%-ATR meme coin) puts LONG stops negative / SHORT
 *  targets negative. 30% keeps even the 3R target positive (1 − 3×0.30
 *  = +10% of price) on both sides; anything wider is untradeable noise. */
export const MAX_STOP_FRACTION = 0.30;
