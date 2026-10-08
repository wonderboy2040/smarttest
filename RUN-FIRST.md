# ⚡ RUN-FIRST — SmartAI Pro kaise chalana hai (Windows)

Ye file zip extract karte hi sabse pehle padho. **Koi .exe nahi chahiye — sirf ek .bat file hai.**

---

## 🚀 v21.0.0 — LOCAL AI (OLLAMA) SETUP (naya, 16GB laptop)

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

## 🔔 v21.0.0 — TELEGRAM FIX (notifications nahi aa rahe the?)

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
