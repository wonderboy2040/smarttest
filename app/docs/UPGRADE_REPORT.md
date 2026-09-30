# Upgrade & Verification Report

Date: 15 July 2026
Version: 1.1.0

## Changes applied

1. **Removed critical Telegram dependency vulnerabilities**
   - Upgraded `node-telegram-bot-api` from `0.66.x` to `1.2.x` in the standalone bot.
   - Upgraded `node-cron` from `3.0.x` to `4.6.x`.
   - Regenerated the bot lockfile and removed vulnerable transitive `request`, `form-data`, `qs`, `tough-cookie`, and old `uuid` paths.
   - Final production audit: 0 known vulnerabilities in both package trees.

2. **Fixed Docker Compose backend startup**
   - The `node-server` service previously used the final `nginx:alpine` stage, which has no Node runtime or `server/index.js`; its `node server/index.js` command could not work.
   - Compose now explicitly builds the named `build` stage from `Dockerfile.frontend`, which contains Node, installed packages, source, and the production bundle.

3. **Improved Nginx proxy support**
   - `/health` now reaches the real Node health endpoint instead of returning the SPA HTML fallback.
   - Added forwarded headers, HTTP/1.1 upgrade support, disabled buffering for EventSource/SSE, and extended the live-feed timeout.

4. **Removed duplicate backend startup logic**
   - Environment validation now runs through one validation path.
   - Removed duplicate authentication startup logging.

5. **Project maintenance upgrade**
   - Updated compatible root dependencies and lockfile versions.
   - Added Node.js `>=20` engine declarations.
   - Added `typecheck`, `check`, and `audit:all` scripts.
   - Added complete setup, Docker, ML service, Telegram, test, and deployment documentation.

## Verification results

- Strict TypeScript (`tsc --noEmit`): **PASS**
- Vitest: **41/41 tests PASS** across 3 test files
- Vite production build: **PASS** (2,264 modules transformed)
- Node syntax checks (`server/*.js`, `telegram-bot/*.mjs`): **PASS**
- Python bytecode compilation (`ml-service/app`): **PASS**
- Root production `npm audit`: **0 vulnerabilities**
- Telegram production `npm audit`: **0 vulnerabilities**
- Backend startup without `APP_PIN`: **correctly refuses unsafe startup**
- Backend startup with valid minimum configuration: **PASS**
- `/health`: **HTTP 200 JSON**
- `/`: **HTTP 200 production frontend**
- Missing JavaScript asset: **HTTP 404**, not incorrect SPA HTML

## Scope and limitations

Static checks, unit tests, builds, server startup, routing, and dependency security were verified. Features that require private credentials or external accounts cannot be end-to-end validated without those credentials, including:

- AI provider responses and quotas
- Telegram delivery to the configured chat
- Google Apps Script cloud persistence
- Dhan and Shoonya account data
- Finnhub and other live market-provider availability
- ML model training quality and live upstream datasets

No secret values were added to the archive. Configure them from `.env.example` after extraction.
