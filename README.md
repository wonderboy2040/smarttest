# SmartAI Pro v21 — Three-Desk AI Trading Terminal

> **v21.1.2 — REPORT PHASE-1 IMPLEMENTATION (full check report ke saare quick fixes + CoinDCX WS diagnosis tooling)**
> - **WS DOWN FALSE-POSITIVE FIX (Cause-1 CONFIRMED):** `OpsHealthStrip` ab `armed` flag respect karta hai — idle socket (koi subscriber nahi, refcounted streams band) grey "N idle" hai, red "WS DOWN" sirf armed+unhealthy pe. Server-side alert loop pehle se armed-aware tha; ab UI bhi wahi contract follow karta hai (`wsFeedView` pure helper + unit-tested). **Sandbox se LIVE probe verify: CoinDCX futures WS bilkul HEALTHY** (HTTP 200 → handshake → ns-ACK 0.1s → first tick join ke 0.3s baad, 114 ticks/30s) — matlab "WS Down" UI false-positive hi tha
> - **`cx-ws-probe.mjs` (NAYA diagnostic, app/scripts/):** 45s me stage-wise CoinDCX WS probe — HTTP reachability → WS handshake → namespace ACK → channel join → 30s tick window → **VERDICT** (HEALTHY / BLOCKED-geo / DNS-FAIL / TIMEOUT / NO-NS-ACK / SILENT-CHANNEL) + har verdict ka action. `node scripts/cx-ws-probe.mjs` (futures) ya `--spot` (spot socket). CoinDCX socket protocol ka verbatim mirror (EIO=4 framing, app-ping 25s, client-`2` violation se bachav)
> - **Health detail (1.5):** `/api/health` → `feeds.ws.*` me ab `cooldownReason` (`handshake-streak`/`silent-contract`/`glob-quiet`) + `failStreak` + `cooldownRemainMs` — OS strip WS tooltip me "kyun down" seedha dikhta hai, bina `/api/feed-status` ke
> - **Listener-leak hardening (1.4):** jevEngine ka process-`exit` hook ab `globalThis`-sentinel se cross-module-registry safe (vitest file-isolation me module state reset hota hai, `process` shared rehta hai — ab har registry me single listener)
> - **Lint ZERO (1.3):** eslint **128 warnings → 0** (0 errors) — TypeScript Language Services se scope-aware `_`-renames (shadowed `sl`/`tp`/`pair` params sahi binding hi rename hoti hai, destructuring `{ cap: _cap }`, imports `X as _X`) — 3505 tests ne behavior-neutral confirm kiya
> - **dist/ untrack follow-through (1.2):** remote push me dist wapas tracked aa gaya tha — ab `git rm -r --cached` + commit (har build pe 42-file noise khatam; supervisor ensureFrontend auto-build + CI gate waise hi zinda)
> - **Full suite green**: tsc ✓ · eslint **0/0** · vitest **3505/3505** (188 files, +10 naye: wsFeedView idle-vs-down + health cooldown shape) · check:routes ✓ · check:version 21.1.2 ✓ · npm audit 0

