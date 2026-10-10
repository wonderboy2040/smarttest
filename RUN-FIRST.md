# ⚡ RUN-FIRST — SmartAI Pro kaise chalana hai (Windows)

Ye file zip extract karte hi sabse pehle padho. **Koi .exe nahi chahiye — sirf ek .bat file hai.**

---

## 🎯 v21.1.0 — PHASE 1-4 RELIABILITY UPGRADE (user plan implemented)

**1) LIVE trading ab GO-LIVE GATE ke peeche hai (sabse zaroori change):**
- LIVE entries tabhi fire hongi jab **PAPER track-record qualify** kare:
  100+ settled paper trades + positive expectancy + max drawdown limit ke andar.
- Dono desks (India + CoinDCX) me **STRATEGY HEALTH panel** dikhega —
  LIVE LOCKED/UNLOCKED chip + progress bar + exact counters.
- Tunable: `GO_LIVE_MIN_TRADES=100`, `GO_LIVE_MIN_EXPECTANCY_R=0`,
  `GO_LIVE_MAX_DD_R=8` (env se).
- **Per-strategy auto-pause**: kisi strategy ki rolling 30-trade expectancy
  negative ho gayi to wo khud pause ho jaati hai (naye entries honest reason
  se reject; recover hone par auto-resume). Telegram pe 🛑 notification.

**2) Naya /api/health + OPS strip:**
- Dono tabs ke top par **OPS** strip: feeds ka last-tick age, WS health,
  teeno kill layers, exec heartbeat, disk status — 30s refresh.
- Server har 60s check karta hai — koi feed 90s+ stale / WS down / kill
  arm / heartbeat gap / disk problem → **Telegram health alert** (15-min throttle).

**3) dist/ ab git me nahi aata:**
- `Start-SmartAI-Watchdog.bat` pehle hi **dist missing/stale hone par auto
  build** karta hai (`ensureFrontend`) — kuch nahi karna.
- Render deploy: **Build Command** me `npm ci && npm run build` rakho.
- GitHub pe CI (Actions) har push pe build+test verify karta hai.

**4) proxy-addr security fix:** npm audit ab **0 vulnerabilities** (pehle 1
critical IP-spoofing). Telegram-bot lockfile bhi patched.

**5) LIVE-CHECKLIST:** `app/PHASE-2-LIVE-CHECKLIST.md` kholo — real feeds,
Telegram, Dhan, Render flows ke manual test items (PASS/FAIL log ke saath).

**6) Logs kam shor karne ke liye:** `.env` me `LOG_LEVEL=warn` daal sakte ho
(sirf warnings+errors dikhen ge). Default `info` (pehle jaisa).

---

## 🎯 v21.0.6 — ADVANCE-PRO FULL AUDIT FIXES (8 major + 4 medium)

**1) Options paper trading ab aur bhi ACCURATE:**
- Paper option trades ke exits (SL/T1/T2/BE/15:10) ab **wahi LIVE premium use
  karte hain jo Options Desk pe dikhta hai** — pehle ye Black-Scholes model
  premium pe chalte the. Ab jab tak live chain (NSE/BSE/Groww) available hai,
  trade usi ke LTP pe manage hoga — desk aur engine me koi difference nahi.
- **1 lot ka trade ab T1 pe poora band NAHI hota**: pehle 1-lot trade T1 chhote
  hi 100% close ho jata tha (T2/breakeven-trail kabhi run nahi hote the).
  Ab T1 aane par SL **entry (breakeven)** pe shift ho jata hai aur runner
  T2 tak ride karta hai — jaisa card advertise karta hai.
- Auto-entry cooldown ab **per-underlying** hai (NIFTY entry se SENSEX 20 min
  nhi rukta), aur holiday pe "window open" jhooth nahi bolta.

