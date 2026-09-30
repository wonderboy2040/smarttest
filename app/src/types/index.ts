export interface Position {
  id: string;
  symbol: string;
  market: 'IN' | 'US';
  qty: number;
  avgPrice: number;
  leverage: number;
  dateAdded: string;
  /** Full display name (INDMoney-synced assets carry fund/company names). */
  name?: string;
  /** true = no live exchange price exists (MF/FD/bond/EPF…) — the price
   *  shown is INDMoney's own unit value (NAV), refreshed on each sync. */
  noLive?: boolean;
  /** Synced-asset removal key (INDMoney or CoinDCX source) — the row's
   *  identity for hide/restore, stable across syncs. */
  indmKey?: string;
  /** Sync source: 'indmoney' (MCP holdings) | 'coindcx' (exchange balances).
   *  Absent for manually-added rows. */
  source?: 'indmoney' | 'coindcx';
  /** Ground-truth INR invested amount from the INDMoney/CoinDCX sync (server
   *  snapshot `invested` field). US assets: their USD avgPrice is an FX
   *  approximation (sync-time rate), but this INR number is exact — the P&L
   *  metrics use it so USD buckets convert at ONE consistent live rate. */
  indmInvestedINR?: number;
  /** INDMoney's own unrealized P&L for the holding, in INR (snapshot `pnl`).
   *  The exact-match P&L engine (assetPnl.ts) anchors every synced row's
   *  Unrealized P&L / Total P&L to THIS number + live-tick delta, so the site
   *  matches the INDMoney app (USA $ / India ₹) instead of recomputing from
   *  a different price world. */
  indmPnlINR?: number;
  /** INDMoney's own P&L % (snapshot `pnlPct`) — fallback when no cost basis. */
  indmPnlPct?: number;
  /** Per-unit price at the LAST sync, in the row's NATIVE currency (server
   *  converts US rows to USD). The live-delta anchor: (live − this) × qty. */
  indmLastPrice?: number;
}

export interface PriceData {
  price: number;
  change: number;
  high?: number;
  low?: number;
  volume?: number;
  rsi: number;
  time: number;
  market: string;
  tvExchange?: string;
  tvExactSymbol?: string;
  sma20?: number;
  sma50?: number;
  macd?: number;
  isRealtime?: boolean;
  /** v10.12 (#1 source transparency): which upstream actually served this
   *  tick. India desk: 'groww-live' (Groww NSE SSE) | 'tv-ws' (browser
   *  TradingView socket) | 'yahoo-delayed' (Yahoo fallback — indices / Groww
   *  misses). The shared SSE pipeline also carries the other desks' labels
   *  ('coindcx-*', 'finnhub-*', 'binance-*', 'yahoo-us-fallback', …) —
   *  LiveSourceBadge maps every known label to its honest pill and renders
   *  a neutral LIVE pill for unlabeled provenance. */
  src?: string;
  /** REAL previous close from the quote source (not back-computed from the
   *  rounded change %). Present on Groww/Yahoo/Finnhub/TV-batch sourced
   *  ticks — used for exact Today's P&L: (price - prevClose) * qty. */
  prevClose?: number;
}

export interface ETFInfo {
  sym: string;
  name: string;
  cagr: number;
  maxDD: number;
  cat: string;
  aum: string;
  vol: string;
  fixedAlloc: number;
}

export interface ExpertInfo {
  id: string;
  icon: string;
  name: string;
  role: string;
  colorBg: string;
  border: string;
}

// v6.9: the AI Trading tab is SPLIT into two self-contained desks —
// India intraday (NSE) and CoinDCX (crypto spot + global futures).
export type TabType = 'dashboard' | 'india' | 'crypto' | 'portfolio' | 'planner' | 'macro';
export type RiskLevel = 'low' | 'medium' | 'high';
export type TransactionType = 'buy' | 'sell';

// ========================================
// PRICE ALERTS (target / stop-loss → Telegram)
// ========================================
export interface PriceAlert {
  id: string;
  symbol: string;
  market: 'IN' | 'US';
  target?: number | null;      // upper target price (notify when price >= target)
  stopLoss?: number | null;    // lower stop-loss price (notify when price <= stopLoss)
  note?: string;               // optional user note shown in the alert
  enabled: boolean;
  createdAt: number;
  lastTriggered?: number;          // ts of last fired alert (cooldown)
  triggeredType?: 'target' | 'stoploss' | null; // which threshold last fired
}