> **v21.1.1 — FULL ADVANCE-PRO RECHECK: 10 major + 15 medium + ~18 minor fixes (4 parallel deep-audit agents)**
> - **SAFETY (order-exec):** restart pe persisted L1 kill ab L1 hi restore hota hai (pehle hard-coded L3 — har Render redeploy mass-flatten fire kar sakta tha) · exec-stack hydrate ab durable-restore KE BAAD (ephemeral-FS pe restored live positions ka ladder management wapas) · **spot dust-guard ab order-placement se PEHLE** (pehle sub-min sell fire hoti thi phir check — exchange-accept pe journal row forever OPEN + 60s spam loop) · `/api/exec/kill` ab explicit integer 0-3 mangta hai; level 0 (disarm) ke liye `confirm:"CLEAR-KILL"` phrase (malformed request active kill clear nahi kar sakta) · futures: id-resolution miss / tpsl-fail pe `protectionMissing` stamp → watcher HAR pass native TP/SL re-arm karta hai jab tak lag na jaaye (pehle position bina SL ke forever) · futures ambiguous-entry UNKNOWN row (spot parity — duplicate live order block) · reconciler engine-ownership scan ab `symbol` field bhi dekhta hai (crash-window orphan safety net zinda hua) · PM flatten verdict-checked + retry ×2 + HONEST failure alert (pehle unconditional "FLATTENED" message jhoot bol sakti thi) · `e.pair??e.symbol` + REJECTED filter
> - **KILL SEMANTICS UNIFIED:** kill switch ab dono desks pe "no new entries, exits ENFORCED" (spot desk pehle kill ON pe live SL/TP closes SUSPEND kar deta tha — panic-kill dabane wala trader apne stops disarm nahi karna chahta). Reconciler ka read-only UNKNOWN-reconcile bhi kill ke under chalta hai (unblock path kabhi band nahi)
> - **KILL-RULE DEADLOCK FIX (Phase-4):** per-strategy pause ab LIVE-only block karta hai — paper continue (window refresh hota rehta hai → expectancy recover → auto-resume sach me reachable). Pehle sab-modes block ek one-way latch tha: negative window kabhi update hi nahi hoti thi · **India LIVE path ab goLiveGate + strategyGuard dono se gated** (UI ka "enforced on both desks" claim pehle sirf crypto ke liye tha) · GLOBALFUTURES SIM desk pe bhi kill-rule parity
> - **HEALTH MONITOR FALSE-ALERTS GONE:** WS alerts ab sirf ARMED streams pe (subscribers/wantOpen — headless deploy pe raat bhar ke "WebSocket down" spam khatam) · India feeds (groww-live/yahoo-delayed) market-closed pe stale-count me NAHI (raat/weekend ke false feeds_stale alerts khatam) · 24h+ purani heartbeat file ignore (previous-run leftover se permanent false "reconcile stuck" khatam) · data-dir probe 60s cache (request-path sync FS off) · `ok` ab kills + persist-failures + Bot Lab global pause sab dekhta hai · disk_ro message me failing dirs named
> - **DATA ACCURACY:** option paper-quote ka stale-chain fallback ab **5-min AGE-BOUNDED** (Groww outage me SL/T1/T2 frozen premiums pe evaluate hote the) · auto-entry ab live-LTP cross-check karta hai (>5% premium move pe stale card skip) · walk-forward "CALIBRATED on losing system" fix (train negative → NO_TRAIN_EDGE/NO_EDGE) · backtest cache-key me currentMinConfidence · **correlation discount ab revived votes pe bhi** (tape/structure revival false-diversity fix ko undo kar raha tha) · vision breaker fast-fail (cooldown me 90s timeout burn nahi) · expertMode 4h candles time-bucketed (index-chunk overnight gaps span karta tha) · NSE lotSize static-stamp + lotSizeSource marker · FII buy/sell ab status me exposed
> - **UI:** BacktestPanel me **🔬 WALK-FORWARD toggle** (Phase-4 feature pehle API-only tha — ab per-symbol train/test R + verdict + summary chips dikhta hai) · PIN login 429 ka server reason surface (global-lockout message dikhne laga) · AgentPanel 15s→30s copy fix · restored-note timer cleanup · StrategyHealthPanel "enforced on all desks" (India wired) · sw.js base-relative registration · desktopNotify icon fix
> - **SETUP-v20.bat FALSE-FAIL FIX:** verify step ab version-agnostic regex (`v2[0-9]`) — v21 dist pe literal "SmartAI Pro v20" match nahi hota tha aur installer achhe install ko ROLLBACK kar deta tha
> - **Ledger boot-restore:** `ai-signal-ledger.json` ab durable backup se restore hota hai (Render restart pe Phase-4 counters/kill-windows silently zero nahi hote)
> - **Alert-spam throttles:** spot + futures watcher errors ab per-pair 30-min throttle (bad keys/dust loops pe har-60s Telegram khatam — channel mute ka raasta band)
> - **pinAuth:** per-IP limiter ab sirf FAILURES count karta hai (rapid successful re-login burst 429 nahi deta) · TRUST_PROXY `true/yes/on` bhi accept (sirf `1` nahi) + PaaS-hint me "false"/"0" values ignore
> - Minor batch: exec-enter stage-aware journal status (REJECTED→FAILED/SUBMITTED_UNKNOWN), reversal-reduce qty>0 guard, strategyGuard env footguns (empty-string + window<minTrades clamp), expiry-day pick after 15:30, per-underlying cooldown map, watchdog banner, optionsDesk underlyings msg
> - **Full suite green**: tsc ✓ · eslint 0 errors (128 warnings) · vitest **3495/3495** (187 files, +7 naye contract tests) · build+stamp 21.1.1 · check:routes ✓ · check:version ✓ · npm audit 0 (app + telegram-bot)

