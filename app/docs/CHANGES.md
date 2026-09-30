# Changelog

## v20.4.2 — SYMMETRIC DIRECTION CERTIFICATE: dono taraf 100% pakka (2026-09-30)

**User directive: "SHORT signal pe LONG jata hai ya SHORT — 100% pakka. LONG signal pe SHORT jata hai ya LONG — 100% pakka. PAKKA BATAO AISA details me."** v20.4.1 ka certificate sirf SHORT direction lock karta tha; v20.4.2 ne **LONG mirror** add kiya — certificate ab SYMMETRIC hai (20 locks: 10 SHORT + 10 LONG).

### The symmetric final answer (test-locked, not words)
- `test/directionProof.test.ts` — **20 locks**, BOTH desks (spot/margin/futures) × BOTH modes × BOTH directions:
  - **SHORT card → SHORT trade. 100%.** Paper: position.side 'SHORT' + entry fills adversely (sell-side). LIVE: exchange body `side:'sell'` (spot) / `order.side:'sell'` (futures perp) + SHORT-polarity native TP/SL (stop > entry, profit < entry). Margin SHORT: `margin_amount_short` filled, liquidation ABOVE entry. Exit: stop breach **buys back**.
  - **LONG card → LONG trade. 100%.** Mirror of every lock above: `side:'buy'`, `margin_amount_long`, liquidation BELOW entry, TP/SL LONG-polarity, exit **sells out**.
  - **Silent flip structurally impossible (dono directions me)**: clicked SHORT + fresh consensus LONG (ya clicked LONG + fresh SHORT) → PAPER still opens the REQUESTED side (honest FLIPPED note) / LIVE **honest REJECT — ZERO signed requests leave the server**.
- Full suite: **2737 tests / 153 files 100% green** · supervisorGuard 54/54 · tsc clean · vite build OK.
- Direction trio re-verified: directionProof 20 + directionIntegrity 19 + cryptoCounterTape 8 = 47/47.

## v20.4.1 — DIRECTION CERTIFICATE: SHORT card pe SHORT hi hota hai (2026-09-30)

**User directive: "sirf short signal pe long ho ya short — pakka final batao; Top world AI Agent recheck; world ke top strategies strong signals ke liye."** Post-v20.4 end-to-end re-audit of the FULL direction chain (client card → gauntlet → exchange order body → booked position → exit polarity) with a dedicated proof suite.

### The final answer (locked by tests, not words)
- `test/directionProof.test.ts` — **10 locks** across BOTH desks (spot/margin/futures) and BOTH modes:
  - STRONG 80+ SHORT card (paper + live) → position.side === 'SHORT', exchange body `side:'sell'`
  - Clicked SHORT while the fresh consensus flipped LONG → PAPER still opens the REQUESTED side (SHORT) with the honest FLIPPED note; LIVE **honest REJECT with ZERO signed requests** ("fresh consensus LONG hai, aapne SHORT card pe trade maara tha")
  - LIVE margin SHORT → `margin_amount_short` filled, liquidation ABOVE entry
  - Futures LIVE SHORT → nested `order.side:'sell'` + native TP/SL with SHORT polarity (stop > entry, profit < entry)
  - SHORT exit → stop breach closes by **buying back** ('buy' order side)
- Full suite: **2727 tests / 153 files 100% green** (3 consecutive runs; +2 isolation locks) · tsc clean · vite build OK.

### Bonus fix caught BY the audit (v20.4.1 zip smoke)
- The smoke's app-tree-mutation gate caught `ai/selfHeal.js` hardcoding `server/data/exit-reasons.log` module-relative — every exit wrote into the app tree even with SMARTAI_DATA_DIR set (the v20.3 hermetic sweep missed this leaf). Fixed in selfHeal.js + supervisor.js (same env contract as lib/store.js); 2 new locks in selfHealGuard.test.ts (behavioral: fresh-module import writes INSIDE the sandbox root; source: env-before-default resolution). Smoke now asserts the booted app tree stays byte-identical.

### Strategy-stack audit (world-class components verified ACTIVE)
- 10-model quant committee (TrendMatrix/MomentumQuant/VolatilityScope/VolumeFlow/PatternNeural/SRMatrix/OptionsFlow/MacroRegime/SmartMoneyICT/IntradayTapeMTF) + AI Council LLM (Gemini→Groq→Cerebras) + sentiment/instflow/fundamentals + 4 mesh alt-data seats (congressional/insider/vendor-consensus/on-chain)
- MTF confluence caps · probrain v9.3 quality layer (counter-tape ban, chase guard, session phase) · adaptive Bayesian weights (live-outcome self-correction) · regime weights
- STRONG gate: conf ≥ 75 AND agreement ≥ 70% AND plan risk ≤ cap AND counter-tape/chase/MTF caps — a STRONG badge is EARNED, not printed.

## v20.4 — COINDCX DIRECTION FIX: crypto counter-tape wiring (2026-09-30)

**User report (CoinDCX tab): "Trade signal Strong 80+ SHORT rehne par bhi LONG jaa raha hai"** — the board printed STRONG 80+ SHORTs while the 15m tape/price kept climbing. Deep pro-trader-level trace (signal → votes → consensus → quality → execution) found a **wiring gap**, not a math bug: the direction math was correct everywhere, but one protection was dead on the crypto desks.

### Root cause (mechanical, 3-layer verified)
- probrain's v9.3 **counter-tape STRONG-ban** (MISALIGNED htf-vs-15m phase → conf −12/−18 + WATCH/ACTION grade caps) was built for EXACTLY this bug — but `signals.js` fed the quality verdict `enr?.ltfInd`, the **INDIA-only** enrichment map (`enrichN = INDIA ? … : 0`). On CRYPTO/FUTURES `enr` is always null → mtfAnalysis compared the 1h committee against ITSELF (LTF was also 1h) → the MISALIGNED phase could never fire off India.
- The 15m tape enrichment the crypto desks DO fetch (`tapeEnriched`) only VOTED (w 1.3) — it can never out-vote 5-7 lagging 1h seats (combined w ~5-9) that turn bearish AFTER the dump, exactly when the tape V-bounces. Result: a lagging 1h bear stack printed STRONG SHORT at the bottom of the V — the user shorted the bottom and watched the trade "go LONG".
- The deep path had the same self-compare (LTF = the 1h ctx candles), so the card the execution gauntlets re-verify at click time carried the same blind spot.

### Fix (3 surgical wiring changes, zero math changes)
- **Board path**: CRYPTO/FUTURES quality verdicts now receive the crypto 15m tape enrichment (`tapeEnriched` — the SAME data the tape vote reads) as the LTF: 1h-stack-vs-15m-tape conflicts demote exactly like the India desk (counter-tape conf −12/−18 + WATCH/ACTION cap), a CONFIRMING tape keeps the desk tradeable, and the structure stop lands on real 15m swings.
- **Deep path**: same wiring (hoisted `_cxTapeEnr`), so the deep card == the board card again.
- **VWAP domain fix**: `fetchCrypto15mTape` — the TV row's vwap is USD-domain while crypto-spot candles are INR; unscaled it poisoned the tape vote's VWAP leg with a ~×85 divergence (every crypto tape paid the "far from VWAP" mean-reversion penalty on the wrong side). Now scaled onto the candle domain (no-op on USDT desks / rows without vwap).

### What this changes on your CoinDCX tab
- A STRONG 80+ SHORT against a RISING 15m tape can no longer wear STRONG — it demotes to WATCH ("🛑 COUNTER-TAPE hard — tape roll hone do") or ACTION (stalling tape), with the honest reason on the card.
- SHORTs with a CONFIRMING (falling) 15m tape keep their grades — protection ≠ paralysis.
- The auto-executor (STRONG-only) and the live gauntlets now refuse counter-tape entries at the source.

### Tests
- **8 new locks** (`test/cryptoCounterTape.test.ts`): unit (probrain MISALIGNED/caps on CRYPTO + the ltf=null inertness doc) + board (rising-tape demotion + confirming-tape parity) + deep (card agreement) — hermetic, same mock pattern as intradayTapeAlignment/cryptoBoardFallback.
- Full suite: **2715 tests / 152 files 100% green** · tsc clean · zero regressions (the MTF-6 layer and all trust guards untouched).


## v20.3 — FULL-SITE RECHECK: 14 code fixes + packaging honesty rebuild (2026-09-30)

**User directive: "Full site code recheck and issues fix kardo".** 4 parallel deep-audit agents (server/ai · intraday+root · client · build/deploy/test-infra) + main-agent spot-verification: 27 findings, **14 source-code fixes + 8 packaging/deploy fixes + 5 test-infra fixes** implement kiye. Suite ab **2707 tests / 151 files 100% green** (16 nayi v20.3 locks — v203DeepAudit + targeted suite extensions); tsc clean; vite build OK; engineV4 time-of-day flake khatam.

### Server — HIGH (signal integrity)
- **Replay lookahead bias (R1)**: `replay.js` ke 15m/1h TF votes ab sirf COMPLETED buckets use karte hain (decision = current 5m bar ka close). Purana check bucket START test karta tha (`ts - 0` leftover) — in-progress bucket ke close/high/low FUTURE ke 5m bars se resampled hote the (1h TF pe ~55 min future leak, weight 1.8 — har winRate/avgR/PF/maxDD systematically optimistic). Gate replay ab tuning ke liye sach me honest hai.
- **Board universe base filter (R7)**: `signals.js` board tiered scan ab pre-filtered INDIA_UNIVERSE base pass karta hai. `tieredScanUniverse` ka `exclude` sirf discovered rows + hot map filter karta hai — 44/45 editor names T1 the, toh removed name har board cycle me scan hota raha (v20.2 wala "editor board pe apply hota hai" fix default mode me adhoora tha).

### Server — MED (money paths)
- **Futures partial-TP double-sell guard**: ambiguous transport error (timeout/network) ke baad watcher har 60s SAME market order re-send karta tha (40%+40%+… book slice). Ab `partialRetryAfter` 5-min hold (spot ka v18.9 fix ported) + reconcile pass exchange qty sync karta hai.
- **Futures reconcile qty-sync**: `(p.tp1Hit || p.tp2Hit)` guard hataya — app/native exchange partial close ab book qty turant sync karta hai (P&L/daily-cap/liquidation math stale nahi rehta).
- **Paper exit slippage (parity)**: v20.2 entry-side +7bps sirf entry pe tha — har paper EXIT mid pe bharta tha (~7bps flattered, har leg). Ab watchPositions full close, partialCloseSpotLeg, manual close — teeno adverse fill + `slipNote` journal stamp. LIVE fills exchange-real hi rehte hain.
- **Relaxed calibration stamps (parity)**: FUTURES / GLOBALFUTURES / INDIA paper paths ab `relaxed: true` stamp karte hain (sirf CRYPTO desk tha) — flipped/sub-floor practice fills ab KISI bhi desk se calibration corpus me nahi ghushte.
- **Telegram env-key outage**: `telegramPush` ka sink + backup alerter `telegramConfig({})` (secrets-only) resolve karte the — TG_TOKEN/TG_CHAT_ID env-only deployment pe 5s level pushes, 30s STRONG scans, 60s backup SAB silently no-op (jabki watcher close messages aate rehte the). Ab routes `tgEnv` inject karta hai.

### Server — LOW
- **TrackRecord flip-cooldown**: scanner (60s) vs AI-board (30s) direction disagreement row ko har cycle FLIP-close+reopen karta tha (levels churn, 40/day cap burn). Ab 30-min/symbol cooldown — genuine flip ek baar, churn nahi.
- **STRONG format currency**: futures plans ab "B-USDT Perps · 65,000 USDT" (hardcoded ₹ galat label tha).
- **MATIC dead seed** hata → POL (FUTURES_UNIVERSE + precision map).

### Client
- **CandleChart tick-loop (HIGH)**: `ltp` load-deps me tha — har live price tick (crypto 800ms batch) naya `load` banata tha → 60s interval teardown + instant 96-bar refetch (API abuse loop on liquid names). Ab ltpRef se padha jata hai.
- **CandleChart TF-race**: `reqSeq` per-request token — slow 5m response 15m switch ke baad land karke gal chart paint nahi kar sakta. Candles ab OHLC-validated (ek null `high` poora chart NaN kar deta tha). Flat-range guard negative-safe.
- **AgentPanel wallet dedup**: 4th independent 60s signed wallet poller bhi shared `useWalletPoll` me (v20.2 dedup ne is panel ko miss kiya tha).
- **PortfolioHeat SIM separation**: EQUITY SIM (USDC) paper rows REAL equity ke heat meter me count nahi hote (false HOT/DANGER band + "book risk off" advice). Header count bhi real-only ("+ N SIM" honest suffix).
- **SSE stale-token reconnect**: ProTraderAutoPanel + positions stream — native EventSource reconnect stale-token URL loop karta tha; ab error pe close + fresh-URL re-attach (useIntradayStream pattern). GateReplayPanel unmount pe abort + setState guard. Toast dedup FIFO eviction (bulk clear re-toast bug).

### Build/deploy — the v20.2 zip was defective (v20.3 packaging rebuild)
- **Dev data leak**: rsync `--exclude 'server/data'` galat anchored tha — v20.2 zip me dev ke 20 runtime files (server.log, journals, secrets placeholders) aaye the. Ab pattern 'data' + hard absence assert.
- **Stale source shipped**: v20.2 zip ka src/ test/ v20.1 ka tha (CandleChart, GateReplayPanel, useWalletPoll, desktopNotify, v202 test suite — sab missing). Ab poora source tree sync (scripts curated — dev build scripts bahar).
- **Version claims**: package.json 20.1.0 (zip me!), App badge "v20.0", watchdog bat v20.1, README install line v20.1, server banner v20.1 — sab ek source se: `src/version.ts` (APP_VERSION) + package.json 20.3.0 + build gates.
- **smoke_v202_zip.sh kuch assert nahi karta tha** (always exit 0) — naya `smoke_v203_zip.sh` real assertions ke saath (login token, candles 200+ok+bars, replay 200+ok+trades, version markers, offline boot).
- **ml-service /MIR data-loss**: upgrade user ke trained models (`ml-service/store/`) delete kar deta tha (backups me bhi nahi the). Ab `/XD store` + ml-service backup+rollback coverage dono bats me.
- **VERSION-MANAGER version parse**: findstr whole-line return karta tha → malformed VERSION.json. Ab PowerShell ConvertFrom-Json se exact number.

### Test infra
- **Suites ab fully hermetic**: `src/test/setup.ts` global `SMARTAI_DATA_DIR` (mkdtemp) — 8 suites (futures/mandateFreeze/trailing/v70/aiSecrets/agent/indiaAgent/clearClosedPositions) dev ke LIVE `server/data` me likh rahe the (journal erase, trailing disable, config reset — wahi pollution zip me bhi gaya tha). settings/durable/portfolioSync apne fs-assertions bhi env-dir pe redirect.
- **engineV4 time-of-day flake**: counter-regime test real clock pe 09:15-09:45 IST window me fail hota tha (session-pace volume boost → scores 100 pe saturate → early-phase cap dono 88 → diff 0). Sabhi 6 unpinned tests ab SAT_NOON_IST deterministic clock pe.
- **16 nayi locks**: v203DeepAudit (replay bucket semantics ×3, flip-cooldown ×2, currency format ×2, ambiguous classifier) + aiOrders exit-slip + telegramPush env-keys ×2 + indiaBoardTiered base-filter ×2 + futures/global/india relaxed-stamps ×3 + v70/v702/v189 fee suites slip=0 isolation.

## v20.2 — INTRADAY + COINDCX TABS: full feature-audit UPGRADE — 16 upgrades implemented (2026-09-30)

**User directive: "Intraday TAB & coindcx tab me existing features deep check karo accurately aur kya kya upgrade and improvement kar sakte hai details me batao" → "sabhi phases accurately implement and apply kardo".** Dono tabs ka dual-agent deep audit (~48 sections mapped) + main-agent spot-verification, phir roadmap ke sabhi phases implement kiye. Suite ab **2691 tests / 150 files 100% green** (16 nayi v20.2 locks); tsc clean; vite build OK.

### Phase 1 — P0 fixes (honesty gaps)
- **Board → Track-Record wiring (A1)**: AI Superintelligence board ke ACTIONABLE signals (STRONG+ACTION, valid plan) ab `recordSignals()` me jaate hain — TrackRecordPanel ka "har published signal track hota hai" waada ab sach me board ke liye bhi sach hai (pehle sirf unpolled legacy scanner feed karta tha). Naya `server/ai/boardAccountability.js` — engine-identical qty formula, LEVEL-FREEZE idempotent, wrong-side-plan rejection. FUTURES/GLOBALFUTURES skip (USDT/USDC plans vs INR watcher quotes — unit mismatch, explicitly documented).
- **FUTURES STRONG alerts (A2)**: insta-push STRONG scan me 3rd live desk add (pehle sirf CRYPTO+INDIA scan hote the — B-USDT perps ke STRONG signals kabhi push hi nahi hote the). GLOBALFUTURES (SIM) deliberately excluded.
- **Wallet 3×→1× polling (A4)**: WalletCard + WalletStrip + PortfolioHeat ke 3 independent 60s pollers (3 signed CoinDCX wallet calls/min) ab EK shared `useWalletPoll` store (useSyncExternalStore) — 1 poller, N subscribers, last-unmount pe timer park.
- **QuickNav + copy fixes (A6)**: CoinDCX nav me SELF-FIX / MY TRADES chips + FUTURES desk pe PERP chip (3 sections pehle unreachable the); PerpIntel "60s"→90s honest copy (2 spots); "15 live tools"→18; TOOL_LABEL me 4 missing tools (backtest/news/verify/consensus) — ab raw snake_case nahi dikhta.

### Phase 2 — latency + UX + data-honesty
- **Spot SL fast-path 60s→5s (B3)**: level-touch detect hone par insta-push sink (5s cadence) ab `watchPositions()` ko TURANT fire karta hai (DI-injected, no import cycle) — violent candle pe spot SL ab max ~60s nahi baithta (futures me exchange-native TP/SL pehle se tha). **Telegram keys ke bina bhi chalta hai** (SL execution alerts pe depend nahi karta — `_tick` restructure).
- **PRICE CHARTS (B5)**: poore desk ka pela candlestick chart — naya `/api/ai/candles` endpoint (MTF-6 ka hi fetch chain: CoinDCX→Binance/Bybit→Yahoo, 60s cache, LTP-scale conversion) + `CandleChart.tsx` (SVG candles, 5m/15m/1h/1d toggle, ENTRY/SL/T1/T2 dashed overlays, honest degrade). SignalCard me lazy "📈 PRICE CHART" strip + dono desks ke deep modal me first-class chart.
- **USDINR single source (B7)**: naya disk-backed `ai/lib/usdinr.js` — dono private FX caches (cryptoStream + futures) ab shared last-known-good store me record karte hain; flat-84 fallback ab SIRF tab jab process ne kabhi live rate nahi dekha (pehle: cold boot + Yahoo outage = ~5% INR-twin error har jagah). routes.js ke 4 hardcoded-84 sites migrated.
- **TrackRecord/Journal self-poll (B8)**: dono panels 60s visibility-gated tick pe refresh (pehle sirf paper open/close pe — "Currently Tracking" indefinitely stale reh sakta tha).
- **Universe Editor → Board (B9)**: board scan ab user ke universe edits honor karta hai (removedBase excluded from tiered AND legacy static scan; custom symbols Tier-1 cadence pe) — pehle TATAMOTORS remove karne ke baad bhi board pe dikhta tha. Tooltip honest copy update.

### Phase 3 — realism + calibration
- **Intraday GATE REPLAY harness (C10)**: naya `/api/ai/replay` + `server/ai/replay.js` — 5m bars pe bar-by-bar replay of THE QUANT GATE STACK (MTF 3-TF weighted ladder, chase 2.5/1.8×ATR guard, OB/OS RSI suppression, conf grade ladder, ATR plan, T1-50%+BE-trail discipline — trackRecord jaisa hi exit model). Win-rate/avgR/PF/maxDD + per-gate rejection funnel. `GateReplayPanel` India tab ke Backtest Lab me. Honest: quant-proxy (LLM council replay nahi hota), fills bar-close, intrabar SL-first conservative.
- **Paper-fill realism (C11)**: practice fills ab +7bps adverse slippage (AI_COINDCX_SLIP_BPS env, 0=off) lete hain — mid-price fills paper P&L ko flatter nahi karte. **Calibration corpus hygiene**: relaxed practice entries (flipped/sub-floor consensus wale) ledger me `relaxed: true` stamp hote hain aur trust.js calibration/Brier/monthly se EXCLUDED — engine-ne-endorse-nahi-kiya entries claimed-vs-actual calibrate nahi karte.
- **Binance projection divergence guard (C12)**: Binance→INR projected tick anchor se >0.3% drift kare to `binance-proj-drift` label — UI me amber **Binance·PROJ** pill (extrapolated price kabhi venue-confirmed jaisa GREEN nahi dikhta).
- **TrackRecord live LTP (C13)**: watcher (tracked symbols = priority class) + 60s self-poll = "Currently Tracking" ab live (B8 ke saath naturally complete).

### Phase 4 — desk hygiene
- **Equity SIM separation (D14)**: GLOBALFUTURES (USDC SIM) entries ab REAL desks ke daily trade/loss budget me count NAHI hote — SIM P&L alag report hota hai (`simTradesCount`/`simRealizedPnlINR`, OrderConsole me alag book line). SIM desk ka APNA discipline cap ab sim* counters pe (self-limiting intact).
- **Desktop notifications (D15)**: naya `desktopNotify` util + AlertsPanel me ENABLE button — naye STRONG signals hidden tab pe OS toast (Notification API; Telegram out-of-browser channel hai, ye in-browser). 30s throttle + per-symbol:side dedup; permission sirf user-click se.
- **Visibility gating (D16)**: EngineHealthStrip + SelfImprovementPanel ke network polls hidden-tab pe band (baaki sab pehle se gated the).

### Tests
- NEW `test/v202DeepAudit.test.ts` (11 locks) + telegramPush.test.ts me fast-path executor suite (3 locks) + futures.test.ts me last-known-good FX case. Suite: **150 files / 2691 tests 100% GREEN**; tsc clean; vite build OK (CoinDcxTab 130KB / IndiaIntradayTab 169KB chunks).

## v20.1 — FULL-SITE + TRADE-SIGNAL DEEP RECHECK: 10 real bugs fixed (2026-09-29)

**User directive: "full site code recheck aur trade signal ko deep recheck karo koi issues hai tho fix kardo or upgrade kardo".** Teen parallel audits chale (frontend 46 files, server infra ~45 files/63k lines, signal engine 6,646 lines hands-on: signals.js + optionsDesk + optionsScan + mtf + winProb + signalVerifier + entryTiming + models tapeVote). Signal engine math CLEAN nikli (ensemble/MTF-6/win-prob/SVA layers sab prior-audit hardened); 10 real bugs surface layers me mile — sab fixed + test-locked.

### Frontend (6)
- **[HIGH] DepthLadder.tsx — L2 order-flow widget PERMANENTLY DEAD tha**: `apiFetch` RAW Response deta hai; `setView(r)` us Response ko hi store kar raha tha (Response structurally `DepthView` ka `ok: boolean` satisfy karta hai — tsc chup, widget hamesha "L2 depth unavailable" render karta tha) jabki har card har 2s me /api/ai/depth poll karta rehta. Ab JSON parse hota hai + background tab me poll wire pe nahi jata.
- **[MED] CoinDcxTab deep-modal indicator block**: v18.5 ka IndiaIntradayTab fix (object indicators har key pe `.adx` print karte the) CoinDCX desk pe port hi nahi hua tha — ab identical per-key logic.
- **[MED] useCxLivePrices — token baked into SSE URL**: mount-time token URL me fix tha; session expire hone ke baad har reconnect wahi dead-401 URL loop karta tha. Ab URL HAR connect attempt pe rebuild hota hai (fresh token; useIntradayStream parity).
- **[MED] api.ts + useAuthState — mid-session 401 dead-end**: token expire hone pe saare polls 401-loop karte the, PIN gate manual F5 tak nahi dikhta tha. Ab koi bhi 401 throttled `session-expired` event fire karta hai aur shell auth-state reset karke PIN gate pe gir jaata hai.
- **[LOW] ProTraderAutoPanel — SSE sirf mount-time token pe lagta tha**: session-restore se pehle mount hua to live-log stream lifetime bhar nahi lagta. Ab 1s token-wait loop.
- **[LOW] deskShared tooltip**: "Auto-refresh every 30s" → 60s (REFRESH_MS=60_000 tha).

### Server (4)
- **[MED] bandwidth.js — unbounded telemetry scopes**: REST middleware full `req.path` ko scope key banata tha — parameterized routes (/api/fundamentals/:symbol) per-symbol scope mint karte the aur `_scopes`/`_lifetime` kabhi prune nahi hote. Ab route-template collapse (`:p`) + hard 200-scope LRU cap.
- **[MED] index.js — raw XFF trust on 3 rate-limiters**: `clientIp()` (chart/quote/fundamentals pubGuard), `/api/telegram`, aur PUBLIC `/api/ml/*` mlGuard — teeno unconditionally `X-Forwarded-For` trust karte the; ek LAN peer har request pe fresh IP forge karke rate-limit ko bypass kar sakta tha (ML endpoints CPU-bound hain — event-loop saturation vector). Teeno ab hardened `clientIpOf()` use karte hain (XFF sirf TRUST_PROXY=1 ya loopback pe).
- **[LOW] /api/ai-consensus stance inversion**: BULLISH-first substring test — koi bhi bearish answer jisme "buy" word hota ("do NOT buy") BULLISH classify ho jata tha. Ab dono keyword classes count hote hain; strict majority jeet-ta hai, mixed answer honest NEUTRAL.
- **[LOW] meshModels.js — warm-seat store never evicts**: `_store`/`_lastQueryAt` process-lifetime grow karte the (rotating CoinDCX pairs + India F&O discovery). Ab 30-min age-sweep har warm tick pe.

### Test hygiene
- **durable.test.ts flake killed**: AES-GCM envelope test 2-char plaintext `'AT'` ko pure base64 envelope me search karta tha — random GCM auth tag kabhi-kabhi literally "AT" se START hota hai (live run me pakda gaya). Ab distinctive 19-char plaintext — invariant same, assertion cryptographically deterministic.

### Tests
- NEW `test/v201DeepAudit.test.tsx` — 8 regression locks (DepthLadder JSON render + honest degrade, SSE token re-read per reconnect, 401→session-expired event + auth reset, bandwidth route-template + 200-cap, meshModels age-sweep). Suite ab **2675 tests / 149 files 100% green**; tsc clean; vite build OK.

# Changelog

## v20.0.1 — DEPS AUTO-INSTALL: fresh installs bina npm install bhi boot honge (2026-09-29)

**Live bug (D:\SmartAI26): v20 full zip me node_modules nahi hota (user-data rule) — NAYE folder pe Start-SmartAI-Watchdog chalate hi `ERR_MODULE_NOT_FOUND: dotenv` crash-loop, aur supervisor GALAT "port conflict" hint de raha tha.** Fix teen layers me:

### supervisor.js (v19.2 engine + v20.0.1 deps self-heal)
- **Preflight audit**: boot se PEHLE package.json ke saare dependencies vs app\node_modules check — missing ho to `npm install --omit=dev --omit=optional --no-audit --no-fund` KHUD chalata hai (output `[npm]` lines me relay; max 15 min = WATCHDOG_INSTALL_TIMEOUT_MS). Fresh install pe pehli run ab khud dependencies laga legi.
- **Crash sniff**: child stderr me `ERR_MODULE_NOT_FOUND` mila (aadhi line bhi — exit pe buffer flush naya hai) → journal reason `deps-missing(exit(..))` + HONEST Hindi message ("DEPENDENCY MISSING"), GALAT "port conflict" hint band. Ek auto-install retry (max 2 per run), phir bhi missing → 60s cool delay + "khud chalao: npm install" guidance (budget-pause anti crash-loop pehle se hi tha).
- **Race-free**: npm install ke dauran restart-tick + startChild blocked (`state.installingDeps`).
- **Honest UP line**: spawn pe "server START" bola jata hai; "server UP" tab bolte hain jab PEHLA /api/ping OK ho (pehle crash ke turant baad "UP" likha jata tha — misleading tha).
- Naye knobs: `WATCHDOG_AUTO_INSTALL=0` (off), `WATCHDOG_INSTALL_TIMEOUT_MS`, `WATCHDOG_APP_ROOT` (rare override).

### Windows installer (fresh-install support)
- v20.0.1 full zip ab **node_modules (prod-only, pure-JS) OFFLINE bundled** karta hai — internet ke bina bhi fresh install boot hota hai (npm fallback sirf offline-copy fail ho).
- SETUP/VERSION-MANAGER: target me node_modules missing → payload se copy (user ka existing node_modules kabhi overwrite NAHI hota); `.env` missing → auto-create (APP_PIN random generate + console pe print; AI keys baad me .env.example se add kar sakte ho).
- 1-CLICK-FIX.bat (DEPS-FIX hotfix zip): D:\SmartAI26 jaise half-broken installs ke liye — auto-locate → supervisor.js replace → node_modules install → .env fix → watchdog start, ek click me.

### Option cards — date-window bug (test suite ne pakda)
- **`expiryLabel()` day ab 2-digit PADDED**: `2026-10-06` → `06Oct` (pehle `6Oct` banta tha). Sirf Oct/Apr/Jan jaise mahino ke 1-6 din wali expiry window me dikhta tha — runtime next-weekly single-digit day pe ho tab card-name contract `/^\d{2}Mon$/` toot jaata tha (date-rot-proof test ne live pakda). Card names ab fixed-width — layout bhi stable.

### Tests
- NEW supervisorGuard v20.0.1 block (11 tests: preflight/off-env/timeout/tries-guard/honest messages/flush-race) — suite ab **2667 tests / 148 files 100% green**; smoke_v201.mjs 14/14 REAL-process proof (fresh app → REAL npm install → ping 200; restart pe koi spurious install nahi; auto-install OFF pe honest crash). smoke_v192 17/17 + smoke_v20 8/8 regression green; tsc clean. optionSignalCards expiryLabel contract reconciled (05Jan).

## v20.0 — TWO-DESK REBUILD: India Intraday + CoinDCX ONLY (2026-09-29)

**User spec: "site me sirf Intraday TAB & CoinDCX TAB ko hi rakho, baaki sab completely remove karo, full site completely redesign karo — high performance & high accuracy, sab full optimize karo, future upgrade/downgrade ke liye perfect installer, Windows ke liye full setup .zip me, unwanted files cleanup."** v20.0 is a full-site rebuild: the terminal is now EXACTLY two desks, the shell is near-zero-cost, the frontend ships 5x smaller, and a version-managed installer (upgrade / downgrade / rollback) replaces overlay patches.

### WHAT WAS REMOVED (86 frontend files, provably dead)
- TABS: Dashboard, Portfolio, Planner, Macro(Risk) — UI + their entire module trees.
- SHELL: NeuralChat (chat bubble), PortfolioHealthMonitor, InstallPWA prompt, StaticMirrorBanner, Add/Edit portfolio modal, VIX/sentiment/USD-INR ticker strip, PWA widget page (public/widget.html).
- STATE: the 2570-line useAppState (portfolio prices polling, forex loop, INDMoney sync, IndexedDB per-tick snapshots, cloud merge) replaced by a 140-line useAuthState (PIN auth + session restore + theme + ONE /api/ping heartbeat per 30s).
- UTILS (37): liveStream, tvWebsocket, wealthEngine, portfolio*, riskEngine, taxOptimizer, monteCarlo*, inflation*, dipEngine, smartMoney, superintelligence*, mlApi, fundamentalsApi, advancedScreener, exportData, assetPnl, costBasis... all portfolio/planner/macro-only engines.
- SW: the service worker's 15-min portfolio background-sync engine + widget data + P&L badge + price notifications — rewritten as a lean app-shell SW (cache v20; /api/* NEVER cached; activate evicts ALL legacy caches incl. old private-API leftovers).
- Deletions are import-graph-proven (scripts/trace_deps.py): the two desks' transitive closure was computed BEFORE deletion; tsc + 2656 tests + build + boot smoke all green after.

### WHAT STAYED (battle-tested v19 desks, untouched)
- India Intraday desk: 10-model signal board, committee, top-5 picks, options desk, swing, paper trading, journal, track record, Dhan execution, morning brief, agent console, near-miss engine, universe editor, MTF confluence.
- CoinDCX desk: live board (WS), signal cards + MTF/edge, perp intel, order console, manual-trade monitor, reversal, models + performance, mesh status, alerts, agents (crypto/ask-AI), self-improvement panel, pro-trader auto, wallet, backtest, ledger, trust layer.

### PERFORMANCE (the redesign's measurable wins)
- Shell chunk: 18.26 kB (was ~400+ kB monolith path) — instant PIN-to-desk boot. Desks lazy-loaded as separate chunks (India 163 kB / CoinDCX 130 kB / shared 295 kB), each behind ErrorBoundary + auto-retry chunk reload.
- Shell recurring network cost: ONE /api/ping per 30s (4s timeout). No ticker polls, no forex loop, no INDMoney sync, no per-tick IndexedDB writes.
- SW: app-shell + SWR statics only; every /api/* (incl. SSE) network-only.
- Backend: unchanged battle-tested route surface (every desk endpoint intact) + the full v19.1/v19.2 anti-freeze stack.

### ACCURACY PROTECTION
Both desks' engines (committee quorum, council verdicts, MTF confluence, verifier gates, near-miss harvesting, self-improvement loop) are byte-identical v19 code — the rebuild only removed NON-signal surfaces. All 2656 desk/server tests green, zero engine drift.

### INSTALLER (the "perfect upgrade/downgrade setup")
- SETUP-v20.bat: auto-locates the install, backs up current code (server/data + .env + node_modules NEVER touched), applies the v20 payload (dist/ public/ are MIRRORED — stale hashed chunks die = unwanted-file cleanup), writes VERSION.json, verifies (node --check + dist marker).
- VERSION-MANAGER.bat: applies ANY future SmartAI zip with the standard app/ layout — upgrade or downgrade, same 4-step guarded flow (locate -> backup -> apply -> verify, auto-rollback on verify fail).
- ROLLBACK.bat: one-click restore of the last backup.
- Start-SmartAI-Watchdog.bat now launches the v19.2 ANTI-FREEZE SUPERVISOR (node server\supervisor.js) — hang + crash auto-recovery; this is the recommended way to run the site.

### TESTS + SMOKE
- NEW test/v20TwoDesk.test.tsx — 16 contracts: exactly two desks, lazy+boundary wiring, zero shell fetch loops, strong-PIN login, removed-file guards (16 files stay deleted), auth server-side contract, heartbeat shape, SW private-data rule, no background-sync.
- Suite: 148 files / 2656 tests 100% GREEN (7 obsolete portfolio tests removed). tsc clean. Build 3.7s.
- NEW scripts/smoke_v20.mjs — 8/8 with the REAL server + new build: /api/ping, v20 shell served, hashed chunk on disk, PIN login -> token, /health selfheal+consoleguard, SSE route alive, v20 banner. Anti-freeze smoke (smoke_v192.mjs): 17/17 incl. real freeze-recovery.

## v19.2 — ANTI-FREEZE SUPERVISOR + QUICKEDIT GUARD (2026-09-29)


**User spec: "site atak raha hai" (hung, not crashed) — the v19.1 follow-up.** v19.1 made the server crash-immune and log-pipe-safe, but one failure class stayed UNRECOVERABLE: the HANG. Process zinda hai, event loop FROZEN (Windows QuickEdit console select-mode, a blocked stdout pipe, a sync stall) — health checks time out, the site "atak jaati hai", and the process NEVER exits, so no restart trigger ever fires. The v19.1 watchdog bat only restarted on EXIT; a hung child never exits. v19.2 closes exactly that gap, and does it with an INDEPENDENT heartbeat the child cannot fake or share.

### THE FIX (3 layers, hang-first)
- **LAYER 1 — external anti-freeze supervisor (server/supervisor.js, NEW)**: `node server\supervisor.js` (what Start-SmartAI-Watchdog.bat now runs) spawns the server as a child (marker `SMARTAI_SUPERVISED=1`), RELIABLY drains its stdout (a always-drained pipe can never fill and freeze the child — console + rotated file log `server/data/logs/server.log` 5MB x 2), and every 20s GETs **/api/ping** from its OWN event loop. 3 consecutive timeouts after the 45s boot-grace = **FREEZE verdict** -> force-kill (taskkill /F /T tree-kill on Windows) -> journal -> restart. A boot that never comes up hits the same verdict via fails+3 (boot-hang). Child EXIT (crash/OOM/V8 fatal) -> journal + restart with exponential backoff (3s..60s, reset after 10 min stable) and an hourly restart budget (20/hour -> 10 min pause instead of crash-loop CPU burn). Ctrl+C = graceful (child gets the shared-console ctrl event on Windows; supervisor waits 8s, then force-kills, journals watchdog-clean-shutdown, exits 0). The supervisor itself never exits on internal errors (own uncaught/unhandled stay-alive). **CRITICAL found live in smoke: the interval timers must stay REF'd — unref'd timers let the supervisor's own process die silently the moment the child's stdio pipes close, killing the scheduled restart (the "restart #1 3s baad" that never came).**
- **LAYER 2 — /api/ping (NEW public route)**: a ZERO-work liveness endpoint (no snapshots, no fs, no middleware work) registered BEFORE /health and added to PUBLIC_PATHS — response time IS the event-loop heartbeat. /health stays the deep status endpoint (now also carries `consoleguard` + `supervised` fields).
- **LAYER 3 — QuickEdit programmatic guard (server/ai/consoleGuard.js, NEW)**: the #1 REAL "site 5-10 min me atak jaati hai" root cause on Windows portables is conhost QuickEdit mode: any accidental click in the console puts it in text-select mode, conhost stops draining stdout, the pipe fills, the next console.log blocks forever = event loop frozen, process alive. One best-effort PowerShell child at boot flips the shared console's input mode (kernel32 SetConsoleMode: clears 0x0040 ENABLE_QUICK_EDIT_MODE, sets 0x0080 ENABLE_EXTENDED_FLAGS). Runs in BOTH the supervisor (covers the shared console) and index.js (covers startai.exe direct boots; skipped when supervised to avoid double-spawn). Verdict lands in `/health.consoleguard`; `QUICKEDIT_GUARD=off` to disable. Non-Windows / no-console / timeout paths all resolve silently — never blocks, never throws, never rejects.

