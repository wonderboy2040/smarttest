# SmartAI Pro v21 — Three-Desk AI Trading Terminal

> **v21.13.0 — MOMENTUM CAPTURE ENGINE v2 (the "100 me 90 opposite" fix — LIVE-PROVEN root cause)**
> - **ROOT CAUSE (live-proven 2026-10-14, dono scanners pe probe kiya):** signals INVERTED nahi the — wo **DAILY-RESOLUTION + LATE** the. RELIANCE: daily RSI 41.8 (SHORT sweet-zone!) while the **15m RSI 83 (powerful rally)** — the intraday engine "kal ka trend" pe vote karta tha aaj ki tape ke against. Daily SMA50 1263 (bearish) vs **SMA50|60 1181 (1h — bullish)**. Crypto board: repo ka apna measured 29%-win-rate lag disease. Yahi the 90%-opposite class.
> - **FIX 1 (engine |15 columns, positional-parse preserved):** `TV_INTRADAY_COLUMNS` ab 15-minute resolution pe — `EMA10|15, EMA20|15, SMA20|15, RSI|15, MACD.macd|15, MACD.signal|15, ATR|15, ADX|15, ADX±DI|15` + **`SMA50|60` (1-HOUR — asli HTF confluence, daily-vs-daily nahi)** + `Recommend.All|15`; daily/session pe rehte hain: OHLC/change (day-range/gap), VWAP (session anchor), monthly pivots (Pivot.B.Classic.* TV pe null — live-probed), relVolume (session pace). **Risk geometry ab 15m-scaled** — SL 1.1×ATR(15m), T1 1.6R — intraday-reachable (pehle: daily ATR 22.5 → SL 2.1%, T1 3.3% = 15:10 sq-off tak kabhi nahi). LIVE SMOKE (NSE hours): TCS/INFY RSI(15m) 60.7/67.6, ATR(15m) 11.3 vs daily 69.5 — **stops 6× tighter, T1 sach me reach hota hai**
> - **FIX 2 (engine chase gate — board parity):** `entryTimingRead` ab intraday engine me bhi (PURA module, zero deps): HARD chase (≥2.5×ATR / RSI 64+36 assist / vertical leg) → conf cap 48 → routes pool floor (70) chase setup ko drop karta hi hai; SOFT ≥1.8×ATR → −7; EXTENDED → −4; PULLBACK band payload-flag (engine pe boost INTENTIONALLY nahi — suppression-only, deterministic penalties)
> - **FIX 3 (India board 1H COMMITTEE REVIVAL):** `buildIndiaStockCtx` ab Yahoo 15m series (1mo, 2-min TTL — pass-2 wahi series) carry karta hai; committee **1H view** vote karti hai (15m → 1h resample, crypto desks ka exact mirror — 1h swing + 15m tape w1.6 entry-timing + MTF-6 veto + daily HTF veto + regime), `ctx.candles` = 1h, `__ltfInd` = 15m (expert ka LTF), **`ctx.__dailyInd` = daily TV view** (qualityVerdict ka htf — MISALIGNED daily-vs-15m counter-tape wiring). Thin history (<30 1h bars) → honest daily fallback; Yahoo down → pehle jaisa daily view
> - **FIX 4 (momentum bugs):** `tvToInd` histSlope ab honest-null (pehle hist LEVEL ko slope alias karta tha — "MACD turning" branches fake the); `momentumQuant` null-slope-robust (hist-sign 0.8 reduced weight, honest label); **regime-aware contrarian tails** — RSI>75 + ADX≥25 (strong trend) → continuation ±0.4 (NEVER fade a trending extreme — "momentum capture" fix), ADX<25 → classic exhaustion fade ±0.9; ADX shape normalize (object|number dono)
> - **FIX 5 (expert side-aware grading):** `expertScoreFactors` ab `side` param leta hai — committee consensus ke side KE LIYE grade hota hai (pehle side-blind recompute OPPOSITE-side quality ko committee card ke aiScore me blend karta tha — conflict coins top pe rank hote the). `lean` + `leanConflict` + `gradedFor` payload me surfaced; board/deep teeno call sites consensus side pass karte hain
> - **FIX 6 (paper FLIP REALIGN):** stale-clicked card + fresh FLIPPED consensus → practice trade ab FRESH side pe khulta hai (pehle: 60s-cached LONG card, fresh SHORT consensus, trade LONG → SL → "engine opposite hai" amplifier). LIVE ka strict no-auto-flip veto UNTOUCHED (kabhi silent flip nahi)
> - **FIX 7 (flip-cooldown retune):** 5min/10min → **2min/5min** — purana card reversal ke 6min tak purani side dikhata tha; whipsaw protection intact (tape-MTF + strict agreement guard karte hain)
> - **FIX 8 (SESSION-VWAP anchor):** India chase guard ab TV row ka SESSION VWAP use karta hai (`ctx.__tv.vwap`) — pehle month-anchored candle VWAP padhta tha → trending days pe extension massively overstated → session-mean pe GOOD entries suppress hoti thi (fixture: real −0.39 vs guard ka −4.32 "HARD chase"!)
> - **FIX 9 (evaluation parity):** trackRecord SL ab TRADED price pe fill (paperTrading [H3] gap-through parity — trigger level nahi); MAX_WATCH_NSE 34 → 56 (MAX_PER_DAY 80 ke against mismatch); expertMode ML_SERVICE_URL default 8000 → **8100** (8000 Laya ka port hai — v21.11 ka missed spot); boardAccountability label ab LIVE committee counts se dynamic; engine change-fallback nullish (legit 0.00% TV value pe fall nahi)
> - **FIX 10 (META roster sync):** `META_MODEL_IDS` 14 → **16 live voting ids** (structure/macross/tape-mtf pehle silently zero-filled the); stale pkl cols-mismatch pe graceful weighted fallback + retrain scheduler self-heal (meta agree-only hai — side kabhi flip nahi hota)
> - **Tests:** +24 naye (`v2113MomentumCapture` — |15 column contract, chase gate, 15m risk geometry, regime-aware tails, side-aware expert, flip windows, SL gap-through, META roster, misc) + 5 legacy pin updates (realign semantics, 2-5m soft window, traded-price SL fills) — **3845/3845 PASS · 205 files** · tsc 0 errors · eslint 0 errors (1 pre-existing warning) · build+stamp 21.13.0 · check:routes ✓ · check:version ✓ · **LIVE E2E boot PASS** (16+4 committee, META ARMED @8100, v=21.13.0==pkg) · **LIVE NSE-hours engine smoke** (|15 values real pipeline se)

