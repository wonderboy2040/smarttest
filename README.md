# SmartAI Pro v21 — Three-Desk AI Trading Terminal

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
- ₿ **CoinDCX Desk (Crypto)**: Spot (INR pairs) and Global Futures (USDT perps), autonomous trading agent, wallet sync, reversal engine, and real-time WebSocket orderbook depth.
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
