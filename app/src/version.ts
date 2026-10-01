// ============================================================
// src/version.ts — v20.3 SINGLE-SOURCE version marker
// ------------------------------------------------------------
// v20.2 zip shipped a "v20.0" header badge (two releases stale) because
// the badge + console banner were hardcoded strings nobody bumps. Every
// user-visible version claim now derives from HERE — the build gate
// (scripts/build_v203_full.sh) greps this file so the shipped app can
// never disagree with the shipped VERSION.txt again.
// ============================================================
export const APP_VERSION = '20.6.1';
export const APP_TITLE = `SmartAI Pro v${APP_VERSION} — TWO-DESK TERMINAL (India Intraday + CoinDCX) — OLLAMA_DEEP_MODEL support: qwen3:8b scan + deepseek-r1:14b deep analysis on 16GB (auto-swap, OLLAMA_MAX_LOADED_MODELS=1)`;