**2) CoinDCX tab — FUTURES USDT auto-trade ab chhote wallet pe bhi:**
Paper mode me connected wallet chhota ho (₹300-500) to pehle futures entries
"margin too small" se skip ho jati thi jabki equity-sim chalta rehta tha.
Ab **paper mode me futures bhi practice equity (₹10,000) pe size hota hai** —
dono desks fair. LIVE mode me pehle jaisa wallet-floor (safety untouched).
"Sirf SPOT desk se entry hoga" wala purana message bhi hata (spot desk to
v21.0.5 me hi remove ho gaya tha).

**3) AI engines:**
- 🔬 Deep Advance Pro modal ka council ab **sach me deep model
  (deepseek-r1:14b)** pe chalta hai (pehle chip dikhata R1 tha par debate
  scan model qwen3:8b pe chalta tha).
- 👁 Vision AI failures ab board ke scan seat ko cooldown me nahi daalte.
- Vision cache ab chart-timeframe aware (15m ka verdict 1d pe serve nahi hota).

**Update kaise karein**: purane folder pe ye naya zip extract karo →
`Start-SmartAI-Watchdog.bat` chalao → browser me **Ctrl+Shift+R** (service
worker cache clear). Login badge pe **v21.0.6** dikhna chahiye.

---

## 🎯 v21.0.5 — NIFTY REALTIME FIX + COINDCX SPOT DESK HATA DIYA

**1) NIFTY options ab laptop + server dono pe REAL data:**
SENSEX wala fix (v21.0.4) ab NIFTY pe bhi lag gaya hai. Aapke laptop pe
jahan NSE seedha chalta hai wahan **`LIVE NSE CHAIN`** (volume + saari
expiries ke saath) pehle jaisa hi milega. Jahan NSE block karta hai
(VPS/Render/cloud) wahan app **Groww public mirror** se REAL NIFTY chain
serve karega — chip **`LIVE NSE CHAIN · GROWW`** (emerald). Dono paths
fail hone par hi model chain + amber banner (rare, auto-retry chalu).
BANKNIFTY/FINNIFTY waise hi sirf direct NSE pe hain.

**2) CoinDCX tab me ab sirf 2 desks:**
User spec ke hisaab se **₿ SPOT desk poori tarah remove** ho gaya hai —
desk switcher me ab sirf **⚡ GLOBAL FUTURES (USDT)** aur **🌍 EQUITY SIM**
hain (default: FUTURES). Crypto-spot wali analytics sections (Swing Desk,
Whale Radar, Orderbook, crypto Backtest/ModelPerf) bhi hata di gayi hain.
Wallet card, Execution Console, Auto-Agent, Reversal, Mesh — sab intact.
Auto-agent me ab **🌍 EQUITY SIM PICKS** strip bhi dikhti hai (agent us
desk pe bhi auto-trade karta hai).

---

## 🎯 v21.0.4 — SENSEX OPTIONS AB REAL LIVE DATA (bada fix)

**1) "SENSEX premiums are model-estimated" warning khatam — ab REAL chain:**
Pehle SENSEX options ke liye koi public live feed available nahi tha (BSE
apne datacenter IPs ko block karta hai), isliye app Black-Scholes MODEL
premiums dikha raha tha. **v21.0.4 me Groww ka public page mirror lag
gaya** — ab SENSEX desk pe:
- Chip **`LIVE BSE CHAIN · GROWW`** (teal) = real BSE premiums
- Real **LTP / OI / IV / Greeks / PCR / Max Pain / Gamma walls** (model nahi!)
- Real weekly expiry list (Thursday) + lot size 20
- Ye **datacenter/VPS pe bhi kaam karta hai** (Render/cloud deploy included)

**2) SENSEX pe warning kabhi dikhe to (rare case):**
Agar Groww mirror AUR direct BSE dono down ho jayein, tabhi honest model
chain dikhega with rose banner "auto-retry chalu rehta hai" — kuch minutes
me khud wapas live ho jata hai. Isko bina refresh ke ignore kar sakte ho.