> **v21.6.0 — ULTRAFAST REALTIME MARKET FEEDS (India + CoinDCX + Binance + USA)**
> - **RESEARCH FINDING (live-probed 2026-10-12):** Groww ka KOI public websocket NAHI hai — `groww.in/socket.io` 404, `api.groww.in/v1/stream` 404, official Trading API docs (groww.in/trade-api/docs/curl/live-data) REST-only hain (quote/ltp/ohlc/option-chain). Groww ka apna web app bhi wahi public REST endpoint poll karta hai jo hum use karte hain. TradingView ka guest websocket (`unauthorized_user_id`) ab bhi locked hai (protocol_error). Isliye sabse FAST direct-Groww path = **official Trading API ka batched LTP endpoint**: 1 call = 50 symbols, 1s freshness, limits 10 req/s + 300/min.
> - **TIER-1 (NAYA `server/ai/growwApi.js`): OFFICIAL Groww Trading-API** — env `GROWW_API_KEY` + `GROWW_API_SECRET` (Groww → Profile → Settings → Trading APIs). Token auto-lifecycle: SHA256(secret+epoch) checksum → `/v1/token/api/access` → Bearer JWT, ~05:00 IST auto-refresh (06:00 expiry se pehle), 401 pe ek refresh+retry. Batched `/v1/live-data/ltp` (≤50/call, 1s micro-cache, in-flight dedupe) + `/v1/live-data/quote` (30s, h/l/vol/prevClose/circuits — loose `{open:…}` ohlc-string parser ke saath). 3-fail → 5-min breaker (public tier unaffected). Badge: **Groww·API** (emerald). Keys na hon → tier-2 seamlessly.
> - **TIER-2 (public Groww CDN):** micro-cache **3s → 1.5s** — live rate-test ne 20 req/s sustained (73ms avg latency, 0 failures) validate kiya; in-flight sharing unchanged (N consumers = 1 round-trip)
> - **inStream SSE poll: 3s → 1s** — India pushes ab 1Hz (US TV-batch + crypto spot-WS ke barabar cadence). Tier ladder per symbol: API LTP (1s) → public quote (1.5s) → Yahoo (indices)
> - **Intraday watcher: 5s → 3s** — outcome evaluation (T1/T2/SL/trail/EOD) ab 3s me react karta hai; quotes shared caches pe ride karti hain (upstream ~free)
> - **COINDCX + BINANCE (verify-live):** official spot-WS (`stream-spot.coindcx.com`, `currentPrices@spot@1s`) LIVE verify — connect 408ms, **730 markets streaming**, BTC 8,166,703.5 INR; Binance WS 173ms, 3 msgs/s, first ticker +0.7s. Chain (REST anchor → spot-WS book → Binance×fx synth → deep-stale) 62/62 tests green
> - **USA:** TV america/scan batch LIVE verify (AAPL 339.83, NVDA -1.54% real-time) + Yahoo bootstrap. **FREE Finnhub key** (`finnhub.com` → free signup → `FINNHUB_API_KEY`) instant US trade-WS unlock karta hai — `.env.example` documented
> - **SITE-LOAD SPEED (live-measured):** SSE snapshot **+8ms** saare 9 keys ke saath (India+US+crypto) — crypto ticks instant (spot-WS direct push), US first live tick +3.2s (TV batch), India NSE hours me 1s loop
> - **PRE-EXISTING BREAKAGE FIX (origin cleanup 66e833a se):** `npm run check` TOOTA tha — deleted scripts jo package.json + supervisor.js + 4 test files refer karte the. Restore: `backup-state.mjs` (supervisor BACKUP_STATE_ON_BOOT runtime-dep!), `botlab-calibrate.mjs`, `check-version.mjs`, `check-api-routes.mjs`, `stamp-dist.mjs`; `start-laya.cmd` LF → CRLF (Windows .cmd CRLF-strict); package.json dead entries cleaned
> - **SIGNAL VERIFICATION (live + deterministic):** crypto scan 5 signals — direction-vs-momentum **5/5 consistent** (SHORT ⇒ RSI<50 + below-VWAP); India scan (debug) 5/5; **10 paper trades live** (4 engine-strong SHORT conf 98-100 + 3 manual LONG + 2 manual SHORT + 1 tight-T1) — watcher 3s cadence pe live prices se evaluate, **P&L signs exact** (SHORT +0.01/+0.03 jab price gira, LONG −8.04/−3.90/−1.26/−0.07/−0.02 jab gira, qty-math paisa-exact), manual closes + history aggregation exact; **12 deterministic outcome tests** — LONG/SHORT T1 partial (+50), T2 full (+150), SL gap-through worst-side fill (−100), BE-trail (+50 no-loss), qty=1 BE-protect, crypto 0.5 fractional split — sab pass
> - **Tests:** +13 naye (`growwApi.test.ts` — checksum/token flow, 401 self-heal, 50-sym chunking, 1s cache, breaker) + 4 pre-existing files repaired — **3698/3698 PASS** · tsc ✓ · eslint 0/0 · build+stamp 21.6.0 · check:routes ✓ · check:version ✓