> **v21.1.0 — PHASE 1-4 RELIABILITY & SIGNAL-ACCURACY UPGRADE (user-plan implementation)**
> - **Phase-1 quick fixes**: proxy-addr CVE critical → 2.0.8 (0 vulnerabilities, dono lockfiles) · **dist/ ab git me TRACKED NAHI** (har commit me 40+ hashed-bundle noise khatam — supervisor ensureFrontend auto-build + CI har push pe build verify karta hai; Render build command: `npm ci && npm run build`) · PaperTradePanel stale-closure hook bug (reportSymbols dep) · **eslint 175 → 125 warnings** (0 errors) + 18 empty-catch ab `swallow()` dev-debug helper se visible · **REAL DATA BUG**: FII/DII `fiiBuyCr/fiiSellCr` hamesha 0 the (NSE rows ka buyValue/sellValue accumulate hi nahi hota tha)
> - **GitHub Actions CI** (`.github/workflows/ci.yml`): har push/PR pe wahi full gate jo local chalta hai (`npm run check` = typecheck + lint + version + 3464+ tests + build + route-contract) + dono (app + telegram-bot) npm audit high/critical pe fail
> - **Phase-2 order-exec hardening** (deep-audit findings): **AMBIGUOUS-ENTRY GUARD** — timeout/network pe order MAY fill ho sakta tha, plain FAILED journal se 30s agent tick DUPLICATE live order laga sakta tha; ab UNKNOWN position book hota hai jo one-per-pair block karta hai · **FUTURES PROTECTION-FIRST**: native TP/SL do baar fail ho → entry FLATTEN (pehle sirf note ke saath naked leveraged position reh jaati thi) · **Spot partial-TP ambiguity defer** (futures ka 5-min double-sell guard port) · **Reconciler kill L1/L2/L3 ab AI-desk + agent loop dono rokta hai** (pehle sirf /api/exec/enter) · L2/L3 flatten-fail + orphan-fail + tick-fail ab Telegram alerts ke saath honest · Bot Lab protection-catch flatten + NAKED-position alert · `TRUST_PROXY` PaaS auto-detect (Render pe sab users ek rate-bucket me nahi ginte)
> - **Phase-3 reliability**: **`/api/health` endpoint + OPS strip** (dono tabs me) — har feed ka last-tick AGE seconds me, WS health, teeno kill layers, Bot Lab snapshot, exec heartbeat (dead-man), data-dirs writability · **60s Telegram health-alert loop** (stale feeds >90s / WS down / kills / heartbeat gap / disk-ro — 15-min throttled) · **logGovernor me LOG_LEVEL** (debug/info/warn/error — `LOG_LEVEL=warn` se info-chatter gayab, flood control trigger point pe) · **jevEngine MaxListeners fix** (per-instance `process.once('exit')` → module-level registry) · **index.js 3720→3477 lines: AUTH SPLIT** → `server/security/pinAuth.js` (7 naye behavior tests + static guards updated)
> - **Phase-4 signal accuracy**: **PER-STRATEGY KILL RULE** — har source×market ka rolling 30-trade expectancy ledger se; negative → strategy AUTO-PAUSE (naye entries honest reason se reject, Telegram notify, recover hone par auto-resume) · **GO-LIVE GATE** — LIVE entries sirf jab PAPER track-record qualify kare (100+ settled trades, +expectancy, maxDD ≤ 8R; env-tunable) — `StrategyHealthPanel` (dono tabs) me LIVE LOCKED/UNLOCKED counters · **WALK-FORWARD backtest mode** (`?walkForward=1`) — 70/30 train/test split, learned-gate out-of-sample verify, overfit verdict (HIGH/MODERATE/CALIBRATED) per symbol + aggregate
> - **Deliverables**: `PHASE-2-LIVE-CHECKLIST.md` — live CoinDCX/Dhan/Binance/Telegram/Render flows ke manual items (PASS/FAIL log ke saath)
> - **Full suite green**: tsc ✓ · eslint 0 errors (125 warnings, -50) · vitest 3464+22 naye tests · build+stamp 21.1.0 · check:routes ✓ (88↔188) · check:version ✓ · npm audit 0 (app + telegram-bot)