**3) NIFTY/BANKNIFTY pe raat/weekend ko "BS MODEL" chip:**
NSE band hone pe (09:15–15:30 IST ke bahar) NIFTY-family model chain
dikhti hai (honest amber label) — market khulte hi **LIVE NSE CHAIN**
wapas. SENSEX/Groww bhi market hours me sabse fresh data deta hai.

---

## 🎯 v21.0.3 — OPTIONS + PAPER DESK + OLLAMA MODEL (kya fix hua)

**1) Options Trading abhi bhi galat dikhe to:**
NSE live chain sirf market hours (09:15–15:30 IST) me aata hai. NSE band ho
to app **honest label** ke saath Black-Scholes MODEL chain dikhata hai
("BS MODEL CHAIN — NSE BLOCKED" chip). Ye galat nahi hai — model estimate
hai. Live chain wapas aate hi chip **"LIVE NSE CHAIN"** ho jata hai aur
premiums exchange se aate hain. Expiry ab hamesha **13-Oct-2026 jaisa
sahi nearest weekly** hoga + Greeks/DTE/GEX live.

**2) Option paper trade kholo — Paper Desk me turant dikhega:**
- 🧪 PAPER TRADE button (F&O card pe) dabao → toast confirmation + **Paper
  Desk section me trade turant** (SIMPLE view me bhi — pehle sirf PRO me tha)
- NSE band ho (raat/weekend/15:00 ke baad) to naya paper entry **reject**
  hota hai with clear message — ye jaan-bujh kar hai (entries sirf live
  session me), crypto paper 24×7 chalta hai
- Max 10 open paper trades + same contract duplicate entry block

**3) Konsa Ollama model use ho raha hai — dono tabs me top par chip:**
India Intraday aur CoinDCX dono desk par ab **AI ENGINES strip** hamesha
dikhti hai. Ollama chalu ho to chip me **`QWEN3·8B ↗R1·14B`** (scan model
+ deep model) dikhta hai; hover par vision model, ctx, RAM guard, installed
models sab details. Ollama band ho to **`OLLAMA —`** (slate, honest).
🔬 deep analysis modal me "AI COUNCIL · ollama:deepseek-r1:14b" — ab
REAL model name, sirf "ollama" nahi. Model change kiya ho to **RECHECK**
button dabao (naya probe turant).

---

## 🚀 v21.0.2 — LOCAL AI (OLLAMA) SETUP (naya, 16GB laptop)

Aapke paas **Ollama + deepseek-r1:14b + qwen3:8b** already hai — bas
`app/.env` me ye lines daalo (ya .env.example se copy karo):

```env
LLM_LOCAL_ONLY=1
OLLAMA_MODEL=qwen3:8b
OLLAMA_DEEP_MODEL=deepseek-r1:14b
```

**Vision seat (optional, chart screenshot AI):**
```bash
ollama pull qwen2.5vl:7b
```
Phir chart kholo → **"👁 Vision AI"** button → screenshot ko local model
analyze karega (trend/patterns/risk verdict).

**Ollama service tuning (16GB ke liye — Windows System Environment
Variables me daalo ya `ollama serve` se pehle set karo):**
```
OLLAMA_MAX_LOADED_MODELS=1
OLLAMA_NUM_PARALLEL=1
OLLAMA_KEEP_ALIVE=5m
OLLAMA_KV_CACHE_TYPE=q8_0
```
(Isse 14B + 8B dono ek saath load NAHI honge = OOM nahi; Node server +
browser ko RAM milegi.)

**Kaise kaam karta hai**: scan/council seat = qwen3:8b (fast), deep
single-symbol analysis = deepseek-r1:14b (best reasoning), chart
screenshots = qwen2.5vl:7b (vision). Cloud keys ki zaroorat NAHI —
`LLM_LOCAL_ONLY=1` pe sab local chalta hai. Koi vision model install
na ho to bhi sab kuch chalta hai — sirf Vision AI button 503 dega.

---

## 🔔 v21.0.2 — TELEGRAM FIX (notifications nahi aa rahe the?)