> **v21.5.0 — LAYA FAST UPGRADE (local model speed + burst-storm fix)**
> - **PROBLEM (line-by-line review me mila):** board-confirm bursts (top-6 signals × 2 providers) local Laya server (CPU, single inference worker) par ek saath queue hote the — har request ka `AbortSignal.timeout(1500)` SEND-time se start hota tha, isliye queue ke aakhri requests healthy server pe bhi timeout → 4 consecutive fail → **breaker 10 min ke liye OPEN** (poora Laya layer down). Plus timeout pe retry line AUR lambi karta tha (queue amplification).
> - **FIX-1 FIFO CONCURRENCY GATE (`jevEngine.createJev`):** `LAYA_CONCURRENCY=2` (default) — sirf 2 wire calls ek saath, baaki FIFO queue me; **har request ko queue ke BAAD apna pura timeout budget milta hai**. Cache-hits bypass. `stats().queueWaits` telemetry. Jev (cloud) unlimited (purana behaviour).
> - **FIX-2 TIMEOUT ≠ RETRY (local):** `LAYA_RETRY_ON_TIMEOUT` default OFF for Laya — timeout honest `timeout` note ke saath turant fail; auto-arm failover (`deciders._FAILOVER_NOTES` + 'timeout') turant Jev pe. Jev cloud ka purana retry-on-timeout unchanged.
> - **FIX-3 BOOT WARMUP (`layaSidecar`):** ready/adopted hone par EK real inference (10-min rate-limit) — model compile/lazy-init ka cold-start penalty boot me hi absorbed; pehla board-confirm fast. `LAYA_WARMUP=0` off.
> - **FIX-4 SWRV memo (`boardAiConfirm`):** 5-min memo expire hone par bhi purana verdict TURANT stamp (0-latency confirm) + background refresh next cycle ke liye — stale cap 2×TTL (10 min). `AI_CONFIRM_SWRV=0` kill-switch. Return meta me `stale` count.
> - **GPU AUTO-DETECT:** `LAYA_DEVICE=auto` → `nvidia-smi` probe (3s bound) — GPU mila to `cuda` (~10-50× inference), warna `cpu`. Default `cpu` (zero change), detection spawn se PEHLE (final device env me jaata hai).
> - **FIX-5 (pre-existing):** `start-laya.cmd` ka CRLF remote push me LF ho gaya tha (Windows .cmd CRLF-strict) — restored + test locked (pehle se tha, ye fix usse bachaata hai).
> - **Tests:** +19 naye (`layaFast.test.ts` — FIFO gate, timeout-retry policy, SWRV truth-tables, warmup+GPU probe) — hermetic fake-fetch (abort-signal aware)

