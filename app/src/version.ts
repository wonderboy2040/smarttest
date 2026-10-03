// ============================================================
// src/version.ts — v20.3 SINGLE-SOURCE version marker
// ------------------------------------------------------------
// v20.2 zip shipped a "v20.0" header badge (two releases stale) because
// the badge + console banner were hardcoded strings nobody bumps. Every
// user-visible version claim now derives from HERE — the build gate
// (scripts/build_v203_full.sh) greps this file so the shipped app can
// never disagree with the shipped VERSION.txt again.
// ============================================================
export const APP_VERSION = '20.7.6';
export const APP_TITLE = `SmartAI Pro v${APP_VERSION} — TWO-DESK TERMINAL (India Intraday + CoinDCX) — futures order-form driver v2 (label-aware price/qty finder + limit-verify + market fallback) + 15s signal recheck loop + fresh deep ensemble analysis + CoinDCX futures direct-URL auto-entry`;