// ========================================
// TRANSACTION LEDGER (powers monthly analytics & return reports)
// ========================================
export interface Transaction {
  id: string;
  symbol: string;
  market: 'IN' | 'US';
  type: TransactionType;
  qty: number;          // qty bought / sold
  price: number;        // per-unit price in native currency
  amount: number;       // qty * price (native currency)
  date: string;         // YYYY-MM-DD (trade date)
  ts: number;           // Date.now() when recorded
  prevQty: number;      // holding qty BEFORE this txn
  prevAvg: number;      // avg price BEFORE this txn
  newQty: number;       // holding qty AFTER this txn
  newAvg: number;       // avg price AFTER this txn
  realizedPL?: number;  // realized P&L for sells (native currency)
}

// Aggregated month-wise analytics row (Planner Deep Data Analytics)
export interface MarketBreakdown {
  buyQty: number;
  buyAmount: number;   // native-summed but tagged; INR for IN/CRYPTO-INR, USD for US
  buyAmountINR: number;
  txnCount: number;
}
export interface MonthlyAnalytics {
  month: string;            // YYYY-MM
  label: string;            // "Jun 2026"
  rangeLabel: string;       // "1 Jun – 30 Jun 2026"
  buyQty: number;           // total qty bought in month
  buyAmountINR: number;     // total invested in month (INR equivalent)
  sellQty: number;          // total qty sold in month
  sellAmountINR: number;    // total redeemed in month (INR equivalent)
  netInvestedINR: number;   // buyAmount - sellAmount (INR)
  realizedPLINR: number;    // realized P&L booked in month (INR)
  txnCount: number;
  symbols: string[];        // unique symbols transacted
  // market split: India, USA, Crypto
  india: MarketBreakdown;
  usa: MarketBreakdown;
  crypto: MarketBreakdown;
}



// ========================================
// BUY-THE-DIP & LONG-TERM INVESTMENT TYPES
// ========================================

export interface DipLevel {
  label: string;
  percentBelow: number;
  targetPrice: number;
  suggestedAmount: number;
  triggered: boolean;
}

export interface DipSignal {
  symbol: string;
  market: 'IN' | 'US';
  currentPrice: number;
  sma20: number;
  sma50: number;
  sma20Distance: number;
  sma50Distance: number;
  rsi: number;
  dipDepth: 'DEEP' | 'MILD' | 'NEUTRAL' | 'ELEVATED';
  fibSupport: number;
  fibResistance: number;
  entryTarget: number;
  dipLadder: DipLevel[];
  confidence: number;
  reason: string;
}

export interface PortfolioHealth {
  score: number;
  drawdownFromHigh: number;
  rsiExtremeCount: number;
  trendReversals: string[];
  vixStatus: 'NORMAL' | 'ELEVATED' | 'SPIKE';
  alertLevel: 'GREEN' | 'YELLOW' | 'RED';
  buyOpportunities: string[];
  warnings: string[];
}

export interface MacroRegime {
  regime: 'RISK_ON' | 'RISK_OFF' | 'STAGFLATION' | 'GOLDILOCKS';
  confidence: number;
  vix: number;
  yieldCurve: number;
  description: string;
  portfolioSuggestion: string;
  sectorRecommendation: { sector: string; action: 'OVERWEIGHT' | 'UNDERWEIGHT' | 'NEUTRAL'; reason: string }[];
}

export interface SectorMomentum {
  name: string;
  ticker: string;
  change: number;
  relativeStrength: number;
  compositeScore: number;
  trend: 'LEADING' | 'LAGGING' | 'IMPROVING' | 'WEAKENING';
}

export interface ScreenerResult {
  symbol: string;
  market: 'IN' | 'US';
  name: string;
  price: number;
  qualityScore: number;
  cagr: number;
  maxDrawdown: number;
  momentumScore: number;
  rsi: number;
  sma20: number;
  sma50: number;
  aboveSma50: boolean;
  change: number;
  volume?: number;
  valueScore: number;
  riskScore?: number;
  pegRatio: number;       // FIX H4: misleadingly named — actually RSI/CAGR ratio. Kept for type compat; consumers should treat as rsiCagrRatio, NOT a true PEG (P/E ÷ growth).
  alphaScore: number;
  signal: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'AVOID';
  reason: string;
}