> **v21.0.6 — FULL ADVANCE-PRO AUDIT: 8 major + 4 medium fixes (4 parallel deep-audit agents)**
> - **India options paper exits ab LIVE chain premium pe** (audit B1 — sabse bada accuracy fix): desk jahi real premium dikhata hai (direct NSE / Groww mirror / BSE), paper SL/T1/T2/BE-trail/EOD + P&L ab VAHI premium use karte hain. Pehle exits Black-Scholes model premium pe act karte the — SL model pe hit ho sakta tha jab live chain ne chhua tak nahi. BS ab sirf honest fallback (chain down / row missing), 30s per-underlying reprice cache
> - **1-lot option trades ab T1 pe poora close NAHI hote** (audit B2): pehle `qty=1` (option cards ka default) T1 pe 100% close ho jate the — advertised "50% book → trail / T2" KABHI run nahi hota tha aur track record +0.5R pe structurally capped tha. Ab un-splittable runner T1 pe **SL→breakeven** le leta hai, T2/BE tak ride karta hai (multi-lot ab bhi 50% book karte hain)
> - **Options auto-entry cooldown ab PER-UNDERLYING** (audit B3): pehle GLOBAL 20m cooldown NIFTY entry ke baad SENSEX ko bhi 20 min stall karta tha. Ab sirf usi underlying pe lagta hai (config spec ke मुताबिक). Re-entrancy guard + holiday-aware status window bhi
> - **CoinDCX paper futures ab chhote connected wallet pe bhi FIRE karta hai** (audit M1): ₹280-560 wallet + paper mode pe futures har cycle "margin too small" se skip hota tha jabki equity-sim chalta rehta tha ("sirf equity sim ka auto trade lagta hai" complaint ka last residue). Ab paper/notify me dono desks PRACTICE equity (₹10,000 baseline) pe size hote hain; 2-USDT floor sirf LIVE. Stale "sirf SPOT desk se entry hoga" messaging bhi fix (spot desk to v21.0.5 me hi gaya tha)
> - **🔬 Deep modal ka AI council ab SACHI me deep model use karta hai** (audit AI-B1): default debate=ON config me teeno debate calls scan model (qwen3:8b) pe chal rahe the — `↗R1·14B` chip ka promise sirf fallback single-shot pe poora hota tha. Ab `opts.deep` debate me bhi thread hai
> - **Vision AI failures ab board ka scan seat nahi park karte** (audit AI-B2): vision calls apna isolated `ollama-vision` circuit breaker arm karte hain (pehle shared `ollama` breaker 2 weak-JSON vision calls se 30s+ scan cooldown de deta tha)
> - **Vision cache ab timeframe-aware** (audit E1): 15m chart ka verdict 10-min window me 1d chart pe serve ho sakta tha — ab client active tf bhejta hai aur cache key tf se banta hai. Ollama-down pe honest 503 (misleading 502 hataya)
> - **Groww mirror OI-unwinding preserve**: negative OI-change (OI build-down) ab mirror se bhi pass hota hai (direct NSE parity); missing fields → 0. BSE whole-ladder hold ab sirf direct probes ko block karta hai — mirror apne 5-min backoff ke baad turant wapas
> - Minor: restore-path symbol cap 15→20 (BANKNIFTY 16-char), RISK_FREE 0.065→0.069 align, card lotSize chain-first, dead no-op ternary, SIMPLE-view PAPER nav chip, SAPTA manual 'spot' config normalize, EngineHealthStrip qwen3-vl chip + deep-ctx tooltip, ExpertPicks 30s copy, seatCorrelation dead code, telegram-bot version drift v18→v21.0.6
> - **Full suite green**: tsc ✓ · eslint 0 errors ✓ · vitest 3464/3464 (+11 naye) · build+stamp 21.0.6 · check:routes ✓ · check:version ✓