4 root-causes fix hue:
1. **telegram-bot/node_modules ab watchdog khud install karta hai**
   (pehle bot crash-loop karta tha — isliye koi digest/alert nahi aata tha)
2. **Boot self-test**: har start pe getMe + test message — 401 (galat
   token) / 403 (bot ko /start nahi bheja) / 400 (galat chat id) —
   EXACT reason console me dikhega
3. **Agar bhi nahi aa rahe**: Telegram me apna bot kholo → **/start
   bhejo** (one time) → Watchdog restart karo
4. **Delivery health**: `/api/ai/insta-push/status` me `delivery` block
   (24h me kitne sent/failed + lastError)

**Localhost golden rules**: `TG_TOKEN` + `TG_CHAT_ID` DONO set karo
(aadha pair = dono silently off) · `TELEGRAM_WEBHOOK_SECRET` KHAALI
rakho (webhook mode hosted deployments ke liye hai).

---

## ✅ 30-second me chalao

1. **Node.js install karo** (ek baar, agar pehle se nahi hai)
   - https://nodejs.org se **LTS version** (v20+) download karke install karo
   - Check: `cmd` kholo → `node -v` → `v20.x.x` dikhna chahiye

2. **Zip ko kahin bhi extract karo** (e.g. `D:\SmartAI`)

3. **`app` folder ke andar jao** → **`Start-SmartAI-Watchdog.bat` double-click karo**

4. **Pehli baar** watchdog khud sab karega (internet chahiye):
   - `node_modules` install (agar missing) — 1-3 min
   - Frontend build (`vite build`) — 2-5 min
   - "frontend build COMPLETE" line dikhne tak wait karo

5. **Browser me kholo**: http://localhost:8080

6. **PIN**: `.env` file me `APP_PIN=...` likha hai (app folder me).
   `.env` nahi hai to `SETUP-v20.bat` chalao — naya PIN bana dega.

Bas. Window khuli/minimized rakho — ye anti-freeze supervisor hai,
site hang ho to khud restart karta hai.

---

## 👁 v21.0.1 — VISION AI BUTTON KAHAAN HAI? (button nahi dikh raha?)

**Vision AI button chart ke header row me hai** — `📈 SYMBOL · CANDLES` label
ke saath wahi row me (fuchsia/purple button). Ye dono jagah dikhta hai:

- **Deep Ensemble Analysis** kholo (signal card pe 🔬 button) → andar
  price chart ke upar header row me **👁 Vision AI** button
- **AI Trading board** ke signal card me 📈 PRICE CHART toggle karo →
  wahi header row me button

**Button nahi dikh raha?** Matlab browser me PURANA build chal raha hai:

1. Login screen pe dekho — **v21.0.1** likha hona chahiye (v20/v21.0.0 = purana)
2. Server window me dekho — boot pe `⚠ dist STALE` warning aayegi
3. Fix: Watchdog window **Ctrl+C** karke **`Start-SmartAI-Watchdog.bat`**
   dobara chalao (auto npm install + rebuild, 2-5 min, internet chahiye) →
   browser me **Ctrl+Shift+R** (hard refresh)
4. v21.0.1 se **dist/ ab repo me tracked hai** — `git pull` karne pe fresh
   frontend khud aa jata hai, rebuild ki zarurat sirf tab jab tumne khud
   source code badla ho

**Button click karne pe kya hota hai**: chart ka screenshot local Ollama
vision model (`qwen2.5vl:7b` — `ollama pull qwen2.5vl:7b` se install) ko
jata hai, 20-40s baad 👁 VISION VERDICT (agree/disagree + patterns + risk)
chart ke neeche dikhta hai. Vision model installed nahi hai to honest
error aata hai — fake verdict kabhi nahi.

---

## 🔄 Naya code update karo (zip/copy se) — v20.8.3 ALWAYS-LATEST

Purane folder me naye files copy/extract karo (ya naya zip usi folder pe
extract karo), phir:

