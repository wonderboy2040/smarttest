# Deep Recheck Report — SmartAI Pro v20.4.2

## Verification (all green)
| Check | Result |
|---|---|
| `npm install` (app + telegram-bot) | OK |
| `tsc --noEmit` | 0 errors |
| `npm run check:routes` | PASS |
| `npm run build` (Vite) | OK |
| `node --check` on every .js/.mjs (server, telegram-bot, scripts, public) | 0 syntax errors |
| `vitest run` | 153 files / 2737 tests passed (+1 new regression test) |
| Python `compileall` (ml-service) | OK |
| Server boot smoke test (`/api/ping`, `/`, login flow) | OK |
| Secret scan (keys / tokens / private keys) | none (only dummy test token) |

## Issues found & fixed
1. **False "HARD KILL" alarm on every restart** (`server/ai/selfHeal.js`)
   `initSelfHeal()` wrote this run's `boot` record *before* `reportLastExitOnBoot()` read the journal,
   so the last record was always its own boot → always reported HARD KILL (even after clean shutdown / first run).
   Fix: snapshot the journal tail before writing the boot record. Regression test added in
   `test/selfHealGuard.test.ts` (verified it fails without the fix).
2. **Session cookie always `Secure`** (`server/index.js`, login + logout)
   On plain HTTP (LAN IP, Safari, non-localhost) the browser silently dropped the cookie.
   Fix: HTTPS (incl. `x-forwarded-proto: https`) → `SameSite=None; Secure`; HTTP → `SameSite=Lax`.
   Cross-origin HTTPS deployments (Vercel → Render) behave exactly as before. Verified live with curl.
3. **Mojibake (double-encoded UTF-8)** in `server/index.js` — 41 places incl. user-visible console warnings
   and the multi-engine consensus message (`â€”`, `ðŸ¤`, `â”â”`, `â˜ï¸`). Repaired to proper — → 🤝 ━ ☁️.
4. **Duplicate folder** `scripts/fixtures/fixtures/` (identical copies, unreferenced) removed.

## Notes / recommendations (not changed — config or design choices)
- `APP_PIN` should be ≥ 8 chars; `ALLOWED_ORIGINS` must be set for cross-origin deployments (CORS is fail-closed).
- `/api/health` requires auth (401 without login) — use `/api/ping` for unauthenticated uptime checks.
- `index.html` redirects any `*.vercel.app` host to `https://smartai1.onrender.com` (hard-coded) — change if your backend URL differs.
- Many mesh-agent / AI-provider keys are unset by default (see `.env.example`); those features abstain honestly.