> **v21.4.1 — TRADING-SIGNALS DEEP-RECHECK: 12+ confirmed bugs fix (4 parallel line-by-line audit agents + live probes)**
> - **[A1] CHOP FILTER ka ADX<15 leg DEAD tha (v21.3.0 se):** `ctx.ind.adx` har desk pe OBJECT (`{adx, plusDI, minusDI}`) hota hai — purana read `parseFloat(String(object))` → NaN → null. `readAdxNum()` normalizer ab board + deep + expert picks teeno pe. LIVE verify: fixture-ADX 9.6 → chop fire (pehle kabhi nahi)
> - **[A5] DEEP-PATH HARD VETO port:** counter-HTF veto sirf BOARD pe tha — deep path (LIVE exec ka signal source: `getFreshSignalForExec` → `getDeepSignal`) pe sirf conf ladder thi. Ek board-vetoed signal deep re-run pe STRONG 85 ban ke execute gauntlet pass kar sakta tha — exactly the "SAB SL hit" class. LIVE verify: BTC deep pe `veto: counter-htf + chopRange` + aiScore 17 + executable=false
> - **[B2] EXPERT PICKS blanket −25:** qualityVerdict ka single-voter quorum penalty (−25 + WATCH cap) HAR expert pick ko mil rahi thi (envelope 1 synthetic vote pass karta hai) — 80+ STRONG bar unreachable, panel hamesha 65+ fallback. `quorumExempt` ab 8-factor composite envelope ke liye (regime/extension/counter-tape ladders unchanged)
> - **[B1] Expert-picks ADX trend leg + chop cap dead (same object bug)** — ±18/±10/−10 trend adjustment aur cap-78 ab sach me fire karte hain; ≈ CHOP chip render hota hai; **[B6]** AI-confirm +2 bump chop-capped pick ko 80+ se paar nahi le ja sakta
> - **[B4] CRYPTO × FUTURES cross-desk track collision:** same base (BTC) dono desks pe track hota hai par dedup symbol+dayKey tha — (a) futures rows "refresh" me swallow (zero outcome feedback), (b) opposite direction pe INR row USDT price pe FLIP-close (domain-mix fake PnL). Ab market-scoped dedup/flip/id + stream me market-qualified quote keys (`FUTURES|BTC`) + collision-repair leg
> - **[B5] Sub-cent fake full-loss ban:** trackRecord `toFixed(2)` se SHIB/PEPE/BONK exits 0.00 → full-qty loss (−₹16,600 on ₹600-risk trade). `_pxRound` (4-sig-digit sub-1) — LIVE data me 5/11 rows affected the
> - **[A2] Board final aggregation revived-vote rediscount** (tape seat full-weight escape fix — deep parity); **[A4]** deep ctx null-guards (500-crash ban); executable=false on UCV/AI-conflict demotes; **[C5]** tracked-crypto watch cap 14→40
> - **[C2] USDC candle cache stale-prune (90s+)** — WAF block me minutes-purani prices fresh Finnhub se pehle serve hoti thi; **[C4]** Yahoo frozen-close + watcher legs ab honest upstream ts; **[C3]** futures precheck live-mode parity + Leverage-sanity blocking gate (modal ab wahi dikhta hai jo order karega)
> - **[D] UI honesty:** ⛔ HTF VETO / ≈ CHOP / 🔒 SL FLOORED chips board cards pe (pehle WATCH demotion bina explanation dikhta tha); per-desk board-error state (ek desk fail → sirf wahi section honest unreachable panel, silent hole nahi); precheck-unavailable honest error
> - **Tests:** +32 naye (v214DeepRecheck 26 + v214StreamQuotes 6) + 3 contract updates — **3666/3666 PASS** · tsc ✓ · eslint 0/0 · build+stamp 21.4.1 · check:routes ✓ · check:version ✓