### OBSERVABILITY
- supervisor journal entries (same `server/data/exit-reasons.log`, same 60-line cap): `watchdog-boot` / `watchdog-restart` (reason: freeze | boot-hang | exit(code)) / `watchdog-budget-pause` / `watchdog-clean-shutdown` — the next "site down/atak gaya" report is one file-read away from the exact verdict.
- file log `server/data/logs/server.log` (5MB x 2 rotation): child stdout + supervisor status lines, both tagged. `WATCHDOG_LOG_FILE=off` disables.

### KNOBS (all optional)
`WATCHDOG_PORT` (default PORT/8080), `WATCHDOG_PROBE_MS` (20s), `WATCHDOG_TIMEOUT_MS` (9s), `WATCHDOG_FAILS` (3), `WATCHDOG_GRACE_MS` (45s), `WATCHDOG_BACKOFF_BASE_MS` (3s), `WATCHDOG_BACKOFF_MAX_MS` (60s), `WATCHDOG_STABLE_RESET_MS` (10m), `WATCHDOG_MAX_RESTARTS_HOUR` (20), `WATCHDOG_BUDGET_PAUSE_MS` (10m), `WATCHDOG_LOG_FILE` (path|off), `WATCHDOG_JOURNAL`, `WATCHDOG_CHILD` (entry override), `WATCHDOG_DISABLE` (probes off = restart-on-exit only), `QUICKEDIT_GUARD` (on|off).

### TESTS + SMOKE
- NEW test/supervisorGuard.test.ts — 43 tests: consoleGuard (non-win32 skip, env off, PS command construction w/ SetConsoleMode + quick-edit bits, QEDIT_OFF/ALREADY_OFF/NO_CONSOLE verdicts, spawn-fail/timeout/error silent paths, never-rejects) · supervisor (knobs parse + garbage->default, spawn contract SMARTAI_SUPERVISED=1 + app-root cwd, fail streaks, FREEZE verdict only after grace, BOOT-HANG fails+3, crash-exit journal + backoff doubling/cap/stable-reset, restart tick timing, budget pause + resume, clean stop linux/win32 semantics + 8s force fallback, taskkill tree-kill, stdout/stderr relay + file log + 5MB rotation, hostile-data relay) · probe transport (timeout/ECONNREFUSED/2xx-4xx alive/5xx dead/sync-throw) · wiring source contracts (ping route pre-/health, PUBLIC_PATHS, consoleguard+supervised in /health, v19.2 + v19.1 markers intact). FULL SUITE: 158 files / 2757 tests 100% GREEN. tsc clean.
- NEW scripts/smoke_v192.mjs — 17/17 with REAL processes: real server boots under the supervisor (ping 200, /health supervised:true + selfheal.armed:true, clean SIGINT stop exit 0, no orphan) · **REAL FREEZE-RECOVERY: a fixture serving 4 pings then while(true) locks its event loop — supervisor catches it, force-kills, journals 'freeze', restarts, fixture serves again** · REAL CRASH-RECOVERY: exit(7) -> backoff restart -> run=2 alive · relay file log carries child + supervisor lines.

## v19.1 — NEVER-DOWN STABILITY GUARD (2026-09-29)

**User spec: "localhost pe 5-10 min ke baad site down ho raha hai — deep advance pro level pe fix karo, full site code deep recheck, .zip patch."** Deep diagnosis: 9-minute live repro with 2 SSE clients + API load = 0 health failures, flat RSS, stable FDs — the server core is sound. The "down after 5-10 min" vectors are ENVIRONMENTAL, and v18.1's own crash policy was the biggest one: any single uncaught exception ran flush-then-exit(1), assuming a supervisor would restart the process — on a Windows portable with no working watchdog, that IS the site going down and staying down. v19.1 installs defense-in-depth so no single failure can take the site down, and makes the NEXT failure self-explanatory.

### ROOT-CAUSE COVERAGE (3 independent layers)
- **LAYER 1 — crash immunity (selfHeal.js, new)**: uncaughtException now FLUSH + LOG + COUNTER + **STAY ALIVE** (the v18.1 exit-on-crash pair is retired from index.js). A stray sync throw in any callback can no longer kill localhost. `SELFHEAL_EXIT_ON_FATAL=true` restores the old exit-for-restart behaviour for supervised deployments (Render). unhandledRejection: counted + rate-limited (was log-only).
- **LAYER 2 — stdout volume governor (logGovernor.js, new)**: a piped/frozen Windows console (launcher stops draining, or QuickEdit select-mode freezes the window) fills the OS pipe buffer in minutes of multi-stream logging — the next console.log blocks FOREVER and the event loop hangs: process alive, site dead, exactly at 5-10 min. The governor dedupes repeats (xN collapse) + rate-caps lines/min (default 240; excess dropped + counted) so the pipe can never fill from normal chatter. `LOG_GOVERNOR=off`, `LOG_LINES_PER_MIN`, `LOG_DEDUPE_MS` knobs.
- **LAYER 3 — external watchdog (Start-SmartAI-Watchdog.bat, new, optional)**: double-click launcher alternative that auto-restarts the server 5s after ANY exit (covers V8 OOM fatals and SELFHEAL_EXIT_ON_FATAL deployments — the two cases in-process guards cannot catch by design).

### OBSERVABILITY (the next "site down" is now self-explanatory)
- **exit-reason journal** `server/data/exit-reasons.log`: every boot + exit is one JSON line; the NEXT boot prints `[selfheal] previous run: CLEAN SHUTDOWN / EXIT(...) / HARD KILL (OOM ya force-kill likely)` — clean vs crash vs kill-9 becomes a one-line fact, not a guess.
- **/health enriched** with `selfheal` block: rss/heap/external MB (+ limits + pressure flag), event-loop lag (perf_hooks histogram, 30s buckets), crash counters, lastError, logGovernor stats, previousRun verdict. One URL answers "kitna RAM lag raha hai / kitna lag hai / kitne crashes se bacha".
- **memory watchdog**: 60s cadence vs limits (RSS 1400MB / heap 1100MB default; `SELFHEAL_RSS_LIMIT_MB`/`SELFHEAL_HEAP_LIMIT_MB`); on breach fires the trim registry — liveFeed aggressive prune (new `pruneLiveFeedNow()`) + candle-cache flush — and logs throttled.
- **event-loop lag watchdog**: >4s freeze in a 30s bucket logs the exact recovery hint (QuickEdit select-mode unfreeze: console pe click + Enter).

### FULL-SITE DEEP RECHECK (user-ordered)
- Audited ALL 40+ setInterval sites (unref + try/catch discipline verified), every fetch path (AbortSignal timeouts present incl. TG 10s / candles 8s / meta-ensemble breaker / Binance 6s), SSE backpressure guards (128KB writableLength cap, keepalive cleared on close), WS modules (cxSocketIo frame cap 1MB + safe wrappers; cxSpotWs/cxRtStream circuit breakers + negative caches + coalescing), bounded caches (candles 64-entry LRU, cxBookState 10-min retention, liveFeed 300-key eviction, usStream session prune, bandwidth scopes), bot restart backoff, login rate limiters — no new defect found; CoinDCX auto-trading desk scope re-verified (desks.spot=false, futures+global on).
- **9-minute live repro**: /health 0 fail / 106 polls, worst 2.2s, RSS flat 455-467MB, FDs stable, both SSE streams alive throughout — with the guard armed: 0 fail / 48 polls, [selfheal] armed + previous-run verdict logged.

### TESTS + SMOKE
- NEW test/selfHealGuard.test.ts — 27 tests: governor dedupe/cap/never-throw/off/reset, stay-alive (no exit + flush + counters), exit-on-fatal opt-in, rejection counting, memory watchdog (breach/throttle/heap/throwing-trim isolation), journal (clean/HARD KILL/exit-code/bounded), liveFeed prune hook, full wiring contracts (arm order, v18.1 handlers GONE, /health block, shutdown journal). FULL SUITE: 157 files / 2714 tests 100% GREEN. tsc clean.
- NEW scripts/smoke_v191.mjs — 16/16: boot, /health.selfheal shape, console verdict line, journal boot entry, SIGTERM journaled clean-shutdown, REAL uncaughtException in a child process survives (exit 0, "STILL ALIVE").

## v19.0 — SUPER INTELLIGENCE SELF-IMPROVEMENT ENGINE + AUTO-TRADING DESK SCOPE (2026-09-29)

**User spec: "muje iss complete system ko Super Intelligence Self Improvement AI banana hai" + "Coindcx tab me Auto Trading Sirf Global Futures USDT & Equity SIM USDC me Hi Auto Trading rakho Spot me nhi" + full-site recheck.** The system already MEASURED itself (adaptive weights, trust calibration, retrain infra) — but the loop never CLOSED: the ml-service model store was EMPTY, lessons evaporated weekly, gates were hand-set forever. v19.0 closes the loop: harvest -> drift -> learn -> propose -> approve, all tamper-evident.