> **v21.0.5 — NIFTY REALTIME DATA FIX + COINDCX SPOT DESK REMOVED**
> - **NIFTY options ab REAL NSE chain — har host se**: v21.0.4 ka Groww-mirror formula ab NIFTY pe bhi — `groww.in/options/nifty` server-render karta hai asli NSE chain (108 contracts, real LTP/OI/IV/Greeks, weekly expiry list, lot size, live spot). Ladder: **direct NSE FIRST** (richest feed — volume + saari expiries; residential/laptop hosts pe wahi chalta rehta hai) → NSE block kare to **Groww mirror** (datacenter/VPS/cloud friendly) → dono fail tabhi honest model chain (amber banner, dono paths named + auto-retry). 10-min negative-hold se blocked host pe dead probe free rehta hai
> - **Chip ab `LIVE NSE CHAIN · GROWW`** jab mirror serve kare (direct pe `LIVE NSE CHAIN` jaisa pehle) — BANKNIFTY-family sirf direct NSE pe (unki Groww pages client-side hain)
> - **CoinDCX tab me SPOT desk COMPLETELY REMOVED** (user spec): ab sirf **⚡ GLOBAL FUTURES (USDT)** + **🌍 EQUITY SIM (AAPL/NVDA/…/SPACEX)** — spot switcher button, spot board fetch, spot execute handler, SPOT·WS heartbeat tier, Swing/Whales/Orderbook spot-analytics section aur crypto Backtest/ModelPerf panels sab hata diye. Auto-agent ki third picks strip ab **EQUITY SIM PICKS** dikhati hai (pehle invisible thi); shared infra (wallet, execution console, mesh, reversal, correlations) intact

> **v21.0.4 — SENSEX OPTIONS REAL LIVE DATA (Groww public mirror)**
> - **SENSEX options ab REAL BSE chain**: Groww ka public option-chain page (`groww.in/options/sp-bse-sensex`) server-render karta hai asli BSE SENSEX chain — real LTP, OI/prevOI, exchange Greeks + IV, weekly expiry list, lot size 20, live spot. App isse `__NEXT_DATA__` se parse karta hai (90s cache, 5-min backoff) — **datacenter/VPS/cloud pe bhi kaam karta hai** (jahan BSE direct Akamai-block karta hai)
> - **Ladder design**: Groww mirror FIRST → direct BSE candidates second (future-proof) → dono fail tab honest `bs-model-sensex-always` + rose banner ("auto-retry chalu rehta hai") — model mode ab RARE case hai
> - **Real analytics ab SENSEX pe bhi**: PCR 1.55 / Max Pain / OI walls / GEX / ATM IV — pehle ye SENSEX me hamesha null the
> - **UI honesty**: chip `LIVE BSE CHAIN · GROWW` (teal) + `sourceVia` field; scan rows me SENSEX = LIVE BSE; F&O cards me `LIVE BSE PREMIUM`
> - NIFTY-family NSE path untouched (jaisa tha waisa — live NSE + recoverable model fallback)

> **v21.0.3 — OPTIONS ACCURACY + PAPER-DESK VISIBILITY + OLLAMA MODEL STRIP**
> - **Options root-cause fix**: NSE live chain ka `DD-Mmm-YYYY` expiry (jaise `13-Oct-2026`) ab source par hi ISO me normalize hota hai — pehle galat/far expiry chain dikhti thi, Greeks/GEX/DTE null/zero the, aur option paper trades **server reject** ho jaate the (ISO regex) — "options accurate nahi / paper trade show nahi hua" ka asli reason. Defensive normalize `openPaperTrade` me bhi (live formats kabhi reject nahi honge) + BANKNIFTY51000CE jaise 16-char contract IDs ab allowed
> - **Paper Desk ab hamesha visible**: SIMPLE view (default) me bhi Paper Trading Simulator dikhta hai + option paper trade khulte hi turant toast + instant refresh (pehle 15s poll wait)
> - **Ollama model strip dono tabs me**: India + CoinDCX desk-top par hamesha-visible chip — `QWEN3·8B ↗R1·14B` (scan + deep), hover par vision model/ctx/RAM guard/installed list; 🔬 deep modal ka "AI COUNCIL" ab real model naam dikhata hai (`ollama:deepseek-r1:14b`); gamma 4dp precision
>
> **v21.0.2 — DEDUP + LOCAL AI + TELEGRAM SELF-HEAL + DIST-IN-REPO**
> - **Duplicate-indicator fix**: BOS/CHoCH ab sirf SmartMoneyICT me (StructurePro = Fib/VP/S&D/EMA key-level seat); VWAP ab sirf Tape seat me (VolumeFlow = pure volume family); core-seat correlation guard (ledger-settled corr > 0.85 → weight ×0.5); aiScore self-echo band; TopPicks + board grid ek hi rank formula
> - **Ollama superintelligence**: qwen3:8b scan seat + deepseek-r1:14b deep seat + qwen2.5vl:7b VISION seat (chart screenshot pe "Vision AI" button); native /api/chat (num_ctx + keep_alive + think-strip — 4k silent truncation fix); 16GB RAM guard
> - **Telegram self-heal**: boot-time self-test (401/403/400 loud diagnosis), watchdog ab telegram-bot/node_modules khud install karta hai (crash-loop fix), intraday sender unified, 24h delivery-health counters

