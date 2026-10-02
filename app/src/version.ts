// ============================================================
// src/version.ts — v20.3 SINGLE-SOURCE version marker
// ------------------------------------------------------------
// v20.2 zip shipped a "v20.0" header badge (two releases stale) because
// the badge + console banner were hardcoded strings nobody bumps. Every
// user-visible version claim now derives from HERE — the build gate
// (scripts/build_v203_full.sh) greps this file so the shipped app can
// never disagree with the shipped VERSION.txt again.
// ============================================================
export const APP_VERSION = '20.7.5';
export const APP_TITLE = `SmartAI Pro v${APP_VERSION} — TWO-DESK TERMINAL (India Intraday + CoinDCX) — 15s STRONG/ACTION signal recheck loop + fresh deep ensemble analysis (15s self-recheck + full indicator transparency) + CoinDCX futures direct-URL auto-entry + SMC v2 structure engine`;