1. Watchdog window me **Ctrl+C** (ya window close)
2. **`Start-SmartAI-Watchdog.bat` dobara double-click**
3. Watchdog khud pakad lega ki dist/ (frontend build) stale hai →
   **npm install + build KHUD chalega** → fresh site serve hogi
4. Browser me **F5**

**Guarantee**: `dist/.build-version` stamp vs `package.json` version —
mismatch = auto rebuild. "Purana version serve ho raha hai" wala bug
ab ho hi nahi sakta. Agar kabhi bhi browser me **red STALE-BUILD banner**
dikhe (site vA · server vB), wahi karo: Watchdog restart + F5.

---

## 🛡️ v20.9.0 — HARD RISK GATE (naya, zaroori janko)

Ye version SAPTA (Pro Trader Auto) aur Bot Lab dono ko **ek shared hard
risk gate** se guzarta hai — AI ke UPAR wale rules jo koi config override
nahi kar sakta:

| Rule | Default | Matlab |
|---|---|---|
| Daily loss halt | ₹1500 (3 x stake ₹500) | Aaj itna loss = naye entries band |
| Consecutive losses | 3 | 3 loss lagataar = aaj ke liye pause |
| Drawdown kill | 10% (peak se) | Profit peak se 10% giraya = band |
| Event-day blackout | auto | Result/RBI/FOMC din pe entries block |
| Max concurrent | 3 | Ek waqt pe 3 positions |

- **Stake clamp**: ab max ₹5,000 per trade (pehle ₹1,00,000 tha).
  Zyada chahiye? `.env` me `SAPTA_MAX_STAKE_INR=20000` likho (explicit opt-in).
- **Leverage clamp**: max 5x (pehle 10x). Override: `SAPTA_MAX_LEVERAGE=8`.
- Bot Lab env knobs: `BOT_MAX_DRAWDOWN_KILL_PCT`, `BOT_MAX_CONSECUTIVE_LOSSES`,
  `BOT_STALE_FEED_SECONDS`, `BOT_MIN_EDGE_OVER_COST_MULT` (sab clamped).
- **Regime routing** (Bot Lab): ORB sirf trend me, LVL sirf chop me.
  Band karna ho: `BOTS_REGIME_ROUTING=off`.

## 🔒 v20.9.1 — MONEY-PATH HONESTY (deep-recheck, zaroori janko)

Is version me 4th-pass full-site audit ke **~50 verified fixes** hain. Jo
aapke paisa/copy se seedha khelte hain:

- **Exchange rejection ka pakka jawab**: CoinDCX kabhi HTTP 200 ke andar
  error bhejta tha — pehle aise "close" ko success maan liya jata tha
  (journal me fake CLOSE + P&L, jabki position exchange pe khuli rehti
  thi). Ab har close/partial/entry ka verdict check hota hai (spot +
  futures + reversal teeno desks).
- **LIVE + exchange disconnected = kabhi paper-book nahi**: TP1 partial
  ke "book ho gaya" journal entries ab sirf tab banti hain jab exchange
  ne sach me qty move ki ho.
- **INR-margined futures wallet ab chalta hai**: pehle sirf USDT-leg
  ginti thi — aapke jaise INR margin wallet pe poora futures desk
  "margin < 2" jhothe reason se mar jata tha. Ab dono legs jud ke
  viability/caps dete hain.
- **paperMirror restore ab kaam karta hai**: Render wipe hone par
  browser apni history wapas bhejta tha — par mirror pehle hi wipe se
  overwrite ho jata tha (restore kabhi fire nahi hota tha). Fix ho gaya.
- **Lint gate repair**: `npm run lint` ab TSX bhi check karta hai
  (pehle 66 parse errors chhupe hue the) aur `npm run check` me wired.
- **Calibration leakage fix** (ml-service): meta-ensemble ab date-sorted
  trains hota hai (cross-symbol future-leakage band).
- **Indicators**: Supertrend ab asli trailing-band hai (pehle sirf
  "last bar up/down?" tha), RSI flat symbol pe 50 (100 nahi), stochastic
  %D sahi smoothing se.