### PHASE 1 — DATA FOUNDATION (the fuel)
- **outcomeHarvester.js** (new): ledger settled executions (raw entries — full vote maps + council stamps + plan risk) -> `selfimprove-outcomes.json` ML dataset. Idempotent (dedup by ledger id), r:null outcomes EXCLUDED (settlePositionOutcome's no-risk path would else become fake 0R losses), honest NOT-ENOUGH-DATA below 40 rows. v19.0.1 fix: reads `__ledgerRaw()` (the `recentEntries()` projection strips agreement/votes/council — which quietly starved the whole pipeline).
- **driftMonitor.js** (new): 3 instruments — per-model vote-distribution PSI (old/new half, 0.1/0.25 industry buckets), trust.js calibration drift (worst claimed-vs-realized gap + Brier), 30d/90d hit-rate windows. Verdict ladder STABLE/DRIFTING/ALARM, 6h alarm throttle, alarms land on the evolution ledger.

### PHASE 2 — LEARNING LOOP CLOSED
- **retrainBridge.js** (new): guarded POST /train to the ml-service (single-flight, 4h cooldown, stale-flight guard for crash recovery), champion/challenger shadow book (200-prediction window, agreement %, promote verdict recorded — never auto-swaps). SELFIMPROVE_AUTO_RETRAIN=false default: drift alarms PROPOSE, never auto-fire.
- **gateTuner.js** (new): bounded grid search over the entry gates (conf 60-80, agreement 0.55-0.75) on SETTLED rows, expectancy-max objective with a 30-trade floor, per-field jump caps (±5 / ±0.05), <0.05R gain = honest skip. Output = PROPOSAL only (selfCouncil), never a direct write.

### PHASE 3 — SELF-EVOLUTION
- **lessonsEngine.js** (new): quant-computes the evidence -> ONE LLM call narrates max 5 lessons in a strict JSON schema -> versioned `ai-lessons.json` + 12-version history. LLM down/thin data -> deterministic lessons from the stats (never fabricates). `lessonsForPrompt()` injects the lessons block into the Council deep debate + judge prompts (past mistakes now shape verdicts; no lessons = byte-identical prompts).
- **strategyEvolution.js** (new): bounded genetic search (16-pop x 5-gen, seeded RNG = reproducible) INSIDE strategyLab's whitelisted rule-space (can never invent an unbounded rule, by construction), fitness = expectancy x sqrt(n) with a 12-trade floor, real candle history via the cached backtest fetcher. Reports top-3 candidates — NOTHING auto-trades.

### PHASE 4 — SELF-AWARENESS + REPAIR
- **evolutionLedger.js** (new): append-only SHA-256 chain of every self-modification (12 whitelisted kinds, unknown rejected) — same honesty model as the signal ledger, including the v7.0.2 re-anchor-on-prune fix. 600 entries.
- **selfStatus.js** (new): ONE endpoint /api/ai/self/status — all six phases + honest stage ladder (NO FUEL -> MEASURING -> LEARNING -> EVOLVING). `selfRepair()`: the safe ladder (engine-chain probe, candle-cache flush, harvest refresh, drift re-check) — never restarts, never touches keys, never goes near order paths.

### PHASE 5 — GOVERNANCE (the council of self)
- **selfCouncil.js** (new): change proposals with tiers — safe (gate numerics) auto-eligible after 24h ONLY with SELFIMPROVE_AUTO_TUNE=true (default OFF); risky (desks/scope) ALWAYS human-approved. Apply walks the SAME clamped updateAgentConfig path the human UI uses (a proposal can never set what a human couldn't). 1-click ROLLBACK restores the from-snapshot. Kill-switch SELFIMPROVE_ENABLED=false freezes everything (monitoring-only).
- **Wiring**: 13 /api/ai/self/* endpoints (routes.js) + the index.js heartbeat (harvest 6h, drift + auto-approvals 1h, lessons + gate-tune weekly — all guarded; arm failure = one non-fatal line). Frontend: SelfImprovementPanel (CoinDcxTab section 00d) — stage ladder, phase cards, action buttons, proposal approve/reject/rollback, evolution-ledger timeline.

### AUTO-TRADING DESK SCOPE (user spec — spot OFF)
- **Auto-Agent (agent.js)**: desks default `{futures:true, spot:false, india:true, global:true}` — CoinDCX auto-entries now SIRF Global Futures (USDT margin) + Equity SIM (USDC). One-time v19_0 migration flips saved spot:true -> false; a deliberate later re-enable survives. Manual spot trading + EXISTING spot position management untouched (exits iterate open positions regardless of desk flags — verified). AgentPanel shows AUTO SCOPE chips.
- **SAPTA (proTraderAuto.js, browser execution)**: new `cryptoProduct` config, default 'futures' — scans the FUTURES board, trades the B-{SYM}_USDT page (USDT-margined, native leverage — the spot margin-tab toggle skipped), stake converts via USDTINR fx (stamped fxAtEntry — entry qty math and close P&L share ONE rate), futures LTP monitoring from the futures feed (deps-injectable for tests). 'spot' = legacy opt-in. ProTraderAutoPanel chip + toggle.

### Validation
`node --check` clean on all touched/new server files · **vitest 156 files / 2683 tests — 100% GREEN** (+38 in test/selfImproveEngine.test.ts incl. tamper/chain/prune-re-anchor/raw-ledger/r:null locks; 1 honest v70 legacy update — the v7.0 "spot ON" contract lock now asserts the v19.0 scope) · tsc CLEAN · vite build · **scripts/smoke_v19.mjs 16/16**: boots with the scheduler arm line, all six /api/ai/self/status phases + stage ladder serve, harvest + repair ladders run live, kill-switch arm boots DISABLED with monitoring intact, /api/ai/agent desks = spot:false + futures:true + global:true, no orphan processes. Post-implementation deep review found 6 real bugs — all fixed + locked by tests (raw-ledger source, row ordering, r:null outcomes, prune re-anchor, stage field, gate-tuner honesty).


## v18.10 — AGENT UN-BRICK + COINDCX ENV-CONNECT + DIRECT SPOT-WS ULTRA-FAST (2026-09-28)

**User hit (live log):** `[agent] ⚠️ cycle error: Cannot read properties of null (reading 'riskPct')` firing EVERY 60s cycle, plus "maine app\.env me coindcx ka api and secret sab dala hai phir site me ⚠ CoinDCX not connected" — and the ask for Direct CoinDCX WS realtime 24x7 ultra-fast prices on the CoinDCX tab.

### 1. AUTO-AGENT CYCLE-CRASH (CRITICAL — the agent was dead)

`agent.js`'s candidate scan read `s.plan.riskPct` **before** the `qualifies()` plan gate — but boards legitimately carry **plan:null rows** (`buildTradePlan` returns null when a coin's LTP failed to load — "plan nahi bana"). ONE bad row threw inside `_tick`, the catch logged `cycle error`, and the whole cycle aborted EVERY scan: the auto-agent could never reach the entry logic again (exits above the crash kept working, masking it). The near-miss pool, correlation guard, patient entry — everything below the loop never ran. **Fix:** explicit `if (!s?.plan || !s.side) continue;` guard before the risk read (same contract the near-miss diagnostics loop already had), + the same defensive guard in `indiaAgent.js`'s twin loop (ordering-safe there, hardened anyway). Locked by 3 tests (source-order contract + semantic mirror with the exact user crash row).

### 2. COINDCX KEYS IN `.env` NOW AUTO-CONNECT (the "not connected" complaint)

The ONLY entry to the CoinDCX credential store was the Portfolio-tab UI Connect flow — nothing read `COINDCX_API_KEY`/`COINDCX_SECRET` from the environment, so the user's `.env` keys sat unused while every consumer (wallet card "LIVE · API CONNECTED", live-mode gate `blocked.notConnected`, order console, agent equity) read the empty store. **Fix:** `coindcxEnvBootstrap()` at boot (index.js, after listen): no saved creds + BOTH env sides → validated with a real signed `/users/balances` call via the same `coindcxConnect()` the UI uses, then persisted — the whole app wakes up connected. Saved creds always WIN over env (UI stays authoritative); invalid pair = one loud `[coindcx-env]` line, app continues in paper mode (never a brick — the v18.8.1 lesson); memoized one attempt per process. Accepts the alias spellings users actually type (`COINDCX_KEY`/`COINDCX_APIKEY`/`COINDCX_PUBLIC_KEY` + `COINDCX_API_SECRET`/`COINDCX_SECRET_KEY`/`COINDCX_PRIVATE_KEY`), whitespace-trimmed. `.env.example` documents it; the wallet card + order console now name the `.env` path in their not-connected hints.

### 3. DIRECT COINDCX SPOT-WS ULTRA-FAST PUSH (24x7)

The official spot socket (`wss://stream-spot.coindcx.com`) maintained a full INR price book, but the browser only saw it through the **2s REST poller** reading that book — a price print on the exchange socket waited up to 2s on the wire. **Fix:** event-driven direct push — `cxSpotWs` exposes `setSpotWsOnPrice()`; `cryptoStream` registers the handler at import: every `currentPrices@spot#update` print for a watched coin lands in `liveFeed` THE INSTANT it arrives (source-labelled `coindcx-spot-ws`, `/INR$/`-gated to the `IN_` namespace, unwatched coins filtered). SSE wire discipline is unchanged (1 update/sec/symbol + 0.05% dead-band) → bandwidth identical, latency sub-second. The 2s poller keeps running (stats/high/low enrichment + REST chain re-anchor); the WS-first demand lifecycle (idle close, silent-kill, handshake breaker) is untouched. The SSE `status` frame + `/api/feed-status` now carry a `spotWs` tier (`{connected, servable, freshMarkets, ageMs, cooling}`) and the CoinDCX desk chip honestly badges **⚡ DIRECT COINDCX WS · SPOT·WS⚡ · FUT/GLOB·WS⚡** (per-tier state: Binance-FUT accelerator, GLOB-quiet cooldowns still explained).

### Validation
`node --check` clean on every edited file · **vitest 155 files / 2649 tests — 100% GREEN** (+13 in the new `test/v1810UltraFast.test.ts`) · `tsc` CLEAN · `vite build` 5.17s · `scripts/smoke_v1810.mjs` 9/9: no-creds boot logs the honest line, invalid env pair attempts + NEVER bricks, `/api/feed-status` serves the `cxRt.spotWs` shape, `/health` 200 throughout.

## v18.9 — PRO TRADER FULL-SITE RECHECK: the money-path integrity pass (2026-09-28)

**User spec: "full site code deep advance pro trader level pe recheck karo aur issues fix kardo then patch .zip file me dedo"** — a fresh full-site audit (crypto execution desk, India Dhan desk, live feeds, intraday engine, paper/track simulators, committee, auto-trader, every trading panel) with every finding verified against the code before fixing. 20 real fixes, 37 new regression tests, `vitest 154 files / 2636 tests — 100% GREEN`, tsc clean, vite build 5.22s, boot smoke 8/8.

### CRYPTO ORDER DESK (`server/ai/coindcxOrders.js`) — 9 fixes

1. **MARGIN PAIR FALLBACK (CRITICAL):** `getMarginPairName`'s convention fallback built `B-BTCINR` — the module's OWN contract says margin pairs are `B-BTC_INR` (underscore). Whenever the active_pairs list was unreachable (boot, outage, cold 6h cache), EVERY leveraged exit — SL close, liquidation exit, manual close — was sent with a malformed pair and failed + retried forever while a live leveraged position bled. One-line convention fix + locked by test.
2. **OFFICIAL-PRICE GATE (CRITICAL):** the SL/TP watcher priced live positions from `fetchCoinDcxTickers()` without checking WHICH leg served — the synthetic `binance-fx-synth` leg (Binance × fx, **fx fallback 84** while real USDINR ≈ 88 → ~4.6% low) and the 3-min-old `coindcx-rest-deep-stale` leg could fire a REAL market sell on a false stop breach and book the loss at the synthetic price (corrupting `pnlINR`, `dailyStats`, the ₹ daily-loss cap). New `officialPriceMap()`: synthetic rows filtered, degraded legs rejected — live actions only ever ride official CoinDCX prices. Manual `closePosition` rides the same gate (honest reject during degraded feeds).
3. **FEED-DEGRADED ALARM:** the old watcher silently `continue`d every position when the feed came back empty/degraded — "a failing stop-loss must never be indistinguishable from a healthy position" was the file's own promise, violated exactly in the catastrophic case. Now: one throttled (1/hour) `WATCH_ERROR` + telegram alarm naming the degraded source. Partial gaps (missing pairs) alarm at 1/30min.
4. **KILL-SWITCH CONTRACT:** documented "one click → all auto/execution disabled", but SL/TP/liq closes still fired live market sells under kill. Now they suspend with a once-per-day journal stamp + alert; paper simulation continues.
5. **MARGIN PARTIAL-TP EXCLUSION:** the T1/T2 partial legs on leveraged books opened an OPPOSITE-SIDE margin position (CoinDCX margin is per-side) — the journal booked a reduction while the exchange accumulated an untracked opposite position the later `exit_positions` full-exit leaves behind with margin locked. Leveraged books now exit via `exit_positions` only.
6. **PARTIAL-LEG EXCHANGE MINIMUM:** a leg below the pair's `min_quantity` would 422-reject every 60s forever (WATCH_ERROR + telegram spam, exit never happens). Below-min legs now honestly disable partials (the full TP2/SL exit — whole remaining book ≥ min — takes over). DUST GUARD: a remaining book below minimum can never be market-sold — flagged once, manual disposal advised, no retry spam.
7. **FEE HONESTY (net P&L):** every booked close/partial-leg/liquidation is now NET of both-side taker fees — `(entry+exit)×qty×fee%`, default **0.10%/side**, env-tunable `AI_COINDCX_FEE_PCT` (0 = off). The gross `(exit−entry)×qty` math systematically overstated every booked P&L, the daily realized number AND the ₹ daily-loss cap (a churn day of small "wins" could be net-negative while the cap said +). Positions/journal entries carry `feesINR` for audit.
8. **AMBIGUITY COOLDOWN (double-sell protect):** a close that died ambiguously (timeout/abort/network — the order MAY have reached CoinDCX and filled) now defers the re-send 5 minutes (`p.closeRetryAfter`) with the honest journal note — the old 60s re-send cycle could double-sell the same book. Definitive `[4xx]` rejections keep the 60s retry (those moved no coins).
9. **SINGLE-FLIGHT + LOCK DIET:** overlapping 60s interval ticks queued unboundedly behind the journal lock during slow passes; the ticker batch (8s timeout) and the telegram sends (up to 30s) ran INSIDE the lock, starving `executeSignal` and panic manual closes exactly during outages. Tickers + gate now run before the lock, telegram after it, and a mid-pass tick joins the running pass.

### INDIA EXECUTION DESK (`server/ai/indiaOrders.js`) — 5 fixes

10. **DHAN FILL VERIFICATION:** `dhanOrderStatus` existed but was NEVER called — an entry that returned an orderId was assumed filled at the PRE-order TV LTP. A margin/circuit REJECT after a TRANSIT reply booked a phantom OPEN position with a made-up basis; a later "close" SELL was a naked order. The gauntlet now polls the broker 3× (300/600/600ms): `TRADED` → books `averageTradedPrice` (real slippage basis), `REJECTED` → honest FAILED entry with the broker's reason, no position booked.
11. **DAY-ROLLOVER RECONCILE:** if the app (or the quote feed) was down through the 15:15–15:30 square-off window, INDIA positions survived into the next session and were then MANAGED against fresh prices — a tripped stop fired a market order on a broker-auto-squared MIS position (unintended naked intraday order + phantom P&L). Yesterday's rows now reconcile instead: PAPER → `STALE_SQOFF` close at last-known; LIVE → verified against `dhanPositions()` (gone → `MISSED_SQOFF` closed; still held → `carriedOvernight` flag + alert, never auto-traded).
12. **LIVE-UNKNOWN PROTECT:** `status:'UNKNOWN'` India rows were skipped by the watcher but ALSO passed the one-per-symbol check — a second LIVE order could stack on an unreconciled fill. UNKNOWN now blocks duplicates (paper UNKNOWN is watched; live UNKNOWN is surfaced once + never auto-closed — a close SELL on an unfilled position is a naked order).
13. **BROKER SL TRAIL STATE:** after cancel+replace, a failed replace left `p.slOrderId` pointing at the CANCELLED order — the journal claimed an armed broker SL while the server held none. `slOrderId` is now cleared the moment the cancel is issued (honest "watcher guarding" state).
14. **HOLIDAY CLOCK UNIFICATION:** `data.js isNseOpen` (the LIVE gauntlet + watchers + agent loops) was holiday-blind while `intraday/time.js` (the "single source of truth") carried the calendar — on Republic Day/Diwali LIVE entries passed the gate into a closed market and square-offs submitted orders the exchange rejects. `isNseOpen` now delegates to `isNseMarketOpen`; `intraday/stream.js _inWindow` and `proTraderAuto.indiaMarketOpen` share the same calendar.

### INTRADAY SIMULATORS + COMMITTEE — 4 fixes

15. **PAPER DAY-ROLLOVER GUARD:** `evaluatePaper` had the stale-day check only at boot/restore — a non-CRYPTO trade whose quote feed died through 15:10 survived into the NEXT session and was auto-managed against next-day prices (two sessions in one P&L; the module's own "NEVER carry intraday overnight" rule broken). Per-tick dayKey guard mirrors trackRecord's v11.4 fix (`STALE_SQOFF`).
16. **TRACK-RECORD LEVEL FREEZE:** a republished OPEN row had its `entry/stopLoss/target1/target2` REWRITTEN mid-life — a 14:00 refresh that lifted `entry` above the current price made the next tick book an `SL_HIT` that never happened at the published plan; win-rate/avgR measured the last refresh, not the signal. Levels now freeze at first publish (confidence/lastPrice still refresh — the PARTIAL branch's own discipline, now applied to OPEN too).
17. **COMMITTEE PERSONA QUORUM:** 2 of 3 personas could silently fail and the debate still published a "committee" verdict where the judge weighed one real opinion against two "(no response)" placeholders. Quorum ≥ 2 takes enforced in code.
18. **intraday/stream.js holiday window** (see #14) — the watcher no longer polls a frozen closed tape for 6.5h on weekday holidays.

### FRONTEND — 7 fixes

19. **OPTION LOT-SIZE INPUT:** the manual-trade recorder hardcoded `lotSize: 75` — a RELIANCE CE (lot 500) tracked at 15% of true P&L, BANKNIFTY/SENSEX scaled wrong, and no input existed to fix it. The prompt now has a validated lot-size field (default 75, per-underlying hints) + the record POST carries a 20s timeout (the only mutation in the app without one — a hung connection stuck "RECORDING…").
20. **HONEST REFRESH CADENCE + MOOD MATH + misc:** the countdown ring counted 30s while the board polls 60s (the ring reset twice with zero refresh — "desk frozen?" feeling; texts in CoinDcxTab/TopPicks/ExpertPicks now match reality at 60s/120s); the two on-screen MOOD chips used different math (raw symbol counts vs percentage points — 400-symbol board read MIXED on one strip and RISK-ON on the other; both are pp now); the SSE positions snapshot bumps the `posSeq` staleness guard (an agent-close could be resurrected by a stale in-flight REST read for up to 45s); the crypto order preview hides while the trade ticket is open (two conflicting sizing blocks); the OrderConsole SET button disables on non-numeric input (was a fake "Saved ✓" for values the server silently dropped); `assetPnl`'s invalid-fx fallback is 84 (was a silent 1:1 ₹ collapse).

### Validation
`node --check` clean on every edited file · **vitest 154 files / 2636 tests — 100% GREEN** (+37 in the three new files `test/v189ProTraderRecheck.test.ts`, `test/v189IndiaClock.test.ts`, `test/v189IntradayGuard.test.ts`; every fee-affected legacy expectation updated with the honest net math) · `tsc` CLEAN · `vite build` 5.22s · `scripts/smoke_v189.mjs` 8/8 (boot + login + TG-degrade regression + APP_PIN fatal intact). Existing behavior NOT changed: paper closes, trailing math, gauntlet caps, SVA/75-65-90 gates, engine chain, manual-trade merge — all locked by the same suites.

## v18.8.1 — BRICK-PROOF BOOT (TG half-config can never kill the server) (2026-09-28)

**User hit:** `startai.exe` → `[wealth-ai] ERROR: TG_TOKEN and TG_CHAT_ID must both be set (or both empty). TG_TOKEN=empty, TG_CHAT_ID=set.` → `Refusing to start due to configuration errors.` — the ENTIRE trading app (desks, signal board, manual tracker, auto-trader, ML service) dead over an **optional notification channel**: one stray `.env` edit (user added their `TG_CHAT_ID` and lost the `TG_TOKEN` value) brick-locked every desk.

**Root cause:** `validateEnv()` treated a half-set Telegram pair as a boot-fatal. But Telegram is optional, and every sender already gates on token+chatId TOGETHER (`startBot`, the `/api/telegram` relay, `secrets.telegramConfig`, `telegramToken`) — a half-config could never send anyway. The exit protected nothing; it only converted a cosmetic misconfig into a total outage.

**The fix (server/index.js, two edits):**
- The half-pair is now normalized at the **TG definition site** — the earliest point in boot, BEFORE any subsystem arms or captures the values: loud actionable `console.warn` (which side is EMPTY, how to fix, and that Settings > Alerts-saved pairs keep working) → both sides cleared → `process.env.TG_TOKEN`/`TG_CHAT_ID` also cleared so env-fallback paths (`webhook.js`, the forked bot child) see the same clean "unconfigured" state. Telegram degrades to OFF; the app boots and runs normally.
- `validateEnv()`'s TG fatal block removed (unreachable by construction). **Auth-critical fatals stay fatal:** missing `APP_PIN` and `VITE_API_TOKEN === API_TOKEN` still refuse to start.
- Bonus resilience: the forked `telegram-bot` child can never hit its own `TG_TOKEN missing → exit(1)` path from a half-pair again — `startBot()` never forks when the pair was normalized.

**Validation:** `node --check` clean · **vitest 151 files / 2599 tests — 100% GREEN** (+7 in the new `test/brickProofEnv.test.ts`) · live boot smoke: `TG_TOKEN="" TG_CHAT_ID=12345` → server binds, warns, serves `/health` 200; `APP_PIN` unset → still exits 1.

## v18.8 — ENGINE CHAIN UNIFICATION (the real "AI language engines offline" kill) (2026-09-28)

**User spec: "AI language engines offline hain… Engine wapas aane par prose richer ho jayega — isko theek karo advance pro level pe" + "Manual Trade Tracker live-feed fix + superintelligence patch pe continue karo".**

**The gap the audit found:** v18.7 upgraded the two DESK AGENTS (crypto + intraday) to the sentinel chain with the keyless local ollama engine — but every OTHER LLM path in the app silently stayed on the OLD 4-provider ladder (gemini → groq → cerebras → openrouter, no sentinel, no huggingface/nvidia, **no ollama**):
- `llmChain.js` `councilAsk` — the Global Market Council's 6 persona seats, the LLM second-opinion validator (A2) and the weekly review all ride this chain → with every cloud engine down/unkeyed they degraded to "AI language engines offline" while a perfectly good local Ollama sat UNUSED on 127.0.0.1:11434.
- `signals.js`'s PRIVATE chain (×2: the debate path + the single-shot verify path) — the board's own AI Council seat (w=1.5, the heaviest voter) could never use a saved HF/NVIDIA key or the local engine, and reported zero health to the sentinel (a dead engine got retried every board cycle).

### The fix — ONE chain, one health ledger, one place to fix
- **`server/ai/llmChain.js`** (rewritten v18.8): the shared `councilAsk` now ENDS at the keyless local ollama engine — probe (2.5s, 90s-cached) → `/v1/chat/completions` with the OpenAI-compat body, sentinel-tracked like every cloud engine (success → ready, failure → cooldown ladder). **Provider-aware timeouts:** cloud engines keep the 15s bound; the local engine gets **90s** (a CPU-only llama3.1:8b takes 30-60s for a 2k-token JSON verdict — the old shared bound made it time out on every CPU machine). `aiKeysPresent` now counts all SIX cloud engines; new `aiEnginesOnline()` async gate also counts a reachable ollama.
- **`server/ai/signals.js`**: the private 4-provider ladder (both copies + its private `askGemini`/`askOpenAICompat`/`tryParseJson`/`aiKeysPresent`) is DELETED — `aiCouncilDebate` and `aiCouncilVerify` ride the shared chain. The council gate is ollama-aware: cloud keys OR a reachable local engine → the board seat goes ONLINE for a zero-cloud-key local install too.
- **`server/ai/llmValidator.js` + `server/ai/council.js`**: the availability gates (`aiKeysPresent`) now OR a live `ollamaProbe()` — the second-opinion validator and the council's board + deep persona batches stay armed on a local-only install. (Probe imported directly from `llmSentinel` — the existing `llmChain` test mocks stay untouched.)
- **`server/ai/cryptoAgent.js` + `server/intraday/agent.js`**: the local engine's per-round tool budget is 30s → **120s** (provider-aware; cloud engines keep 30s) — on CPU boxes every ollama round used to blow the shared timeout mid tool-loop.
- Net effect: with the user's setup (OpenRouter + HF + NVIDIA live, Cerebras maybe, local Ollama ready) EVERY LLM surface in the app — desk chat, board AI Council seat, global council personas, borderline validator, weekly review — now answers through the same 7-engine chain with the same health ledger, and an Ollama-only machine gets full LLM coverage with zero cloud keys.

### Validation
`tsc` CLEAN · **vitest 150 files / 2592 tests — 100% GREEN** (+8 in the new `test/engineChainUnify.test.ts`: ollama answers with zero cloud keys, sentinel-tracked, six-engine key gate, board seat online via ollama, HF fall-through on the board seat, honest offline, council personas on the local engine) · `vite build` 5.31s · every edited file passes `node --check`.

## v18.7 — AI ENGINE SENTINEL (earlier session; context entry)

The per-engine health ledger (`server/ai/llmSentinel.js`): circuit-breaker cooldowns (401/403 → 15 min, 429 → 90s, network → 30s…300s ladder), half-open auto-retry, `GET /api/ai/engines` + `POST /api/ai/engines/recheck`, the `EngineHealthStrip` UI chips, and ollama liveness probing — plus the desk-agent chain upgrades and the v18.6.3/v18.6.4 REALTIME NEVER STOPS live-feed fixes (client watchdog + SSE loopback cap 8 + tracker vote-budget 12s) that the 2584-test baseline already locked.

## v13.2 — FULL IMPLEMENTATION PLAN (Accuracy Track A + Bandwidth Track B) + Site Cleanup (2026-09-25)

**User spec: "latest github repo pull karo · ye implemention plan accurately apply karo · after implementation full site code cleanup kardo — unwanted files, broken files, temp files sab permanently delete"**

**Gap analysis first (the discipline):** the plan was audited item-by-item against what earlier versions already shipped — A1's Sentiment/InstFlow/FundaCheck V2 seats + quorum caps + the votes-journaled ledger, A2's CoinDCX agent parity (17 tools), A3's ATR time-exit + correlation guard + orderbook depth split, A4's tax suite + net-worth card, A5's Telegram two-way (/crypto /intraday /portfolio /status /weeklyreview /trade-with-PIN-approval), B1's dead-tick filter + 1s/symbol throttle, B3's parseSyms caps, B5's immutable asset caching — all verified present. v13.2 implements the SIX real gaps that remained, in the plan's own rollout order, then cleans the site.

### Phase 1 — B6 Bandwidth Telemetry (measure before changing)
**NEW `server/ai/bandwidth.js`**: rolling-24h wire accounting with hourly buckets — REST responses counted as TRUE socket `bytesWritten` deltas on `finish` (real headers+compressed body, zero serialization cost), SSE frames counted at every write site (`sse:stream` / `sse:intraday` / `sse:positions`). `GET /api/ai/bandwidth` (auth'd) → rolling 24h + daily average + **30-day projection vs the Render cap** (default 5GB, `BANDWIDTH_MONTHLY_CAP_GB`) + per-scope top-12 breakdown + OK/ALERT/OVER_CAP status. **Hourly Telegram guard** (`initBandwidthAlerts`, wired in index.js with the shared `sendTelegramMessage`): ONE alert per UTC day when the projection crosses `BANDWIDTH_ALERT_PCT` (default 70%) — the "80% used" surprise can't happen again.

### Phase 3 — B2+B4 SSE residuals (the remaining egress)
- **HIDDEN-PARK (B2)**: a tab hidden ≥30s now CLOSES its EventSource — `useCxLivePrices` (the main /api/stream client) and `useIntradayStream` both park; the server's refcounted pollers go idle at zero clients (zero upstream + zero egress for a tab nobody watches). Visible again → **instant** reconnect (no backoff — the user is waiting) + snapshot repaint. Brief switches (≤30s) keep the connection; the flush gate already renders nothing in the background.
- **EXPONENTIAL BACKOFF (B4)**: `useCxLivePrices` now OWNS the retry cadence — errors close the socket before native retry fires and retry at 1s→2s→4s→…→30s cap (reset on clean open). A Render cold-start can no longer stampede N tabs into the fixed-3s reconnect-each-refetch-full-snapshot loop.

### Phase 2 residual — A2 LLM SECOND-OPINION VALIDATOR (the plan's borderline rule)
**NEW `server/ai/llmValidator.js`**: when ensemble confidence sits in the **borderline band (45-60%, env-tunable)**, the provider chain (Gemini → Groq → Cerebras → OpenRouter, the same `councilAsk` the council rides) gets ONE strict-JSON second opinion — `CONFIRM / REJECT / FLIP` + confidence + one-line reason. **Cost guardrails per the plan**: one live call per symbol per **15-minute candle bucket** (a board refresh, deep dive, agent chat and Telegram /crypto in the same bucket share the SAME answer); board cards read the cache passively (never trigger calls); no keys → honest unavailable; `AI_ENABLE_LLM_VALIDATOR=false` kills it. Rides `s.verify.llm` → the 🛡 VerifyBadge shows a 🤖 marker (✓/✕/⇄) + the deep-card checklist gains the violet **🤖 LLM SECOND OPINION** row with verdict, confidence, reason and provider. The SVA rule engine stays the deterministic owner — the LLM validates, never replaces (the plan's explicit division of labour). Deep-path hardening: the verify attach moved OUT of the superintel try-catch — a superintel failure no longer costs the final verdict.

### Phase 5 — A5 MCP Tool Standardization + Governance
- **`get_model_consensus` tool** (crypto agent #18 + intraday agent #10): the per-model vote breakdown — every seat's direction/confidence/reason, bull/bear/abstain tally, weighted consensus, meta-ensemble stamp, SVA verdict + LLM second opinion. The chatbot can now explain **WHY a signal fired** ("consensus kya bol raha hai", "kaun se models agree"). India desk: wired to the 14-model deep ensemble via `getDeepSignal` (lazy, cached) with an honest scanner fallback when the ensemble is cold.
- **NEW `server/ai/mcpAudit.js`**: EVERY desk-agent tool call (crypto + intraday + telegram) is now **rate-limited** (per-desk rolling-minute cap, default 60/min, `AI_MCP_RATE_PER_MIN` — a runaway LLM loop can't hammer the live stack; over-limit calls get a structured `rate-limited` answer the model can READ) and **audit-logged** (bounded 300-entry ring: tool, arg digest, ok/error, duration; **placeOrder-class flags**). `GET /api/ai/mcp-audit` → the governance view (recent 120 + per-tool aggregates). Panels updated: `18 TOOLS • VERIFY + CONSENSUS…` / `10 TOOLS • AGENTIC`.

### Phase 6 — A4 Portfolio Risk Analytics (the REAL numbers)
**NEW `server/ai/riskAnalytics.js` + `GET /api/ai/portfolio-risk`**: the client riskEngine's `sortino = sharpe × 1.3` placeholder and empty `correlationMatrix` are replaced server-side where the candle history lives:
- **REAL Sortino** — target downside deviation over ALL n observations (the classic ÷downside-count footgun caught by its own test), per holding AND portfolio (value-weighted, trailing-aligned returns), with Sharpe (rf-aware, default 6.5%), annualized return/vol, max drawdown on the cumulative path.
- **Correlation matrix** — Pearson on aligned 90d daily returns (Yahoo for IN/US equities+ETFs, Binance 1d for crypto) — rendered as the Portfolio tab's new **📊 Risk Analytics card heatmap** (r>0.7 rose "same bet twice", r<−0.6 emerald "diversification gold").
- **Rebalance drift engine** — vol-parity × equal-weight blend targets (70/30), concrete "Trim A 8.3% → add to B" lines past 3% drift.
- **Honesty**: fixed/EPF/bond rows land in a `skipped` list (no fake series); <10 points → null; whole snapshot cached 1h per asset signature; never throws.

### Phase 7 — A3 Win-Rate Self-Downgrade (per-strategy size weight)
The v10.1 latch downgraded the WHOLE agent on a rotten global record; the plan asks for the finer tool. **`strategyWinRate` / `strategySizeMultiplier`**: a PAIR whose own rolling **20 settled trades** win-rate has decayed gets its position-size weight cut on the sizing line (`riskPct × eventSizeMul × grMul × stratMul`) — ≥50% full · 40-50% ×0.75 · 30-40% ×0.5 · <30% ×0.25 — while the rest of the book trades full size. Only agent-sourced CLOSED trades count; config kill-switch `winRateSizeDowngrade` (default ON, round-trips via `updateAgentConfig`); the haircut pairs surface in `agentStatus.accuracy.strategyDowngrades` + a logged line per entry. (ATR time-exit, correlation guard and the orderbook depth-split were verified already shipped.)

### Site cleanup (unwanted / broken / temp — permanently)
- **Deleted (git-tracked)**: `scripts/smoke_v113.mjs`, `scripts/smoke_v120.mjs` — version-locked smoke scripts superseded by the current suite (v128/v131 smokes + the 2421-test vitest run). Kept: `check-api-routes.mjs` (active route regression guard), `backtest_ab_v2.mjs` (active A/B runner).
- **Deleted (local temp, gitignored)**: all 6 `.test-data-*` runtime dirs, `ml-service/**/__pycache__`, `dist/` build output — regenerated as needed, never shipped.
- **Verified clean**: every server JS passes `node --check`, every Python file passes `py_compile`, zero empty source files (`ml-service/tests/__init__.py` is the standard package marker), zero stray `.log/.tmp/.bak/.DS_Store`, zero tracked files >500KB, `telegram-bot/` confirmed an active wired sub-project (not junk).

### Validation
tsc CLEAN · **vitest 135 files / 2421 tests — 100% GREEN** (+57 over v13.1's 2364: bandwidth 10, LLM validator 13, MCP audit 8, risk analytics 16, strategy downgrade 6, get_model_consensus 4) · build 5.46s · ml-service pytest 11/11 · smokes v12.8 35/35 + v13.1 12/12 · env: `.env.example` + `render.yaml` carry BANDWIDTH_MONTHLY_CAP_GB / BANDWIDTH_ALERT_PCT / AI_ENABLE_LLM_VALIDATOR / AI_MCP_RATE_PER_MIN.

## v13.1 — SIGNAL VERIFICATION AGENT (SVA-v1) + Reversal AUTO-CUT (2026-09-24)

**User spec: "CoinDCX TAB ko Signal Feature ko advance pro deep level pe Optimize karo · XRP long paper trade negative balance me ja raha hai · ek Aisa Agent ko add karo jo tab me Signal mila usse advance pro trader level pe check karke final result bole long jana hai ya short accurate and high accuracy ke sath"**

**The live XRP postmortem (the why):** the trade record showed a LONG @ 1.619 taken on a signal whose OWN summary said "⛔ OVERBOUGHT RSI 70 + 🚀 CHASING — 2.31×ATR above EMA20 — LONG entry suppressed" (aiScore 57 · conf 48 · grade WATCH · 3/11 voters = 28% quorum). Price mean-reverted −5.52%, and the ₹150 loss-cap — stamped 44 MINUTES before the close — stayed advisory ("execute aap karo"), so the loss ballooned to **−₹2,250 (15× the cap)**. The information to reject that entry ALL existed; nothing aggregated it into ONE final call at the point of entry. v13.1 is that aggregation.

### The SIGNAL VERIFICATION AGENT — `server/ai/signalVerifier.js` (NEW, pure)
A senior pro-trader second opinion on EVERY signal — one auditable final call before money moves:
- **10-point weighted checklist** (weights sum 100): committee quorum (14) · chase/ATR-extension (16) · RSI-extreme-vs-side (12) · MTF confluence (12) · ledger win-edge P(win)−P(need) (14) · plan R:R (8) · regime alignment (8) · entry band (6) · perp crowd/funding (6) · side stability (4). Every check carries PASS/WARN/FAIL + points + a human detail line — never a black box.
- **The verdict ladder** (pro rules, not vibes): **CONFIRM** same side at full risk (score ≥68 AND zero CORE-check fails) · **CAUTION** same side half-risk · **FLIP → opposite side** (mean-reversion case ≥60: RSI-extreme + HARD chase + thin quorum + neg edge) · **STAND ASIDE** (hardVeto OR score <40 OR **negative-EV plan** — edge FAIL + R:R FAIL). HARD chase + RSI-extreme = **PRO VETO** (the exact XRP-class burn combo).
- **`sizeHint`** 1 / 0.5 / 0 rides every verdict — the pro's sizing discipline.
- **Hinglish verdict + proNote** on every payload; partial input degrades to neutral WARN bands (never throws, never silently zeros).
- **Verified against the LIVE site**: the 24-Sep XRP deep signal (pullback zone · +23.7pt edge · R:R 2) → **CONFIRM LONG 84/100**; the burn snapshot the user actually traded → **FLIP → SHORT, veto**. The verifier answers "long hai ya short" with the checklist attached.

### Wiring — every surface the user touches
- **`signals.js`**: every directional board signal carries `s.verify` (compact wire — `verificationWire`), the deep path carries the FULL checklist (the deep modal's audit trail). Attached inside the winProb block, try/caught — the verifier can never break the board.
- **`cryptoAgent.js` — tool #17 `verify_signal`**: the desk agent answers "XRP long ya short?" with the SVA verdict + full checklist; the system prompt makes it the FIRST call for every long/short question and forbids silently overriding the verdict. Quick prompt 🛡 added; panel chip → `17 TOOLS • VERIFY + P(WIN) + EV TICKETS + NEWS`.
- **`SignalCard.tsx`**: the 🛡 **final-call badge** reads FIRST on every card — VERIFIED (emerald) / CAUTION (amber) / **FLIP → SHORT (rose, pulsing)** / STAND ASIDE — with the verdict + proNote tooltip, and the full 10-point checklist table on deep cards.
- **`ManualTradePrompt.tsx`**: the PRE-TRADE verdict banner — CONFIRM green / CAUTION amber / **FLIP+STAND_ASIDE RED with the explicit "verifier ne reject kiya" warning** — before the record button.
- **`recordManualTrade`**: every manual trade now FREEZES `t.verify` (the open-time verdict — wire passthrough verbatim, or computed from the signal snapshot). The confirmation Telegram push cites it; **`ManualTradeMonitor.tsx`** shows the 🛡 stamp per trade — "kya verifier ne pehle hi mana kiya tha?" is answered forever on the ticket.
- **`deskShared.tsx` DeskStatsStrip**: new **VERIFIED** tile (CONFIRM count; caution/rejected in the tooltip) — the desk's honest "kitne pakke setups hain" number at one glance.

### The Reversal AUTO-CUT (the negative-balance fix, OPT-IN)
The ₹150→−₹2,250 bleed happened because the loss-cap was advisory-only. **`reversalAutoCut`** (agent-config key, PUT-able via `/api/ai/reversal/config`, default OFF — v12.7's "never auto-close a manual trade" stays shipped behavior): ON karo to the 5s sweep **CLOSES the manual leg AT the crossing price** with the `REVERSAL AUTO-CUT` close-reason + Telegram confirmation; the flip plan survives on the trade record + Reversal board for the next leg. **`ReversalPanel.tsx`** gets the ✂️ AUTO-CUT toggle (rose, with the full tooltip) alongside the ensemble gate.

### Validation
`tsc` CLEAN · **vitest 2364/2364 (100% green** — +23 new locks: 17 in `test/signalVerifier.test.ts` + 6 SVA/auto-cut locks in `test/manualTrades.test.ts`; registry lock updated to the 17-tool list**)** · build 6.14s · smoke v12.8 35/35 · **NEW smoke v13.1 12/12** (S1 the XRP burn → FLIP/veto · S2 clean pullback → CONFIRM · S3 checklist integrity · S4 wire idempotence · S5 verdict language) · `node --check` all touched server files.

## v13.0 — ACCURACY & DEEP-AI UPGRADE PLAN: full implementation (Phases 0-5) (2026-09-23)

**User plan: "ye issues fixes aur implementation plan accurately implement kardo"** — the audited Accuracy & Deep-AI Upgrade Plan, implemented end-to-end: the CI-blocking stale test fixture fixed (suite now 100% green for the first time), the three proven-safe accuracy flags flipped ON in every deploy template, the MTF confluence A/B made MEASURABLE (both arms journaled per settled execution), OptionsFlow extended to per-stock REAL chains, both desk agents brought to full tool-parity + the new-seat context, the portfolio tab got its AI overlay (red-flag engine + coach narration + Telegram /portfolio), and the meta-ensemble is TRAINED, ACTIVATED and on a weekly retrain worker.

### Phase 0 — the CI blocker: `test/bseOptionChain.test.ts` (Issue #1)
The parity test failed because its fixture hardcoded expiry `'2026-09-17'` — once the IST calendar rolled past it (23 Sep), `getOptionsDesk`'s `d >= today` filter correctly found no valid rows and honest-fell-back to `'bs-model-sensex-always'` (production logic was RIGHT; the fixture was stale). **Fix: both fixtures are now SELF-HEALING** — the expiry is always the next (future) Thursday via the file's own `nextThursday()` helper (parse test too, ISO → "DD Mon YYYY" converted). Production code untouched, exactly as the plan prescribed. **The full suite is now 2341/2341 — 100% green, zero documented failures, for the first time in the repo's history.**

### Phase 1 — flags ON + mesh health visibility
- **`render.yaml`**: `AI_ENABLE_V2_MODELS` (was MISSING from the blueprint entirely — a real gap), `AI_ENABLE_MTF_CONFLUENCE`, `AI_ENABLE_MESH_MODELS` now ship `value: "true"` (the three proven-safe levers: keyless honest-abstain V2 feeds, shadow weight-0 mesh seats, MTF tape). `AI_ENABLE_REGIME_WEIGHTS` + `AI_ENABLE_KELLY_SIZING` stay OFF (backtest-gated per the plan's own sequencing).
- **`.env.example`**: the same three flipped ON with the Phase-1 header; MTF got its own explicit line (it previously existed only inside a comment).
- **MCP MESH BOOT HEALTH (server/index.js)**: one log line on every deploy — `[mesh] BOOT HEALTH — 3/10 agents usable · MISSING KEYS: quiver→QUIVER_API_KEY, …` — the plan's "check karo kaunsa agent unauthed hai" is now visible in the Render log without hitting any API (verified live in this session: 3/10 usable, 7 key-gaps listed). Missing key = honestly absent, never fakes; free-key links live in .env.example's v11.8 block.

### Phase 2.1 — MTF confluence A/B: MEASURED, not guessed
The plan asked "Confirm karo IntradayTapeMTF ka weight-1.6 upgrade genuinely behtar hai plain 15m tape (w1.3) se". The honest answer needed DATA — now every settled execution journals BOTH arms:
- **`models.js`**: `intradayTapeMTF` stamps `__abShadow` on its vote — the byte-identical plain 15m read (same dir by design — the 15m anchor carries it; only CONFIDENCE differs by the ±15/−20 agreement math). Degraded fallbacks stamp nothing (they ARE the plain seat — no double-count).
- **`ledger.js`**: `recordExecution` journals the shadow arm as `ab_tape15m` (with `shadow: true`) on the tamper-evident chain — back-compat exact for votes without a shadow.
- **`trust.js mtfABReport()`**: the verdict block — paired samples, per-arm hit-rate (identical by design, stated honestly), conf **separation** (avg conf wins − losses) and **Brier** on aligned votes, `brierDeltaPlainMinusMtf`, verdict `MTF SHARPER / PLAIN 15m SHARPER / NO MEASURABLE DIFFERENCE / NEEDS DATA` at ≥10 pairs.
- **Surfaces**: `GET /api/ai/trust` gains the `mtfAB` block + the weekly review narrates one honest line (`📊 MTF A/B (N paired): verdict · separation X vs Y · Brier A vs B`). *(Architectural note: the A/B rides the LEDGER chain — the settled-outcome store — rather than signalMemory.js, which is the flip-continuity store; same intent, correct plumbing.)* 12 new locks in `test/mtfAB.test.ts`.

### Phase 2.2 — OptionsFlow per-stock (feasibility verdict first)
**Feasibility (checked before building): Massive/Polygon + AlphaVantage serve US options only — the plan's suggested mesh sources CANNOT provide NSE stock chains. The right source was already in the repo**: `getOptionsDesk(sym)` fetches + analyzes ANY NSE F&O underlying (the v10.17 options scanner already runs it on 6 stock names). Implemented on that machinery:
- **`signals.js`**: a per-stock option-ctx store (10-min TTL, REAL nse/bse chains only — the `REAL_CHAIN_RE` gate, model chains never vote) warmed for the TOP turnover slice (`AI_STOCK_OPTIONS_TOP_N`, default 6, clamp 0-10), fire-and-forget — this cycle attaches the cache, the refresh lands for the next board. `buildIndiaStockCtx` attaches the snapshot per symbol; the deep path attaches the cached ctx WITHOUT fetching (the board's warm owns the budget). Absent names keep the honest structural abstain. 3 locks in `test/stockOptionsCtx.test.ts` (store TTL, knob clamp, wire-level).

### Phase 2.4 + 3.3 — both desk agents: new-seat context + tool parity
- **Intraday agent (`intraday/agent.js`)**: the `get_live_intraday_signals` tool description + CORE METHODOLOGY now carry the full committee context — MTF tape confluence (conflict = never STRONG), V2 seats (SentimentPulse/InstFlow — honest disagreement rule), per-stock option chains (contrarian PCR, OI magnets), mesh shadow seats (context-only, never the deciding conviction).
- **Crypto agent (`cryptoAgent.js`)**: the system prompt's "14-model" line is now the accurate committee description (14 core + V2-when-enabled + mesh-shadow framing). **TOOL PARITY closed: `search_market_news`** (the one tool the intraday agent had that crypto didn't — same Tavily implementation, crypto-flavoured query) → **16 tools**; the prompt routes "why is X moving / regulation / ETF flows" to it. Panel chip: `16 TOOLS • P(WIN) + EV TICKETS + NEWS`. Registry lock updated (16-tool exact list).

### Phase 4 — the Portfolio AI overlay (the tab was rule-only)
- **NEW `server/ai/portfolioNarrative.js`** (pure-testable): `portfolioRedFlags` (PURE — market concentration × live regime: India ≥50% + BEARISH NIFTY → flag, crypto ≥35% + BEARISH BTC → flag; health-grade concentration risk; **"your top holding's AI signal just flipped bearish"** nudge: holdings ≥10% with fresh SHORT/FLIP ensemble views, ≥20% escalates high-severity) · `narratePortfolio` (quant-computes, LLM-narrates; honest quant-fallback text when the LLM layer is down) · `buildPortfolioDigestText` (the Telegram digest).
- **`POST /api/ai/portfolio-narrative`**: the client's OWN sync-truth quant payload POSTs up; the server adds what it cannot compute client-side — live `buildRegime('INDIA'/'CRYPTO')` + fresh ensemble views on the top-8 holdings — raises the flags, narrates. Response: `{ redFlags, narrative, source, regime, aiViews }`.
- **`PortfolioInsights.tsx`**: the AI OVERLAY section — 🧠 AI EXPLAIN button, red-flag cards (high=red/warn=amber), the narration block, honest unavailable state.
- **Telegram `/portfolio` (the plan's two-way item)**: net-worth by class + the same red-flag engine over the server's own asset snapshot + live regimes, chunked for Telegram; HELP_TEXT updated. The digest-level market split derives from top-holding weights (netWorthSnapshot carries none).
12 locks in `test/portfolioNarrative.test.ts`.

### Phase 5 — meta-ensemble: trained, activated, self-retraining
- **Trained (for real, this session)**: `train_meta_ensemble()` ran on fresh-fetched OHLCV — **6,630 samples · 29 vote-features** (BTC/ETH deep history via the keyless Binance path; the 40 equity symbols' yfinance feed is datacenter-geo-blocked from this sandbox — on Render/user machine the weekly retrain folds the full 42-symbol universe in). Artifacts `meta_ensemble.pkl` + `meta_feature_cols.pkl` saved and **committed into the repo** (ml-service/store/ is untracked-never; the Docker `COPY . .` carries them) — the inference roundtrip verified live (bull vote vector → UP 0.874). Walk-forward weighted-F1 0.470 (3-class) — journaled honestly; the weekly retrains will track it.
- **Activated**: `AI_ENABLE_META_ENSEMBLE=true` in `.env.example` + `render.yaml` (value: "true") — SAFE in every deploy shape: the Node ensemble honest-degrades to the in-process weighted average whenever `ML_SERVICE_URL` is unreachable or artifacts are missing.
- **The weekly retrain worker**: `retrain_scheduler.start_retrain_daemon()` — NEW non-blocking daemon-thread mode armed at FastAPI startup (`app/main.py` @startup) — boot-train + every `META_RETRAIN_INTERVAL_HOURS` (default 168 = weekly), APScheduler when available, plain loop otherwise; `META_RETRAIN_DAEMON=false` hands the cadence to an external `--once` cron; `META_RETRAIN_ON_BOOT=false` skips the boot-train (frequent-redeploy containers). A failed retrain keeps the previous pkl (graceful degrade) and never kills the API. Standalone modes unchanged (`python -m models.retrain_scheduler [--once]`).
- **Cleanup**: the m-stripped log prefixes (`eta-ensemble]` → `meta-ensemble]`, `eta-retrain]` → `meta-retrain]`) fixed.
- **Kelly sizing stays OFF** (the plan's own last step — "pehle signal accuracy stabilize ho, tabhi position-sizing optimize karna") — documented in render.yaml's flag comment.

### Validation
tsc CLEAN · full suite **2341/2341 — 100% GREEN** (v12.9's 2313/2314 + 28 net-new locks: mtfAB 12, stockOptionsCtx 3, portfolioNarrative 12, cryptoAgent 16-tool registry update — AND the 1 always-failing BSE fixture FIXED, so zero documented failures remain) · ml-service pytest **11/11** · build 5.17s · boot smokes **9/9 (v127) + 35/35 (v128)** · `node --check` + `py_compile` all touched files · meta-ensemble inference roundtrip verified live.

## v12.9 — MANUAL-TRADE REVERSAL ENGINE CONNECTION + REALTIME PRICES + NO-CAPS THRESHOLDS (2026-09-23)

**User spec: "manual trade record ko Realtime Prices Fetch hona hai" · "isko Superintelligence Reversal AI Engine se connect karo — jo bhi trade long/short reversal me jata hai to ye ACTIVATE hona chahiye" · "koi threshold tweak cap nahi — editable manually hamare hisaab se" · "USDT ke price point pe trade lete vo theek hai, qty bhi theek hai, but indian INR price amount add karne mat karo."** Four user specs, one release: the manual-trade tracker becomes a FIRST-CLASS citizen of the Reversal AI engine (cycles ACTIVATE on threshold crossings, exact FLIP plans stamped + pushed), repaints its LTP/P&L at SSE ~1s speed, the ₹ thresholds are the user's own numbers with ZERO caps, and the USDT desk carries no ₹-converted price amounts.

### 1. MANUAL TRADES ARE ENGINE-CONNECTED (the v12.8 advisory banner → a real cycle)
- **Activation on EVERY 5s price sweep (`manualTrades.js`)**: `activateReversalOnManualTrade()` runs per OPEN manual trade BEFORE the 30s conviction pass (capital protection is a stop — it must not wait for the ensemble re-vote). A ₹ loss-cap crossing stamps the MANUAL cycle + the exact FLIP plan (opposite side, qty, and the ₹ thresholds converted to price SL/TP levels at the live price via the same `priceLevelsForLeg` math the futures-desk engine uses); a ₹ target crossing stamps the BOOK call. In-band prices keep the cycle 'ACTIVE'; repeat crossings stay quiet; OPTION trades are conviction-tracked only (premium/IV domain); engine OFF / closed trades / bad prices are honest no-ops.
- **The activation Telegram push carries the FULL actionable plan in the trade's NATIVE currency**: USDT perps show `$` P&L (−$2.00, never a ₹-converted amount — the user's USDT-purity spec), India trades show ₹. The plan: "1) position CLOSE karo — minimal loss accept · 2) FLIP SHORT qty 1000 @ ~0.498 · SL 0.4998 (₹150) / TP 0.492 (₹500) · 3) +₹500 target pe BOOK". The later conviction-pass banners (LOSS_CAP / new REVERSAL_BOOK) are 15m-cooldown reminders of the same plan.
- **Cycle advance on close (`closeManualTrade`)**: closing a reversal-active trade stamps `closedState` + `followUp` (FLIP after a cut, REVERSAL_WATCH after a book) and the closeReason carries the cycle context ("REVERSAL leg-2 CUT (loss-cap ₹150) · manual") — the trade record itself tells the cycle story.
- **AUTO-LINK (`recordManualTrade`)**: a NEW trade on a symbol with a recently-closed cycle (inside the re-entry window, legs remaining) becomes the NEXT LEG of that cycle automatically — following the engine's plan paints the full ₹-cycle on the board without any manual bookkeeping. Best-effort: never blocks a record.
- **The board (`manualReversalCycles` + `GET /api/ai/reversal`)**: manual cycles grouped by `t.reversal.cycleId`, legs in openedAt order, net ₹ (summed realized legs), live-leg ₹ P&L off the monitor's own 5s-fresh LTP, ACTIVE/WAITING/ENDED states (WAITING = all closed inside the re-entry window with legs left), ranked live-first. The route merges them into the same payload: `manualCycles[]` + `activeCycles` counts both worlds.
- **UI**: `ReversalPanel` gains the "✋ Manual trades — engine-connected cycles" section (violet cards, MANUAL ✋ chip, LOSS-CAP / ₹ TARGET state chips, the stamped FLIP plan block with exact levels) · `ManualTradeMonitor` gains the emerald `REVERSAL_BOOK` banner ("₹ TARGET hit — BOOK karo") and the LOSS_CAP banner now carries the exact FLIP plan (qty @ ~px · SL/TP with the user's ₹ numbers) — both pinned to the top like EXIT_NOW.

### 2. REALTIME PRICES on the manual tracker (~1s SSE, was 5s REST)
- **NEW `src/components/aitrading/manualLiveMerge.ts` (pure, 6 unit tests)**: `liveKeyFor` maps a trade's market to the SSE tick namespace (FUT_/GLOB_/IN_) · `livePnlOf` recomputes the native-currency P&L with the EXACT server math ((px−entry)×mult×dir, ×fx for the ₹ twin of USDT-domain trades, the same usdInr the server sent — never a hardcoded 84) · `mergeLiveTicks` overrides LTP+P&L on OPEN trades only, with the 30s stale-tick rule (a dead tick never masquerades as live).
- **`useCxLivePrices` extended with the `india?: string[]` param**: NSE equities ride the SAME `/api/stream` SSE via the `in=` param — the tracker's realtime LTP source for India trades. The ManualTradeMonitor subscribes its OPEN trades' symbols (futures/global/spot/India lists, memoized on the joined symbol-set), merges ticks into the trade views at the hook's 800ms batched cadence (never per-tick re-renders), and the header chip flips to cyan `REALTIME ⚡` while a fresh tick + live SSE status hold — falling back honestly to `LIVE 5s` when the stream is down.
- **`GET /api/ai/manual-trades` now returns `usdInr`** — the server's own fx for that response, so the client-side recompute converts with the SAME rate the 5s poll used (zero drift between the two paints). The 5s REST poll stays as reconciliation: banners/conviction/distances remain server-computed.

### 3. NO-CAPS THRESHOLDS (user spec: "hamare hisaab se")
- **`reversalEngine.js`**: the REVERSAL_CLAMPS table is GONE. `loadReversalConfig` passes the user's numbers VERBATIM — the only validation left is sanity (finite + positive; maxLegs an integer ≥1). The old auto-lifts (cycle-stop below one cap lifted to 2×cap; target below cap lifted to 2×cap) are REMOVED — a ₹50 target with a ₹300 cap is the user's explicit choice now. Defaults stay ₹150/₹500/3 legs when nothing is saved.
- **`agent.js`**: the 7 reversal knobs moved from `NUM_CLAMPS` to a new `NUM_FREE` set — `updateAgentConfig` saves them verbatim (rounded 2dp, positive-only sanity), so the PUT `/api/ai/reversal/config` chain (panel → route → updateAgentConfig → force-refreshed loadReversalConfig) preserves the user's numbers end-to-end. Locked by 2 new agent tests (verbatim pass-through + garbage ignored).
- **`ReversalPanel`**: every `NumField` lost its min/max attributes (free typing, sensible steps: ₹10/₹50/0.5min/5min); the save button's only guard is `thresholdsSane` (all > 0); the footer says it out loud: "NO CAPS — aapke hisaab se (sab > 0 ho)". The config grid grew to 7 fields (re-entry conf bar is editable too).

### 4. USDT DESK PURITY (user spec: no ₹ price amounts on USDT)
- **`SignalCard.tsx`**: the ≈₹ conversion hint next to the margin input and the "USDT ≈ ₹ conversion display-only (×84)" footnote are REMOVED from the futures desk — the USDT domain stays pure USDT (entry/SL/TP/margin/qty). The ₹ lives only where it belongs: the server's own risk caps and the Reversal ₹-thresholds (the user's config). India/spot desks keep their native ₹ as before.
- **`_fmtPx` (manualTrades) precision-aware**: XRP-style sub-$1 levels used to collapse to "$0.5"; now 4-6 decimals below $1 keep the actual SL/TP flip levels readable on Telegram + banners.

### Validation
tsc CLEAN · full suite **2313/2314** (v12.8's 2294/2295 + 17 new `manualReversal.test.ts` locks: activation/flip-plan stamping, BOOK crossing, in-band degrade, quiet repeats, honest no-ops, native-currency texts, close-advance tags, AUTO-LINK next-leg, board grouping/ranking/WAITING, REVERSAL_BOOK banner, client liveKey/livePnl/stale-tick merge + 2 rewritten no-caps `reversalEngine.test.ts` config locks + 2 new `agent.test.ts` NUM_FREE locks; the 1 failure = the documented pre-existing BSE live-network geo-block, identical on baseline) · build 5.08s · boot smoke **35/35** (`scripts/smoke_v128.mjs` + S7: manual LOSS_CAP activation w/ stamped FLIP plan, native-$ text with NO ₹-converted amount, PROFIT_TARGET book, manualReversalCycles board view) · `node --check` all touched files.

## v12.8 — SUPERINTELLIGENCE REVERSAL RECOVERY AI (₹ loss-cap → flip → book cycles) (2026-09-23)

**User spec (XRP futures story): "long trade liya, thoda up hua, phir reversal down — balance negative ja raha tha. Long me minimal loss ₹100-150 accept karke close, phir opposite SHORT me ₹500+ profit book, reversal LONG pe wapas long laga ke phir profit book."** The engine turns a FAILED signal into a NET-POSITIVE CYCLE: `LEG-1 LONG → −₹150 CUT (loss cap) → ensemble confirm → LEG-2 SHORT flip → +₹500 BOOKED → waiting window → LEG-3 LONG re-entry → BOOKED → cycle end`. One new module (`server/ai/reversalEngine.js`, pure-testable, deps injected — zero import cycles), wired into the existing futures watcher, agent config, routes, and a new CoinDCX section 02f board.

### The engine (`reversalEngine.js` — 26 unit tests + 31-check boot smoke)
- **₹-denominated discipline per leg**: `lossCapINR` (default ₹150) → unconditional CUT (capital protection is a stop, never vetoed); `profitTargetINR` (default ₹500) → BOOK. The ₹ thresholds are stamped as price SL/TP on every new leg AND armed natively on the exchange when LIVE (`createFuturesTpsl`) — the discipline survives a sleeping/dead server.
- **Stop-and-reverse with guards (the v12.7 whipsaw lesson baked in)**: the flip after a loss-cap cut fires immediately (user spec) BUT is vetoed when — maxLegs budget done (default 3) · leg cooldown alive (3m) · cycle net ≤ cycle-stop ₹ (default ₹300 = cycle ENDS, no more legs) · the live ensemble still STRONGLY backs the original side (≥65% conf → pullback ≠ reversal, cut only). A dead/FLAT ensemble NEVER blocks the flip — a dead feed must not disable capital recovery.
- **Re-entry is CONFIRMATION-only**: after a target booking (or a vetoed flip), a WAITING window (45m default) opens — the next leg opens only when the ensemble flips OPPOSITE to the just-closed leg at ≥60% confidence. No blind churn after profit. Windows are in-memory but **journal-revived every pass** (`reviveWaitingFromJournal`) — a Render restart mid-window does not orphan the cycle.
- **LIVE honesty (v7.0.2 convention)**: live legs close via the real exchange exit (`exitFuturesPosition`); a blocked/failed exit journals WATCH_ERROR and the watcher retries next pass. LIVE opens respect daily trade/loss caps, max-open, one-per-pair, kill-switch (closing always allowed — it REDUCES risk).
- **Opt-in, OFF by default**: `reversalEnabled: false` — the user's visible ₹ thresholds, their explicit switch (ENABLE button on the panel). When OFF, behavior is byte-identical to v12.7.

### The wiring
- **`futures.js` watcher**: `evaluateReversalForPosition()` runs per OPEN futures-desk position (agent + manual + signal + reversal sources) INSIDE the journal lock, BEFORE trail/SL/TP (the ₹ thresholds ARE the discipline; stamped SL/TP stays as the redundant second guard) · `processReversalWaiting()` runs after the position loop — AND on the flat pass (a position-less journal still has live windows). The engine sends its OWN Telegram (leg cuts, flips, bookings, cycle ends — no double push via closures).
- **`routes.js`**: `GET /api/ai/reversal` (config echo + live cycle board w/ live-leg ₹ P&L) · `PUT /api/ai/reversal/config` (same clamp table as agent-config; force-refreshes the engine's 60s TTL cache so the next watcher pass picks it up) · the watcher now injects `getDeepSignal` (30s-cached deep path) — the ensemble gate reads the SAME signal the boards show.
- **`agent.js`**: 9 reversal knobs in `AGENT_DEFAULTS` + `NUM_CLAMPS` + `updateAgentConfig` (mirrored clamps in `loadReversalConfig` — the loadProTraderConfig convention).
- **UI**: NEW `ReversalPanel.tsx` (section 02f on CoinDcxTab + REVERSAL quick-nav chip) — master ENABLE/PAUSE, the 6 threshold fields + ensemble-gate toggle, live cycles board with per-leg timeline (side @entry → close @price ±₹), guards footer (legs left · cooldown · cycle-stop), recent ended cycles. 12s repaint while cycles live, 30s idle — the engine ticks server-side every 60s regardless.
- **Manual trades get the ₹ discipline as an ADVISORY (the v12.7 rule)**: `stateOfManualTrade` gains a `LOSS_CAP` banner (violet) — "minimal loss accept karke CLOSE karo → ulta LONG/SHORT entry → target pe BOOK" with the user's own ₹ numbers; one Telegram push per 15m; the futures desk's own positions cycle AUTO. Pinned to the top of the monitor like EXIT_NOW.

### Validation
tsc CLEAN · full suite **2294/2295** (v12.7 baseline 2268/2269 + 26 new `reversalEngine.test.ts` locks: config clamps, leg ₹ math, trigger edges, price-level stamping, cycle summary, decision guards — cut-unconditional/flip-vetoed ×4, waiting-window staging, re-entry confirm bar, cycle-end stamping, view payload; the 1 failure = the documented pre-existing BSE live-network geo-block, identical on baseline) · build 4.95s · boot smoke **31/31** (`scripts/smoke_v128.mjs`: the FULL XRP story end-to-end — LEG-1 cut −₹168 → LEG-2 SHORT +₹630 BOOKED → window → LEG-3 LONG confirmed re-entry → net +₹336 ACTIVE; agent-config bridge; routes registration) · `node --check` all touched files.

## v12.7 — FULL-SITE DEEP RECHECK: flip-discipline engine + egress diet + security hardening (2026-09-21)

**User report: "full site code recheck karo."** Three independent deep audits ran over the whole codebase (direction-chain / bandwidth / general QA, findings ranked with file:line evidence), every finding fixed, and every fix locked by tests. Baseline before the work: tsc clean · 2252/2253 (the 1 = documented pre-existing BSE live-network geo-block, identical after).

### 1. DIRECTION — the LITERAL "long pe trade liya, short me chala gaya" mechanism is dead
The audit found NO wire-level inversion anywhere (all four order desks, all exits, all position recording verified again). What it DID find — and what this release fixes:
- **Manual-position flip discipline (`agent.js`)**: the v9.7 trend-flip sweep used to MARKET-CLOSE the user's MANUAL LONG the moment the board printed a qualifying opposite signal — and the candidate flow could then re-enter the FLIP side after a bare 20-min global cooldown. That was the only code path that literally converted the user's LONG into a SHORT. Now: **manual positions are notify-only by default** (one Telegram ALERT per flip episode — `manualFlipAction:'close'` restores the auto-close, and even close-mode demands a STRONG-grade opposite signal).
- **Per-pair flip-churn guard (`agent.js`)**: every flip (exit OR alert) stamps `flipBlock[pair] = {side, at}` — the agent refuses to enter the **OPPOSITE side of that pair for 4h** (`flipReentryBlockMin`, clamped 0-1440). Same-side re-entries stay allowed. The block window + active blocks surface in `agentStatus().state.flipDiscipline` (panel-ready).
- **Board-vs-gate asymmetry fixed (`signals.js`)**: the deep CRYPTO/FUTURES path never set `ctx.__tv`, so in degraded candle conditions the fresh exec re-run's 15m tape seat ABSTAINED while the clicked board card HAD the tape vote → vetoes the user read as "direction galat". The deep ctx now carries the TV row — board card == deep card, always.
- **Pinned holding cards headline the POSITION (`signalMemory.js` + `SignalCard.tsx`)**: a held LONG whose AI view flipped used to render under a SHORT-labeled card. The card's side is now the position's side; the AI's current view rides a new `aiView` sub-chip ("👁 AI abhi SHORT dekh raha hai" — context, never a call). Summary leads with "aapki LONG position".
- **Exact committee ties → honest FLAT (`ensemble.js`)**: `bull >= bear` used to mint a LONG on an exactly-split committee. A perfect weight tie is now FLAT/NEUTRAL with a `tie: true` marker and the split summary.
- **Paper-synth side default (`coindcxOrders/futures/indiaOrders/globalFutures`)**: an ABSENT side in an execute request no longer silently defaults LONG — it inherits the fresh signal's side.

### 2. BANDWIDTH — the free-tier egress diet (recheck R2's ranked levers, all four)
- **`/api/crypto-prices ?symbols=` (the biggest pure-egress lever)**: the client re-downloaded the FULL ~400-market ticker array (~300KB raw) every 30s while reading only its ~20-symbol watchlist. The server now slices the CACHED array to the requested bases (~8KB, ~97% cut); the client sends its watchlist. Filter extracted to `lib/tickerFilter.js`, locked by `test/cryptoPricesFilter.test.ts` (6), verified live in the boot smoke (2 rows for BTC,ETH).
- **Boards are 304-able**: the client's `?t=` cache-buster is gone and the signals route sets `Cache-Control: no-cache` — Express's weak ETag now answers 304 for the byte-identical board inside the 60s server cache (the client polls every 30s → ~half the polls were full re-downloads of 100-400KB).
- **SSE tick diet (`index.js`)**: per-symbol throttle 400ms→1000ms + a dead-tick filter (|Δprice| < 0.05% pushes nothing) — ~0.3-0.4GB/day of price noise the UI's own 800ms batcher smoothed away anyway.
- **The fapi full-book whale is dead**: BOTH Binance `ticker/24hr` fetch sites now request ONLY the symbols they actually read via the documented `?symbols=` JSON-array param — `cxRtStream._binanceFutBook(missing)` (the outage-mode REST fallback, was 1-2MB every beat, worst-case 17-35GB/day) and `futures.js` leg 3 (the board's dark fallback, now FUTURES_UNIVERSE-only ~5KB). Cache is signature-keyed so a symbol-set change never serves a stale slice.
- **Deploy side**: `render.yaml` buildCommand `npm install` → `npm ci` (deterministic — Render's build cache hits far more often, cold installs shrink).

### 3. SECURITY / HYGIENE (recheck R3's top findings)
- **Paper + manual trades ride the ENCRYPTED durable channel**: both stores used plaintext `scheduleBackup` pushes to the public GitHub backup branch (symbols/qty/entries/P&L) while every other state file rode durable.js's AES-256-GCM promise. Both now `durablePut`; boot restores are decrypt-aware with legacy-plaintext migration grace — and manual-trades got a boot restore it NEVER had (restarts silently wiped the tracker).
- **Shutdown remote flush**: the four graceful-shutdown flushers only wrote Render's EPHEMERAL disk; the remote backup stayed a debounce+60s-gap window behind on every deploy. New `flushBackupNow()` fires every pending push inside the SIGTERM drain (bounded bypass, once).
- **Service-worker allowlist inversion**: the old sensitive-DENYLIST still cached `/api/ai/*`, positions, wallet, journal, holdings into unencrypted CacheStorage. Now only PUBLIC market-data paths (`quote|crypto-prices|forex|feed-status|ai-status|chart|fundamentals|inflation|ml`) may touch the offline cache; everything else is network-only. API cache bumped v18→v19 so the activate pass evicts every previously-cached private entry.
- **Security headers on the LIVE Render path**: nosniff / X-Frame-Options DENY / Referrer-Policy / Permissions-Policy / CSP (frame-ancestors 'none'; object-src 'none'; base-uri 'self') — the safe subset, verified live in the boot smoke.
- **RESCAN single-flight fixed**: `?rescan=1` used to bypass `_boardInflight` (the route comment claimed "single-flight protected" — it wasn't): a RESCAN could stack with the 15s warmOnly poll + the 30s board poll. All computes now share the one single-flight map.
- **Site cleanup re-applied**: the dead files the v12.4 cleanup removed and later user commits resurrected are gone again (UPGRADE_REPORT*.md, AUDIT_FIX_REPORT_v1801.md, smoke_v113.mjs, oldcode.gs).

### Validation
tsc CLEAN · full suite **2268/2269** (baseline 2252/2253 + 16 net new locks: agent flip-discipline 6, pinned-card aiView 2, exact-tie 2, ticker filter 6, fapi symbols locks in futuresResilience + cxRtStream, futures leg-3 universe-filter lock; the 1 failure = the documented pre-existing BSE live-network geo-block, identical on baseline) · build 5.43s · route audit PASS · boot smoke 9/9 (headers, symbols slice, auth gates, health) · `node --check` all touched files · ml-service pytest untouched/11-11.

## v12.6 — DIRECTION-ACCURACY ENGINE + THE BANDWIDTH FIX (2026-09-21)

**User report: "phir se check karo Intraday & coin dcx dono tabs ke Trade Signal directions Long aur Short Accurately dedo — long pe trade lene par short ho raha hai · world-top-professional deep AI quantum level pe recheck karo aisa kyun ho raha hai · aur Render me har redeploy me bandwidth bahut le raha hai — free tier 5GB exhaust ho raha hai."**

**The quantum-level recheck — STATISTICAL ground truth first:** the app's OWN walk-forward replay engine was pointed at the live ensemble (`/api/ai/backtest`, 116 trades, ACTION floor, same model code the boards run): **29.3% win-rate · avgR −0.35 · profit factor 0.55 · 78/116 trades stopped out.** The directions are not randomly wrong — they are systematically ANTI-predictive at entry. Combined with the live board probe (10/10 futures signals LONG in a mixed market; every coin already +2-13% into its move; the committee's only voting seats were trend/momentum/regime/smc — all 1h LAGGING trend readers), the root cause is now measured, not guessed: **the crypto/futures committee is a 1h-trend echo chamber that confirms moves AFTER they happen.** The tape seats (the only sub-hour timing voice) were hard-coded to abstain on crypto/futures ("no double count" — a note that only ever applied to reading the SAME series twice). The agent's conviction-flip exit + flip-re-entry then converts the whipsawed LONG into a SHORT position — the literal "long pe trade lene par short ho raha hai" experience.

### 1. THE 15m TAPE SEAT GOES LIVE ON CRYPTO/FUTURES — the committee counterweight
- `models.js`: `intradayTape`/`intradayTapeMTF` gates are now **data-driven** (vote whenever a tape payload exists; honest abstain when it doesn't) instead of market-driven (India-only).
- `signals.js`: **NEW pass-2 15m tape enrichment for crypto/futures boards** — the top candidates (2× the board, cap 20) get a 15m tape read (CoinDCX futures 15m candles → Binance/Bybit 15m klines; spot: CoinDCX 15m → Binance rescaled onto the INR anchor). The tape vote is injected into the committee and the board **re-ranks after it weighs in** (the India pattern). Deep dives fetch the same tape — **deep card == board card** (a deep dive disagreeing with the board's tape read was a silent "board ne LONG bola, deep SHORT nikala" source).
- Live check (local boot): the futures board now carries real tape votes (NOT LONG/69, HMSTR LONG/83; SOL's tape honestly abstains at a borderline-neutral read) — the first sub-hour voice the crypto committee has ever had.

### 2. ENTRY-QUALITY BANDS — the POSITIVE side of the timing read (rank the good entries to the top)
- `entryTiming.js`: **PULLBACK** (extSigned ∈ [−0.6, +0.8] — price at/near its mean inside the trend) → **+4 confidence, ×1.10 board score**; **EXTENDED** (1.5-1.8×ATR, under the SOFT chase line) → **−4 confidence, ×0.93 score**; chased (HARD/SOFT) → ×0.85. Never touches side/ltp.
- **The board now ranks by ENTRY-QUALITY-ADJUSTED score** (`rankScore` on the payload, fully transparent): live check — SOL PULLBACK 0.8×ATR aiScore 79 → rank 86.9 (board #1); BNB EXTENDED 1.76×ATR aiScore 74 → rank 68.8 (below equal-score calm coins). The most-extended movers no longer crown the board — pullback-in-trend setups do.
- `applySignalTrustGuards` applies the boost/haircut alongside the v12.5 chase caps; `buildSignal` forwards `entryQuality`; **SignalCard chip: 🌊 PULLBACK (emerald) / 📐 STRETCHED (amber)** with the acha-entry-zone tooltip.
- **A/B proof (the app's own replay, identical bars):** RAW 110 trades · 30.0% win · avgR −0.30 · PF 0.60 · maxDDR 35.1 → **GUARDED 89 trades · 31.5% win · avgR −0.25 · PF 0.66 · maxDDR 26.4** — the guards cut 21 trades and improve every metric. `strategy=guarded` is now a route param (`/api/ai/backtest?strategy=guarded`) so the proof is reproducible any time.

### 3. THE FLIP VETO made honest (the "long pe trade lene par" execution-side belt)
A clicked side that no longer matches the fresh consensus is vetoed (this always existed — a LONG click can NEVER silently execute as SHORT); the journal reason now names both sides and the fix: *"fresh consensus SHORT hai, aapne LONG card pe trade maara tha — signal FLIP ho gaya (whipsaw window). Card refresh karke naya setup confirm karo; auto-flip execute kabhi nahi hota."* FLAT/planless veto moved before the mismatch check (a FLAT signal is not a "flip" — the honest reason is there is no consensus).

### 4. THE BANDWIDTH WHALE IS DEAD — Render 5GB exhaustion fix
**Measured root cause: `cryptoStream.js`'s shared ticker cache window (2000ms) == the SSE poll period (2s) — with ONE browser open, the server re-downloaded the FULL CoinDCX exchange ticker list (~400-800 markets, several hundred KB) every 2 seconds ≈ 20GB/day of Render outbound.** Every redeploy restarts the server, the user opens the site to verify, the SSE connects, the whale resumes — "har redeploy me bandwidth khata hai."
- **REST anchor window 2s → 20s** (live ticks come from the WebSocket books; REST is only the INR anchor). **WS-first serving**: a servable + fresh (<10s) official CoinDCX spot-WS book serves with ZERO REST round-trips. SSE UX unchanged (2s pushes from the merged tick cache).
- **CANDLE TTL CACHE (5 min / 3 min on 15m)** on `fetchCoinDcxCandles` / `fetchBinanceKlines` / `fetchFuturesCandles` — 299 of 300 bars are byte-identical between board cycles; the board's per-cycle candle downloads drop ~10×. Boards also render faster (free-tier CPU bonus).
- **cxRtStream prolonged-outage backoff:** 2+ minutes with every WS accelerator dark backs the futures REST poller 2s → 5s (a dark-accelerator session was ~13GB/day); fresh sessions keep the 2s feel, any WS tick resets it.
- Combined effect: the with-one-browser outbound drops from the tens-of-GB range to low-GB/day; idle burn (ticker cache + candle cache + compressed responses + immutable asset caching from v11.7) stays in the hundreds of MB.

### Validation
- **tape seat:** intradayTapeAlignment + intradayMtfConfluence updated to lock the NEW data-driven gate (crypto ctx with a tape VOTES; no tape → honest abstain).
- **entry quality:** signalTrust v12.6 cases (PULLBACK boost + stamp + summary · EXTENDED haircut under the SOFT line · HARD cap wins, no boost on chased signals · buildSignal passthrough).
- **guarded backtest:** new suite (guards only refuse — never invent: guarded ≤ raw trades, no invented sides · blow-off-top vertical-leg entries refused · unknown strategy degrades byte-identical).
- **candle cache:** `__clearCandleCache` / `__clearFuturesCandleCacheForTest` hooks; futures suite clears between cases.
- **tsc CLEAN · full suite 2252/2253** (1 = the documented pre-existing BSE live-network geo-block, identical on baseline) · build 5.21s · local boot + live functional probes: PULLBACK re-ranking live on the futures board, tape votes landing, rescan path intact, A/B numbers above.

## v12.5 — DIRECTION-TIMING ENGINE (chase guard) + RESCAN button (2026-09-21)

**User report: "CoinDCX tab me sabhi trades signal directions wrong bata raha hai — long bola tho short jaa raha hai, short bola tho long · same Indian intraday me bhi · signal age correct show ho raha hai ✓ · RESCAN button chahiye — click karo toh fresh top trade signals aaye, high win rate high accuracy, deep AI Trading agent se."**

**Root-cause discipline (audit first):** the ENTIRE execution chain (signal → order side → position record → display) was re-verified line-by-line — LONG→buy / SHORT→sell is correct everywhere (spot /orders/create, margin /margin/orders, futures /derivatives/futures/orders — plus every exit path). The live board was then probed against the real market: the board said LONG across the board WHILE the market had ALREADY risen +0.9% to +6.5% over 14h. **The signals are not inverted — they are LATE.** The lagging ensemble (EMA stacks, momentum, trend seats) CONFIRMS the move that already happened, the entry lands at local exhaustion, and the mean-reversion that follows reads to the trader as "direction galat bola". Same mechanism on the India intraday desk (shared ensemble). The v12.4 RSI-only OB/OS guard misses this: a +6% vertical run prints RSI 63 — under the 70 bar, still a top-tick entry.

### 1. DIRECTION-TIMING ENGINE — `server/ai/entryTiming.js` (NEW, pure)
The structural entry-timing read, computed on the trading timeframe every consensus already carries:
- **extAtr** — signed distance of price from its mean (EMA20; session **VWAP** on the India intraday desk), in ATR units. ATR-normalized so the same thresholds mean the same thing on a ₹2 smallcap and $80k BTC.
- **runBars / runAtr** — consecutive one-way closes at the END of the tape + how many ATR that leg covered (the news/liquidation vertical).
- **Verdict:** HARD when extAtr ≥ **2.5** in the signal's direction, OR RSI ≥ 64 / ≤ 36 with extAtr ≥ **1.9** (the RSI-assist band the OB/OS guard misses), OR ≥ **6 one-way candles covering ≥ 3 ATR**; SOFT at extAtr ≥ **1.8**. Never flips the side (entries are suppressed, not redirected — counter-knife-catching is the same disease). Never throws; silent-degrades when price/ATR/candles are missing.

### 2. CHASE GUARD wired into the trust ladder — `applySignalTrustGuards` (board + deep paths)
HARD → grade capped WATCH + confidence capped **48** (entry gate dead — a WATCH can never satisfy `requireStrong`/ACTION floors); SOFT → **−7** haircut. Stamped `chasing: { severity, extAtr, runBars, runAtr, ref, reason }` rides the wire through `buildSignal`; summary says "🚀 CHASING — price 2.6×ATR above EMA20 — LONG entry suppressed (pullback ka wait karo)". **Both desks inherit automatically** — the guard runs on the shared consensus layer (crypto spot / USDT futures / global equity SIM / India intraday), and the deep path the execution gauntlets read is the same one.

### 3. EXECUTION GATE chase veto — honest journal reasons
`evaluateExecutionGate` now refuses a HARD-chasing entry with a readable reason (`chasing guard — price 2.6×ATR extended; entry suppressed (pullback ka wait karo…)`) — **practice entries too** (rehearsing a top-tick chase is the same bad habit). Belt-and-suspenders over the grade cap: the journal now names the disease instead of a bare "grade WATCH".

### 4. SignalCard v12.5 chip
**🚀 CHASE-LOCK / EXTENDED chip** — rose (HARD) / amber (SOFT), "2.6×ATR · 5↑" live on the card; tooltip explains: move already ho chuka hai — ab entry = chase (top-tick risk), pullback ka wait karo; signal side wahi rahega, entry timing improve karo.

### 5. RESCAN button — fresh top signals on demand (the explicit ask)
- **Server:** `GET /api/ai/signals?rescan=1` → `noCache` — a FULL fresh universe scan, single-flight protected (concurrent rescan clicks join the same in-flight scan; the 60s board cache is untouched for the normal 30s cadence).
- **Client:** `useAITrading.rescan()` widens the timeout to 90s (cold universe scans), double-fire guarded (`rescanning` state disables the button); the board header of BOTH desks (CoinDCX + India Intraday) carries a **🔁 RESCAN** button — cyan-violet, live "SCANNING…" pulse while the deep ensemble re-runs (fresh prices → fresh consensus → fresh guards → re-ranked top signals).
- Normal refresh (🔄) unchanged: 60s-cache read, instant.

### Validation
- **NEW v12.5 suite (17 tests) in `test/signalTrust.test.ts`** (39 total): pure verdict table (HARD at 2.5×ATR both sides · RSI-assist band · 6-candle vertical leg · SOFT band · calm tape clean · India VWAP anchoring · null-degrade) · consensus discipline (STRONG→WATCH cap + conf 48 + stamp + side untouched, both directions · SOFT haircut without grade cap · clean signal untouched · wire passthrough) · gate veto table (live refusal with reason · practice refusal · SOFT passes · clean passes as before).
- **Live functional probe (local boot):** the futures board surfaced `NOT extAtr=2.6 → chase=HARD, conf 48, WATCH` and `BNB extAtr=1.92 (RSI-assist) → chase=HARD` while calm coins (extAtr 0.64-1.45) ride untouched — the guard fires on real market geometry, not just fixtures. The rescan endpoint re-scanned fresh (new generatedAt, re-ranked board) while the cached path answered instantly.
- **tsc clean · full suite 2244/2245** (1 = the documented pre-existing BSE live-network geo-block, identical on clean baseline; mandateFreeze parallel-load flake passes 9/9 × 3 in isolation) · build 5.4s · `node --check` on every touched file.


## v12.4 — SIGNAL TRUST ENGINE: signal age, OB/OS discipline, anti-whipsaw, board pinning + site cleanup (2026-09-20)

**User report: "WLD USDT Futures me trade liya (qty 692 @ 0.4385) long signal tha but lagane ke baad short me chala gaya, stock negative chala gaya — ye nhi hona chahiye · overbought aur oversold ko dhyan rakho · AI signals high accuracy badhao · trade lene ke baad wo Superintelligence Signal Board se gayab ho gaya · signal ka AGE batao (AI model ne kab dekha, kitna time hua) · site cleanup karo, lag-free, bugs-free."** The WLD incident decomposed into four distinct gaps, each closed at the source this release.

### 1. Signal Continuity Engine — `server/ai/signalMemory.js` (NEW)
Per-(market, symbol) continuity store: **firstSeenAt** (when the AI FIRST called this direction — the signal's true AGE), lastSeenAt (last board confirm), prevSide/flippedAt/flips-24h (the whipsaw thermometer), lastConf/lastGrade/lastLtp (the pinned-card's AI view), lastDirSide (preserved across FLAT gaps — LONG→FLAT→LONG resumes, LONG→FLAT→SHORT counts as a genuine flip from LONG). Bounded 400 records (LRU), persisted to `ai-signal-memory.json` (3s debounce, read-only-FS degrades to memory-only), 48h boot prune. `remember()` is called from BOTH consensus layers: pass-1 (FLAT views included — a symbol going neutral is exactly when its last directional view must stay queryable) and the final post-council consensus; the deep path remembers too (its consensus is what the execution gauntlets read).

### 2. SIGNAL TRUST GUARDS — `applySignalTrustGuards` (board AND deep paths)
- **OVERBOUGHT/OVERSOLD HARD GUARD (the user's explicit ask):** LONG at LTF RSI ≥ 70 can no longer wear ACTION/STRONG — grade capped to WATCH, confidence floored at 50 (extreme ≥ 78 → 42); SHORT at RSI ≤ 30 mirrored (≤ 22 extreme). RSI source priority: the LTF (trading timeframe) indicator set first, TV daily fallback. Side/ltp are NEVER touched (existing plans stay valid) — the card still shows, honestly stamped `obOs: { tag, rsi }` + the summary says "⛔ OVERBOUGHT RSI 74 — LONG entry suppressed (chase hi hota hai ye)".
- **FLIP COOLDOWN (the WLD whipsaw fix):** a side that flipped < 5 min ago is capped to WATCH + stamped `freshFlip: { from, to, ageSec }`; 5-10 min after a flip takes an −8 confidence haircut; older flips pass clean. A first-ever direction is NOT a flip. The LIVE execution path inherits both guards automatically — `getFresh*SignalForExec` feeds from the guarded deep consensus, so a live LONG on an overbought perp or a freshly-flipped whipsaw is now rejected at gate 5 (grade WATCH can never satisfy `requireStrong`).
- **AGE on every card:** `signalAge: { firstSeenAt, lastSeenAt, ageMs, flips24h }` rides the wire; the frontend recomputes age LIVE from firstSeenAt (15s tick) so the chip keeps ticking between board refreshes.
- Guards run inside try/catch and NEVER break a signal — worst case the consensus passes through untouched.

### 3. Board persistence — traded symbols NEVER vanish (the "gayaab ho gaya" fix)
`pinHoldingOnBoard` runs after the top-N cut on every board cycle: cards for symbols with OPEN positions (journal auto/desk trades + the manual tracker — both read directly from their JSON stores, no import cycles) get a `holding` stamp (side/entry/qty/age/via); held symbols that fell out of the cut get a **PINNED card** — the AI's CURRENT view stamped honestly ("AI view: STRONG LONG · conf 71%" / "AI abhi NEUTRAL hai — last directional view LONG 8m pehle" / "AI view stale"), grade never above WATCH, no plan, `executable: false`, `holdingOnly: true`, bounded to 4 pins so a full book can't flood the board. Normalized matching across pair spellings ("B-WLD_USDT" / "WLDINR" / "NVDA-USD" → base symbol). The board fallback for exec (`_boardFallbackForExec`) can never turn a pinned card into an entry — its null plan fails the execution gate honestly.

### 4. SignalCard v12.4 chips (frontend)
- **⏱ AGE chip** — `<2m` cyan "FRESH" (unstable — confirmation ka wait karo) · 2-10m emerald · 10-30m amber · `>30m` red "STALE" (deep re-check karo) · 24h flip count rides the chip (`2↺`); tooltip carries the full truth (age · last board confirm · flips).
- **⛔ OB/OS chip** — OVERBOUGHT/OVERSOLD + live RSI, red when extreme; tooltip names the suppressed side and why.
- **🔄 FLIP chip** — "FLIP LONG→SHORT 3m pehle — whipsaw window me hai, grade WATCH cap laga hai".
- **🎯 HOLDING chip** — side + entry price; fuchsia ring on the card (strong ring for pinned-only cards); tooltip shows qty/opened-when/source.
- Pinned-only cards render through the normal SignalCard path (no trade button — not actionable by design; the monitor/console own the exits).

### Site cleanup (lag-free / bugs-free pass)
Removed: `docs/AUDIT_FIX_REPORT_v1801.md`, `docs/UPGRADE_REPORT.md`, `docs/UPGRADE_REPORT_v18.md` (one-off audit reports consolidated into this changelog — README references updated), `server/apps-script/oldcode.gs` (dead code), `scripts/smoke_v113.mjs` (superseded by smoke_v120.mjs). Client polling cadence audited and confirmed by-design (board 30s / RT prices 2s single-flight / agent status 15s warmOnly — no compute on poll paths).

### Validation
- **NEW `test/signalTrust.test.ts` — 22 tests**: continuity (age anchoring, flip detection, FLAT preservation, per-market keys, 24h-bounded history, symbol normalization) · OB/OS guard table (both sides, extreme bands, LTF-priority, cap-only-tightens, neutral untouched) · flip cooldown ladder (fresh/soft/clean/first-ever) · FLAT no-op · wire passthrough · holdingPositions (journal + manual, side/symbol normalization, market filter, closed ignored, garbage-degrade) · pinning (stamp, pin, bound, honest stale view).
- Board suites updated to the new discipline with REALISTIC fixtures: the old monotonic synthetic tapes computed RSI 0/100 (any honest OB/OS guard must catch them) — added falling-with-pullbacks series (RSI ~41) under which the confirming-tape STRONG/ACTION SHORT assertions still hold; the monotonic fixture now LOCKS the OVERSOLD suppression (side/tape-vote intact, grade WATCH + obOs stamp). `__clearSignalCaches()` now also resets the continuity memory (clean slate between board tests).
- **tsc clean · full suite 2226/2227** (the 1 = the documented pre-existing BSE live-network geo-block; mandateFreeze's occasional parallel-load timeout passes 9/9 in isolation — documented class) · build ~5s · `node --check` on every touched file.

## v12.3 — THE 401 ROOT CAUSE FOUND & FIXED: GET-with-body is the documented wallets contract (2026-09-19)

**User report: "SAME ISSUE HAI — FUTURES WALLET READ FAILED [401]" (after v12.2). The live scope probe had now SPOKEN: `futures-key-scope: OK` — the key CAN authenticate derivatives (the positions POST passes auth with the same key that 401s on the wallets GET). That kills the permission hypothesis outright and left exactly one suspect: our GET wire form. Re-extracted the official docs.coindcx.com Slate capture (1.1MB, "Wallet Details" + "Wallet Transactions" samples) — and there it is: the derivatives private GET endpoints carry the SIGNED COMPACT `{"timestamp":<int ms>}` JSON AS THE GET REQUEST BODY (`requests.get(url, data=json_body)` in Python / `request.get({url, json:true, body})` in Node), with page/size-style params riding the query string UNSIGNED. We were sending the signed payload as QUERY PARAMS with an EMPTY BODY — the server verifies the signature against the request body, so every permutation (v10.3.2 seconds-string → v12.1 int variants → v12.2 spaced-JSON) was structurally unable to verify. THAT is why all 8 rungs 401'd forever while the same key POSTed fine.**

### The transport fix — `coindcxPrivateGET` body mode (the new default)
Body mode (default): signature = HMAC-SHA256 over the compact `{"timestamp":<int ms>}`; the exact signed string is sent as the GET request body with `Content-Type: application/json`; params (page/size) ride the query string UNSIGNED; the timestamp NEVER goes in the query. Legacy `mode: 'query'` keeps the v10.3.2-v12.2 wire form verbatim as ladder fallback rungs. **Transport subtlety:** Node's undici `fetch` FORBIDS GET bodies ("Request with GET/HEAD method cannot have body") while the official docs assume Python `requests` (a raw HTTP client with no Fetch-spec restriction) — so the body-mode GET rides Node's native `node:https` module (`_httpsGetJson`: same URL/headers/signed JSON, GET body written onto the socket, 10s timeout, byte-identical error envelope `[status] message`). The legacy query mode stays on `fetch` untouched. Wire form PROVEN against a local echo server: `GET /exchange/v1/derivatives/futures/wallets` + `Content-Type: application/json` + `Content-Length` + `X-AUTH-APIKEY/X-AUTH-SIGNATURE` + body `{"timestamp":<ms>}`.

### The ladder — documented rungs first
7 rungs: **GET-body/ms/num** (the doc sample — Python AND Node official examples) → GET-body/s/num (the Request-Definitions table says "epoch seconds" — docs self-inconsistency insurance) → GET-body/ms/str (string-ts insurance) → GET-s/str → GET-ms/num (legacy 2025 query family) → GET-s/pgsz → POST (the [404] canary). Sticky-rung logic hardened: the resolved rung is what gets de-duplicated out of the tail (a stale sticky id can never duplicate rung 1). Scope-OK guidance now names the GET-with-body fix instead of the spaced rungs.

### Why this closes the incident
With the wallets read fixed: `deployableFuturesUSDT` goes live → the `equity_floor` skip clears (wallet equity ≥ ₹300) → the agent's 75-score/70-confidence gated scan can fire REAL futures entries → the positions watcher (POST family — always authed fine) auto-manages TP/SL/close. The auto-trade chain was never broken downstream of the wallet read; it was starved of the wallet read.

### Validation
- coindcxGet.test.ts rewritten around BOTH transports: node:https stub locks the body-mode wire (path with NO timestamp in query, Content-Type/Content-Length, signature over the exact body string, params-unsigned-in-query, [401] envelope, network-error rejection) + fetch stub locks the legacy query mode (regression: pre-v12.3 wire reachable ONLY via `mode:"query"`).
- futures.test.ts: 6-rung ladder order with body rungs first + sticky/trace/cooldown/sweep counts updated + scope-OK text lock (`GET-with-body rungs`); agent.test.ts fixture trace updated.
- **tsc clean · full suite 2204/2205** (the 1 = the documented pre-existing BSE live-network geo-block, unchanged; an occasional durable.test.ts parallel-load flake passes 21/21 in isolation) · build 5.83s · boot smoke PASS (server up with the https transport, /api/health 401-auth-gated as designed).
- Expected live outcome after deploy: the FIRST wallet poll answers on rung 1 (GET-body/ms/num) — the futures USDT tile shows the real balance, the `equity_floor` blocker clears, and (with Risk mode LIVE + Auto-execution ON + agent START) live futures entries can finally fire.

## v12.2 — FUTURES KEY-SCOPE PROBE: the definitive verdict on the wallets-401 (2026-09-19)

**User report: "FUTURES WALLET READ FAILED — [401] Invalid credentials [auth-ladder GET-s/str:401] — key spot par kaam karta hai par derivatives wallet reject kar raha hai." The v12.1 ladder fired exactly as designed and its trace proved all five compact-GET permutations 401 with a spot-working key — but that evidence alone cannot distinguish the two candidate root causes: (a) the API key lacks Global-Futures permission, or (b) CoinDCX's GET canonicalization drifted. Cross-checked an independent public CoinDCX SDK (@nemesis-oss/coindcx-sdk — signs the wallets GET exactly like rung 1: GET + query params + seconds-string timestamp + compact JSON), which keeps (b) alive but makes (a) the prime suspect. v12.2 makes the app itself run the discriminator and lead every error with the verdict.**

### The key-scope probe — `probeFuturesKeyScope()` (futures.js)
One harmless POST read of `/exchange/v1/derivatives/futures/positions` (the documented POST route on the SAME derivatives family) with the SAME key settles it: **2xx / 400 / 422 → scope OK** (a validation error is past the auth middleware — auth PASSED), **401/403 → scope MISSING** (the key is rejected on the whole derivatives family — a SPOT-scoped key), **404/5xx/network → UNKNOWN** (honest, never guesses). Fired only when every GET rung answers a strict 401 (timeouts/gateway blips never trigger it), cached 10 min, single-flight, cooldown-safe.

### Verdict-led errors — every surface names the exact cause + the one-step fix
`MISSING` → `[401] … · futures-key-scope: MISSING — API key me Global Futures permission nahi hai (derivatives positions auth bhi 401 — same key spot par chalti hai). CoinDCX app → API Dashboard → Futures permission ON karke NAYI key banao → site me CoinDCX reconnect karo`. `OK` → the verdict says auth-format drift and points at the spaced rungs instead — the permission fix is deliberately NOT suggested when the key is fine. Ordering: verdict → guidance → ladder trace last, so the agent blocker (260 chars), the agent log (300), Telegram (200) and the wallet card (420) all carry the verdict + fix inside their budgets. `walletSnapshot.futures.scope` exposes the machine verdict; the CoinDCX wallet card turns the error **red + ⛔** when scope = no_scope so the fix can't hide in amber noise.

### Spaced-JSON ladder rungs — the (b)-path fix, in case the drift is real
Two new rungs (`GET-s/str-sp`, `GET-ms/num-sp`) sign the **Python json.dumps canonical form** (`{"timestamp": 1789824123}` — `, `/`: ` separators). Rationale: POSTs verify against the raw body byte-for-byte (immune — which is why spot works), but a GET server must REBUILD the payload from the query string; if that rebuild walks Python defaults, a compact signature can never verify no matter the timestamp typing. `coindcxPrivateGET` gained `sep: 'spaced'` (hand-built canonical string — never a regex on the compact form, so values containing `,`/`:` can't corrupt it). Ladder is now 8 rungs: 4 compact permutations → 2 spaced → page/size → legacy POST.

### Reconnect = clean slate
`coindcxConnect` now calls `resetWalletTransportForReconnect()` (dynamic import — no static cycle): the sticky rung, the 5-min probe cooldown and the cached scope verdict all belonged to the PREVIOUS key — a fresh futures-permission key re-probes the FULL ladder immediately instead of failing one stale rung for 5 minutes and flashing the old verdict.

### Validation
- New locks: futures.test.ts scope-probe block (verdict classification 2xx/400/422→ok · 401/403→no_scope · 404/5xx/net→unknown; verdict-led error text; probe caching; reconnect reset; non-401 never probes) + 8-rung ladder order with spaced rungs + snapshot 420-char budget + `futures.scope` exposure; coindcxGet.test.ts spaced-signature block (4); agent.test.ts blocker verdict+fix survival lock.
- **tsc clean · full suite 2204/2205** (the 1 = the documented pre-existing BSE live-network geo-block, unchanged) · build 5.14s · route audit PASS · npm audit 0/0.
- Expected live outcome after deploy: within one wallet poll the agent log/blocker will say which world we're in — `futures-key-scope: MISSING` → create the futures-permission key (CoinDCX app → API Dashboard) and reconnect; `futures-key-scope: OK` → the spaced rungs have a live shot at fixing the read outright; either way the panel states the cause, not a guess.

## v12.1 — LIVE AUTO-TRADE UNBLOCK: the three walls every live entry was hitting (2026-09-19)

**User ask: "site code me smartai-e954.onrender.com ki jagah smartai1.onrender.com daalo · Global Futures wallet me amount hai par koi auto trade lag hi nahi raha — accurately theek karo · min trade score 75+ aur conf 70+ rakho · auto entry + auto close high accuracy maintain karo." Live diagnosis on the NEW deployment (login → /api/ai/agent → /api/ai/wallet → journal entries) found the agent FIRING but dying at three separate walls — all three fixed.**

### URL migration
`smartai-e954.onrender.com` → **`smartai1.onrender.com`** everywhere (api.ts `getProxyBase()` Vercel/GH/Netlify fallback, index.html static-mirror redirect, StaticMirrorBanner `REAL_APP_URL`, README guidance, test headers, CHANGES history). The old service is suspended by its owner — every hardcoded reference now points at the live deployment.

### Wall 1 — every LIVE SPOT order died with `[422] market is required` (journal-proven)
The spot `/exchange/v1/orders/create` body sent the pair in a `pair` field with `order_type: 'market'` — that's the MARGIN/futures vocabulary. The SPOT contract wants **`market`** ("BTCINR") + **`order_type: 'market_order'`** (the exact fields CoinDCX's 422 named). Fixed at all four send sites: agent/manual ENTRY, watcher SL/TP close, partial-TP legs, manual close — live entries AND exits now speak the right dialect. (The margin + futures desks were already on their own correct contracts — untouched.)

### Wall 2 — the Global Futures wallet read 401s (the "amount hai par auto nahi lag raha" root cause)
Live evidence: spot `/users/balances` signs fine with the user's key, but `derivatives/futures/wallets` answers **401 Invalid credentials** on both string-timestamp GET transports while POST still 404s (route is GET-only) — CoinDCX evidently drifted the GET canonical signed payload. Fix: the wallets transport is now a **6-rung AUTH LADDER** — GET-s/str (2025-verified) → GET-ms/num (docs-canonical INT timestamp) → GET-s/num → GET-ms/str → GET-s/pgsz (page+size signed) → legacy POST. First rung the server accepts goes STICKY; when every rung fails the error carries the **full variant trace** (`[auth-ladder GET-s/str:401 · GET-ms/num:401 · … · POST:404]`) plus, when all GETs 401 with a spot-working key, the honest guidance: build the key with GLOBAL FUTURES permission. The trace rides the wallet snapshot (error budget 140→300 chars), the agent log, a one-shot Telegram alert, and a NEW hard `futures_wallet_read` FAULT blocker on the agent panel (a failed read is never mislabeled "margin < 2 USDT" again).

### Wall 3 — FAILED orders were burning the daily trade quota
Three `[422]` failures + "Daily trade cap (5) hit" the same hour: exchange-refused orders consumed the entire daily budget and the agent stood down on trades that never existed. FAILED now joins REJECTED/NOTIFIED in the quota exclusions — `dailyStats` (both desks' cap) and `agentTradesToday` (the agent's own 3/day) count only orders that actually reached the book (FILLED/SUBMITTED/SUBMITTED_UNKNOWN).

### Thresholds — USER SPEC locked
`minAiScore` stays **75** (Path A) and `minConfidence` rises 60 → **70** (Path B: STRONG + executable + agreement). Saved configs sitting at the old default migrate up automatically; user-customized values are preserved; the mid-session mandate guard allows the stricter bar without a restart. Near-miss auto-trade keeps its own 70-conf floor.

### Validation
- New locks: `test/v121AutoTradeFix.test.ts` (9) + auth-ladder/sticky/trace block in futures.test.ts (4) + tsType-num signer block in coindcxGet.test.ts (3) + spot-body `market`/`market_order` locks in aiOrders/leverage + FAILED-quota lock + wallet-read FAULT blocker lock.
- **tsc clean · full suite 2194/2195** (the 1 = the documented pre-existing BSE live-network geo-block, unchanged) · build 5.63s · route audit PASS.
- User-side arming after deploy (safety, unchanged by design): Risk settings → mode **LIVE** (typed) + **Auto-execution ON** → agent START LIVE — the agent's own `live_preconditions` blocker names all three on the panel strip.

## v12.0 — PRO TRADER UPGRADE: calibrated Win-Probability engine + Perp Positioning Intelligence across the CoinDCX desk (2026-09-19)

**User ask: "CoinDCX TAB ke 6 sections (Crypto Desk AI Agent, Manual Trade Tracker, Execution Console, Superintelligence Signal Board, EXPERT PICKS 80+, GLOBAL FUTURES USDT PERPS) ko aur zyada advance pro-trader level pe upgrade karo — Superintelligence improvement, highest accuracy, highest win trades." The upgrade answers the pro desk's actual first question — "IS TRADE ME KITNI PROBABILITY HAI?" — with numbers it can defend.**

### New engine 1 — WIN PROBABILITY (`server/ai/winProb.js`)
- **P(WIN)** on every scored signal: AI-score prior → **ledger calibration** (trust.js settled outcomes per confidence bucket, claimed-vs-actual with 0.70-1.30 damping, n≥10 gate) → LONG/SHORT side split (n≥20) → funding + positioning (perps) → MTF/agreement confluence. Every adjustment carries a ±pts driver string.
- **P(NEED) = 1/(1+R:R)** — the plan's breakeven. **EDGE = P(win) − P(need)**, **EV in R** (full 40/40/20 book + a realistic capture haircut), verdict ladder EDGE/FAIR/NO-EDGE. Hard cap 92% — never certainty; uncalibrated says so.
- Wired: signal board (all markets) + expert picks + deep dives + agent tools + topFive (spread carries it).

### New engine 2 — PERP POSITIONING INTELLIGENCE (`server/ai/perpIntel.js`)
- 5 Binance fapi PUBLIC endpoints (no key): funding + open interest + OI 24h history (implies the price change) + top-trader L/S ratio + taker buy/sell flow.
- The **OI×price 2×2 matrix** (LONGS_BUILDING / SHORTS_BUILDING / SHORT_SQUEEZE / LONG_UNWIND), taker aggression, crowd flags (🚩 LONGS/SHORTS CROWDED), positioning score 0-100 + Hinglish reasons. 60s cache, single-flight, bounded map, per-field honest degrade (dead OI-history ≠ "flat OI").
- `GET /api/ai/perp-intel` desk view + per-signal `superIntel.perp` wire payload on FUTURES.

### Fixed en route — the DEEP DIVE had NO superintel at all
`getDeepSignal` never attached superIntel (no AI SCORE ring, no blueprint, no win-prob in the deep modal or the agent's analyze_coin answers — they read `s.superIntel?.aiScore` and got null). The deep path now builds the FULL ticket: computeSuperScore + buildSuperBlueprint + winProb + perp intel.

### Section upgrades (CoinDCX tab)
- **Signal Board**: every card's SuperIntelStrip gains the WIN-PROBABILITY row (P(win) + band · breakeven + edge pts · EV per trade · EDGE/FAIR/NO-EDGE verdict) + perp positioning chips on FUTURES (funding/OI/taker/crowd).
- **EXPERT PICKS**: per-pick P(WIN)/BREAKEVEN/EV/VERDICT strip + perp positioning row; the AI score strip stays test-locked.
- **TOP 5**: 🎯 P(win) chip per row (verdict-colored).
- **Crypto Desk AI Agent**: 13 → **15 tools** (+ `get_perp_intel`, + `get_win_probability`), system prompt routing (positioning check BEFORE any futures entry; P(win)+EV mandatory on every full ticket), new Win-Probability quick prompt.
- **Manual Trade Tracker**: live **R NOW / PEAK** column (MFE/MAE excursion tracked server-side on every 5s sweep), per-trade capture %, closed rows show final R + peak + exit-quality verdict (CLEAN_WIN / CUT_WINNER / GAVE_BACK / DISCIPLINED_LOSS / OVERSHOOT_LOSS), and the aggregate stats strip (win-rate in R · avg R · capture efficiency · gave-back count · disciplined-vs-overshot losses · avg hold). `manualStats()` rides the list endpoint.
- **Execution Console**: **🔥 PORTFOLIO HEAT** — total open risk (SL-distance risks, live FX→INR) vs equity with COOL/WARM/HOT/DANGER bands, worst-case ₹ number, same-side pile-up warning, and the 🚨 NO-SL flag (unbounded risk positions).
- **GLOBAL FUTURES desk**: new **🛰️ PERP POSITIONING INTELLIGENCE** section (desk funding regime + breadth + per-symbol reads, 60s refresh, collapsible).

### Validation
- New locks: `test/winProb.test.ts` (22) + `test/perpIntel.test.ts` (22) + manualTrades v12.0 block (61 total) + cryptoAgent registry 15-tool update — **full suite 2177/2178** (the 1 = the documented pre-existing BSE live-network geo-block, unchanged).
- tsc CLEAN · build 5.22s · npm audit 0/0 · **LIVE smoke `scripts/smoke_v120.mjs` 28/28**: BTC intel (funding 0.59bps, OI 108904, L/S 1.01, taker 1.02, full-confidence read), desk view (avg funding −6.02bps → SHORTS PAYING regime), board 10/10 winProb (DOGE 69% → EDGE, EV +0.62R), picks 6/6 (AVAX 84 → 70% EDGE), deep BTC full superintel (79 ACTION, P(win) 68%, perp NEUTRAL).
- Fixed en route (found by the new tests): `num(null)` returned 0 — missing funding/positioning/agreement silently fired their adjustment branches in both engines (now null-safe, locked); exit-quality severity order (GAVE_BACK wins over CUT_WINNER at <30% capture).


## v11.8.2 — Deep recheck: the intermittent agent-suite flake (12→24 test failures), root-caused and killed (2026-09-18)

**User ask: "ek baar full site code recheck karo deep me aur koi issues hai tho fix kardo." Full-suite runs were flipping between clean (2115/2116) and 12-24 failures across agent.test.ts / v101AgentAccuracy / nearMissAutoTrade — 2 of 4 runs failed with a "timeout + expected 1 times, got 0 times" cascade. Root cause (empirically verified): the agent-family suites never mocked `readDepth` — the entry path's CoinDCX→Binance depth fetch is TWO SERIAL 6s timeouts (12s worst case) vs vitest's 5s per-test budget. When a sandbox route stalls, the tick blows the budget; the still-running zombie holds the agent's single-flight guard (`_ticking`) for up to 12s, so every subsequent agentTick in the file no-ops instantly — exactly the 0-call cascade observed. Same hazard class: `pairCorrelation` (2 real Yahoo fetches, 12s timeouts) on open-position fixtures and `fetchFuturesPrices` (8s timeout) inside getPositionsWithPnl.**

### The fixes
- **Production — depth chain shares ONE 6s budget (orderFlowDepth.js)**: the Binance fallback now gets the REMAINING time (`max(750ms floor, deadline - elapsed)`) instead of a fresh 6s. Worst-case stall halves: 12s → ~6.75s. A live agentTick entry decision (30s cadence) can no longer black out for 12s.
- **Tests — the agent-family suites now own their network boundary**: `orderFlowDepth.readDepth → null` (the depth layer keeps its own suites), `pairCorrelation → null` ("unknown → allow", the guard's documented contract) in agent.test.ts + nearMissAutoTrade, and `fetchFuturesPrices → []` added to the existing futures.js partial mocks in all three suites. Zero live network remains in the agent suites — deterministic regardless of sandbox route conditions.
- **No agent.js change needed**: the single-flight guard was already correct production design (never overlap cycles) — the flake was the UNMOCKED network stall, not the guard.

### Also verified during the recheck (no issues found)
- v11.8 applicable-quorum math, board tape fallback, India index option-chain ctx (single-flight + TTL + real-chain gate), Binance depth fallback labeling, na marks — all reviewed, byte-level display artifact on meshModels.js line 347 (`[massive.ok` renders as `assive.ok` through ANSI-eating display paths; od + node --check confirm the file is correct).
- tsc CLEAN · npm audit 0/0 · route audit PASS · build 4.96s · smoke 15/15 · **full suite ×2 back-to-back: 2115/2116 each** (the 1 = the documented BSE live-network geo-block, unchanged).

## v11.8.1 — Mesh agent free-key pass: live-verified key availability + the Massive domain bug (2026-09-18)

**User ask: "Mesh keys (6 agents unauthed): QUIVER / TRADINGCENTRAL / ALPHAVANTAGE / MASSIVE / COINAPI / COINGECKO — free API key milega kya?" Every endpoint was probed LIVE (2026-09-18) before answering, and one real bug surfaced: the `massive` agent was pointed at `api.massive.dev`, a domain that DOES NOT RESOLVE (DNS failure) — a free key would have connected to nothing. Massive is the rebrand of Polygon.io and its REST surface still lives at `api.polygon.io` (probed: 401 = alive, key-gated).**

### Free-key verdict (live-verified)
| Env var | Free? | Where | Limits vs our agent budget |
|---|---|---|---|
| ALPHAVANTAGE_API_KEY | ✅ FREE | alphavantage.co/support/#api-key | 25 req/day, 5/min (budget 20/day) |
| COINGECKO_API_KEY | ✅ FREE Demo | coingecko.com/en/api | 10k calls/mo, 30/min (keyless works NOW — key stops 429 breaker trips) |
| COINAPI_API_KEY | ✅ FREE | coinapi.io → "Get Free API Key" | 100 req/day (budget 60/day) |
| MASSIVE_API_KEY | ✅ FREE Basic | massive.com (formerly polygon.io) | 5 req/min, EOD/reference (budget 5/min) |
| QUIVER_API_KEY | ✅ free tier | api.quiverquant.com (account → API key) | limited free requests (budget 50/day; full history paid) |
| TRADINGCENTRAL_API_KEY | ❌ no self-serve | enterprise B2B only | leave unset — TechConsensus honestly absent by design |

### The fix
- **massive.js retargeted to the live API**: `BASE = MASSIVE_API_BASE || 'https://api.polygon.io'` (env-overridable — if Massive migrates domains again, no redeploy needed), auth switched to Polygon's documented `Authorization: Bearer` header. `fundamentals.profile` now reads `/v3/reference/tickers/{sym}` (`results.ticker/name/sic_description`); the free Basic tier serves no valuation ratios, so `marketCap/peRatio/dividendYield/beta` return honestly null — the FundaProPlus seat cross-reads AlphaVantage for the numbers, and if NO source yields usable fields the seat abstains with the reason (unchanged honesty gate). The `quant.greeks` cap was REMOVED: no consumer existed anywhere (mesh seats, agent tools, routes) and the real free tier has no BS-greeks REST endpoint — advertising a dead cap is its own small dishonesty.
- **.env.example**: the v11.8 checklist now carries the per-key free-tier table above (registration links + limits vs budgets) + the new `MASSIVE_API_BASE` documented var.

### Validation
- tsc CLEAN · agent/mesh test files green (mcpAgents ID-list lock unchanged — 'massive' stays registered) · live probes: api.polygon.io 401 (alive), api.quiverquant.com 401, rest.coinapi.io 401, api.coingecko.com keyless 200, api.tradingcentral.com 403 (no self-serve), api.massive.dev DNS-dead.

## v11.8 — FULL COMMITTEE: why only 3-4 of 14 models were responding, fixed (2026-09-18)

**User ask: "Intraday TAB & CoinDCX TAB — 14 models me sirf 3-4 ka response aa raha hai, isliye signal accuracy high nahi hai — deep advance pro level pe check karo, Render env bhi bolo, live check karo." Live-render diagnosis (login + /api/ai/signals + /api/ai/status + /api/mcp/mesh/status on smartai1.onrender.com, 2026-09-18): the committee was losing voters to FIVE separate causes, four of them code bugs and one an env gap. This release fixes the code side and documents the exact env checklist. Verified locally end-to-end: the INDIA board went from 3-4 voters / conf 7-28 / all-NEUTRAL to 8/11 voters · conf 78 · STRONG (ACE, tape-MTF voting with real 5m/15m/1h confluence); the CRYPTO board went from "6/17 models voting · 47% quorum · conf 34" to "6/10 applicable models voting · 66% quorum · conf 42-45" on the SAME votes.**

### The five root causes (live-verified)
1. **AI Council (w=1.5, the heaviest single seat) was OFFLINE** — no LLM keys on Render (`aiCouncilOnline: false`). ENV fix: at least one of GEMINI_API_KEY / GROQ_API_KEY / CEREBRAS_API_KEY / OPENROUTER_API_KEY.
2. **The India board's tape seat (w=1.6, heaviest quant seat) never voted when the 5m base fetch failed** — the injection condition `(_mtfOn ? enr.tapeMTF : enr.tape)` skipped the ENTIRE seat even though a good 15m tape was in hand (the deep path already had the right fallback; the board didn't).
3. **OptionsFlow NEVER voted on the India board — not even on NIFTY/BANKNIFTY**, the exact underlyings it was designed for (PCR/max-pain/IV contrarian): ctx.options was only a deep-path hook (`opts.indexOptions`) that no board caller ever passed.
4. **InstFlow + VolumeFlow's L2 read were structurally dead on Render** — both read CoinDCX public REST depth, which is 403/timeout-blocked from Render datacenter IPs (live: booksCached stayed 0 all day). Crypto: "CoinDCX book not polled yet — InstFlow abstains" on every signal, every day.
5. **Structural abstains sat in the quorum denominator** — OptionsFlow/tape on crypto, FundaCheck on crypto+intraday, the 3 equity mesh seats on crypto, the on-chain seat on equity: seats that CANNOT serve a market shaved ~15% off every confidence via the participation factor ("6/17 voting" on a desk where 6 of 11 applicable seats HAD voted).

### The fixes
- **Applicable-committee quorum (ensemble.js)**: votes may carry `na: true` (structural abstain — the seat cannot serve this market). The participation denominator counts only applicable weight; data-missing abstains STILL count (honest). `totalModels` = applicable seats, `structuralAbsent` exposed, summary reads "6/10 models voting". buildSignal passes `na` on the wire (votes + abstentions) so the UI can gray them. Old math is byte-identical when no vote carries `na` (locked by tests).
- **Board tape-MTF 15m fallback (signals.js)**: the injection condition is now `(enr.tapeMTF || enr.tape)` — when the MTF flag is ON but the 5m base is dead, the seat fn degrades internally to the plain 15m read (exactly like the deep path). The heaviest quant seat no longer disappears with the 5m fetch.
- **India index option-chain ctx (signals.js)**: the board refreshes a 5-min-TTL OptionsFlow ctx for NIFTY + BANKNIFTY (REAL nse/bse chains only — a `REAL_CHAIN_RE` gate rejects the bs-model synthetic chain, because model data must never vote). Fire-and-forget (depth-warm pattern); `opts.indexOptions` callers keep precedence; deep dives on indices get the same cached ctx.
- **Binance USDT depth fallback (swing.js getOrderbook + orderFlowDepth.js)**: when the CoinDCX public REST book is unreachable (the Render reality), the same-USDT-pair Binance public depth serves as an honestly-labeled proxy (`source: 'binance-usdt-proxy'`); the L2 ladder is linearly rescaled onto the caller's INR anchor before any wall-distance/slippage math. InstFlow's ring polls now record which book served (the vote's reasons say "Binance USDT book proxy — CoinDCX REST unreachable" when applicable). Local verification: `booksTracked` went 0 → 12 (3 polls each) and XRP read a sustained 63% bid-side book.
- **India board mesh T3 warm**: the equity seats (TechConsensus / FundaProPlus) now shadow-vote on the India board too (top-12 slice, same budget-aware cadence gaps) — their abstains were previously "not warmed for X yet" forever on India.
- **InstFlow warm slice 8 → 10** (matches the 10-signal board; warmInstFlow's own rate guards unchanged).
- **Deep-path India index LTF fix**: index contexts carry DAILY candles — the deep dive used to treat them as the "15m" LTF (wrong timeframe for the tape/SMC/edge replay). Index deep dives now always fetch the real 15m series.

### The Render env checklist (see .env.example "v11.8 FULL-COMMITTEE CHECKLIST")
- AI Council: GEMINI_API_KEY (recommended free) or GROQ / CEREBRAS / OPENROUTER — the heaviest missing voter.
- Mesh keys (6 agents unauthed on live): QUIVER_API_KEY · TRADINGCENTRAL_API_KEY · ALPHAVANTAGE_API_KEY · MASSIVE_API_KEY · COINAPI_API_KEY · COINGECKO_API_KEY (demo key stops the keyless 429 breaker trips). FINNHUB_API_KEY already set.
- Flags already ON on Render: AI_ENABLE_V2_MODELS · AI_ENABLE_MESH_MODELS · AI_ENABLE_MTF_CONFLUENCE · AI_ENABLE_GLOBAL_COUNCIL. Leave AI_ENABLE_REGIME_WEIGHTS OFF until the A/B backtest.
- Mesh seats remain SHADOW (weight 0) until 10+ settled outcomes prove an edge — honest by design, not missing config.

### Validation
- tsc CLEAN · **2115/2116 tests** (the 1 failure = the documented pre-existing live-network BSE test, identical on pristine baseline; the v67-gauntlet/agent full-suite flakes seen mid-run were caused by the LOCAL dev server sharing state — clean tree runs are green) · 20 NEW locks in test/v118FullCommittee.test.ts (applicable-quorum math + no-regression, tape 15m fallback via the real registry with the flag ON, real-chain gate regex, Binance proxy labeling + INR rescale end-to-end, mesh na marks, and the exact live ENA card re-scored: 6/10 · 66% quorum) · npm audit 0/0 · full local boot with all flags: INDIA board 8/11 voters conf 78 STRONG with tape-MTF voting; CRYPTO board na marks on the wire; InstFlow books tracked; deep NIFTY honest neutral-coil abstain.

## v11.7 — FULL-SITE RECHECK: dead-code purge + the two missing PERF layers (2026-09-17)

**User ask: "full site code recheck + issues fix + unwanted files permanently remove + cleanup + site fast accurate." Result: 44 tracked files deleted (23 dead source files, 7 obsolete smoke/demo scripts, 13 stale/duplicate docs, 1 Windows leftover), a v11.6 VISIBILITY BUG fixed (the MCP mesh ops panel was wired only into a tab unreachable since v6.9 — users could never see it), and the two biggest transfer-performance gaps closed: the site served ~1.9MB of content-hashed assets with Cache-Control max-age=0 (re-downloaded on EVERY visit) and NO gzip at all. Now: assets are immutable-cached for a year + gzipped (vendor-react 192KB → 60KB, −69%), API JSON compressed (−59% on /api/ai/status), index.html/SPA shell no-store so deploys land instantly, SSE streams guaranteed uncompressed. Validation: tsc CLEAN · 2095/2096 tests (the 1 failure is the documented pre-existing live-network BSE test) · vite build 5.2s · npm audit 0/0 · live boot curl-verified every header.**

### PERF #1 — transfer compression (server/index.js, NEW dep `compression@1.8.2`)
- `app.use(compression({filter}))` before all routes: gzip every compressible response ≥1KB. Custom filter is belt-and-braces on top of the package defaults: NEVER touch `text/event-stream` (zlib buffering would delay live ticks) and never touch `Cache-Control: no-transform` responses. Live-verified: assets 192260 → 60219 bytes (−69%); `/api/ai/status` 4488 → 1852 bytes (−59%) with correct `Vary: Accept-Encoding` + `Content-Encoding: gzip`; both SSE endpoints confirmed uncompressed with `no-store, no-transform` intact.
- `app.disable('x-powered-by')` — Express fingerprint removed.

### PERF #2 — real browser caching for the content-hashed build (server/index.js)
- express.static default was `public, max-age=0`: a Vite-hashed build (`index-C2rax6Rt.js`…) re-downloaded ALL ~1.9MB on every visit. Now `/assets/*` → `Cache-Control: public, max-age=31536000, immutable` (filenames are content-hashed — a deploy changes every hash); `index.html` → `no-store`; `sw.js`/`widget.html`/`manifest.json` → `no-cache` (spec-safe SW updates depend on revalidating the SW file itself). The SPA fallback (`/portfolio` etc.) now sends `no-store` — previously sendFile's implicit heuristic caching could serve a STALE shell after a deploy (the classic "site looks unchanged / chunk 404" bug).

### BUG — the v11.6 mesh ops panel was invisible (MeshStatusPanel)
- v11.6 wired `MeshStatusPanel.tsx` (per-agent breaker state + token-bucket burn + seat warm-gaps — the Phase-3 ops view) ONLY into `tabs/AITradingTab.tsx`, which has been unreachable from App.tsx since the v6.9 desk split (App renders dashboard/india/crypto/portfolio/planner/macro + NeuralChat only). The panel now renders on BOTH live desks (IndiaIntradayTab + CoinDcxTab, §04 next to ModelPerformancePanel, still collapsible/off-by-default). Deleting the dead tab made this visible; the fix makes the whole v11.6 measurement layer actually reachable by users.

### CLEANUP — 44 tracked files permanently removed
- Dead source (zero importers, verified by full import-graph BFS from src/main.tsx + repo-wide name search): `PWAInstallPrompt`, `ScreenerPanel`, `Skeletons`, `TapetidePanel`, `tabs/IntradayTab` (dead since the v6.9 split), `tabs/ResearchLabTab`, `tabs/AITradingTab`, `intraday/{IntradayChartModal, MarketIntelPanel, SignalTable, TrendingMovers, sectorMap, SignalCard}`, `hooks/{useServerSentEvents, useTheme, useWebSocket}`, `utils/{deduplication, memoryEngine, retry, riskAnalyzer, smartDataLayer, screener, researchLabApi}`.
- test/indiaLiveSource.test.tsx: §5 (rendered the DEAD intraday SignalCard) removed — the pill-gating contract is locked in liveSourceBadge.test.tsx against the LIVE aitrading/SignalCard; stream-tagging sections untouched.
- Obsolete tooling: `demo-reliance-intraday.mjs`, `demo-sol-deep-dive.mjs`, `smoke_v1013.sh/v1015.sh/v1016.mjs/v1017.mjs/v1100.mjs` (v11.3's smoke_v113.mjs is the current one; v1100 read the now-deleted AITradingTab from disk).
- Stale/duplicate docs: exact duplicates (`docs/ADD_API_KEYS.md`, `docs/SETUP.txt`, `docs/start_server.vbs` — byte-identical to root copies) + unreferenced one-off historical reports (`UPGRADE_REPORT_v9/v801`, `AUDIT_FIXES_2026`, `FIX_SUMMARY`, `QUICK_IMPROVEMENTS`, `ADVANCED_IMPROVEMENTS`, `IMPLEMENTATION_PROGRESS`, `NEUMORPHISM`, `DEEP_SECURITY_AUDIT`, `PREMIUM_FEATURES`). README-referenced docs (UPGRADE_REPORT_v18, UPGRADE_REPORT, AUDIT_FIX_REPORT_v1801) + CHANGES.md kept. Windows leftover `start_server.vbs` removed (Render deploys via render.yaml); its stale comment reference in server/index.js updated. check-api-routes.mjs orphan comments refreshed.
- Local residue wiped: `.test-data-*` dirs. `Dockerfile.frontend`/`docker-compose.yml`/`nginx.conf` KEPT (documented alternate self-host path, referenced from docs).

### Verified NOT broken by the recheck
- Memory hygiene: hot-path Maps already capped (`_capMissMap` 200, `_fundamentalsCache` LRU 200, wick guards function-local) — the 2026 perf-audit caps hold; no new unbounded caches found at module scope.
- Route integrity: `node scripts/check-api-routes.mjs` → RESULT: PASS after the deletions.
- Service worker v18.1 already correct (no-transform/SSE/sensitive-API guards) — immutable asset headers now layer cleanly on top of its stale-while-revalidate.

### Validation
- tsc CLEAN · 2095/2096 tests pass (1 documented pre-existing live-network BSE failure, fails on pristine baseline too) · vite build CLEAN 5.22s · npm audit 0/0 (root + telegram-bot, with the new compression dep) · full boot with PIN auth + live curl checks: `/assets/vendor-react` → 200, gzip, `immutable`; `/` and `/portfolio` → `text/html`, `no-store`; `/sw.js` → `no-cache`; both SSE streams → uncompressed `text/event-stream`; login → session cookie OK.

## v11.3 — THE PERMANENT CRYPTO-PRICE FIX: official CoinDCX WebSocket layer (2026-09-17)

**Production incident (smartai1.onrender.com, deploy logs): `[corr=…] 502 Failed to fetch crypto prices. The operation was aborted due to timeout` + `[backup] head council-nearmiss.json failed: timeout`. Root cause: the whole crypto price layer hung off ONE Cloudflare-fronted REST host per domain (api.coindcx.com tickers / public.coindcx.com futures RT) — from Render datacenter IPs those time out, and after a 30s stale window every consumer 502'd. This release makes the price layer MULTI-SOURCE with the user's exact ask — CoinDCX's OFFICIAL servers — as the backbone: both official WebSocket streams were reverse-engineered LIVE from the docs + probes (EIO=4 both; the futures socket had been pinned EIO=3 which the server now kills ~1s after the ns-ack — the "WS accelerator" never delivered a single tick in production), and the book channels (`currentPrices@futures@rt` ~500 attributable pair rows ~1/sec; `currentPrices@spot@1s` + `priceStats@spot@60s` full spot book) now carry the desks. LIVE-verified end-to-end from a network where every CoinDCX REST host is 403-challenged: spot tickers served via the official WS (977 rows), futures prices via the WS book (source 'ws-book'), FUT ticks sub-second with honest labels. +27 tests → 2024 total; smoke_v113.mjs 15/15 LIVE.**

### The official spot WebSocket (NEW server/ai/cxSpotWs.js)
- Connects `wss://stream-spot.coindcx.com/socket.io/?EIO=4&transport=websocket` (Socket.IO v4 / Engine.IO 4; server pings at 45s — client answers '3'; the client must NEVER send its own '2' ping: live-verified it kills the socket in ~200ms; app-level `42["ping",...]` every 25s is the documented keepalive — all handled by the shared cxSocketIo client).
- Joins `currentPrices@spot@1s` (whole-book updates, payload.data is a JSON-encoded STRING) + `priceStats@spot@60s` (24h change % + volume). INR pairs refresh in ~10s bursts, USDT ~1s; a `#snapshot` full book arrives on join.
- Demand-driven lifecycle (Render free-tier friendly): every `fetchCoinDcxTickers()` + SSE client connect arms a heartbeat; ~2 min without demand → socket closes; handshake fail-streak → 30-min breaker; backoff reconnects. `AI_CX_SPOT_WS=0` kills it (off under vitest by default — no suite ever opens a real socket).

### fetchCoinDcxTickers() — the 5-leg chain (cryptoStream.js)
- REST (api.coindcx.com, 8s timeout, 2s cache, in-flight dedup — unchanged primary) → 30s stale-serve → **official spot-WS book** (servable at ≥25 fresh markets; CoinDCX-ticker-shaped rows, `feed: 'coindcx-spot-ws'`) → **Binance spot 24h tickers × live USDINR fx** (api.binance.com → data-api.binance.vision mirror → Bybit v5; every row honestly marked `__synthetic: 'binance-fx'`; local fx cache mirrors futures.js logic with zero import cycles) → **3-min deep-stale serve** → honest throw. `lastTickerSource()` exposes which leg served; `/api/crypto-prices` rides it as the `X-Price-Source` response header + a degraded-mode server log line.
- The SSE poller re-anchors INR ticks from the WS book when the chain is dry (partial books included — a single fresh BTCINR row still lands `IN_BTC` with source 'coindcx-spot-ws' and refreshes the Binance projection ratio). Boot-time 502s (the incident's exact signature) are structurally gone: the first ticker demand arms the WS and the second poll already has an official source.

### The futures book channel (cxRtStream.js + NEW server/ai/cxBookState.js)
- **EIO=4 URL fix**: the old `?EIO=3` handshake completed but the server killed the socket ~1s after the ns-connect ack — live-verified with 270 events in 40s on EIO=4 vs an instant kill on EIO=3. The futures WS accelerator had therefore NEVER worked in production (the design degraded gracefully to REST 2s, which is why nothing looked broken).
- **Book channel replaces per-pair joins**: `currentPrices@futures@rt` pushes ~500 ATTRIBUTABLE pair rows ~1/sec (`ls` last · `pc` change · `v` volume · `mp` mark) — the old per-pair `@prices-futures` price-change events carry NO pair identity ({T, p, pr}), which is why attribution never worked. `ls` rows land ticks instantly (honest 'coindcx-fut-ws'); `mp`-only rows are a keep-alive (land only when the symbol's tick is >8s stale — never displacing a fresher last price); heartbeat rows prove channel health.
- NEW `cxBookState.js` — the shared book state (leaf module, zero imports) so futures.js can serve it as a fallback WITHOUT an import cycle with cxRtStream. Retention 10 min, snapshot freshness 5s.

### fetchFuturesPrices() — the 4-leg chain (futures.js)
- REST RT (public.coindcx.com — unchanged primary, seconds→ms ts guard preserved) → **official WS book** (source 'ws-book'; often FASTER than REST when healthy) → **Binance fapi / Bybit linear 24h tickers** (same USDT-perp domain, sources 'binance-fut'/'bybit-fut'; 30s negative cache so a dead CoinDCX never turns into a 2s fapi hammer) → 3-min deep-stale serve → honest throw. Bonus discovered live: the futures book also carries commodity perps (NATGAS/CL/XAU/XAG/COPPER/BZ + index perps) — free for a future desk.
- Honesty fix en route (test-caught): `_pollFutures` now labels the liveFeed tick by the row's ACTUAL source (`coindcx-fut-ws` / `binance-fut-rt` / `coindcx-fut-rt`) — the old blanket 'coindcx-fut-rt' would have mislabeled fallback data as direct CoinDCX REST. Manual futures closes during a CoinDCX outage now price from the same-domain fallback instead of stranding the position ("No live futures price" only when EVERYTHING is dead — verified by the v7.0.2 audit test, now hermetically stubbed).
- INR futures note (user ask): CoinDCX futures instruments are marginable in INR or USDT (`margin_currency_short_name` per the docs) but the PRICE feed is the same USDT-perp book — the desk's existing USDINR conversion already serves the INR view; no separate feed exists to add.

### Backup hardening (intraday/backup.js)
- The boot-time `[backup] head council-nearmiss.json failed: timeout` — api.github.com's first TLS handshake from a cold Render container can exceed the old 10s budget: FETCH_TIMEOUT_MS → 15s + the sha HEAD now retries once (400ms gap) before giving up. Still best-effort, still never throws into a trading route.

### Validation
- tsc CLEAN · 115 files / **2024 tests ALL PASS** (1997 + 27 new: cxSpotWs 7, cryptoTickerChain 7, futuresResilience 9, cxRtStream book-channel 4) ×2 consecutive full runs (run 1 carried the known pre-existing mandateFreeze full-suite flake — passes in isolation at this commit AND at the pre-v11.3 baseline) · vite build CLEAN 5.13s · npm audit 0/0 both trees · `node --check` all 9 touched server files · **scripts/smoke_v113.mjs 15/15 LIVE** against the REAL sockets from a REST-blocked network: spot book 335 INR markets, ticker chain served via 'coindcx-spot-ws' (977 rows, BTCINR live), FUT_BTC sub-second 'coindcx-fut-ws', book 502 pairs, fetchFuturesPrices via 'ws-book', WS health → REST 10s floor.

## v11.1 — INDIA DESK DEEP GAPS + SENSEX HONESTY (2026-09-17)

**The user's two plans ("Options Desk NSE+SENSEX Addendum" + "Entire India Intraday Tab deep analysis") implemented in the plan's own build order: circuit-limit guard → real transaction costs → sector-map universe sync, plus the SENSEX/BSE research spike with its honest-fallback labeling. Live research findings baked in: Groww's quote already carries the day's price band (highPriceRange/lowPriceRange — same fetch, two fields), TV's India scanner serves a native `sector` column, and BSE is 403-Akamai-blocked from datacenter IPs (both www + api subdomains, sandbox-verified — even from hosts that CAN reach NSE). +53 tests → 1994 total, full suite green.**

### GAP 2 — CIRCUIT-LIMIT GUARD (India's most desk-specific risk, now real)
- NEW `server/ai/circuitGuard.js` — pure guard math: `circuitProximityOf` (band distances, near/at flags, garbage-disarm), `entryCircuitRisk` (same-direction entry near the adverse band → heavy penalty + the exact `⚠ Near upper/lower circuit — entry risk` reason flag + target clamps), `adverseCircuitRisk` (LONG→lower / SHORT→upper adverse classification with frozen-at-band detection). Threshold `AI_CIRCUIT_PROXIMITY_PCT` (default 1.5%), penalty `AI_CIRCUIT_PENALTY` (default 18).
- `growwQuote.js` — the day's price band rides the EXISTING live-quote fetch (`highPriceRange`/`lowPriceRange` → `upperCircuit`/`lowerCircuit`, validated; absent → omitted, guard inert). Zero extra upstream calls.
- `intraday/engine.js` — same-direction entry near the band: −18 confidence + the distinct reason flag + **targets clamped to the band BEFORE R:R math** (a LONG target printed above the upper circuit can literally never fill — price cannot exceed the band). Opposite-direction fades NOT penalized (fading a band is legitimate AND the side that fills at a freeze). Signal now carries `circuitRisk` + `nearCircuit`.
- OPEN POSITIONS (the plan's urgent-distinct-alert requirement): NEW `paperCircuitWatch` in paperTrading.js rides the stream watcher's existing tick (zero extra quotes; 10-min per-symbol cooldown) emitting `CIRCUIT_RISK` events; the India agent's exit-management sweep (indiaAgent.js) checks its own live positions via the shared Groww micro-cache and sends the urgent telegram — both framed as **exit-liquidity danger, NOT an SL-approach warning** ("usual SL playbook yahan kaam nahi karta"). alerts.js + IntradayTab toast render the new 🚨 CIRCUIT_RISK outcome type; NSE equities only (crypto 24/7 has no circuits; option premiums aren't band-bound).

### GAP 3 — REAL TRANSACTION COSTS (gross → net P&L everywhere)
- NEW `server/ai/tradingCosts.js` — the full India cost model with instrument branches: **equity-intraday** (STT 0.025% sell · NSE txn 0.00297% both · SEBI 0.0001% both · stamp 0.003% buy), **equity-futures** (STT 0.02% sell · txn 0.00173% · stamp 0.002%), **options** (STT 0.1% sell premium · txn 0.03503% premium · stamp 0.003% buy premium), **crypto** (approx taker fee %/side, no STT/GST); GST 18% on (brokerage + txn + SEBI) in all India cases. Brokerage flat ₹/executed-order (default ₹20 — a T1+T2 two-part close = 3 orders) or percent-of-turnover. Every rate env-overridable (`AI_TC_*`) so the user pins THEIR broker.
- `paperTrading.js` — every part-close re-annotates `grossPnl` + `costs` + `netPnl` + a full `costsBreakdown` (deterministic derivation — legacy AND restored trades get it too, no migration); PAPER_CLOSE events carry `pnlNet`; summary/history/`_publicTrade` serve net as the headline with gross in tooltips ("costs ate ₹X · Y% of gross profit").
- `journal.js` — entries persist the cost pair; `_dayStats` aggregates costs/netPnlAfterCosts/grossWin/tradesWithCosts (legacy entries honestly stay gross). `weeklyReview.js` — the plan's explicit gross-vs-net line renders in the LLM prompt block AND the always-visible quant header.
- Frontend: PaperTradePanel + JournalPanel show **net as the displayed number** (gross + full breakdown in tooltips), stats chips for day/total costs, the "P&L numbers NET hain" footnote; IntradayTab outcome toast prefers pnlNet.
- Test-caught bug en route: `costsForPaperTrade` double-applied the lot multiplier in the avg-exit derivation (option STT inflated ×75) — locked against recurrence.

### GAP 1 — SECTOR MAP × FULL UNIVERSE (the 5x blind spot closed)
- `indiaUniverse.js` — discovery query now appends TV's own `sector` column (d[8]; locked indices 0-7 untouched; live-verified on the India scanner: "Technology Services", "Process Industries", "Finance"…).
- `sectors.js` — the sector lens now sees the WHOLE tape the scanner sees: universe = base 45 ∪ discovered ~220 via the chunked TV batch; symbol→sector = curated `SECTOR_MAP` (original 45) → NEW `EXTENDED_SECTOR_CLASSIFICATION` (~120 seed/F&O names across the 10 original + 6 new buckets: HEALTHCARE/CHEMICALS/DEFENCE/REALTY/TELECOM/TRANSPORT) → TV taxonomy mapped via `TV_SECTOR_TO_DESK` → honest OTHERS. Static always wins over TV. Breadth/momentum/leader/laggard/context-chain/F-Score math UNCHANGED — only membership scaled. `AI_INDIA_FULL_UNIVERSE=off` = the legacy static 45-name path, byte-identical payload (sectorMode 'base-45'; full modes honestly labelled 'full-dynamic'/'full-seed-fallback').

### NSE + SENSEX ADDENDUM — source honesty for the two "model chain" cases
- Research spike (live from this host): **BSE is structurally unreachable from datacenter IPs** — bseindia.com AND api.bseindia.com both 403 Akamai (this sandbox reaches NSE fine, so Render has no path either). Not an outage — a permanent limitation.
- NEW `fetchBSEOptionChain()` in data.js (the NSE pattern: cookie bootstrap + tolerant parsing of both candidate endpoints + normalized expiry dates) with a 10-min negative cache keeping the dead probe nearly free — SENSEX gets FULL parity the day it becomes reachable (different host / CDN posture change), and `getOptionsDesk('SENSEX')` stops hammering NSE's equities endpoint for an index NSE doesn't list.
- Honest fallback labeling (the plan's exact design): SENSEX model mode = **`bs-model-sensex-always`** + the persistent non-dismissible banner ("SENSEX premiums are model-estimated — BSE does not expose a public real-time option feed usable from this server. For live SENSEX option prices, cross-check your broker.") on the desk AND every SENSEX option card; NIFTY-family model mode = **`bs-model-nifty-fallback`** + "temporarily unreachable … next successful fetch restores live data" (recoverable). The two cases can never be visually confused again.
- Structural confidence discount: SENSEX model cards lose `AI_SENSEX_MODEL_DISCOUNT` (default 8) AI-score points BEYOND the model-uncertainty handling — no live-market cross-check is ever possible for that underlying; `aiScoreRaw` + `structuralDiscount` exposed, machineNote/note say why. A live BSE chain (if ever reachable) restores full parity with zero discount.
- optionsScan: 'bse' counts as a LIVE chain (score bonus, synthetic=false, live/model classification); income ranker + scanner notes updated. Frontend: three-way source chips (LIVE NSE / LIVE BSE / model — rose for the SENSEX permanent case) across desk, cards, scanner rows, income rows; types widened (`OptionSource`).

### Validation
- tsc clean · **111 files / 1994 tests** (1941 + 53 new: bseOptionChain 10 · circuitLimitGuard 19 · tradingCosts 16 · sectors 8) · full-suite green (the flaky agent.test.ts cross-file interference at the v11.0.1 baseline — 11-30 failures depending on order — does NOT reproduce with v11.1; verified at baseline vs current) · `node --check` all 15 touched server files · env keys documented in .env.example + render.yaml (`AI_CIRCUIT_*`, `AI_TC_*`, `AI_SENSEX_MODEL_DISCOUNT`).

---

## v11.0.1 — FULL-SITE DEEP RECHECK: 14 fixes over the v11.0 baseline (2026-09-17)

**The v11.0 recheck pass (user: "full site code ek baar recheck karo") — line-audit of every v11.0 engine + wiring + both Explore-agent sweeps. 4 production-grade defects (2 silent-failure class, 1 dead-feature class, 1 coverage class) + hardening + honesty fixes. All test-locked: +14 tests → 1941 total, 5 consecutive greens.**

### COUNCIL (the 4 real defects)
- `council.js` **WEAK-SIDE BAR WAS DEAD CODE** — `gateContextFor` keyed the direction split by seat ROLE and then read `split.LONG`/`split.SHORT` (always undefined → n:0), so the precision gate's +5 weak-side raise could NEVER fire no matter how badly one direction underperformed. Now aggregates LONG/SHORT across all calibrated seats (n-weighted winRates) exactly as consensus.js's gate expects — the "SHORT side systematically galat" guard finally works. Locked end-to-end: a seeded 100%/0% split suppresses a conf-80 SHORT that the base bar would pass.
- `council.js` **ON-CHAIN SEAT BLIND FOR 4/5 BOARD SYMBOLS** — `councilMeshBundle` fetched `crypto.funding` ONCE for the whole symbol set while the ccxt funding cap serves exactly one symbol per call: only symbols[0] ever got a funding rate, the rest honest-null → the on-chain persona + its deterministic fallback both voted blind on most of the board (the same blind-seat class the validation pass fixed in buildFeatureMatrix). Now: one price query (coingecko serves all symbols per call) + one funding query PER SYMBOL, all riding the mesh's own single-flight + warm 5-min cache — steady-state cost ~1 upstream call/symbol/5min.
- `council.js` **NOMINAL-CAPITAL HEAT READ** — `riskContextFor` hardcoded ₹10k/₹10k into `globalRiskView` while both desks' own gauntlets use real capital (agent.js passes live wallet equity, indiaAgent its configured equityINR). The risk guardian's heatPct context (and its heat_cap veto read) was computed against paper numbers whenever actual capital differed. Now reads the persisted wallet snapshot (`ai-agent-state.json lastWallet.equityINR`) + the India config (cycle-safe dynamic import), falling back to ₹10k exactly like the gauntlets.
- `council.js` + `routes.js` **DEEP ENDPOINT: HANG + DOUBLE-SPEND + EMPTY-MATRIX VERDICTS** — `/api/ai/council/verdict/:symbol` chained a fresh ensemble run + 6 personas + debate + judge with NO route deadline (a slow provider chain could hang the HTTP handler for minutes) and NO single-flight (a double-click / remount+poll overlap fired TWO full ~9-call deep runs inside the 90s cache window). Also: with the ensemble run failed, `runCouncilDeep` still produced an all-NEUTRAL verdict over an EMPTY feature matrix — noise wearing a council badge. Now: 25s route deadline → honest 503 "still computing, caches for 90s"; per-market:symbol single-flight (concurrent callers JOIN the in-flight run); `sig:null` → honest null → the route's 502.

### MESH + AGENTS (hardening — the audit's query-injection sweep)
- `mesh.js` **INPUT SANITIZATION AT THE ENGINE BOUNDARY** — symbols/keys/pairs are charset-filtered (A-Z0-9.-, ≤20 chars, upper-cased), `limit` clamped 1..500 (negative/huge passed through raw before), `timeframe` whitelisted {5m,15m,1h,4h,1d}. No agent downstream can now receive a raw query-string payload from ANY caller (public route included).
- Agent adapters (defense-in-depth, 5 files): `alphavantage` `crypto.rate` from_currency URL-encoded; `quiver` congress/insider ticker encoded; `tradingcentral` news symbols encoded; `massive` company PATH segment encoded (BRK/A-style traversal) + `quant.greeks` kind whitelisted to call|put + NaN delta guard; `coinapi` NaN price/qty guards; **`alpaca` market-wide news mode was DEAD** — the empty-symbols URL built `.../news&limit=10` (the `&` without `?` put limit in the PATH → always 404); also symbols encoded now.
- `finnhubAgent.js` + `alpaca.js` **SEQUENTIAL QUOTE LOOPS vs THE 8s MESH DEADLINE** — 5 sequential 5s fetches guaranteed partial-discard + a breaker fail under the single 8s deadline; both now fan out with `Promise.allSettled` (bounded ≤5).
- `server/index.js` — route-registration warn prefix typo fixed (`cp/mesh]` → `[mcp/mesh]`).

### UI honesty
- `councilStampOf` now carries `gateBar` (the gate's ACTUAL confidence bar — env-tuned + auto-tighten aware) and `CouncilVerdictPanel`'s consensus-bar marker rides it instead of the hardcoded 78 (which lied whenever `AI_PRECISION_GATE_CONF` or the +10 auto-tighten moved the bar); `types.ts` extended.

### Validation
- tsc clean · 107 files / **1941 tests** (1927 + 14 new locks: funding per-symbol coverage ×2, weak-side raise ×2, honest capitals ×2, null-sig 502, deep single-flight, gateBar, mesh sanitization ×5) · vite build 5.4s · npm audit 0/0 both trees · `node --check` all 13 touched files · smoke_v1100.mjs 47/47 (SMARTAI_DATA_DIR-isolated, LIVE Binance probe included).
- Known-and-accepted (unchanged): null payloads still count as breaker failures (load-bearing — fetchJSON collapses all network errors to null, so null is the only failure signal the mesh sees); a half-open probe that is routed-but-not-called keeps its half-open flag (standard semantics).

---

## v11.0 — SUPERINTELLIGENCE: GLOBAL MARKET COUNCIL + MCP AGENT MESH (2026-09-17)

**The superintelligence upgrade: 10 MCP data agents + 6 specialist LLM seats + a calibrated precision gate, wired as an ANALYSIS layer over both desks (execution gauntlets untouched). Everything flag-gated default OFF (`AI_ENABLE_GLOBAL_COUNCIL`) for clean A/B against v10.18. 95% is engineered as a PRECISION TARGET (publish fewer, highest-confluence tickets) — never a claimed win-rate; realized numbers stay measurable via the tamper-evident ledger.**

### PHASE 1 — MCP Data Agent Mesh (10 agents, one contract)
- NEW `server/mcp/agents/registry.js` — agent cards + capability index (`whichAgentsNeed('crypto.ohlcv')`), per-agent 3-fail circuit breakers with 10-min→80-min exponential-backoff half-open probes (the cryptoStream/binanceFutWs pattern), token-bucket rate budgets (daily + per-minute), env-key auth resolution (missing key = agent honestly ABSENT). Zero network at import.
- NEW 10 agent adapters, one standardized card each ("protocol flexible, interface strict"): `alphavantage.js` (world stocks/forex/crypto + fundamentals, 20/day budget), `coingecko.js` (crypto prices/trending/market/onchain, keyless-friendly 10/min), `ccxt.js` (unified Binance+Bybit+OKX public OHLCV/orderbook/funding with geo-failover — deliberate deviation from npm-ccxt: same unified surface, ~0MB instead of ~50MB, recorded here), `tradingview.js` (wrap of the repo's own TV India/crypto scanner batches — zero duplicate upstream), `tradingcentral.js` (news sentiment, absent without key), `quiver.js` (US alt-data: Congress/insider), `massive.js` (fundamentals + independent BS-Greeks), `coinapi.js` (tick fallback), `finnhubAgent.js` (wrap of the shared finnhubQuote module — one key one budget), `alpaca.js` (US IEX quotes + market news).
- NEW `server/mcp/mesh.js` — the orchestrator: capability-routed fan-out (p-limit 6), per-agent 8s deadline race (`AI_MCP_MESH_TIMEOUT_MS`), 3-tier cache (hot 30s / warm 5min / cold 60min, LRU 200), single-flight dedup, 90s negative cache, stale-while-revalidate serve-tagged, cross-source price sanity bands (>1.5% divergence → degraded flag). Routes: `GET /api/mcp/agents`, `GET /api/mcp/mesh/status`, `POST /api/mcp/mesh/query`.

### PHASE 2 — Council + Consensus + Precision Gate
- NEW `server/ai/council.js` — the 6 specialist seats (Technical · Macro · Sentiment · Options-Flow · On-Chain · Risk Guardian with VETO) with anti-hallucination prompts ("sirf diye gaye data se bolo"), market-aware seat availability (onchain abstains on India; optionsflow abstains where no chain data), BOARD mode (6 BATCHED persona calls over the top-5 — one prompt per seat, NOT 6×N), DEEP mode (6 + bull/bear debate + judge synthesis with a bounded ±8 confidence shift — the plan's ~9-call cost math), 90s per-symbol verdict cache (LRU 200), and a DETERMINISTIC quant-only fallback tagged `model:'deterministic'` when the LLM chain is down (superIntelFallback pattern — never fakes a provider name).
- NEW `server/ai/consensus.js` — pure synchronous consensus (<5ms): weighted score `Σ(wᵢ×confᵢ×dirᵢ)/Σ(wᵢ over direction-voting seats)` (NEUTRAL = abstain — otherwise the structurally-NEUTRAL Risk Guardian would cap the ceiling at ~80 forever), count-based agreement over all present seats, quorum, then the PRECISION GATE: conf ≥78 (`AI_PRECISION_GATE_CONF`) · agreement ≥0.70 · quorum ≥5/6 · regime-aligned · eventGuard not blackout · globalRisk not off · risk veto null · weak-side bar +5 (direction-split honesty). Suppressed verdicts → NEAR-MISS JOURNAL (durable, cap 200) — the weekly review's learning input. AUTO-TIGHTEN: 3-week <75% published-precision streak → conf bar +5 (cumulative cap +10, durable override, ≥85% auto-resets, `AI_PRECISION_GATE_AUTO_TIGHTEN=off` disables).
- NEW `server/ai/llmChain.js` — the shared Gemini→Groq→Cerebras→OpenRouter JSON chain extracted from signals.js (same ask semantics, no circular import).
- `server/ai/signals.js` — surgical council hook after `computeTopFive` (flag-gated): top-5 candidates → `runCouncilBoard` under a 12s soft deadline (unresolved verdicts keep warming in the council cache and stamp the NEXT cycle — warmDepthBatch pattern); stamps `sig.council` + `payload.council`; the deep path gets the full debate verdict. **The council NEVER touches grades/plans/execution — it ATTACHES.**
- `server/ai/routes.js` — NEW routes: `GET /api/ai/council/status|near-miss|calibration|verdict/:symbol`.

### PHASE 3 — UI (both desks, transparency-first)
- NEW `src/components/aitrading/CouncilVerdictPanel.tsx` — the 6-seat grid with per-agent direction+confidence bars, consensus bar with the 78 gate-marker, PASSED/SUPPRESSED chip + reasons, bull/bear/judge debate trail, freshness badges (LIVE/CACHED/MODEL), price-divergence flag, and the 10-agent mesh health strip (● healthy · ◐ half-open · ○ breaker · · no-key). OFF state explains the flag + cost honestly. Mounted on BOTH desks (AITradingTab 01c + IndiaIntradayTab 01a).
- NEW `src/components/aitrading/NearMissPanel.tsx` — the gate's transparency surface: suppressed verdicts with reasons, seat breakdowns, age, stats. Collapsible, 60s hidden-gated poll.
- `SignalCard.tsx` — NEW CouncilStrip: 6 mini vote bars + gate chip on every stamped card; expanded cards get per-seat reasons + veto + the debate trail.
- `OptionsDeskPanel.tsx` — scanner rows get the 🏛 cross-check chip (ALIGN green / CONTRADICTS red / no-data grey) — on-demand only (deep verdict ≈9 LLM calls), 90s client cache.
- `ModelPerformancePanel.tsx` — NEW COUNCIL AGENTS block: per-seat hit-rate bars + calibrated weight multipliers (×Bayesian) + published precision/90d/Brier line.
- `useAITrading.ts` — NEW fetchers: `fetchCouncilStatus` / `fetchCouncilNearMiss` / `fetchCouncilVerdict` / `fetchCouncilCalibration` (60s client caches, hidden-tab gated); types in `types.ts` (CouncilStamp, CouncilBoardMeta, CouncilStatusView, NearMissEntry, CouncilCalibrationView).

### PHASE 4 — Accuracy validation loop + per-agent accountability
- `server/ai/ledger.js` — `recordExecution` now stamps the council verdict onto the tamper-evident chain entry (`e.council.agents` per-seat dir/conf — the attribution input).
- `server/ai/trust.js` — NEW `councilAgentStats()` (per-seat win/loss attribution + LONG/SHORT direction split), `councilCalibrationMultipliers()` (Bayesian Beta posterior, clamp 0.7-1.3, n<8 refuses to tune — the adaptive.js rule one seat over), `councilCalibration()` (published precision + 90d rolling + per-council Brier + the insufficient-data honesty).
- `server/ai/weeklyReview.js` — NEW council section: per-seat week stats, precision-by-week ladder, near-miss counts + reasons + the APPROXIMATE outcome scan (suppressed verdicts >24h vs current price — honestly labeled "price-at-review-time, not a backtest", capped 15 symbols), the auto-tighten state, and the calibrated-weights report; Council Read added to the LLM narration + Telegram header. Weekly review now also computes when ONLY council-stamped trades exist.

### PHASE 5 — Perf + env + docs
- Perf guardrails built-in at every layer (the plan's budget table): mesh p-limit 6 + 8s deadlines + 3-tier LRU-200 cache + negative cache; council 6 batched calls/90s + 12s soft deadline; consensus pure sync <5ms; frontend 60s hidden-gated polls + memo'd panels; verdict/price caches all LRU-capped; every new map bounded (registry health/buckets, verdicts, near-miss 200).
- `.env.example` + `render.yaml` — all v11.0 keys documented (6 agent API keys + master switch + 6 tuning flags; sab default OFF/optional).

### Honest limitations (unchanged doctrine)
- 95%+ is a TARGET, not a guarantee — realized published precision is measured on settled outcomes (90-day rolling window; 30-day n≈120 is noise) and visible in Track Record + weekly review. Publish kam, quality zyada.
- The council is an ANALYSIS layer only. Execution authority stays 100% with the v10.18 gauntlets (kill switch, allowAuto, LIVE arming, daily caps, one-per-pair, fresh-signal re-verify, eventGuard, globalRisk, Kelly caps). Autonomy does not increase by one inch.
- New agents/weights earn trust on settled outcomes only (Bayesian, n≥8); paper probation + demotion ride the same ledger.

### Validation pass — 6 real defects caught by the test chain, all fixed + test-locked
- **mesh `resolveCapability` crashed on every cache MISS** (`mesh.js`): `cacheGet` returns `null` on a miss but the caller dereferenced `hit.fresh` — the mesh could never serve its first query. Null-guarded; the stale-while-revalidate inflight entry is now the WRAPPED result shape (joined callers previously would have read a raw payload as a "gap"); the cache tier is derived from the serving agent's own card instead of hardcoded warm.
- **The on-chain seat was blind in production** (`council.js`): `councilMeshBundle` builds a FLAT `{ fundingRate, price }` bundle, but `buildFeatureMatrix` read `mesh.onchain.fundingRate` — funding data NEVER reached the personas' prompts or the deterministic fallback. Fixed with flat-first, nested-forward-compat mapping (locked by the funding-crowding-flips-SHORT test).
- **Partial LLM failure collapsed the whole council to quant-only** (`council.js`): the board required a MAJORITY of personas to answer usable JSON before the LLM council could stand; now any one usable seat stands and the rest degrade per-seat (the deep-mode pattern).
- **The per-seat fallback condition was inverted** (`council.js`): `if (!a.json?.verdicts ...) continue` skipped exactly the seats it was supposed to fill — a failed seat left its slot EMPTY (undefined verdict on the wire). Now fills per-symbol with honest reason tags (`LLM seat failed` vs `seat skipped SYMBOL` — a batched persona covering BTC but skipping ETH fills ETH from quant).
- **weeklyReview's trust mock predated v11.0** (`test/weeklyReview.test.ts`): the vi.mock lacked the three new council exports — extended with honest neutral mocks.
- **The mesh test harness dropped array payloads** (`test/mesh.test.ts`): the fetch stub serialized `out.body ?? {ok:true}`, erasing bare-array klines responses (and the multi-cap case served klines to the depth endpoint) — arrays now serve as the body; the orderbook URL gets a depth-shaped response.
- Validation totals: tsc CLEAN · **107 files / 1927 tests ALL PASS** (1867 + 60 new v11.0) · vite build CLEAN 5.5s · npm audit 0/0 both trees · node --check all 21 touched server files · **smoke_v1100.mjs 47/47** (incl. LIVE Binance ohlcv probe through the real mesh + 90s verdict cache round-trip).

## v10.18 — DEEP RECHECK #3: ADVANCED PRO-LEVEL AUDIT + 22 FIXES (2026-09-17)

**Full-site code re-checked at the engine, wiring, frontend, and lifecycle levels (two parallel deep-audit passes + own line review of every v10.15-v10.17 surface). Suite grew 1865 → 1867 tests, all passing; tsc clean; build clean 5.0s; audit 0/0; boot smoke 20/20.** Findings were triaged into real production impact — every fix below is a defect that could hang a handler, lose an alert, corrupt state, leak memory, or jank the UI; style nitpicks were skipped deliberately.

### SERVER — resilience & correctness
- **Photo-chart Telegram handler could hang forever + leak the typing indicator** (`bot.mjs`): the image download had NO timeout — a black-holed Telegram CDN route stalled the handler AND the 4s `startTyping` interval leaked per photo (the voice handler already had the 30s deadline; now the photo path matches).
- **The GitHub backup rate-limiter was DEAD CODE** (`lib/backup.js` + `intraday/backup.js`): `PUSH_MIN_GAP_MS` (the per-file 60s abuse guard) read `_lastPush` but never wrote it — state churn could hammer the Contents API ~20x/min/file, trip GitHub's secondary rate limit → 403 → **all durable backups silently stop**. The per-file gap now arms after every successful push (failed pushes retry early by design — the remote copy is still stale).
- **One transient Telegram blip used to eat a 30-minute alert** (`telegramPush.js` + `manualTrades.js`): the alert cooldown armed BEFORE the send — a 5-second network hiccup at the moment an EXIT-NOW / SL-touch / STRONG fired suppressed that push for its whole window with no retry. Now the FULL cooldown arms only on a successful send; a failed send reserves a short 30s failure-retry hold (the next conviction sweep / sink tick re-attempts). The manual `_push` return flag is honest now too (false when nothing went out).
- **`globalRiskGate` could stall the entry gauntlet for minutes** (`globalRisk.js`): the VIX/BTC Yahoo reads had no deadline — undici's default headers timeout is minutes, and BOTH desks' entry ticks await this gate. 8s `AbortSignal.timeout` deadlines added (matching every other fetch in the repo).
- **`remove-webhook` could hang the admin route** (`telegram/webhook.js`): the `deleteWebhook` fetch had no signal (its `setWebhook` sibling had one) — 10s deadline added.
- **MID-SYNC DISCONNECT race on the portfolio snapshot** (`mcp/portfolioSync.js`): `indmConnected`/`cdcxConnected` are captured at sync start, then the sync sits in 30-60s of awaits — if the user disconnected a source mid-sync, `clearSourceAssets()` wrote a snapshot without those rows and the still-running sync wrote them RIGHT BACK (resurrect + durable-put, surviving restarts until the next sync). Connectivity is now re-checked in the same no-await window as the hidden re-read (the established discipline in that file), dropping the disconnected source's rows + residue exactly like `clearSourceAssets` does. Test-locked with a gated-hanging MCP call.
- **Unbounded user-keyed caches bounded** (memory-hygiene sweep): `orderFlowDepth` book/ring maps (~10-20KB retained per slot, `/api/ai/depth` lets a caller grow the key space forever — evict-stalest past 200, current key + in-flight protected), `backtest._cache` (keys embed the caller's symbol lists with full backtest payloads — cap 24, evict oldest), `signals.js` `_ltfMiss`/`_ltf5mMiss` negative caches (cap 200, expired-first), `fundamentals._data` (cap 300, error rows evicted before good rows), `manualTrades._alerts` (same >200 prune as telegramPush).

### FRONTEND — races, jank & honesty
- **`loadPositions` responses could resurrect a just-closed position** (`useAITrading.ts`): up to four uncoordinated callers raced (45s reconciliation poll · 5s fallback poll · close/execute refreshes · visibility refresh) with blind wholesale `setPositions` — a slow REST response landing after a newer one reverted the panel, and a poll started BEFORE a close that resolved AFTER closePos's refresh showed the closed position as OPEN for up to 45s. Request sequence guard added (`posSeqRef` — only the latest request's response applies; same discipline as the desks' `deepReq` tokens).
- **O(n²) maxOI inside the option-chain row render** (`OptionsDeskPanel.tsx`): `Math.max(...rows.map(...))` executed INSIDE the per-row `.map()` — the 100-250-strike NSE chain re-scanned itself per row on every repaint (10k-62k comparisons + a fresh array per row). Hoisted to a single per-render computation.
- **"LIVE 5s" monitor badge lied right after mount** (`ManualTradeMonitor.tsx`): the cadence scheduler read `tradesRef` one poll late (the sync effect commits after the next render), so the first refresh after mount always waited 30s even with open trades; the close path could also interleave with the scheduled load and transiently resurrect the just-closed row. The ref now syncs INSIDE `load()` + a response sequence guard.
- **Stale ticks rendered as live prices** (`useCxLivePrices.ts`): when the board re-ranked and a symbol dropped out of the watched key set, its last tick kept rendering with the live ⚡ marker — a frozen price presented as realtime. `forSignal` now returns null past 30s (the card falls back to its board snapshot honestly).
- **Hidden-tab API burn**: the India agent panel (15s poll) and the options signal strip (30s poll) now gate on `document.hidden` like every sibling poller — a backgrounded tab no longer fires 12s-timeout API calls forever.
- **Toast/message timers wiped newer messages early** (sweep): the first `setTimeout(() => setX(null))` erased a second message posted within its window (two paper trades, two saves, connect+disconnect flashes, the clear-closed result chip, the execute banner's pending→verdict sequence). All hot sites converted to the timer-ref pattern (clear-before-rearm + unmount cleanup): OrderConsole (save/flash/sweep), SignalCard (copied/result), OptionsDeskPanel (paperMsg), AlertsPanel, IndiaAgentPanel, CoinDcxTab, IndiaIntradayTab.
- **Options strip `err` flag read a mount-time closure** (`OptionsDeskPanel.tsx`): `else if (!view) setErr(true)` captured the always-null mount-time `view` — every failed poll set err even with data on screen (render masked it; latent trap). Now reads a `viewRef`.

### Verification
- NEW/updated tests: `telegramPush.test.ts` +1 (failed send does NOT arm the full cooldown — reserved short window, retries after 30s, full cooldown arms on success), `manualTrades.test.ts` +1 rewritten contract (failure → honest `pushed:false` + retryable after the failure window + full cooldown only on success), `portfolioSync.test.ts` +1 (mid-sync disconnect gated-hanging-call race — no resurrect, residue dropped, honest not-usable result).
- `tsc CLEAN · 103 files / 1867 tests ALL PASS · vite build CLEAN (5.0s) · npm audit 0/0 (both trees) · node --check all 13 touched files · scripts/smoke_v1017.mjs 20/20 (SMARTAI_DATA_DIR-isolated).`

### Audit scope (what was checked and found clean)
- All 186 `fetch(` call sites across `server/` + `telegram-bot/` (only the 3 timeout-less ones above were fixed); every `setInterval`/listener/keepalive lifecycle (all paired); the journal writer-lock discipline (all four desks correctly serialized); fire-and-forget paths (all carry `.catch` or sit in try/catch; both processes register `unhandledRejection` guards).
- Frontend: hook-dep/stale-closure sweep (the v10.6.1/v10.13 passes hold; only the strip-closure above remained), EventSource/WebSocket/timer leak sweep (no real leaks — only the toast-wipe class), the v10.17 tickBatcher merge/flush semantics re-verified correct (partial-delta merge, snapshot-flush ordering, final-tick scenarios).
- Known-and-accepted (documented, not defects): the 600ms direction-flash timer (cosmetic, sub-second); `ManualTradePrompt` prefill staleness (mitigated by the live deviation warning; editable field); dead `AITradingTab.tsx` (orphaned since the India/CoinDCX tab split — deletion rides the next frontend cleanup pass).

## v10.17 — FULL UNIVERSE SCAN + OPTIONS SCANNER + CLEAR CLOSED + PERF (2026-09-16)

**The superintelligence plan v2's remaining sections, fully applied: Section 1 (full universe scan + tiered cadence + options scanner), the Clear-closed-trades button, and Section 5 (performance/lag cleanup).** Suite grew **1799 → 1865 tests, all passing** (+66 across 6 new files + 5 calendar-determinism patches); boot smoke 20/20 (`scripts/smoke_v1017.mjs` — includes a LIVE TV discovery + LIVE NSE options-chain pass); tsc clean; build clean 5.3s; audit 0/0; ml-service 11/11.

### SECTION 1a — Full universe scan + TIERED CADENCE (India desk)
The gap: every India surface (Signal Board · Trending Movers · intraday scanner) scanned a FIXED ~45-name F&O base — the best setup of the day sitting outside that list could never surface. Now:
- **NEW `server/ai/indiaUniverse.js`** — one TV India scanner FILTER query (type=stock · exchange=NSE · sorted by turnover, depth ~220) discovers the most-traded NSE names every 10 min (single-flight, 90s negative-cache, honest static-seed fallback when the scanner is unreachable). LIVE-verified from the boot smoke: 219-220 real names parsed, turnover-ranked.
- **Tiered cadence** — T1 (base ∪ watchlist ∪ HOT) scans EVERY cycle; T2 (the discovered rest) rotates in ~¼ slices per cycle → whole-market coverage every ~4 board cycles (~4 min) without ever exploding one scan's upstream cost. **Hot promotion**: a T2 name showing heat (|chg| ≥ 2.5% · relVol ≥ 2 · RSI ≥ 72/28) rides T1 cadence for 20 min (cap 15, fittest-survive eviction). The board, movers and scanner SHARE one rotation + one hot set — combined callers cover T2 faster, never slower.
- **Chunked TV batches** — `fetchTVIndiaBatchChunked` (60 symbols/request, ≤3 concurrent) on the board path; the intraday engine's TV round chunks at 100 tickers/request (small universes keep the exact legacy single-shot path). Groww quote load bounded by the v10.12 micro-cache + per-symbol backoff as before.
- **Honest degrade**: discovery DOWN → the board falls back to the legacy static scan byte-identically (same upstream as the tickers batch — no seed guessing on the board path); movers/scanner keep the wider seed coverage. User watchlist removals are honoured against discovered T2 seats AND hot rides. `AI_INDIA_FULL_UNIVERSE=off` reverts everything; `superMeta.universeMode` labels the live tier shape.
- Fixed en route (caught by tests/smoke): `mergeHot`/`pruneHot` silently wiped the production Map state (Array.isArray guard) — hot rides never persisted; `splitTiers` computed the hot set and never seated it into T1 (the smoke's live 220-name rotation caught it); `nextSlice` built the slice before computing the adaptive take.

### SECTION 1b — OPTIONS SCANNER (whole F&O chain, one view)
- **NEW `server/ai/optionsScan.js` + `GET /api/ai/options-scan`** — 3 indices (NIFTY · SENSEX · BANKNIFTY) + the top stock-option underlyings by NSE turnover (F&O seed intersection, `AI_OPTIONS_SCAN_STOCKS` default 6), each loaded through the existing real-NSE-chain machinery with the honest BS-model fallback. Every row: DETERMINISTIC direction tally (OI lean · PCR · max-pain side · gamma-flip side — zero LLM, fully explainable), GEX pin/flip zone + walls, expected-move band, ATM IV, DTE awareness, source tag. Ranked by a transparent scan score (conviction ×8 + OI-flow ×25 + movement potential ×5 + live-chain +5 − far-expiry drag). 90s cache, single-flight, bounded groups of 4 with 350ms gaps (NSE politeness — never a stampede).
- **UI**: the Options Desk panel gets a **🔍 SCANNER** toggle — one ranked list across the whole F&O universe (direction chips, score bars, γflip/walls/exp-move, LIVE NSE vs BS MODEL tags, failed rows honestly listed).

### CLEAR CLOSED TRADES (the console button)
- **`POST /api/ai/positions/clear-closed` + `clearClosedPositions()`** — sweeps ONLY `status === 'CLOSED'` rows from the journal through the writer lock (OPEN/UNKNOWN structurally untouched), stamps a `HOUSEKEEP` audit entry with the count; the tamper-evident LEDGER keeps the permanent trail.
- **🧹 CLEAR CLOSED (n) button** in the Execution Console (all 3 desks) — only rendered when closed rows actually clutter the list, spinner + result chip, parents refetch via the new `refreshPositions` hook export.

### SECTION 5 — Performance / lag cleanup
- **THE render-storm killer** — `useAITrading` merged every SSE `tick` event with its own `setPositions` (crypto cadence ⇒ up to N re-renders/SEC of the whole tab tree — the console "lag"). NEW `src/utils/tickBatcher.ts`: ticks buffer per-id (latest-wins, partial deltas merge) and flush in ONE state update every 800ms — the same proven pattern `useCxLivePrices` ships. Hidden tabs render ZERO times; structural `positions` snapshots flush instantly; visibilitychange force-flushes. 20 → 1 renders per window (test-locked).
- `TrackRecordPanel` memo'd (its only prop is a number — the tab's live flushes now skip that subtree); OrderConsole sweep state is local; the board card grid already rides primitive `liveLtp` props so only price-changed cards re-render.
- **Calendar determinism fix (pre-existing, found live)**: the agent suites asserted exact sizing (₹390 / qtyINR 5000) with the REAL event-guard calendar live — they silently halved or blocked entries around FOMC/CPI windows (today's FOMC 16-Sep proved it: ×0.5 haircut live). All 5 agent-tick suites now pin a neutral event guard — the sizing/mandate/entry math under test is calendar-independent.

### Verification
- NEW `test/indiaUniverse.test.ts` (28: wire parsing/validation/local sort · grammar · tier split incl. THE hot-rides-T1 lock · rotation wrap/adaptive · heat rule · TTL/refresh/cap/eviction · discovery cache/single-flight/negative-cache/seed fallback · wire filter contract · tiered scan + exclude + flag-off parity) · `test/indiaBoardTiered.test.ts` (3: board wiring — chunked batch on the tiered set, honest superMeta, legacy path on discovery-down, hot absorb gating) · `test/optionsScan.test.ts` (17: direction tally BULL/BEAR/NEUTRAL · score math incl. model-penalty + dte drag · row contract + degrade · picker intersection · execution: ranking/cache/single-flight/all-model honesty/group-size cap) · `test/clearClosedPositions.test.ts` (6: only-CLOSED · HOUSEKEEP stamp · no-op writes nothing · lock serialization · repeat-safe) · `test/tickBatcher.test.ts` (10: N→1 render · latest-wins · partial merge · hidden no-op · flushNow · dispose · garbage-safe · visibility flush) · `test/intradayTvChunking.test.ts` (3: 150-symbol → 3×100-ticker chunks · small-universe single-shot parity · dead-chunk containment).
- Calendar-determinism patches: `agent/indiaAgent/mandateFreeze/nearMissAutoTrade/v101AgentAccuracy` (neutral eventGuard mock).
- **tsc CLEAN · 103 files / 1865 tests ALL PASS (×5 consecutive full runs) · vite build CLEAN (5.3s) · npm audit 0/0 · ml-service pytest 11/11 · `scripts/smoke_v1017.mjs` 20/20 incl. LIVE TV discovery (219-220 names) + LIVE NSE chain scan (3 live desks, 5 honest model fallbacks from this sandbox IP).**

### Deferred (documented, not forgotten)
- Telegram `/opts` command for the options scanner (the site panel covers the need; bot surface additions ride the next telegram batch).
- Journal file micro-cache (`loadJournal` reads disk per call — bounded sizes make it ~2-4ms; revisit only if profiling ever shows it hot).
- The TV India filter-query column set is minimal (name/exchange/close/change/volume/value_traded/relvol/mcap) — discovery is liquidity-only by design; no fundamental columns fetched.
# Changelog

## v10.16 — MANUAL TRADE TRACKER + SUPERINTEL THRESHOLD REFORM (2026-09-16)

**The superintelligence plan v2's Section 2 (the user's OWN trades) + Section 3 (the conf=60 threshold spec), fully applied.** Suite grew **1747 → 1799 tests, all passing** (+52 across 1 new file + 5 extended files); boot smoke 14/14 (`scripts/smoke_v1016.mjs`); tsc clean; build clean 5.1s; audit 0/0 both trees.

### SECTION 2 — Manual Trade Tracker ("Maine ye trade liya hai")
The gap: paper trades are tracked, agent trades are tracked — the user's OWN real trades had zero support. Now every manual entry gets the SAME intelligence the desk gives its own positions:
- **NEW `server/ai/manualTrades.js`** — the full tracker: the ORIGINATING SIGNAL SNAPSHOT is frozen at record time (plan + 14-model votes + regime + AI score — the baseline every later "trend change" is measured against), live P&L (₹/USDT + %, direction- and lot-aware, correct currency domains), SL/T1/T2 distances in the trade's favor-frame, time-in-trade, and the escalating STATE BANNER: **THESIS INTACT (green) → WEAKENING (amber) → EXIT NOW (red, pulsing, pinned to top) → TARGET HIT (blue)** — TARGET beats EXIT (a reached target is bookable truth); UNKNOWN conviction degrades honestly to STALE, never a dead bar.
- **The monitor** (5s LTP sweep · 30s conviction re-vote via the SAME cached deep path the agents use — zero new upstream calls · parks at 60s idle when flat): conviction FLIP → immediate highest-priority Telegram push **carrying the WHY** (`flipSummary`: which named models switched sides vs the frozen entry votes + the entry→current score move — "so you can judge rather than obey"); SL approach within 0.3×ATR (5-min re-nudge); each target hit (once per level); stagnant check-ins on quiet trades. All pushes cooldown-guarded; a thrown deep call degrades to UNKNOWN exactly like an `ok:false` one.
- **Instrument coverage** exactly where signal cards exist: India equity + F&O options (premium re-priced via Black-Scholes on the live underlying, entry IV held — the paper-desk basis; expired → intrinsic) + crypto spot/perps (live tick store) + global SIM.
- **UI**: `ManualTradePrompt` on every signal card (entry price pre-filled with the live LTP, editable — a >15% deviation WARNS, never blocks: genuine fills can be off, but one typo silently corrupts every downstream P&L number) + the `ManualTradeMonitor` section in BOTH desks (CoinDCX + India Intraday — 5s repaint while trades are open, EXIT NOW rows pinned, closed-history collapse). Telegram confirmation pushes on record + close.
- **5s level-touch parity**: the manual rows ride the SAME `telegramPush` instant-push pipeline as the CoinDCX + India paper desks (SL/T1/T2 touch pushes, **✋ MANUAL tagged**, honest footer — no executor-watcher promise for a trade no executor watches; INR-domain rows carry ₹ uP&L, USDT-domain rows omit the number rather than guessing an FX conversion). `manualPushes` joins the status heartbeat.
- **Telegram commands**: `/manual` (live list, EXIT NOW rows pinned first, conviction bars + distances per row) + `/manualclose <id> [price]` (default: live price). Both `/help`-registered.
- **Persistence**: `server/data/manual-trades.json` (atomic debounced writes, backup-mirrored, graceful-shutdown flush — the paper-desk contract). Capped at 300 trades.
- **Bugs found & fixed during this ship** (the interrupted-session handoff): `../../intraday/backup.js` wrong path (module couldn't even import), `_monitorTick` read its injected deps off `_mon` instead of `_mon.deps` (getDeepSignal/fetchers undefined → the conviction re-vote and with it EVERY alert silently dead), `manualTradesToPositionRows` spoke BUY/SELL + no `status` field (detectLevelTouches would never fire — and would have level-checked inverted had it fired), and the level-touch adapter was never actually wired into the sink. All now test-locked.

### SECTION 3 — Superintel threshold reform (USER SPEC: conf=60)
The diagnostic that motivated it: Path B (STRONG grade + conf + agreement) was UNREACHABLE at 80/0.75 — a second qualification route that could never fire, while the flat +10 quorum penalty made a 4-voter committee (one honest abstain) face an 85 bar. Both agents now:
- **minConfidence 80 → 60 · minAgreement 0.75 → 0.65** — Path B is a realistic second route (quality still guarded by the STRONG-grade + executable + quorum-honesty caps; a 78% STRONG committee signal that was BELOW the old bar now qualifies — test-locked). Saved configs migrate untouched-old-defaults to the new bar; explicitly customized values are preserved verbatim.
- **PROPORTIONAL quorum penalty** (the primary trade killer): thin committees pay **+1.5/voter below 5, capped at +5** (4 voters → +1.5 · 3 → +3 · 1 → +5) — rigor preserved (thin still pays MORE than full), the cliff is gone. `thresholdProfile: 'flat'` restores the legacy +quorumPenalty arm for A/B; every entry journals the active profile + the exact bar it cleared (the weekly review can compare outcomes honestly).
- **Abstention diagnostics** (the root-cause-behind-the-root-cause): the wire signal now carries `abstentions` (which models sat out + their stated reason); thin-committee near-misses NAME the abstainers ("THIN COMMITTEE SOL — 3/14 models voted; abstained: OptionsFlow (no chain) · InstFlow (feed cold) — data-feed fixes here lift quorum at the source") — fixing a dead feed is the QUALITY fix vs lowering bars. Panel-visible on every near-miss row.
- Both agents (crypto + India) share ONE `effectiveScoreBar` truth (the near-miss gap math reads it too — no stale inline +10); the status panel exposes the new worst-case thin bar (80, was 85).

### Verification
- NEW `test/manualTrades.test.ts` (44: pure math ×5 suites · banner priority · snapshot freeze · CRUD validation + F&O contract · LTP resolution per market incl. BS re-price · alert ladder ×6 incl. cooldowns + containment · level-touch wiring contract incl. the LONG/SHORT translation + INR/USDT P&L-domain honesty · monitor loop ×5 incl. THE deps-live-on-_mon.deps wiring lock + UNKNOWN degradation + idempotent start).
- Extended `test/telegramPush.test.ts` (+4: manual SL touch fires the same path MANUAL-tagged with the honest footer · T1+T2 both fire on a gap-through with ₹ uP&L · USDT-domain rows push without a guessed conversion · a broken manual store never breaks the other desks) · `test/agent.test.ts` (+1: the 78% STRONG Path B unlock) · `test/nearMissAutoTrade.test.ts` (+2: proportional ladder 4/3/1/0 voters + flat A/B arm + full-quorum) · `test/v101AgentAccuracy.test.ts` (+1: the no-cliff boundary — voters 3 at exactly 78 enters, 76 doesn't; worst-case thin bar 80) · `test/indiaAgent.test.ts` + `test/mandateFreeze.test.ts` (parity assertions).
- **tsc CLEAN · 97 files / 1799 tests ALL PASS · vite build CLEAN (5.1s) · npm audit 0/0 both trees · `scripts/smoke_v1016.mjs` boot smoke 14/14** (module contract + snapshot freeze + view + rows + sink wiring + threshold bars + bot commands).

### Deferred (documented, not forgotten)
- OPTION-trade conviction: the deep re-vote scans the UNDERLYING's symbol — an option's own conviction banner reads the index/equity committee (honest enough: the option's thesis IS the underlying's); a strike-aware re-vote would need an options-context deep path that doesn't exist yet.
- Manual-trade Telegram pushes for `evaluateManualTradeAlerts` currently ride the monitor's 30s conviction cadence; the 5s SL-touch parity comes from the level-touch sink — a 5s conviction-grade escalation would need the monitor's loop split (deliberately not done: 30s matches the agents' own re-vote cadence).

## v10.15 — SUPERINTELLIGENCE UPGRADE + BINANCE FUT WS ACCELERATOR (2026-09-16)

**The deep-recheck #2 remaining gaps + the intraday/CoinDCX superintelligence upgrade plan, fully applied.** Both plans verified against `db1f5a9` first (TS 0 errors · 92 files/1666 tests · audit 0/0 — everything already shipped was deliberately excluded). Suite grew **1666 → 1747 tests, all passing** (+81 across 4 new files + 4 extended files); boot smoke 7/7 live-verified (`scripts/smoke_v1015.sh`); build clean; audit 0/0.

### SECTION 1 — Binance futures WS: the real remaining speed fix
- **NEW `server/ai/binanceFutWs.js`** — the FUT_ accelerator TIER between the CoinDCX socket and the Binance REST fallback, modeled directly on cryptoStream.js's proven Binance client (combined-stream subscription, 3-fail handshake circuit breaker, 5-min rapid-cycle backoff, geo-block 451 honesty, 1MB frame cap, 20-stream cap, 2s resub debounce). When CoinDCX's futures socket goes dark (WAF blip/403/cooldown), FUT_ now gets **SUB-SECOND pushes** from `wss://fstream.binance.com` instead of degrading to the 5s REST cache — the "ab pehle jaisa ultra-fast nahi lag raha" moment for BTC/ETH/SOL is gone. Priority chain: CoinDCX Socket.IO → **Binance futures WS (new)** → Binance REST 5s → stale-serve.
- **Hot-standby semantics:** the accelerator socket opens ONLY while the CoinDCX WS isn't proving ticks and closes the moment it recovers — normal operation is byte-identical to v10.14 with ZERO extra upstream connections. Opens/closes with the SSE client gate (Render idle-friendly).
- **Source-priority gate + no badge flapping:** a binance-fut-ws tick never overwrites a fresh `coindcx-fut-ws` (<3s) or `coindcx-fut-rt` (<2.5s) tick (CoinDCX is the desk's authoritative exchange); out-of-order guard on late frames; `binance-fut-ws` renders as its own emerald **Binance·WS** pill (distinct from the 5s sky `Binance·RT`); REST-cadence floor applies while the accelerator owns FUT (GLOB-subscribed sessions keep 2s — GLOB has no Binance path); the REST fallback skips WS-covered symbols; status frame + `/api/feed-status` + the CoinDcxTab honesty chip carry the tier's state ("· FUT Binance·WS⚡" while the CoinDCX socket cools).

### GAP 1 — Live Conviction Tracker (the ensemble now works DURING the trade)
- **NEW `server/ai/positionConviction.js`** — the 14-model ensemble that decided "LONG with 82% confidence" re-votes every open position each tick via the SAME 30s-cached deep path the boards use (zero new upstream calls). `convictionDelta = currentScore − entryScore` (sign-relative to the position's direction) → **STRENGTHENING / HOLDING / WEAKENING / FLIPPED**.
- Wired into BOTH agents' exit ticks (inside the existing gauntlet — kill-switch/daily-cap early-returns gate it; an exit can never bypass the caps): **FLIPPED** (opposite side WITH quorum — ≥5 voters or STRONG) → immediate `conviction-flip` exit BEFORE the stop (thesis invalidation); a flip without quorum is noise, not an exit. **WEAKENING + in-profit** → SL ratcheted toward breakeven (never a hard exit; losing positions are never tightened — no disguised early exits on noise). **STRENGTHENING** → earns winner-extension room even marginally red; **WEAKENING/FLIPPED never earn it** (`extensionEligible` gained the conviction param; absent = the exact v10.8 behavior — locked by tests).
- Live conviction bar on every open agent position in both panels (green ▲ STRENGTHENING → amber ▼ WEAKENING → red ⯅ FLIPPED, with entry→now score + delta). Entry-time conviction score recorded at every entry (the delta anchor; `Number(null)===0` trap fixed in the pure core). Gated behind `AI_ENABLE_CONVICTION_EXIT` or the agent knob — **OFF by default, flag-off = byte-identical**.

### GAP 2 — Event Guard (scheduled-event awareness)
- **NEW `server/ai/eventGuard.js`** — the one question a pro trader asks before entry that the system never did: "is anything scheduled?" Three GRADED responses: **T-30min blackout** (block new entries on the affected symbol/desk — existing positions untouched), **T-2h sizing haircut ×0.5** (multiplier into the risk path, both flat and kelly-capped), and NO auto-flattening by design (the partial-TP/breakeven ratchets already de-risk into events; flattening green runners on every CPI print is churn).
- Calendars (honesty first — every derived date labeled approximate): NSE/US earnings lifted from the frontend's own `earningsCalendar.ts` table and rolled FORWARD quarterly (stale dates never block); FOMC 2026–2027 published decisions; RBI MPC published 2026 H1 + `AI_EVENT_EXTRA_JSON` for additions (invented H2 dates = false blackouts — missing data degrades honestly); India CPI/IIP + US CPI as labeled monthly patterns. Desk scoping: FOMC/US-CPI hit ALL desks (crypto is macro-sensitive); RBI/India-CPI/IIP hit INDIA only; earnings hit the symbol's desk.
- Integrated into BOTH agents' entry gauntlets (veto reason lands in the journal + panel blockers like every other gate) + the **⚠ event chip on every signal card** (`⚠ FOMC 30m · ENTRY BLOCKED` / `⚠ Earnings in 2h · size ×0.5` — the manual trader sees the same warning the auto-agent vets against) + `GET /api/ai/event-guard` status route. `AI_DISABLE_EVENT_GUARD` kills it; tunables `AI_EVENT_BLACKOUT_MIN/HAIRCUT_MIN/HAIRCUT_MUL`.

### SECTION 3 — Direction-accuracy split (the standing "are directions right?" answer)
- `weeklyReview.computeAiDeskWeek` gains **byDirection** (LONG vs SHORT trades/wins/win-rate/net-P&L, from closed positions — the only journal rows carrying side) and **byEntryHour** (IST entry-hour buckets — the "first-15-min entries lose" / "post-lunch chop" pattern detector). Both reach the Telegram header + the LLM prompt block (new **Direction Read** section in the digest).
- `trustReport()` gains the settled-ledger **direction split** (n / win-rate / avg-R per side) — rendered as the Model Performance Panel's new **DIRECTION SPLIT** block with a side-gap read (≥15 pts gap flags "ek side systematically weak hai").

### GAP 4 — Global Risk Brain (the cross-desk portfolio view)
- **NEW `server/ai/globalRisk.js`** — ONE exposure view across both desks (per-position stop-distance risk with correct currency domains, net directional bias, unpriced count — never invented), ONE portfolio-level **heat cap** (`AI_GLOBAL_HEAT_CAP_PCT`, default 6%) consulted by BOTH entry gauntlets (combined deployed risk over the ceiling vetoes entries regardless of which desk asks — "max-long NIFTY IT + max-long crypto" is finally seen as ONE bet), the rolling **BTC↔NIFTY** correlation (reuses the 60d matrix), and **risk-off detection** (VIX spike ≥25 & +15% over 5d AND BTC >1.5% below its 20d SMA — TOGETHER; each leg alone ≠ risk-off) that down-weights new-entry sizing on BOTH desks at once (×`AI_RISKOFF_MUL`, default 0.5). Unreachable market data → riskOff false + dataOk false (missing data is not a signal). 5-min cache — the gauntlet reads it free. `AI_DISABLE_GLOBAL_RISK` kills it.

### GAP 3 — Patient Entry (execution patience)
- **NEW `server/ai/patientEntry.js`** — an EXTENDED signal (>1.5 ATR beyond its anchor) rests at a **depth-derived pullback level** (just above a detected bid wall for longs / below an ask wall for shorts — via the shipped order-flow depth module; no readable depth → the signal's own anchor, never an arbitrary ATR fraction) for a validity window (**15m crypto / 10m India**, `AI_PATIENT_WINDOW_MIN`) instead of chasing. At-anchor signals enter immediately, exactly as today.
- Both agents: the resting order comes FIRST each tick (touched level → execute the PLANNED entry if the board still backs the side; signal gone → cancel, no chase); unfilled expiry → journaled **`missed-pullback`** (a GOOD outcome — it didn't chase); one resting order at a time; waiting doesn't block other symbols. Every entry journals an **`ENTRY_MODE` marker**, and the weekly review gained the **patience A/B** (`byEntryMode`: immediate vs patient closed-position win-rates + missed-window count) — "did patience pay?" is now a number, not a belief. Gated behind `AI_ENABLE_PATIENT_ENTRY` or the knob — **OFF by default (ship-last, A/B-able)**.

### SECTION 2 — Telegram: the implementable triage steps
- `/fiidii` + `/ipo` now reply with a clear **"needs TAVILY_API_KEY"** message when the key is missing (was an opaque error) — key-missing ≠ dead command, per the evidence-first triage.
- `/coindcx` ↔ `/crypto` cross-referenced each way with explicit wording (account status vs market prices — deliberately NOT aliases; they are different data paths by design, the "dedupe" is the shared wording + pointers, killing the two-sources-of-truth confusion without deleting working functionality).
- `/selftest` footer now carries the **triage procedure** (⚠️ = add the key, don't remove; ❌ = re-run twice, delete only PERMANENTLY dead paths incl. their helpers; transient timeouts = keep). The actual deletion pass still waits for the user's LIVE `/selftest` run — by the plan's own "needs your live run before any deletion is safe" rule.

### Verification
- NEW `test/cxRtStream.test.ts` v10.15 suite (7: dark→WS sub-second & REST-bypassed · both-dark→REST tier · cx-recovers→stand-down · source-priority no-flapping · idle-close · 20-stream cap · out-of-order) · NEW `test/positionConviction.test.ts` (21: pure classification ×8 · quorum/flip bar · weakening-tighten policy · extension interplay + zero-regression flag-off · flag round-trips · status payload) · NEW `test/eventGuard.test.ts` (16: blackout/haircut/allow ×desk-scoping ×calendar honesty ×status/chip) · NEW `test/globalRisk.test.ts` (15: exposure math ×currency domains · risk-off legs · gate/veto · tunables · honest degrade) · NEW `test/patientEntry.test.ts` (18: at-anchor/extended · wall levels · fill/expire/wait · flag · patience A/B) · extended `weeklyReview.test.ts` (+5 direction/hour/A-B) · `liveSourceBadge.test.tsx` (+1 Binance·WS pill).
- **tsc CLEAN · 96 files / 1747 tests ALL PASS · vite build CLEAN (5.0s) · npm audit 0/0 both trees · `scripts/smoke_v1015.sh` boot smoke 7/7 LIVE** (modules import+exports · event-guard route carries the FOMC/RBI/CPI calendar · feed-status carries the accelerator tier · SSE 200 with the tier live · trust route alive).

### Deferred (documented, not forgotten)
- GLOB_ (AAPL/MU/SPCX) acceleration: no crypto exchange lists single-stock perps — Finnhub remains the correct shipped answer (by design, not omission).
- Section 2's command DELETION pass: blocked on the user's live `/selftest` evidence (the plan's own prerequisite); the triage procedure + needs-key messages are in place so the next session can act on data.
- India winner-extension: the India agent still has no extension system (the crypto agent's parity item the conviction tracker hooks into); conviction there is exit+tighten only, recorded honestly in the panel.
- All four GAP engines are flag-gated OFF by default (`AI_ENABLE_CONVICTION_EXIT` · `AI_ENABLE_PATIENT_ENTRY` · event-guard ON but `AI_DISABLE_EVENT_GUARD` exists · global-risk gate ON but `AI_DISABLE_GLOBAL_RISK` exists) — flip them one at a time and A/B against the v10.14 baseline.

## v10.13 — FULL-SITE DEEP RECHECK: SECURITY + RESILIENCE HARDENING (2026-09-15)

**The requested "deep advance pro-level" full-site code recheck.** Three parallel deep reviews (server core + security, realtime stream modules, frontend core) — every finding re-verified against source before fixing. **2 HIGH security issues, 9 MEDIUM bugs, 20+ LOW issues found; all HIGH/MEDIUM and the cheap LOWs fixed, each with regression tests.** Suite grew **1621 → 1655 tests, all passing**; boot smoke 7/7 with the new security layer live-verified.

### SECURITY (HIGH)
- **H-1 master-token bundle leak (config footgun chain):** `render.yaml` still declared `VITE_API_TOKEN`/`VITE_ENCRYPTION_KEY` (build-time VITE_* vars are INLINED into the public JS bundle) while `requireAuth` treats `API_TOKEN` as a master bearer for EVERY endpoint — setting both to the same value (the naming invites it) handed every anonymous visitor full auth. Removed from the blueprint, removed the `api.ts` build-time read (cloud sync auth = runtime localStorage override only), and `validateEnv()` now REFUSES TO BOOT when `VITE_API_TOKEN === API_TOKEN` (live-verified both refusal and warning paths).
- **H-2 CSRF on no-body mutations:** the `SameSite=None` session cookie rode along on cross-site "simple requests" — silently authenticating `POST /api/ai/orders/cancel-all`, `kill-switch {}` (= DISARM), broker/API-key disconnects. The logout route already had the discriminator; it is now a GLOBAL middleware for every state-changing request: **cross-site + session cookie + no Bearer → 403** (login exempt — nothing to hijack pre-login; bearer/service calls unaffected). Live-verified in the boot smoke: cookie+cross-site+no-bearer → **403** on kill-switch; same-site → 200; bearer+cross-site → 200 (the app's own Vercel→Render path).

### SECURITY (MEDIUM/LOW)
- Telegram webhook now **fails closed in every mode except explicit `NODE_ENV=development`** (the old gate only refused `NODE_ENV === 'production'` — the repo's own VPS/start_server.vbs paths run unset and accepted forged updates); secret-token compare is now constant-time.
- **Global PIN-failure lockout** (150 failed PINs / 15 min across ALL IPs → 5-min login lockout) — the per-IP limiter alone was bypassable by rotating IPs against a 4-digit PIN; short-PIN boot warning added (not enforced — no lockout of existing deployments).
- Public market-data endpoints (`/api/quote`, `/api/chart`, `/api/fundamentals/:symbol`) gained per-IP rate limits (900/300/240 per 10 min — far above the busiest legit tab); growwQuote's `_failStreaks`/`_backoffUntil` maps are now swept at >500 entries (random-symbol enumeration through the public quote endpoint could grow them forever).
- Compat AI proxies clamp `max_tokens` (≤8192) / `temperature` and strip `stream`; backtest/swing/whales symbol lists capped at 12 + charset-validated; `/api/vision-analysis` no longer forwards the raw upstream error body to the client; body-parser errors now 400 (was 500); graceful shutdown drains in-flight responses (`server.close()` + 2s deadline) before exit.

### REALTIME STREAMS (the honesty + liveness fixes)
- **Groww grossly-stale row guard:** while the NSE window is open, a `lastTradeTime` from before today's 09:15 IST session (the exact v10.12.1 garbage shape: Nov-2023 rows) or an absurd future clock → rejected → quick-retry → honest Yahoo fallback. Same-session old timestamps stay accepted (illiquid symbols still have an honest LTP); outside market hours nothing is gated.
- **Finnhub WS liveness:** ping every 30s + 90s idle watchdog — a half-open TCP (laptop sleep→resume, NAT rebind) previously left `readyState OPEN` forever, silently losing Priority-1 instant trades for the process lifetime while the Yahoo fallback masked the degradation.
- **Epoch UNIT normalization** in `cxRtStream._landWsTick` + `futures.js` + `globalFutures.js` (`ts < 1e12 → ×1000`): the WS out-of-order guard compared CoinDCX SECONDS against internal MILLISECONDS — correctness was luck-dependent, and a seconds value stored into liveFeed poisoned frontend freshness.
- **`setScanSymbols` per-market maps:** an India scan no longer wholesale-evicts the crypto scanner's signal symbols (and vice versa) — each market owns its set, the watch set unions both.
- inStream fresh-symbol fan-out bounded (semaphore 6, usStream pattern — was 60 parallel Groww round-trips at page-load); inStream + intraday `_tick` re-entrancy guards; `_latestQuotes` prunes departed symbols (>10 min off the watch set); intraday `INDEX_SYMBOLS` is now the 10-name union (NIFTY50/NIFTYBANK/CNXIT paper trades can no longer hit Groww's garbage index endpoint); Finnhub REST bootstrap honestly labeled `finnhub-rest` (`finnhub-stream` reserved for actual WS trades); `_fallbackPoll` re-entrancy guard (overlapping TV batch POSTs when TV is slow — the rate-limit vector); WS frame size caps (1MB) on all three sockets; Binance reconnect jitter + rapid-cycle backoff (5+ connect-drop cycles/5 min → 60s hold-off).

### FRONTEND
- **SSE client resilience (liveStream.ts):** `onerror` now immediately downgrades feed status (`onStatus({})` — pollers speed up honestly instead of trusting stale "live" flags while the header still shows every feed LIVE), and a sustained error streak (≥6, no open) takes over from the browser's tight default retry loop with a **capped manual backoff that rebuilds the URL — re-reading the session token** (an expired 30-day token no longer loops 401s forever; a re-login heals the stream). Same pattern in `useIntradayStream`.
- **ErrorBoundary `key={activeTab}`** — one crashed tab no longer bricks the whole `<main>` area ("switch tabs" recovery now actually works).
- **Badge honesty:** unknown/missing source renders a NEUTRAL slate pill (was green "LIVE" — a label sink laundering delayed/unknown feeds into realtime-looking pills); `yahoo-us-fallback` → amber Yahoo·delayed; `finnhub-stream`/`finnhub-rest`/`tv-us-batch` map distinctly.
- Dead-but-exported hooks fixed before they become landmines: `useWebSocket` (handlers via refs — stale closures gone; CONNECTING-state duplicate-socket guard; manual `connect()` resets the attempt counter; symbols subscribe keyed on a string), `useServerSentEvents` (`useStreamingAI` cross-read line buffer — SSE frames split mid-chunk were silently DROPPED; `useLiveUpdates` ring-buffered at 200).
- **txn_history ledger capped at 5,000** (record/persist/cloud-save/restore surfaces — unbounded growth silently killed persistence at the ~5MB quota); tvWebsocket's global kill now clears callbacks (a stray second subscriber can no longer ride a dead socket); `apiFetch` no longer mutates the caller's `init`; `batchFetchPrices` + both SSE clients resolve the proxy base LIVE (runtime backend switch no longer split-brains REST vs stream); caller-initiated aborts are not retried; IndexedDB rejected-open promise resets (a transient failure no longer pins the localStorage fallback for the session); cache cleanup timer lazy-starts; `secureStorage.setItem` degrades to plaintext on WebCrypto failure (matches `setItemAsync`) instead of an unhandled rejection; IST date keys via the formatter directly (weekly-report dedup + daily snapshot were off-by-one outside IST); tab hotkeys ignore Ctrl/Cmd/Alt combos + contentEditable; cloud-merge retry cancellable on logout.

### Verification
- NEW `test/deepRecheckV1013.server.test.ts` (19: stale-row guard 4 paths + inert-outside-hours + failure-map sweep + per-market scan sets + 8 static index.js security guards) · NEW `test/liveStreamResilience.test.ts` (7: honest downgrade, transient-vs-sustained streaks, fresh-token manual reconnect, teardown) · +2 normalization cases in `cxRtStream.test.ts`, +3 NODE_ENV fail-closed cases in `telegramWebhook.test.ts`, +6 badge-mapping cases in `liveSourceBadge.test.tsx`.
- **tsc clean · 92 files / 1655 tests ALL PASS · vite build clean · npm audit 0 vulns · boot smoke 7/7 live-verified** (CSRF 403/200 discrimination, login exemption, quote rate-limit 429, SSE `?session=` 200) · browser E2E: login + 3 tabs, SSE connected, ZERO JS errors. Bundle scan: no `VITE_API_TOKEN` reference remains in `dist/`.
- Known deferred (design-level, documented): short-lived SSE stream tickets to keep 30-day tokens out of URLs (nginx log scrubbing recommended meanwhile); backup-module consolidation; `uncaughtException` survival policy (deliberate free-tier tradeoff, kept).

## v10.12.1 — INDIA INTRADAY: DEEP-RECHECK FIX (2026-09-15)

**Full-site deep recheck (the agreed final step after Plan C) found one real bug — fixed + live-verified.**

### The bug (live on the wire, caught by the boot smoke)
- `server/inStream.js` (`/api/stream?in=` SSE writer) tried Groww FIRST for INDEX symbols too — but Groww's `CASH/<INDEX>` endpoint serves a **garbage STALE ltp** (live-observed: `19425.35` with `lastTradeTime` from Nov-2023 while Yahoo's `^NSEI` was current). That garbage passed the `price > 0` check and went out as **`IN_NIFTY` @ 19425.35 tagged `groww-live`** — a WRONG price with the WORST possible badge, the exact opposite of the v10.12 honest-source goal.
- `/api/quote` (INDIAN_INDICES skip) and `intraday/stream.js` (INDEX_SYMBOLS → Yahoo override) already handled this; the inStream poller was the one gap. The old test only mocked "Groww returns null for NIFTY" — reality returns garbage, so the gap was invisible to the hermetic suite.

### The fix
- `inStream.js`: `INDEX_SYMBOLS` (union of the other two modules' sets — every name has a YF_INDEX_MAP entry) now skips Groww **entirely**; indices go straight to the Yahoo fallback, honestly tagged **`yahoo-delayed`**. Stocks unchanged (Groww first).

### Verification
- NEW regression test in `streamFeeds.test.ts`: Groww mocked with the REAL garbage payload shape (ltp 19425.35) → asserts Yahoo's current spot is served `yahoo-delayed` AND Groww is never even asked for an index, while stocks still hit Groww first.
- Boot smoke (5/5 PASS, live upstreams): `IN_RELIANCE` 1235.3 `groww-live` · `IN_NIFTY` **23118.6 `yahoo-delayed`** (was 19425.35 `groww-live`) · `/api/feed-status` shows both sources live.
- Browser E2E: India Intraday board renders **Groww·live** emerald pills next to live LTPs (AXISBANK ₹1,222.9, SBIN ₹968 — VLM-verified screenshot), SSE 200, zero JS errors.
- Suite: **90 files / 1621 tests ALL PASS**; tsc clean; vite build clean.

## v10.12 — INDIA INTRADAY: PLAN C HARDENING (2026-09-15)

**The user's 2-part plan, implemented end-to-end** (source-transparency badge + faster retry/backoff on Groww; Groww REST + TradingView WS as-is, no broker account).

### #1: Source-transparency badge — Groww·live / TV·WS / Yahoo·delayed
- Every India live tick now says WHICH upstream served it, end-to-end:
  - `server/inStream.js` (the `/api/stream?in=` SSE writer): canonical labels **`groww-live`** (Groww NSE served it) / **`yahoo-delayed`** (Yahoo fallback — indices, which Groww doesn't cover, or a Groww miss); the old `groww-in-stream`/`yahoo-in-stream` labels are retired (App.tsx `NSE⚡` chip + `useAppState` India-SSE-health regex updated to match).
  - `server/intraday/stream.js` (the `/api/intraday-stream` quotes the intraday signal cards + paper P&L actually run on): every quote tagged — stocks `groww-live`, indices `yahoo-delayed` (Groww's CASH/NIFTY endpoint serves a garbage index ltp — verified live 19425 vs 23398), crypto watch symbols `coindcx-inr`.
  - `src/utils/tvWebsocket.ts`: every browser TradingView-socket update tagged **`src: 'tv-ws'`**.
  - `src/utils/liveStream.ts`: the SSE wire `source` field now passes through into `PriceData.src` (was dropped); `PriceData` + `LiveQuote` gain the optional `src` field (zero breakage — absent = neutral LIVE pill).
- `LiveSourceBadge` (the v10.11 CoinDCX pill, reused verbatim for visual consistency) maps the three India labels: **Groww·live** (emerald) / **TV·WS** (sky) / **Yahoo·delayed** (amber).
- UI wiring: the intraday `SignalCard` renders the pill next to `● LIVE` (only when a live LTP exists — a snapshot price shows no provenance pill); `IndiaIntradayTab`'s board cards now get a live LTP overlay + pill from the existing intraday SSE stream (`liveLtp`/`liveSrc` — the aitrading SignalCard's v10.11 props, so the AI desk gets the same live-price treatment as the CoinDCX desk; the stream stays connected in every view mode since the signal board consumes it).

### #2: Faster retry / backoff on Groww failures
- NEW **`server/ai/growwQuote.js`** — the Groww fetcher lifted out of `index.js` (same pattern as v10.11's `finnhubQuote.js`): the 3s micro-cache + in-flight promise sharing is byte-identical (N consumers — /api/quote, intraday scanner, SSE watcher, inStream poller — still cost ONE round-trip/symbol), plus:
  - **Quick jittered retry** — ONE immediate retry after ~300–500ms INSIDE the same fetch cycle; a transient network blip recovers in the same cycle instead of costing a full 3s poll interval (all concurrent consumers ride the one retry — no extra upstream cost).
  - **Per-symbol fail-streak backoff** — after 2 consecutive fully-failed cycles (4 upstream misses ≈ 6s of REAL failure — a blip the retry absorbs never reaches 1), that ONE symbol is skipped for one poll cycle (~4.5s): honest null returns instantly with ZERO upstream traffic (callers fall back to Yahoo), the probe resumes after the hold, and one success anywhere resets the state completely. Steady state for a dead symbol = half-rate probing — never hammering, never frozen, and the shared cache budget stays healthy for symbols that ARE working.

### Tests (v10.12)
- NEW `test/growwQuote.test.ts` (12 — cache/normalization/never-throws + retry-same-cycle + backoff arm/instant-null/per-symbol/expiry/reset/half-rate steady state), `test/indiaLiveSource.test.tsx` (11 — per-path src tagging: intraday stream groww-live/yahoo-delayed/coindcx-inr, tvWebsocket `tv-ws`, badge mapping, SignalCard render gating). UPDATED `test/streamFeeds.test.ts` (canonical inStream labels).
- Suite: **90 files / 1620 tests ALL PASS** (was 88/1597); tsc clean; vite build clean; npm audit 0 vulns; boot smoke clean.

## v10.11 — COINDCX REALTIME PRICES: 5-PART RELIABILITY PLAN (2026-09-15)

**The user's diagnosis-based plan, implemented end-to-end** ("wiring is correct; the EQUITY SIM (USDC stock-perp) domain's upstream source is unreliable — guessed params + 60s blackout + slow Yahoo fallback").

### #1: Source-transparency badge (trust fix)
- Every liveFeed tick already carries a `source` label on the SSE wire; the frontend now SURFACES it: new `src/components/aitrading/LiveSourceBadge.tsx` renders an 8px provenance pill next to every live price — **CoinDCX·RT** (emerald, direct feed REST or WS), **Finnhub·RT** (sky, fallback #1), **Yahoo·delayed** (amber, final fallback), **Binance·RT** (sky, honest CoinDCX-dark fallback), **SIM·synthetic** (slate, SPACEX). Unknown source → neutral LIVE pill — never a blank, never a wrong guess.
- `useCxLivePrices.ts` passes `src` through (`CxLiveTick.src`); `SignalCard` (+ deep modal), `TopPicksPanel`, `ExpertPicksPanel` all render it (new `liveSrc` / `liveSrcFor` props, optional → zero breakage); CoinDcxTab wires all 4 call sites.

### #2: Negative-cache blackout shrunk (60s → jittered exponential backoff)
- `globalFutures.js` `fetchGlobalFuturesRt`: first failed probe round now blacks out **~10s** (was a flat 60s), repeated failures double it (**20s → 40s cap**) with ±0–2s jitter; **one success resets the streak**. A WAF blip heals in 10s instead of a full minute of degraded prices.

### #3: Finnhub fallback for EQUITY SIM (replaces Yahoo as primary fallback)
- NEW **`server/ai/finnhubQuote.js`** — the US desk's inline fetcher lifted into a SHARED module: one 3s micro-cache with in-flight promise sharing (a symbol one desk just fetched is free for the other) + **one 55/min sliding-window rate limiter** (free tier is 60/min; neither desk can starve the other). The 2026-audit staleness gate survives the lift (open-market stale quotes are rejected → Yahoo), so Finnhub-first can never serve a frozen price during US hours.
- `fetchGlobalQuotes` fallback chain is now **CoinDCX RT → Finnhub → Yahoo** (was RT → Yahoo), rows tagged `source: 'finnhub'` → the badge in #1 shows exactly which upstream served each price. `server/index.js` imports the shared module (byte-parity behavior for /api/quote).

### #4: Endpoint contract confirmed (docs.coindcx.com research)
- The `/market_data/v3/current_prices/futures/rt` endpoint is **documented with NO query params** (sample response = USDT pairs only) — USDC-scoping stays best-effort, so the 3-variant probe stays, but now **array-style FIRST** (`margin_currency_short_name[]=USDC` — CoinDCX's documented multi-value convention on the derivatives family: `active_instruments`), then scalar, then combined. Response row shape (`ls/pc/h/l/v/mp/ts`) confirmed → the parser is docs-accurate.

### #5: CoinDCX futures WEBSOCKET (event-driven, no 2s ceiling)
- Docs confirm a futures socket: `wss://stream.coindcx.com` — **Socket.IO v2 / Engine.IO 3**, per-instrument channels `B-<PAIR>@prices-futures`, event `price-change`, app-level ping every 25s, market data needs **no auth**.
- NEW **`server/ai/cxSocketIo.js`** — a hand-rolled EIO=3 framing client over the existing `ws` dependency (~60 lines, factory-injectable, zero new npm packages — keeps `npm audit` clean; the legacy `socket.io-client@2.4.0` has known advisories).
- `cxRtStream.js` gains the **WS accelerator**: subscribes the refcounted symbol set (`B-<BASE>_USDT@…` + `B-<SYM>_USDC@…`), lands every attributable `price-change` in liveFeed **immediately** (labels `coindcx-fut-ws` / `coindcx-glob-ws`), tolerant to every plausible payload shape (channel-attributed single ticks, inline fields, book-style `prices` maps — the docs' own sample for this event is empty). **Tolerant parse + auto-detect health**: only an ACTUALLY-LANDED tick counts as proof —
  - WS healthy (tick < 30s old) → REST poller slows to a **10s floor** (event-driven freshness + a guaranteed floor for illiquid perp channels that can go minutes without events);
  - WS down / unproven / silent → REST stays at the full **2s** (v10.10 behavior — a docs mismatch can NEVER freeze or slow prices);
  - ns-connected but zero attributable ticks for 2 min → **watchdog kills the socket + 10-min cooldown** (the docs payload is best-effort; the REST poller owns the desks);
  - out-of-order guard (a late WS frame never regresses a newer tick), handshake watchdog 8s, fail-streak circuit breaker (3 → 10 min cooldown), reconnect backoff 3s→24s, idle-close with the SSE client count, engine.io ping→pong auto-answer.
- SPOT deliberately untouched: the spot WS channel (`currentPrices@spot@10s`) is SLOWER than the existing CoinDCX 2s REST anchor + ~1s Binance WS accelerator.

### Tests (v10.11)
- NEW `test/finnhubQuote.test.ts` (7 — shared contract, cache sharing, budget guard, staleness gate), `test/globalFuturesFinnhubFallback.test.ts` (5 — RT→Finnhub→Yahoo chain, per-symbol honesty), `test/cxSocketIo.test.ts` (8 — EIO=3 framing, join/leave exactness, lifecycle honesty), `test/liveSourceBadge.test.tsx` (10 — badge mapping + render gating).
- Extended `test/globalFuturesRt.test.ts` (14 — array-first probe order, backoff growth/cap/reset) and `test/cxRtStream.test.ts` (18 — Finnhub/Yahoo labels + the full WS contract: immediate tick, cadence transitions, degrade path, silent watchdog, out-of-order guard, book-style fan-out).

### BONUS FIX (deep-recheck find — fired live TODAY): expiry-day option-card degeneracy
- The full-suite recheck caught `optionSignalCards` failing at HEAD (pre-existing, untouched by the plan): on the expiry-day MORNING (2026-09-15, the real NIFTY Tuesday weekly, ~15:20 IST) the OTM candidate's BS premium collapses to the ₹0.05 tick → `roundToTick` clamping served a degenerate **0.05/0.05/0.05 card (SL == entry == target)** — meaningless numbers next to a fresh consensus, the exact "wrong call" experience.
- `optionsDesk.js` fix: sub-**₹1 collapsed-premium candidates are DROPPED** (below ~₹1 the bid-ask spread IS the premium — no honest card exists for that strike) + belt-and-suspenders **tick-separation guards** (SL ≥ entry or target ≤ entry can never ship, on any path). +2 regression tests (hand-built collapsed row + the runtime-clock expiry-morning case).

## v10.10 — COINDCX DIRECT 2s RT OVERLAY (2026-09-15)

**The original bug**: the CoinDCX tab's three desks (SPOT / GLOBAL FUTURES / EQUITY SIM USDC) rendered `signal.ltp` — a board-snapshot price that could be ~2.5 minutes old next to a "fresh" signal → "wrong call / wrong signal" experience.

- NEW `server/ai/cxRtStream.js` — the 2s DIRECT-from-CoinDCX poller for the two domains the SSE stream never covered: `FUT_<BASE>` (USDT perps, CoinDCX RT + Binance perp fallback, honest labels) and `GLOB_<SYM>` (USDC equity perps, CoinDCX RT + Yahoo fallback + SPACEX synthetic walk). Refcounted subscriptions, 90s eviction grace, idle-stop, single-flight shared with the board compute.
- `/api/stream` accepts `fut=` + `glob=` params; `signals.js` board TTL 90s→60s with ≤2s-fresh plan pricing; `futures.js` single-flight.
- NEW `src/components/aitrading/useCxLivePrices.ts` — ONE EventSource for all three desks, 800ms batched flush render-storm guard, visibility pause; `SignalCard` live LTP with tick flash + ⚡ LIVE badge + drift-vs-entry chip; CoinDcxTab/TopPicks/ExpertPicks live overlays + the honesty chip.

## v10.9 — TELEGRAM BOT 8-UPGRADE PLAN (2026-09-15)

### Feat #1: ONE SOURCE OF TRUTH — dual-bot unification
- **The problem**: the legacy polling bot (`telegram-bot/bot.mjs`, own `analysis.mjs`/`market.mjs`/`algo.mjs` pipelines) and the site webhook bot (`server/telegram/webhook.js`, site agents) could answer the SAME question DIFFERENTLY — "bot says BUY, site says HOLD".
- NEW `telegram-bot/siteAgents.mjs` bridge: `/scan`, `/screener`, `/consensus`, `/regime`, `/smartmoney` ab the SAME site backend routes chalate hain jo website tabs + webhook use karte hain (`/api/ai/deep/:symbol`, `/api/ai/signals`, `/api/crypto-agent`, `/api/intraday-agent`) over the 127.0.0.1 loopback with the server-only `API_TOKEN`.
- **Never goes dark**: site unreachable → every command falls back to its legacy local path (bot stays alive, just local). The bot keeps its genuinely bot-specific value (Gemini Vision chart photos, FII/DII via Tavily — prepended with the SITE's regime read so interpretations can't drift).

### Feat #2: INSTANT TELEGRAM PUSH (SL/TP touches in seconds)
- NEW `server/ai/telegramPush.js` — a price-driven sink polling `getPositionsWithPnl` (the same cached view the realtime SSE stream serves) every **5s while positions are open**: SL / TP1 / TP2 / liquidation level TOUCH → instant push (level-touch early warning; the 60s watcher stays the executor and sends the fill-confirmed truth).
- Fresh **STRONG signals** scanned every ~30s through the SAME board cache + single-flight (underlying compute cadence unchanged).
- The routes.js 60s alerter is DEMOTED to backup — both paths share ONE dedupe map, whichever sees it first wins. The legacy bot's 10-min algo cron is now a **backup heartbeat**: it checks `GET /api/ai/insta-push/status` and only fires when the pipeline is stale/unreachable. Flag `AI_INSTANT_PUSH=off` reverts to watcher-only.

### Feat #3: WEEKLY TRADE-PERFORMANCE DIGEST
- NEW `server/ai/weeklyReview.js` + `POST /api/ai/weekly-review`: the **quant-computes-numbers, LLM-narrates** pattern — AI desk journal closes (rolling 7 IST days), trust.js calibration (claimed vs realized win-rate, Brier, drift), NSE intraday paper week → ONE LLM narration (Week Scorecard / Calibration Read / Best & Worst / Discipline Audit / Next Week Plan / GREEN-AMBER-RED verdict). Quant header is ALWAYS visible (LLM or not).
- Sunday **19:00 IST auto-push** (`AI_WEEKLY_REVIEW_PUSH=off` disables); on demand: webhook `/weeklyreview` + legacy bot `/weeklyreview` (via the bridge).

### Feat #4: CONTROLLED TELEGRAM ORDER APPROVAL (opt-in, security-sensitive — done LAST as planned)
- NEW `server/ai/tradeApproval.js` + webhook `/trade` + inline **Approve/Reject callback buttons** + **PIN second factor**.
- Security contract (all test-locked): default **OFF** (`AI_TELEGRAM_APPROVALS=on` arms); admin-only (viewer chats blocked); PIN mandatory (`AI_APPROVAL_PIN`, 4–12 digits, 3 tries then dead); **daily hard cap** (default 3 EXECUTED/day IST); 5-min TTL + 3-min PIN window; ONE pending request at a time; approval only triggers the **existing `executeSignal` gauntlet** (`source: 'telegram-approval'`) — fresh-signal re-verification, kill switch, risk caps, mandate freeze, one-per-pair ALL still apply. The button is a manual trigger, it **bypasses nothing**.
- `/trade BTC LONG 5000 x3 paper` grammar is strict — no chat text ever becomes an order on its own. `GET /api/telegram/approval/status` for transparency.

### Feat #5: VOICE NOTES
- Both bots listen now: `bot.on('voice')` (legacy) and webhook voice messages → download → **Groq Whisper large-v3** (Gemini inline-audio fallback) → transcript shown → routed to the SAME desk agent (crypto/intraday inference + session memory) a text question would hit. Legacy bot falls back to its own 7-engine chat if the site is down. NEW `server/ai/voiceNotes.js` (site-side, reads groqApiKey/geminiApiKey from the secrets store).

### Feat #6: MULTI-USER ROLES
- `TELEGRAM_ROLES="<chatid>:admin,<chatid>:viewer"` — the configured chat is ALWAYS admin; viewers get read-only access (desk agents, /status, /weeklyreview, voice notes) and are blocked from every approval surface (`/trade` + the buttons + the PIN window are chat-owner-checked). Strangers stay silently ignored. `/whoami` shows the role.

### Feat #7: CORRELATION-AWARE ALERT BUNDLING
- telegramPush.js STRONG scan: simultaneous crypto STRONG signals with 60d Pearson r ≥ 0.75 (the existing `pairCorrelation`, 15-min cache) go out as **ONE bundled message** ("2 correlated moves — ek hi trade hai, diversify ka dhyan") instead of N pings. Unknown correlation = SEPARATE alerts (never a fake 0). INDIA stays per-signal. `GET /api/ai/pair-correlation?a=&b=` exposes the same read.

### Feat #8: SIGNAL FRESHNESS DECAY (CoinDCX tab)
- The Intraday tab's 5-min stale concept applied to the ensemble boards: `FreshnessBadge` (LIVE green pulse <2min → amber "Xm old" 2–5min → red pulsing "STALE Xm" >5min) + the signal grid **opacity ramp** (100% → 80% → 50%). Grades the SIGNAL COMPUTE freshness honestly — prices on cards may still be SSE-live; the badge says which is which.

### Validation
- tsc CLEAN; vitest **81 files / 1504 tests ALL PASS × 2 consecutive runs** (baseline 1394 + 110 new across 7 test files: tradeApproval 29, telegramWebhook 32 incl. the end-to-end approval + voice flows, telegramPush 21, boardFreshness 11, weeklyReview 11, siteAgents 9, voiceNotes 8); node --check on every touched bot/server module; import-smoke all 7 new/extended modules clean; route registry PASS with the 4 new routes (/api/ai/insta-push/status, /api/ai/weekly-review + status, /api/ai/pair-correlation, /api/telegram/approval/status).

## v10.8 — NEAR-MISS AUTO-TRADE + 4 VE-TRADING PRO PORTS (2026-09-15)

### Feat: NEAR-MISS AUTO-TRADE (user spec: "Near Miss ke trade mat chhodo — highest AI score + high conf wale ko auto trade lagao")
- `agent.js`: jab poora bar (AI score / STRONG committee) koi clear na kare us scan-cycle me, sabse **highest AI-score near-miss** (gap ≤ `nearMissScoreGap` pt below the effective bar, confidence ≥ `nearMissMinConfidence`, 5+ voters quorum-honest, STRONG/ACTION grade, executable plan) **auto-entry** lagta hai — same execution gauntlet, same 3-tier exits.
- Quality guards: `nearMissMaxPerDay` (default 1/day) — journal `NEAR_MISS` markers budget ka audit trail hain; full qualifiers HAMESHA priority rakhte hain; correlation guard + one-per-pair + risk-cap near-miss par bhi apply hote hain; per-day budget khatam → honest skip with reason.
- Panel: Decision Quality strip me near-miss chip (gap/budget live), NEAR-MISSES ab "(auto-traded · best one)" labeled, aur "NEAR-MISS AUTO-ENTRIES TODAY" audit strip; Agent Rules editor me NEAR-MISS AUTO toggle + gap/conf/per-day sliders.

### Feat: WINNER EXTENSION ("trade ke hisaab se extension ho na chahiye")
- Time-exit par jo agent position **profit me** hai aur board par koi qualifying **opposite signal nahi** hai — uski window extend hoti hai (each +`winnerExtendPct`% of the dynamic ATR window, max `winnerExtendMax`× = default 2) aur **SL breakeven lock** ho jaata hai (journal `SL` entry, watcher turant armed). Losers original window par hi cut. Trend-flip hamesha extension ko beat karta hai. Board scan ab time-exit sweep se PEHLE ek hi pass me opposite-qualifying map banata hai (flip-exit + extension veto ek hi truth se padhte hain).
- Panel: win-extend chip + Agent Rules toggle.

### Feat: PRO #4 — BOUNDED-AUTONOMY MANDATE (Vibe-Trading port)
- `agentStart` risk-caps ko **frozen mandate** me capture karta hai (deep-frozen, session-immutable) + journal `MANDATE` audit entry (exact caps ka immutable record). Mid-session config loosening (zyada trades/risk/leverage…) clamp ho jaati hai frozen value par — agent sirf STRICTER hi ho sakta hai; user config file untouched rehti hai; STOP+START fresh freeze. `agentStatus.accuracy.mandate` + panel chip.

### Feat: PRO #1 — BULL/BEAR DEBATE COUNCIL (Vibe-Trading investment-committee port)
- AICouncil ab 3-step chain hai: **Bull Advocate** (strongest honest LONG case, grounded in the same indicator data) → **Bear Advocate** (strongest honest SHORT case) → **PM Verdict** (MUST cite where bull/bear disagree + why it sides one way; same verdicts shape as before).
- Resilience: koi bhi step fail → legacy single-shot prompt fallback (never offline because the debate hiccuped). Flag `AI_COUNCIL_DEBATE` (default ON). SentimentPulse parity preserved. `aiNote.debate` carries both cases on the signal card.

### Feat: PRO #3 — LIGHTWEIGHT CHAT MEMORY (Vibe-Trading memory port)
- NEW `server/ai/agentMemory.js`: per-desk (crypto/protrade) ring of 60 Q&A turns, symbols + topics auto-extracted (whitelist + pair shapes), last 8 + recurring-focus tally system-prompt me feed hote hain — "pichhli baar SOL pe short view tha" continuity. Durable-backed, best-effort everywhere. Wired into cryptoAgent + ProTrader (india chat).

### Feat: PRO #2 — NL CUSTOM STRATEGY LAB (Vibe-Trading strategy-discovery port)
- NEW `server/ai/strategyLab.js` + `POST /api/ai/strategy-lab` + chat tool `backtest_custom_strategy` + Backtest Lab UI block: plain-English idea → LLM compiles a **bounded whitelist rule-expression** (10 indicators × 4 operators × sane value ranges, max 4 entry + 3 exit conditions, ATR-stop 0.5–5, TP 0.5–5R, hold 6–168 bars) → validator rejects ANYTHING outside → walk-forward replay on the SAME candle history (no look-ahead, SL-first, 10bps slippage) → same R-multiple stats shape as the ensemble backtest. Rules jo chale wahi UI pe echo hote hain (full transparency).
- `backtest.js`: `fetchHistoryFor` + `statsFromTrades` shared exports.

### Validation
- tsc CLEAN; vitest **75 files / 1394 tests ALL PASS × 2 consecutive runs** (baseline 1322 + 72 new: nearMissAutoTrade 17, mandateFreeze 9, councilDebate 11, agentMemory 13, strategyLab 22); ml-service pytest 11/11; import-smoke all modules clean; functional smoke of every new pure core.

## v10.7 — COINDCX GLOBAL FUTURES APP-PARITY PRICING (USDC RT feed) + realtime positions fix (2026-09-14)

### Fix: Equity SIM prices never matched the CoinDCX app (AAPL 332.27 site vs 333.62 USDC app)
- **Root cause** (the user's live report): the Global Equity SIM desk priced every symbol from **Yahoo stock spot** (`regularMarketPrice`) — but CoinDCX's Global Futures are **USDC-margined perpetuals that trade 24/7**. Two consequences: (a) the number itself differed (perp premium/discount + delayed Yahoo print), and (b) outside US market hours the Yahoo spot is FROZEN while the perp keeps trading — positions LTP/P&L/SL/TP never moved during IST daytime
- New `fetchGlobalFuturesRt()` (`server/ai/globalFutures.js`) — prices this desk from **CoinDCX's own public derivatives RT feed** (`public.coindcx.com/market_data/v3/current_prices/futures/rt`, the same market_data family the crypto perp desk uses), scoped to the USDC margin domain:
  - the USDC-scoping param is probed in every plausible shape (scalar → array-style → combined-feed scan); a variant is accepted ONLY with ≥ 3 live `B-<EQUITY>_USDC` rows and becomes **sticky**
  - 5s cache (positions SSE stream polls at 1s), single-flight probe (board + stream + watcher share ONE round-trip), 60s negative cache, and a **6s probe-deadline race** so a hung/blocked upstream can never stall the board or the positions stream
- `fetchGlobalQuotes()` — RT first (source `coindcx-usdc`, the feed's own 24h change), **Yahoo fills ONLY the uncovered symbols** (fallback, honestly labeled), SPACEX stays the sim walk
- `buildGlobalCtxSync` / `getPositionsWithPnl` carry the true source (`coindcx-usdc` / `coindcx-gf-rt` / `yahoo` / `global-sim`); markets view exposes the CoinDCX pair (`B-AAPL_USDC`)
- **Realtime positions fixed**: `watchGlobalPositions` SL/TP/trailing and the SSE positions stream now tick on the live perp LTP (24/7 — US hours no longer a freeze window)
- Currency display parity: the GLOBALFUTURES desk labels **USDC** everywhere (ticket, plan strip, toasts, position rows) — exactly the unit the app shows; FUTURES stays USDT, INDIA stays ₹

### Fix: the "full universe scan" was discovering COMMODITIES, not stocks
- The USDT book lists XAU (gold) / XAG (silver) / NATGAS / INX / COPPER / ROBO / SLX / RAYSOL perps — they pass every crypto filter yet are NOT stocks; they crowded the discovered tail with names that have no Yahoo equity ticker
- `fetchGlobalFuturesInstruments()` (`server/mcp/coindcx.js`): explicit `COMMODITY_INDEX_BASES` exclusion + a **USDC instrument scan** (`margin_currency_short_name[]=USDC`, both param shapes, ≥ 3 rows validation) that finds the app's actual Global Futures stock list (AAPL/TSLA/NVDA/TSM/SKHX/SMSN/CRWV/HOOD…) and merges it with the USDT scan (deduped by symbol; rows carry `margin`)

### Tests
- NEW `test/globalFuturesRt.test.ts` (11): variant probing + stickiness, ≥ 3-row validation, negative-cache one-probe-per-minute, dark-row skip, RT-first quotes merge (the stale-Yahoo AAPL case), feed-down full fallback, ctx source honesty, markets-view dcxPair, single-flight, **hung-feed deadline**
- `test/globalInstruments.test.ts` +4 (USDC discovery + merge/dedup, < 3-row USDC ignored, commodity/index exclusion, USDC-only honest partial) → 7 tests
- `test/signalCardCurrency.test.tsx` updated to the USDC contract (GLOBALFUTURES renders USDC + ZERO ₹ / USDT; FUTURES renders USDT + never USDC)
- **1322/1322 tests passing (70 files), tsc clean** — zero regressions across the indiaAgent / ensemble / wick / depth / regime / kelly / positions-stream suites

## v10.4 — GLOBAL EQUITY FUTURES SIM DESK + futures-wallet GET transport + ultra-stream (2026-09-14)

### Fix: CoinDCX futures wallet `[404] not_found` — the route is GET-only
- **Root cause** (the live "futures USDT 3.01 dikhta hi nahi" bug): the derivatives wallets route is a **GET** endpoint — the old POST died with `[404] not_found` (Express routes by METHOD), so the futures margin tile showed 0 while the CoinDCX app showed balance
- New `coindcxPrivateGET()` in `server/mcp/coindcx.js` — query-param auth for the 2025 derivatives wallet routes (params in the query string, HMAC over the compact JSON of the same params, seconds timestamp; ms variant kept as fallback)
- `fetchFuturesWallets()` transport chain: **GET(s) → GET(ms) → legacy POST** — first transport that answers sticks for the process lifetime (no per-poll probing); wrapper tolerance unchanged (`[]` / `{wallets}` / `{data}` / `{balances}`)
- With the wallet live, the agent's futures-viability gate (`deployableFuturesUSDT ≥ 2`) works again — the "scan: 0 candidates (futures margin ke karan sirf spot scope)" state clears automatically when margin exists

### New: GLOBAL EQUITY FUTURES SIM desk (Apple/Google/NVIDIA/SpaceX…)
- New `server/ai/globalFutures.js` — CFD-style SIM futures on the world's biggest companies:
  - **AAPL, MSFT, GOOGL, AMZN, NVDA, TSLA, META** — REAL Yahoo Finance quotes (live) + REAL 1h candles (3mo, the same feed the crypto LTF layer uses)
  - **SPACEX** — private company, koi public price NAHI: a deterministic synthetic walk (seeded per-hour random walk, anchored near the tender-valuation per-share equivalent), clearly labeled **SIM** on every surface
- The SAME 10-model superintelligence committee votes on these — full plans (entry/SL/T1/T2/R:R), AI score, regime (NASDAQ-100 + USVIX)
- **Trading honesty**: CoinDCX par ye contracts listed NAHI hain — the desk is PAPER/NOTIFY only; a LIVE click is rejected with the honest reason (gate 0)
- Same gauntlet as every desk: kill switch → auto policy → fresh signal → leverage sanity → journal caps (daily cap / loss cap / one-per-pair / concentration)
- `watchGlobalPositions()` (60s) — SL / TP2 / trailing / partial-TP / liquidation sweep on the desk's own quotes
- Agent integration: `desks.global` (default ON) — the auto-agent scans + enters/exits the GLOBAL desk through the same time-exit / trend-flip / correlation-guard discipline
- Ask-AI (crypto desk agent): new `analyze_global_stock` tool + `market: "GLOBAL"` in the signals tool (9 tools now)
- Endpoints: `GET /api/ai/signals?market=GLOBALFUTURES`, `GET /api/ai/global/markets`, `POST /api/ai/global/execute`, `?market=GLOBALFUTURES` on deep
- Frontend: third desk tab 🌍 EQUITY SIM in the CoinDCX desk, position rows with the GLOBAL/SIM chip, ticket in the USD margin domain

### Upgrade: positions ultra stream
- Open positions now poll **every 5s** (was 10s) — live LTP + avg-buy-price + uPnL with the pulse dot (server-side quote caches keep it cheap); flat stays at 45s
- GLOBALFUTURES positions price from the desk feed (`yahoo` / `global-sim` sources, USD-domain P&L with INR twins)

### Fixes caught live (smoke-tested against the running server)
- `getPositionsWithPnl`: an open GLOBALFUTURES position hit "Assignment to constant variable" (the quote map was re-assigned over a `const`) — route 500'd; fixed + regression test pinned
- `/api/ai/global/execute` now passes `mode: 'live'` through to the gauntlet (gate 0 rejects honestly) instead of silently converting to paper

### Tests
- 28 new tests (wallet GET transport chain + wire contract, global desk gauntlet/watcher/close, board integration on the real model loop, agent desks.global config, positions pricing regression) → **1146/1146 passing**

## v6.8 — GLOBAL FUTURES + SUPERINTELLIGENCE AUTO-AGENT (2026-09-07)

### New: CoinDCX GLOBAL FUTURES desk (USDT-margined perpetuals)
- New `server/ai/futures.js` — the complete futures stack: RT prices (`market_data/v3/current_prices/futures/rt`), pcode=f candlesticks, instrument rules, DF wallets, positions, order create / **position-id** exit / **native exchange TP/SL** (`create_tpsl`), spot→futures margin auto-transfer
- **executeFuturesSignal()** — the SAME gauntlet ladder as spot, venue-switched: kill switch → auto policy → LIVE arming → fresh STRONG signal (venue FUTURES) → leverage sanity (liquidation OUTSIDE the SL) → wallet-margin sizing → journal caps (daily 3 / loss / one-per-pair / concentration)
- **watchFuturesPositions()** (60s loop) — SL/TP/trailing on RT prices, liquidation backstop, LIVE reconcile against the exchange's own position list (native TP/SL closes detected), USDT↔INR honest twins
- FUTURES signal board (10-model consensus, TV USD indicators ≈ USDT 1:1, plans in the exact quote currency), third desk tab, futures trade ticket (margin USDT, leverage, liquidation honesty)
- Currency honesty: futures P&L carries both USDT and INR (live USDINR, 10-min cache); the shared journal + daily caps stay INR

### New: SUPERINTELLIGENCE AUTO-AGENT (server-side, 60s loop)
- New `server/ai/agent.js` + `AgentPanel.tsx` — the autonomous prop-desk agent:
  - **Wallet-fetch**: live CoinDCX spot + futures margin balances (`/api/ai/wallet`); every trade sized from EQUITY (risk %/trade, SL-based; ≤60% of deployable margin)
  - **Auto Entry**: only ≥80% confidence + 75% agreement STRONG signals (stricter than the manual 75/70)
  - **Auto Exit**: watcher SL/TP/trailing + native exchange TP/SL + agent TIME-EXIT (default 90m)
  - **Exactly 3 trades/day** (user spec; agent-scoped, manual trades don't count) + daily loss-cap stand-down (−3% equity) + cooldown between entries
  - LIVE needs the full chain: typed LIVE in Risk settings + Auto-execution ON + typed LIVE at agent start + CoinDCX connected — no private path to money
  - Agent log (every scan decision), Telegram pings on entry/exit, India intraday picks + futures picks strip
- Endpoints: `GET /api/ai/agent`, `POST /api/ai/agent/start|stop|config`, `GET /api/ai/wallet`, `GET /api/ai/futures/markets`, `POST /api/ai/futures/execute`, `?market=FUTURES` on signals/deep

### Site
- OrderConsole: live wallet strip + futures position rows (USDT pricing, agent badge, exchange-reported liquidation)
- engine string → `SUPERINTELLIGENCE ENSEMBLE v6.8`

### Tests
- 43 new tests (futures gauntlet math/parsing/wallets/watcher + agent quota/sizing/loss-cap/time-exit) → **572/572 passing**



## v1.4.0 — SuperScore Backtester + AI Follow-ups (2026-07-20)

### New: SuperScore Backtester (site)
- New util `src/utils/superScoreBacktest.ts` — replays daily candles with the SHARED production SuperScore math (extracted into `computeSuperScoreFromIndicators`, single source of truth, zero formula duplication)
- Trade simulation: enter ≥65 BUY-LEAN, exit ≤40 or 20-day cap, next-open fills
- **Score-band accuracy validation**: ≥78 / 65–77 / 35–64 / <35 buckets with 10-day forward-return hit rates — verifies the production EXTREME thresholds against history
- NeuralChat local command: `/superscore RELIANCE` — deterministic, zero LLM cost, instant chat report with 📉 badge

### New: AI-Generated Follow-ups (NeuralChat)
- Follow-up chips first extract real '?' questions from the AI's own answer (most relevant next steps), falling back to deterministic heuristics

### Tests
- 13 new tests (SuperScore math bounds/direction/determinism + backtester arithmetic/bands/determinism) → **54/54 passing**

## v1.3.0 — SuperScore v6 + Smart Router v18 Deep Upgrade (2026-07-20)

### superintelligenceEngine v6 (Site AI core)
- ⚡ **SuperScore**: 5-factor composite directional score (1-99) per holding — RSI zone 35% + SMA20/50 divergence 25% + MACD 15% + day-range position 15% + anti-chasing momentum 10%. Injected into LLM prompt, inside-story, and Quant Brain top-pick ranking
- 💥 **Volume-breakout anomaly alerts** (big move + heavy tape = institutional footprint)
- ⚡ **SuperScore EXTREME-BUY/SELL** multi-factor alignment warnings (rarer & more reliable than RSI-only signals)

### Telegram Bot v18
- **Latency-aware Smart Router** (ai-chat): per-engine EWMA latency tracking; auto mode now prefers fastest healthy engine, cooldowns sink to bottom — measurable latency reduction in failover cascades
- `/super ai` — LLM-narrated super brief (deterministic numbers + LLM explanation + anti-hallucination check, 35s hard cap, graceful fallback)
- Inline keyboard on /super: 🔁 Refresh Brief + 🧠 AI Narrate buttons (callback_query wired)
- `/aitest` — SMART ROUTER telemetry table (per-engine latency EWMA, failure count, cooling state)

### Hang-proofing (bug fixes)
- `apiFetch` default 30s timeout — previously fetch calls without an explicit AbortSignal could hang forever and stall the UI
- `/api/config` + direct Telegram sendMessage now have 4s/8s caps (fast proxy fallback)

### Validation
- tsc clean ✅ · 41/41 tests ✅ · vite build ✅ · node --check all server+bot modules ✅

## v1.2.0 — Superintelligence v5.0 Upgrade (2026-07-20)

### NeuralChat v5.0 (Site AI)
- Persistent chat memory: conversation saved to localStorage (60 msgs cap, sanitized) — survives reloads
- Stop button: AbortController cancels in-flight engine cascade mid-generation
- Regenerate: one-tap retry of last answer with fresh live data
- Engine latency badge on every response (e.g. "groq • 2.1s")
- Smart follow-up chips after each response (context-aware heuristics)
- New "Super Brief" quick action (parity with Telegram /super)
- Version label unified (header/welcome/quant brain all v5.0 — fixed v3.0/v4.0 mismatch)

### Telegram Bot v17.0
- NEW /super — Superintelligence Brief (regime + portfolio pulse + top signals + warnings + opportunities + verdict, 100% deterministic — works without any LLM key)
- NEW /insights <SYMBOL> — portfolio-aware deep insight (your P&L + RSI + trend + AI verdict + conviction score)
- NEW /aitest — AI engine health dashboard (7 engines + Quant Brain status)
- Typing indicator (sendChatAction keepalive) on /ai, /chat, free-text chat
- Memory hygiene: aiCallTimestamps map pruning, algo-cooldown 24h sweep, ai-chat history capped at 20 chats
- Telegram menu commands updated (/super, /insights, /aitest)

### Site Infra
- Service worker cache bump wealth-ai-v2 → wealth-ai-v5 (PWA auto-refresh after deploy)
- Package version 1.1.0 → 1.2.0
- Baseline verified: 41/41 tests pass, tsc clean, vite build clean, node --check clean on all bot modules
# SmartAI1 — Bug Fix Changelog

## Round 1: Initial Deep Review (28+ bugs fixed in 17 files)

### CRITICAL (Security / Data Loss)
- **C1** `src/utils/riskAnalyzer.ts` — VIX operator-precedence bug
  - `(a || 15 + b || 15) / 2` evaluated as `a || (15+b) || 15` due to operator precedence. Risk alerts and regime classification were silently wrong.
  - Fixed: explicit `?? 15` fallback per VIX, then average.
- **C2/C3** `telegram-bot/bot.mjs` — 33 of 50 command handlers lacked `isAuthorized()` check
  - `/portfolio`, `/market`, `/risk`, `/scan`, `/backtest`, `/debug_env` etc were open to ANY Telegram user who could DM the bot, leaking full portfolio + P&L and triggering billable LLM API calls.
  - Fixed: inserted `if (!isAuthorized(msg)) return;` into all 33 handlers (skipping `/start` and `/help` which are intentionally public).
- **C7** `src/utils/secureStorage.ts` — Single global `migrationDone` flag broke multi-key migration
  - After the first key was migrated from legacy CryptoJS format, every subsequent key (TG_TOKEN, GROQ_KEY, etc.) silently returned `null` from `getItem()`.
  - Fixed: per-key migration Set + immediate mark-on-enqueue to prevent concurrent re-encrypt.
- **C8** `server/index.js` — SPA fallback served `index.html` for missing JS chunks
  - After redeploy, missing `/assets/vendor-charts-*.js` files returned HTML → "Failed to fetch dynamically imported module" → entire app died.
  - Fixed: return real 404 for asset paths (`/assets/`, `.js`, `.css`, etc.) so `lazyWithRetry` can trigger a clean reload.
- **C9/C10** `src/utils/api.ts` — Cloud sync used weak default token + `loadFromCloud` had no auth
  - `authToken = VITE_API_TOKEN || 'WEALTH_AI_SYNC'` shipped a known string in the bundle. `loadFromCloud` sent NO token at all. Anyone with the Apps Script URL could read/write the user's portfolio.
  - Fixed: refuse weak/default tokens; require `>=12` char secret on BOTH load and save paths.
- **C11** `server/index.js` — `/api/telegram` proxy accepted arbitrary `chatId`
  - Any visitor could POST `{message, chatId: <any>}` and make the bot spam arbitrary chats. No rate limit.
  - Fixed: ignore client-supplied chatId, always send to `TG_CHAT_ID`. Added per-IP rate limit (30 msgs / 10 min).
- **C4** `src/utils/riskEngine.ts` — `calculateCorrelationMatrix` returned random numbers
  - `Math.random() * 0.6 + 0.2` labeled as "correlation" — fake risk metrics presented to a financial audience.
  - Fixed: return zeros + `__simulated: true` flag so consumers know data is missing.
- **C5** `src/utils/smartMoney.ts` — FII/DII flows fabricated via `Math.random()`
  - ±500–1000 Cr random figures presented as real institutional flows.
  - Fixed: deterministic heuristic from VIX + index momentum; clearly labelled "(Estimated)" in description.
- **C6** `src/utils/backtestEngine.ts` — Backtests used `Math.random()` with biased drift
  - `(Math.random() - 0.48)` biased returns upward by ~+0.06%/day (inflating win-rate/Sharpe). Non-reproducible across runs.
  - Fixed: seeded deterministic PRNG (mulberry32) with zero-centered noise.

### HIGH (Broken Features / Wrong Behavior)
- **H1** `src/utils/macroRegime.ts` — `directionScore` didn't differentiate up vs down
  - Both +5% and -5% sector moves scored 100. Crashed sectors ranked as "high momentum".
  - Fixed: keep sign (`50 + s.change * 10`).
- **H2** `src/utils/portfolioMonitor.ts` — "Drawdown" was actually unrealized P&L%
  - A portfolio that's +20% then -5% off peak showed drawdown=0.
  - Fixed: relabel as "unrealized loss" with accurate description.
- **H3** `src/utils/riskEngine.ts` — `maxDrawdown` was identical to `currentDrawdown`
  - Both used today's intraday `high`. Documented as not tracked historically.
- **H4** `src/types/index.ts` — `pegRatio` is actually RSI/CAGR ratio, not P/E ÷ growth
  - Documented the misleading name; consumers should not treat as true PEG.
- **H5** `src/utils/tvWebsocket.ts` — Callback fired with empty price data
  - Guard `Object.keys(update).length > 1` was always true (time + market always set).
  - Fixed: explicit check for actual market data fields.
- **H6** `src/utils/wealthEngine.ts` — NaN propagation from invalid `dateAdded`
  - `new Date(badString)` → Invalid Date → `Math.max(1, NaN)` = NaN → XIRR bisection poisoned.
  - Fixed: `Number.isFinite(buyMs)` guard with fallback to 1 day.
- **H7** `src/utils/telegram.ts` — Division-by-zero in report generators
  - Positions with `avgPrice=0` (airdrop) caused `Infinity`/`NaN` rendered in Telegram.
  - Fixed: `cost > 0 ? ... : 0` guards.
- **H8** `src/utils/telegram.ts` — Currency symbol picked from `portfolio[0].market`
  - Mixed IN+US portfolio showed US totals with `₹` if first holding was US.
  - Fixed: always INR total for mixed-currency reports.
- **H9** `src/utils/api.ts` — Greedy regex JSON extraction
  - `\{[\s\S]*\}` over-captured trailing junk.
  - Fixed: try strict `JSON.parse` first, non-greedy fallback.
- **H10** `src/utils/api.ts` — `import` statement after runtime code
  - Worked due to ES module hoisting but fragile under future bundler strictness.
  - Fixed: moved import to top of file.
- **H11/H12** `ml-service/app/main.py` — CORS `*` + credentials; unbounded caches
  - `allow_origins=["*"], allow_credentials=True` is rejected by browsers. Caches (`{}`) grew forever.
  - Fixed: `allow_credentials=False`; OrderedDict LRU with max-size eviction.

### MEDIUM
- **M1** `src/utils/api.ts` — Fear/Greed defaulted to "Extreme Greed" when VIX unavailable
  - `(15+15)/2 = 15` → "EXTREME GREED" while no VIX was actually fetched.
  - Fixed: neutral 50 + "VIX unavailable" label.
- **M2** `src/utils/riskEngine.ts` — Division-by-zero in `calculateRebalance`
  - `totalInvestment=0`, `price=0`, `valINR=0` all caused Infinity.
  - Fixed: explicit `> 0` guards.
- **M5** `src/utils/tvWebsocket.ts` — Stuck-price detector false-positives
  - `isAnyMarketOpen()` (IN OR US) flagged US symbols as "stuck" during India hours.
  - Fixed: per-symbol market gating.
- **M10** `src/utils/constants.ts` + `api.ts` + `config.mjs` — `BEES` substring check
  - `sym.includes('BEES')` matched "BEESLY" etc. Changed to `endsWith('BEES')`.
- **M14** `src/utils/mlApi.ts` — Hardcoded `/api/ml` ignored `VITE_API_PROXY`
  - Cross-origin deployments 404'd. Fixed: respect `VITE_API_PROXY`.
- **M15** `src/components/tabs/PlannerTab.tsx` — `localStorage.setItem` unguarded
  - Throws in Safari private mode / quota-exceeded → effect crash.
  - Fixed: try/catch wrapper.
- **M16** `src/utils/telegram.ts` + `market.mjs` — Brittle `toLocaleString` date reparse
  - `new Date(now.toLocaleString('en-US', {timeZone}))` returned Invalid Date on non-English ICU builds.
  - Fixed: `Intl.DateTimeFormat.formatToParts` for robust weekday/hour/minute extraction.

---

## Round 2: Deep Bot + Python + Frontend Review (40+ additional bugs fixed in 30 files)

### CRITICAL (telegram-bot + ml-service)
- **CRIT** `telegram-bot/analysis.mjs:887` — ETF report division by zero when `totalInvested=0`.
- **CRIT** `telegram-bot/algo.mjs:140` — `key.split('_')` lost underscore-containing symbols (e.g. `IN_GIFT_NIFTY` → `GIFT`).
- **CRIT** `telegram-bot/market.mjs:222` — VIX snapshot corrupted on transient API failure → spike detection permanently disabled.
- **CRIT** `telegram-bot/ai-chat.mjs:299` — Quant Brain fallback NaN when `price=0` (R:R = 0/0).
- **CRIT** `telegram-bot/cloud.mjs:71` — `saveGroqKeyToCloud` accepted any string >10 chars as Groq key → user could brick AI chat with `/setkey groq junk`.
  - Fixed: require `gsk_` prefix + ≥20 chars.
- **CRIT** `telegram-bot/bot.mjs` — 5 cron handlers sent to `TG_CHAT_ID` without null check → silent throws when unset.
- **CRIT** `ml-service/app/main.py:210` — `/signals?market=US` returned ALL symbols (filter had `"US": None`).
- **CRIT** `ml-service/app/main.py:245` — `/train` crashed with `KeyError` when `fetch_all_symbols` returned empty.
- **CRIT** `ml-service/app/main.py:376` — `/regime` crashed with `ValueError` when `combined` was empty after `dropna()`.

### HIGH (telegram-bot + ml-service + frontend)
- **H5 (ml)** `ml-service/models/backtest.py:81` — Sell-prediction PnL was `-abs(fwd_return)` → correct shorts always lost money.
  - Fixed: `-fwd_return` (correct short profits when asset falls).
- **H6 (fe)** `src/components/MLSignalPanel.tsx` — Stale `price`/`change` closure made ML signal stale for entire session on a symbol.
  - Fixed: include price/change in deps + refetch on >1% price move.
- **H7 (fe)** `src/components/AIScreenerPanel.tsx` — False "Sent to Telegram!" success even when send failed.
  - Fixed: check boolean return + surface actual result.
- **H8 (ml)** `ml-service/app/main.py:147` — `top_features` always empty (used wrong sklearn attribute `estimators` instead of `calibrated_classifiers_`).
- **H9 (ml)** `ml-service/app/main.py:435` — `/analyze` ignored user query (passed only `brain_result` to prompt builder).
- **H10 (infra)** `nginx.conf` — Proxy target `node-server:8080` didn't exist (no such service in docker-compose).
  - Fixed: added `node-server` service to `docker-compose.yml`.
- **H11 (ml)** `ml-service/app/main.py:329,357` — `str.contains(symbol)` substring match (BTC matched BTCUSD, BTCUSDT, ABTC).
  - Fixed: exact case-insensitive match.
- **H12 (fe)** `src/components/DipIntelligence.tsx:194` — `onBuy(symbol, 0)` passed zero amount.
  - Fixed: pass `entryTarget` as default price.
- **H13 (ml)** `ml-service/app/llm_router.py:257` — Anti-hallucination guard was a no-op (always returned text).
  - Fixed: return `None` when >3 suspicious numbers detected; main.py falls back to `brain_to_text`.
- **H14 (ml)** `ml-service/app/main.py:193` — NaN RSI/volume leaked into JSON response → browser JSON.parse fails.
  - Fixed: `_safe_num()` coerces NaN/inf to defaults.
- **H15 (tb)** `telegram-bot/ai-chat.mjs:474` — Race condition in chat history (concurrent /ai calls interleaved).
  - Fixed: per-chat mutex via promise chaining.
- **H16 (tb)** `telegram-bot/bot.mjs:110` — Synchronous `fs.writeFileSync` in cron handler blocked event loop.
  - Fixed: `fs.promises.writeFile`.
- **H17 (tb)** `telegram-bot/market.mjs:12` — `toLocaleString` date reparse fragile.
  - Fixed: `Intl.DateTimeFormat.formatToParts` (mirror of M16 fix in frontend).
- **H18 (ml-server)** `server/mlEngine.js:83` — MACD signal line mathematically wrong (`macd * 2/10` instead of 9-period EMA of MACD series).
  - Fixed: full MACD series computation + 9-period EMA.
- **H19 (ml-server)** `server/mlEngine.js:252` — Sharpe annualization assumed daily returns but loop stepped by 20 days.
  - Fixed: `sqrt(252/20)`.
- **H20 (ml-server)** `server/mlEngine.js:253` — Profit factor used win/loss COUNTS not amounts.
  - Fixed: `grossProfit / grossLoss` (standard definition).
- **H21 (apps-script)** `server/apps-script/Code.gs:71` — Auth check only triggered if `authToken` was present → POST with no field bypassed entirely.
  - Fixed: REQUIRE token match; refuse weak default `WEALTH_AI_SYNC`.

### MEDIUM (round 2)
- **M19** `telegram-bot/analysis.mjs:153` — Division by zero when `change === -100`.
- **M20** `telegram-bot/market.mjs:532` — Hardcoded IPO year "2026" → `new Date().getFullYear()`.
- **M21** `src/components/NeuralChat.tsx:424` — Voice transcript segments concatenated without separator ("helloworld").
- **M22** `src/components/NewsSentimentFeed.tsx:69` — Greedy JSON regex over-captured. Fixed: balanced-brace scanner + markdown-fence stripping.
- **M23** `src/components/LiveCandleChart.tsx` — Theme/height change rebuilt chart but data effect didn't re-run → empty chart until symbol change.
  - Fixed: `chartVersion` state increments on rebuild; data effect depends on it.
- **M25** `telegram-bot/ai-chat.mjs:258` — HuggingFace prompt flattened multi-turn history.
  - Fixed: per-turn `User:`/`Assistant:` formatting.
- **M27** `ml-service/pipeline/fetch_data.py:132` — CLI crashed on empty data with `KeyError`.

### LOW (round 2)
- **L6** `src/components/NeuralChat.tsx:506` — `key={msg.timestamp}` collision risk on rapid messages.
- **L31** `ml-service/models/train_target.py:72` — `coverage` computed but never returned.
- **L33** `server/mlEngine.js:256` — `total_periods` overcounted (`floor(length/periods)` vs actual loop count).
- **L36** `src/components/WhatIfSIPOptimizer.tsx:82` — `Math.max(...[])` returns `-Infinity`.
- **L37** `src/components/tabs/PlannerTab.tsx:508` — SIP FV formula div by 0 when rate=0.
- **L38** `src/components/MacroRegimePanel.tsx:32` + `SmartMoneyPanel.tsx:37` — Undefined className if regime/signal not in map. Fixed: `?? NEUTRAL` fallback.
- **L39** `src/components/NeuralChat.tsx:6` — Failed `/api/ai-status` cached for 30s. Fixed: reset cache on failure.
- **L41** `src/components/tabs/PortfolioTab.tsx:38` — `setTimeout` without cleanup. Fixed: timer ref + unmount clear.
- **L42** `src/components/CorrelationHeatmap.tsx:37` — Correlation could go negative. Fixed: clamp `[0,1]`.
- **L44** `docker-compose.yml` — `version: '3.9'` deprecated. Removed.

---

## Files Modified (44 total)

### Frontend (TypeScript/React) — 18 files
- src/types/index.ts
- src/utils/api.ts
- src/utils/backtestEngine.ts
- src/utils/constants.ts
- src/utils/macroRegime.ts
- src/utils/mlApi.ts
- src/utils/portfolioMonitor.ts
- src/utils/riskAnalyzer.ts
- src/utils/riskEngine.ts
- src/utils/secureStorage.ts
- src/utils/smartMoney.ts
- src/utils/telegram.ts
- src/utils/tvWebsocket.ts
- src/utils/wealthEngine.ts
- src/components/CorrelationHeatmap.tsx
- src/components/DipIntelligence.tsx
- src/components/LiveCandleChart.tsx
- src/components/MacroRegimePanel.tsx
- src/components/MLSignalPanel.tsx
- src/components/NeuralChat.tsx
- src/components/NewsSentimentFeed.tsx
- src/components/ScreenerPanel.tsx
- src/components/SmartMoneyPanel.tsx
- src/components/WhatIfSIPOptimizer.tsx
- src/components/AIScreenerPanel.tsx
- src/components/tabs/PlannerTab.tsx
- src/components/tabs/PortfolioTab.tsx

### Backend (Node.js) — 6 files
- server/index.js
- server/mlEngine.js

### Telegram Bot (Node.js) — 8 files
- telegram-bot/ai-chat.mjs
- telegram-bot/algo.mjs
- telegram-bot/analysis.mjs
- telegram-bot/bot.mjs
- telegram-bot/cloud.mjs
- telegram-bot/config.mjs
- telegram-bot/market.mjs

### Python ML Service — 5 files
- ml-service/app/main.py
- ml-service/app/llm_router.py
- ml-service/models/backtest.py
- ml-service/models/train_target.py
- ml-service/pipeline/fetch_data.py

### Infrastructure — 3 files
- server/apps-script/Code.gs
- docker-compose.yml
- .env.example

## Verification
- TypeScript: clean compile ✓
- Tests: 41/41 passing ✓
- Production build: ✓ (4.42s)
- All Node.js files: syntax OK ✓
- All Python files: syntax OK ✓
