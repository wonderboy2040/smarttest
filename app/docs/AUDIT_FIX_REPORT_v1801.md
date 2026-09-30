# AUDIT & FIX REPORT — v18.0.1 (2026-09-10)

Full deep audit of the repo (fresh clone → install → check → boot → API smoke) with all fixes applied.

## 1. Audit methodology

1. `git clone` → `npm ci` (main app + telegram-bot)
2. `npx tsc --noEmit` (strict TypeScript check)
3. `npx vitest run` (full test suite)
4. `npx vite build` (production bundle)
5. `node server/index.js` boot test → `/health` + 41 API route smoke (login → Bearer token → GET)
6. `npm audit` (main app prod + dev, telegram-bot prod)
7. `npm run check` in telegram-bot (syntax validation of all bot modules)
8. Docker / compose / nginx config review

## 2. Findings

### 2.1 BROKEN — TypeScript errors (6 errors, `npm run check` was failing)

**File:** `src/components/tabs/AITradingTab.tsx`
**Root cause:** `SignalCard.tsx` (v7.0.2) dispatches `mode: 'paper' | 'live' | 'notify'`
(`ExecHandler` type) — including the NOTIFY-only button — but the parent
`AITradingTab.tsx` wrapper callbacks (`onExecute`, `onExecuteIndia`,
`onExecuteFutures`) only declared `mode: 'paper' | 'live'`.

The underlying hook (`useAITrading.ts` → `executeSignal` / `executeIndia` /
`executeFutures`) already fully supports `'notify'`; only the wrapper type
annotation was stale. `npm run check` (typecheck gate) failed because of this,
so the repo as pushed did NOT pass its own validation pipeline.

**Fix applied:** widened the three wrappers' `mode` parameter to
`'paper' | 'live' | 'notify'` and added proper notify-mode toast messages
("Notify-only — alert + journal audit likha gaya, koi order nahi bana").
**Result:** `tsc --noEmit` → 0 errors.

### 2.2 SECURITY — npm audit vulnerabilities (5 total)

| Where | Package | Severity | Fix |
|---|---|---|---|
| main app | `qs` ≤ 6.15.3 (via express 4.22.2 `~6.15.1`) | moderate (GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g) | npm `overrides` → `qs@^6.16.0` |
| telegram-bot | `body-parser` 2.0.0–2.2.2 | low (GHSA-v422-hmwv-36x6) | `npm audit fix` |
| telegram-bot | `qs` ≤ 6.15.3 | moderate | `npm audit fix` |
| main app (dev) | `vitest`/`@vitest/mocker` ≤ 4.1.10 | moderate (GHSA-82fw-gwwq-j7x9) | `npm audit fix` |
| main app (dev) | `browserslist`/`baseline-browser-mapping`/`nanoid` | high/moderate | `npm audit fix` |

**Result:** `npm audit` → **0 vulnerabilities** (main app prod+dev, telegram-bot prod).
Lockfiles re-generated and verified in sync (`npm ci --dry-run` clean).

### 2.3 Verified working (no action needed)

| Area | Evidence |
|---|---|
| Tests | **833/833 pass** (42 files) — includes v702 audit suite, route-mount, intraday, futures, CoinDCX, blackScholes, durable storage |
| Production build | `vite build` ✓ — code-split chunks, PWA assets (sw.js, manifest.json, icons) all emitted |
| Server boot | `/health` → `{"ok":true}`; frontend served from `dist/` (HTTP 200) |
| API surface | 37/41 smoke routes → 200 with Bearer auth; the 4 non-200 are by-design: `GET /api/intraday-committee` (POST-only route), `/api/intraday-briefing` 502 (no AI keys configured → graceful), `/api/mcp/{indmoney,tapetide}/tools` 401 (OAuth not connected → by design) |
| `/api/ai/backtest` | 200 in ~12 s — heavy route (fetches real history); per-symbol graceful fallback when CoinDCX+Yahoo unreachable |
| Auth | PIN login → httpOnly cookie + Bearer sessionToken; fail-closed CORS in production |
| Telegram bot | All 8 modules pass `node --check`; bot guards when TG_TOKEN absent; placeholder token logs polling errors (expected — set real token) |
| Docker | Multi-stage `Dockerfile.frontend` (build → non-root server stage with HEALTHCHECK → nginx) + compose wiring verified |
| ML engine | In-process `server/mlEngine.js` — `/api/ml/health`, `/api/ml/regime` → 200 |

## 3. Final verification matrix (after fixes)

```
npm run typecheck  → PASS (0 errors)      [was: 6 errors]
npm test           → PASS (833/833)
npm run build      → PASS (4.6 s)
npm audit:all      → 0 vulnerabilities    [was: 5]
bot npm run check  → PASS
API smoke (41)     → 37×200 + 4 by-design
```

## 4. Deployment notes (unchanged from README)

- `cp .env.example .env` → set `APP_PIN` (required), optional AI/TG/broker keys
- Dev: `npm run dev` (5173) + `npm start` (8080)
- Prod: `npm run check && npm start` (serves dist + API on 8080)
- Docker: `docker compose up --build` (3000 + 8080)