> **v21.4.0 — LAYA SIDECAR (Watchdog ke saath Laya auto-boot — `Start-SmartAI-Watchdog.bat` ab site + Laya dono boot karta hai)**
> - **`layaSidecar.js` (NAYA ~590 lines):** supervisor-managed Laya — ADOPT-first (pehle se chal raha laya-serve ko double nahi karta) → spawn → ready-poll (pehli baar 15 min weights) → hang-detect (3 fail = tree-kill + restart) → crash backoff 5s→60s → 10/hour budget → clean shutdown; API key har relay line me masked; non-loopback `LAYA_BASE_URL` pe autostart REFUSED (security); site kabhi Laya ka wait nahi karti
> - **`start-laya.cmd` (manual/bat fallback):** key `app\.env` se findstr; `Start-SmartAI-Watchdog.bat` me health-check + start block (CRLF-strict)
> - Env knobs: `LAYA_AUTOSTART/HOME/SERVE_CMD/THREADS/READY_TIMEOUT_MS/PROBE_MS/BACKOFF/BUDGET` — rollback `LAYA_AUTOSTART=0`
> - Tests: +29 naye (layaSidecar lifecycle truth-tables) — 3634/3634 PASS

> **v21.3.0 — 7-ISSUE FIX BATCH: server stability + Signal Board accuracy + Laya/Jev board confirm + 1-click LIVE pre-flight + Equity USDC 24/7 prices**
> - **Issue-1 (server down):** constrained-platform auto-profile — Render/Railway/cgroup <1.5GB detection par selfHeal memory limits 420/330MB + exit-on-fatal ON (pehle 1400/1100 laptop defaults dyno ko OOM-kill loop me daalte the); `app.listen` EADDRINUSE ab honest exit (zombie fix); BOOT-REFUSED.txt marker (watchdog crash-loop self-diagnosis); **asyncGuard** — Express-4 async-rejection guard (hung sockets → honest 500s); Dockerfile `--max-old-space-size=384`; warm-up constrained dyno pe default-off. **Render 24x7 ke liye ek FREE external uptime monitor (UptimeRobot → /api/ping har 5 min) ZAROORI hai** — free tier 15 min idle baad sleep karta hai (code se fix nahi hota)
> - **Issue-3 (wrong directions / sab SL hit):** **HARD HTF VETO** — 1d/4h directly against signal → grade WATCH + aiScore cap 62 (pehle sirf −7/−10 conf haircut; 90% conviction wala counter-trend phir bhi ACTION card tha); **CHOP FILTER** — 6-TF SPLIT phase ya ADX<15 → WATCH cap (range me 2R targets unreachable); **sub-noise stop floor** — structure stop ab minimum 0.6×ATR (0.2-0.3×ATR swing stops paper-fill noise me hi mar jaate the); **15m tape enrichment full-board** (pehle top-20 — baaki cards pure 1h-lagging committee pe; 40 candidates tak, AI_TAPE_ENRICH_N env); **FUTURES/GLOBALFUTURES board accountability** — USDT/USDC quote routing ke saath track-record feedback loop (pehle ye desks kabhi track hi nahi hote the — zero self-correction)
> - **Issue-5 (Laya + Signal Board):** **boardAiConfirm.js (NAYA)** — top STRONG/ACTION 75+ signals dono providers (Jev cloud + Laya local) ko jaate hain: both AGREE → `aiScore +3` CONFIRMED ✓; koi provider ULTA side → `−8 + STRONG→ACTION` CONFLICT ✗; CONFLICT picks TOP-5 se exclude. Card pe 🤖 AI chip (Jev ✓ · Laya ✓). `AI_BOARD_CONFIRM=off` se disable; unconfigured = honest no-op. Cost-controlled: bucketed-LTP payload cache + 5-min memo + soft deadline
> - **Issue-2 (TOP 5 PICKS):** AI confirm chip + funding-rate chip (∑ bps/8h) + KYUN reason me AI line; conflicts headline slots se bahar
> - **Issue-7 (EXPERT PICKS):** chop cap (ADX<15 → score 78 — 80+ bar cross nahi kar sakta) + Jev/Laya AI confirm (≥75 picks) + CHOP chip transparency
> - **Issue-4 (1-click live execute):** ⚡ EXECUTE LIVE ab **PRE-FLIGHT MODAL** kholta hai — READ-ONLY dry-run gauntlet (kill/go-live/strategy/arming/connection/signal/side-match) + would-be ticket (qty @ instrument precision, margin, leverage sanity, liquidation, native SL+TP pair) + **HOLD-TO-CONFIRM 1.2s** (accidental click-proof). `roundFuturesQty` ab `meta.qtyPrecision` honour karta hai. Paper flow frictionless unchanged
> - **Issue-6 (Equity sim USDC):** **24/7 candlestick price path** — RT probe fail hone par documented `/market_data/candlesticks?pair=b-<sym>_usdc` endpoint se perp LTP (Yahoo frozen last-close fallback se PEHLE); **US market phase badge** (🇺🇸 PRE/OPEN/POST/CLOSED + countdown) + feed provenance strip (kitne symbols CoinDCX perp/candle/Yahoo se) + **frozen-feed amber warning**; global watcher 60s → 30s
> - **Tests:** +35 naye (selfHeal platform profile, asyncGuard, stop floor, superIntel cap, board confirm truth-tables, precheck gates, usMarketPhase, candle path + negative backoff, futures tracking routing) — **3605/3605 PASS**