Advance Pro Intelligence trading terminal with three dedicated, self-contained desks:
- 🇮🇳 **India Intraday Desk (NSE)**: Real-time signals, 10-model consensus committee, paper trading simulator, journal, options desk, and Dhan execution.
- ₿ **CoinDCX Desk (Crypto Futures + Equity SIM)**: Global Futures (USDT perps) + Equity SIM desk, autonomous trading agent, wallet sync, reversal engine, and perp intelligence. *(v21.0.5: SPOT desk removed — sirf Futures USDT + Equity SIM.)*
- 🤖 **JEV Bot Lab**: 3-arm honest signal pipeline (rules | gated | jev), ORB/LVL strategies with honest backtests, paper-trading virtual accounts, kill-switches and decision stream.

---

## ⚡ Quick Start (Windows — no commands needed)

> Full details in **`RUN-FIRST.md`**. Short version:

1. Install **Node.js v20+ LTS** (one time, https://nodejs.org)
2. Extract the zip anywhere
3. Open the **`app`** folder → double-click **`Start-SmartAI-Watchdog.bat`**
4. First run auto-installs deps + builds the frontend (internet needed, 2–5 min)
5. Open http://localhost:8080 (PIN is in `app/.env` → `APP_PIN`)

**Updating to a new version?** Copy/extract the new files over the old folder,
restart the Watchdog bat — it detects the stale `dist/` build (version-stamp
mismatch) and **rebuilds automatically**. The UI also shows a red
`BUILD STALE` banner if the served frontend ever lags the server code.

## 🧑‍💻 Developer Quick Start

### 1. Prerequisites
- **Node.js**: v20 or higher
- **npm**: v10 or higher

### 2. Setup
```bash
cd app
npm install
```

Configure your environment variables in `app/.env` (see `app/.env.example` for details):
```env
PORT=8080
APP_PIN=your_custom_pin
```

### 3. Development
```bash
# Start Vite development server
npm run dev

# Start backend server
npm start
```

### 4. Build & Production
```bash
# Typecheck
npm run typecheck

# Verify API routes
npm run check:routes

# Build optimized production bundle
npm run build

# Run server in production
npm start
```

---

## 🧪 Testing & Verification

```bash
# Run unit and integration tests
npm test

# Run full project checks (typecheck + test + build)
npm run check
```

---

## 📁 Repository Structure

```
smarttest/
├── app/
│   ├── public/              # Static assets, manifest.json, sw.js
│   ├── server/              # Express API server, MCP tools, real-time streams
│   │   ├── ai/              # AI models, agents, self-improvement engine
│   │   ├── intraday/        # NSE market scans, paper trading, journal
│   │   ├── mcp/             # MCP data agent mesh (CoinDCX, TapeTide, IndMoney)
│   │   └── data/            # Local cache & session data (gitignored)
│   ├── src/                 # React 19 frontend
│   │   ├── components/      # UI components (IndiaIntradayTab, CoinDcxTab, etc.)
│   │   ├── hooks/           # Custom React hooks (useAuthState, etc.)
│   │   └── utils/           # Client API, secureStorage, telegram helpers
│   ├── telegram-bot/        # Telegram alert and command bot subsystem
│   ├── ml-service/          # Machine learning microservice
│   └── test/                # Comprehensive Vitest test suite (150+ test files)
└── .gitignore               # Root ignore rules for node_modules, .env, and build files
```

---

## 🛡️ License
Private / Proprietary.
