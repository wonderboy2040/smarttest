# SmartAI Pro v20 — Two-Desk AI Trading Terminal

Advance Pro Intelligence trading terminal with two dedicated, self-contained desks:
- 🇮🇳 **India Intraday Desk (NSE)**: Real-time signals, 10-model consensus committee, paper trading simulator, journal, options desk, and Dhan execution.
- ₿ **CoinDCX Desk (Crypto)**: Spot (INR pairs) and Global Futures (USDT perps), autonomous trading agent, wallet sync, reversal engine, and real-time WebSocket orderbook depth.

---

## ⚡ Quick Start

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