> **v21.2.0 — LAYA + JEV DUAL-PROVIDER AI LAYER (Bot Lab — selectable per bot, bina server restart)**
> - **6 ARMS:** Rules / Gated / **Jev (cloud)** / **Laya (local, $0)** / **Both (consensus)** / **Auto (primary + failover)** — per-bot UI dropdown se, availability-aware (unprovider option disabled + tooltip; server 409 `provider_unavailable` enforce karta hai). `AI_PRIMARY` (default `laya`) auto-arm ka primary hai; `AI_SHADOW` (R3 shadow-weeks) non-primary provider ka decision SIRF log karta hai — trade pe zero asar
> - **aiProviders.js (NAYA registry):** `buildProviders(env)` — jev (`TYPESAFE_API_KEY`) + laya (`LAYA_ENABLED=1` + `LAYA_API_KEY` + local `laya-serve`), provider-wise cache files (`jev_cache.jsonl` / `laya_cache.jsonl` — replay free/sasta), per-provider threshold/timeout (Laya 1500ms local-fast)
> - **jevEngine provider-aware:** `createJev({name, url, model})` — `JEV_URL`/`JEV_BASE_URL` env override (pehle hardcoded), falsy `model` = field OMIT (Laya T2 compat), **4xx ≠ breaker** (http_422 sirf `rejects` counter — ek lambi bad-state level pehle poore provider ko 10 min band kar deti thi; 5xx/429/network pe breaker same), cache key provider-aware, `stats()` me name/urlHost/rejects
> - **aiDecider (consensus/auto/shadow):** consensus = dono take bolein (same side) tabhi entry; ek provider down → `AI_CONSENSUS_ON_DOWN` = `wait` (default, safe) | `single` (bacha hua decide kare). auto = primary → failover sirf breaker/network/5xx notes pe (4xx pe nahi — bad request dono pe fail hoga). Har verdict me `ai.{laya,jev}` per-provider telemetry + purana `jev` compat field. Exception kabhi crash nahi — WAIT
> - **Safety unchanged (har mode me):** AI sirf flat-position ENTRY pe — side flip / sizing / SL/TP kabhi nahi; botRisk + kill switch + event guard sab se upar; error/timeout = WAIT; `gated` valid safe baseline
> - **UI:** BotsTab me Jev panel ke saath **Laya panel** (model/threshold/calls/p50/p95/rejects/breaker, "Local · $0") + AI mode line (AI_PRIMARY/SHADOW/ON_DOWN); decision stream me per-provider chips (L✓/J✓ agree-disagree, shadow ○ marker); **OpsHealthStrip AI chip** (`AI: L ✓ · J ✓` — breaker red, not-configured grey); arm 409 pe clear server hint
> - **Health/alerts:** `/api/bots/ai/health` (auth ke andar) + `/api/health` me `ai.{jev,laya}` block — selected-arm provider down (breaker) → Telegram alert (15-min throttle, existing pattern)
> - **Scripts:** `laya-ping.mjs` (NAYA — endpoint/latency/choice/probs + VERDICT: PASS/FAIL/SKIPPED, T1-T5 compat tests isi se); `botlab-calibrate` me **per-ARM table** (R5 winner-arm selection ka input). *(v21.11 cleanup: `botlab-backtest`/`botlab-smoke` scripts repo se retire ho chuke hain — unka kaam `botlab-calibrate` + ledger settle-events dekhte hain)*
> - **Laya install (laptop, PowerShell):** `python -m venv laya-env` → `pip install "laya[serve]==<pinned>"` → `LAYA_DEVICE=cpu LAYA_PRELOAD=1 LAYA_MODELS=english LAYA_HOST=127.0.0.1 LAYA_PORT=8000 LAYA_API_KEY=<32+ random> laya-serve` → `node scripts/laya-ping.mjs` (VERDICT PASS) → .env me wahi key. **Rollback = `LAYA_ENABLED=0`** — Laya arms gated pe degrade (event logged), jev arm + TYPESAFE_API_KEY flow bilkul unchanged
> - **Honest limits (plan §10):** Laya general decision model hai, trading-trained nahi — dono ki accuracy tumhare paper data se hi chalegi (R3 shadow-weeks → R4 analysis → R5 winner-arm, PAPER pehle hamesha); Laya context 512 tokens; realtime bottleneck feed freshness hai (CoinDCX WS), AI nahi
> - **Full suite green**: tsc ✓ · eslint 0/0 · vitest (naye dual-provider tests) · build+stamp 21.2.0 · check:routes ✓ · check:version 21.2.0 ✓