- **Bot Lab**: orb_in ka trend-gate double-normalize bug fix (gated arm
  permanent no-trade tha); lvl ka friction ab REAL costs se (backtest
  proof: rules arm 0% win / feeDrag 53R — gate hi bachata hai);
  risk-block telegram alerts ab production me wired.
- Retired: `POST /api/ml/signals` (har symbol hardcoded HOLD-30 deta
  tha) — real signal `/api/ml/predict` se lo.

## 📊 Signal calibration (naya tool)

`npm run calibrate` — SAPTA/Bot Lab ke closed trades ka bucket report
(win-rate, Wilson lower bound, avg R per score bucket) + data-driven
threshold recommendation. **Report only** — config kabhi auto-change
nahi hota. Threshold change walk-forward validate hone ke baad hi karo.

## 💾 Daily state backup (naya)

- Manual: `npm run backup-state`
- Docker: backup sidecar automatic (14-din rotation)
- Windows Task Scheduler:
  `schtasks /create /tn "SmartAI Backup" /tr "node C:\SmartAI\app\scripts\backup-state.mjs" /sc daily /st 23:30`

## 🧪 Honest ML (v20.9.0)

`/api/ml/*` ab deterministic hai (same input = same output) aur har
response `model: "heuristic-v1"` + disclaimer carry karta hai — ye
rule-based heuristic hai, calibrated probability model NAHI. AI chat me
bhi wahi label dikhega.

---

## 🧰 Kaunsi file kya hai

| File | Kaam |
|------|------|
| `Start-SmartAI-Watchdog.bat` | **MAIN LAUNCHER** — anti-freeze supervisor + auto-install + auto-build |
| `SETUP-v20.bat` | Fresh install / in-place upgrade (backup + verify + PIN setup) |
| `Start-AutoBrowser.bat` | Pro-Trader-Auto automation browser (CDP 9222) — optional |
| `server/index.js` | Backend server (ye watchdog khud chalata hai) |
| `dist/` | Built frontend (server isi se site serve karta hai) |

**Note**: `npm start` / `npm run dev` developer flow hai — normal use ke
liye Watchdog bat kaafi hai.

## ⚠️ Common problems

- **"node nahi mila"** → Node.js install karo (step 1), ya `node.exe` ko
  app folder me rakho (portable node)
- **Port 8080 pe kuch aur chal raha hai** → `netstat -ano | findstr :8080`
  se PID nikaalo, Task Manager se band karo
- **Build fail** → Node version check karo (>= 20), internet on karo,
  Watchdog window ka output padho (`[npm]` lines me asli reason aata hai)
- **Site purani lag rahi hai** → hard refresh: `Ctrl+Shift+R` (service
  worker cache). Banner aa gaya to Watchdog restart karo.

---

## 🆕 v21.1.1 — RECHECK RELEASE (advance-pro full-site audit)

**IMPORTANT — pehle ye 3 kaam karo:**
1. **Render pe Build Command**: `npm ci && npm run build` (dist ab git me nahi aata)
2. **`/api/exec/kill` disarm**: level 0 ke liye body me `{"level":0,"confirm":"CLEAR-KILL"}` bhejo (accidental disarm protect)
3. **Bot Lab / exec API users**: kill-ab "exits enforced" semantics hai — kill ON bhi SL/TP closes chalte hain (sirf naye entries block)

**Kya naya hai:** restart-safe kill levels (L1 L1 hi rehta hai — mass-flatten nahi),
futures positions ab protection-missing pe har pass TP/SL re-arm karta hai, spot dust
guard order se pehle check hota hai, India LIVE bhi go-live gate ke peeche, walk-forward
toggle Backtest panel me visible, health alerts ab idle feeds pe false nahi bajte,
watcher Telegram spam 30-min throttled, SETUP bat rollback bug fix.
**Test**: 3495/3495 green · npm audit 0 · CI har push pe verify karega.