> **v21.1.2 — REPORT PHASE-1 IMPLEMENTATION (full check report ke saare quick fixes + CoinDCX WS diagnosis tooling)**
> - **WS DOWN FALSE-POSITIVE FIX (Cause-1 CONFIRMED):** `OpsHealthStrip` ab `armed` flag respect karta hai — idle socket (koi subscriber nahi, refcounted streams band) grey "N idle" hai, red "WS DOWN" sirf armed+unhealthy pe. Server-side alert loop pehle se armed-aware tha; ab UI bhi wahi contract follow karta hai (`wsFeedView` pure helper + unit-tested). **Sandbox se LIVE probe verify: CoinDCX futures WS bilkul HEALTHY** (HTTP 200 → handshake → ns-ACK 0.1s → first tick join ke 0.3s baad, 114 ticks/30s) — matlab "WS Down" UI false-positive hi tha
> - **`cx-ws-probe.mjs` (v21.1.2 diagnostic — v21.11 cleanup me RETIRED):** CoinDCX WS diagnosis ab OS-strip WS tooltip (`/api/health` → `feeds.ws.*` — `cooldownReason`/`failStreak`/`cooldownRemainMs`) + `/api/feed-status` se hota hai — alag script ki zaroorat nahi. Protocol notes (EIO=4 framing, app-ping 25s) server `wsFeed.js` me documented hain
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
