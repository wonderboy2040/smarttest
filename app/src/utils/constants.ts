import { ETFInfo } from '../types';

export const DEFAULT_USD_INR = 83.5;
export const API_URL = import.meta.env.VITE_API_URL || "";

export const TAX_PAIRS: Record<string, string> = {
  'ITBEES.NS': 'TATAIT.NS',
  'SMH': 'SOXX'
};

export const ALPHA_ETFS_IN: ETFInfo[] = [
  { sym: 'MOMENTUM50', name: 'Motilal Oswal Nifty 500 Momentum 50', cagr: 22.5, maxDD: 30, cat: 'Smart Beta', aum: '₹3k Cr', vol: 'Moderate', fixedAlloc: 0.30 },
  { sym: 'SMALLCAP', name: 'Nippon India Nifty Smallcap 250', cagr: 24.5, maxDD: 40, cat: 'Growth', aum: '₹1.5k Cr', vol: 'High', fixedAlloc: 0.25 },
  { sym: 'MID150BEES', name: 'Nippon India Nifty Midcap 150', cagr: 21.0, maxDD: 35, cat: 'Growth', aum: '₹2.8k Cr', vol: 'Moderate', fixedAlloc: 0.20 },
  { sym: 'JUNIORBEES', name: 'Nippon India ETF Junior BeES', cagr: 18.5, maxDD: 30, cat: 'Next 50', aum: '₹4.5k Cr', vol: 'Moderate', fixedAlloc: 0.15 },
  { sym: 'SETFNIF50', name: 'SBI ETF Nifty 50', cagr: 14.0, maxDD: 25, cat: 'Large Cap', aum: '₹180k Cr', vol: 'Low', fixedAlloc: 0.10 }
];

export const ALPHA_ETFS_US: ETFInfo[] = [
  { sym: 'SMH', name: 'VanEck Semiconductor ETF', cagr: 28.5, maxDD: 45, cat: 'Tech Alpha', aum: '$22B', vol: 'Extreme', fixedAlloc: 0.30 },
  { sym: 'VOOG', name: 'Vanguard S&P 500 Growth ETF', cagr: 18.5, maxDD: 32, cat: 'US Mega Growth', aum: '$14B', vol: 'Moderate', fixedAlloc: 0.25 },
  { sym: 'MU', name: 'Micron Technology Inc', cagr: 24.0, maxDD: 45, cat: 'Semiconductor / AI', aum: '$130B', vol: 'High', fixedAlloc: 0.15 },
  // FIX (re-regression): SPCX ticker (Tuttle/Morgan Stanley SPAC ETF) is
  // delisted & effectively un-investable — reverted to QQQ (audit H8 fix).
  { sym: 'QQQ', name: 'Invesco Nasdaq-100 ETF', cagr: 18.0, maxDD: 35, cat: 'US Mega Growth', aum: '$320B', vol: 'High', fixedAlloc: 0.10 },
  { sym: 'VGT', name: 'Vanguard Information Technology ETF', cagr: 21.5, maxDD: 35, cat: 'Tech Broad Alpha', aum: '$75B', vol: 'High', fixedAlloc: 0.20 }
];

export const EXACT_TICKER_MAP: Record<string, string> = {
  // US ETFs & Stocks
  'SMH': 'NASDAQ:SMH',
  'VOOG': 'AMEX:VOOG',
  'MU': 'NASDAQ:MU',
  'QQQ': 'NASDAQ:QQQ',
  'VGT': 'AMEX:VGT',
  'AVUV': 'AMEX:AVUV',
  'IWM': 'AMEX:IWM',
  'VEA': 'AMEX:VEA',
  'SPY': 'AMEX:SPY',
  'DIA': 'AMEX:DIA',
  'XLV': 'AMEX:XLV',
  'VIX': 'CBOE:VIX',
  'SPX': 'SP:SPX',
  'NDX': 'NASDAQ:NDX',
  'DJI': 'TVC:DJI',
  'RUT': 'AMEX:RUT',

  // Indian ETFs & Indices
  'NIFTY': 'NSE:NIFTY',
  'SENSEX': 'BSE:SENSEX',
  'BANKNIFTY': 'NSE:BANKNIFTY',
  'NIFTY50': 'NSE:NIFTY',
  'NIFTYBANK': 'NSE:BANKNIFTY',
  'INDIAVIX': 'NSE:INDIAVIX',

  // Indian Planner Alpha ETFs
  'MOMENTUM50': 'NSE:MOMENTUM50',
  'SMALLCAP': 'NSE:SMALLCAP',
  'MID150BEES': 'NSE:MID150BEES',
  'JUNIORBEES': 'NSE:JUNIORBEES',
  'SETFNIF50': 'NSE:SETFNIF50',

  // Additional US & Crypto symbols
  'AAPL': 'NASDAQ:AAPL',
  'MSFT': 'NASDAQ:MSFT',
  'GOOGL': 'NASDAQ:GOOGL',
  'AMZN': 'NASDAQ:AMZN',
  'META': 'NASDAQ:META',
  'NVDA': 'NASDAQ:NVDA',
  'TSLA': 'NASDAQ:TSLA',
  'BTC': 'BINANCE:BTCUSDT',
  'ETH': 'BINANCE:ETHUSDT',
  'SOL': 'BINANCE:SOLUSDT',
  'BNB': 'BINANCE:BNBUSDT',
  'XRP': 'BINANCE:XRPUSDT'
};


export function getTodayString(): string {
  const t = new Date();
  let m = t.getMonth() + 1;
  let d = t.getDate();
  return `${t.getFullYear()}-${m < 10 ? '0' + m : m}-${d < 10 ? '0' + d : d}`;
}

export function isCryptoSymbol(sym: string): boolean {
  const clean = sym.toUpperCase().replace('USDT', '').replace('USD', '').replace('.NS', '').replace('.BO', '');
  return ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'DOT', 'MATIC', 'LINK', 'UNI', 'BITCOIN', 'ETHEREUM'].includes(clean);
}

/**
 * POSITION-level crypto classification (v6.2). The symbol NAME list alone
 * misses every non-major coin (SHIB, PEPE, TRX, NEAR, BONK, TON, …) —
 * CoinDCX rows for those landed in the INDIA group with an NSE badge and
 * polluted the "APP EXACT" 🇮🇳 card, the insights market-split and the
 * poller partitions. Source of truth first, name fallback second.
 */
export function isCryptoPosition(p: { symbol?: string; source?: string; indmKey?: string } | undefined | null): boolean {
  if (!p) return false;
  if (p.source === 'coindcx') return true;
  if (typeof p.indmKey === 'string' && p.indmKey.startsWith('cdcx:')) return true;
  return isCryptoSymbol(p.symbol || '');
}

// Real TradingView exchanges the price scanner can return. Used to decide
// whether a resolved "EXCHANGE:SYMBOL" is safe to feed straight to the chart.
const VALID_TV_EXCHANGES = new Set([
  'NSE', 'BSE', 'NASDAQ', 'NYSE', 'AMEX', 'CBOE', 'SP', 'TVC', 'DJ',
  'OANDA', 'FX_IDC', 'MCX', 'CME', 'NYMEX', 'COMEX',
]);

// ------------------------------------------------------------
// Resolve the exact TradingView chart symbol for ANY asset.
// Priority:
//   1. Crypto  -> always a real TV crypto pair (COINDCX is NOT a TV exchange).
//   2. The symbol the live-price engine already resolved (tvExactSymbol) on a
//      real TV exchange -> guarantees the chart exists wherever the price does.
//   3. Curated EXACT_TICKER_MAP.
//   4. Last-resort guess by market (NSE: / NASDAQ:).
// This fixes India ETFs (e.g. JUNIORBEES, MID150BEES) whose listing exchange
// (NSE vs BSE) and exact ticker can't be guessed reliably.
// ------------------------------------------------------------
export function resolveTvChartSymbol(
  symbol: string,
  market: 'IN' | 'US' | string,
  resolvedExact?: string
): string {
  const cleanSym = (symbol || '').replace('.NS', '').replace('.BO', '').toUpperCase();

  // 1) Crypto — never use COINDCX (not a TradingView exchange)
  if (isCryptoSymbol(cleanSym)) {
    return EXACT_TICKER_MAP[cleanSym] || `BINANCE:${cleanSym}USDT`;
  }

  // 2) Use the exchange:symbol the scanner actually found live data on
  if (resolvedExact && resolvedExact.includes(':')) {
    const ex = resolvedExact.split(':')[0].toUpperCase();
    if (VALID_TV_EXCHANGES.has(ex)) return resolvedExact;
  }

  // 3) Curated map
  if (EXACT_TICKER_MAP[cleanSym]) return EXACT_TICKER_MAP[cleanSym];

  // 4) Fallback guess
  const isIndian = market === 'IN' || (symbol || '').includes('.NS') || (symbol || '').includes('.BO');
  return isIndian ? `NSE:${cleanSym}` : `NASDAQ:${cleanSym}`;
}

export function guessMarket(sym: string): 'IN' | 'US' {
  sym = (sym || '').toUpperCase();
  if (sym.includes('.NS') || sym.includes('.BO')) return 'IN';
  if (sym === 'RELIANCE' || sym === 'NIFTY' || sym === 'SENSEX') return 'IN';
  if (sym.endsWith('BEES')) return 'IN';  // FIX M10: endswith, not includes
  if (ALPHA_ETFS_IN.some(e => e.sym.replace('.NS', '') === sym)) return 'IN';
  if (isCryptoSymbol(sym)) return 'IN'; // User buys via CoinDCX in INR
  return 'US';
}

// Crypto CAGR proxies (conservative long-term estimates)
const CRYPTO_CAGR: Record<string, number> = {
  'BTC': 55, 'ETH': 45, 'SOL': 40, 'BNB': 35, 'XRP': 25,
  'DOGE': 20, 'ADA': 20, 'AVAX': 30, 'DOT': 25, 'LINK': 30
};

export function getAssetCagrProxy(sym: string, mkt: string): number {
  sym = sym.toUpperCase().replace('.NS', '').replace('.BO', '');
  // Crypto check first
  if (isCryptoSymbol(sym)) return CRYPTO_CAGR[sym] || 30;
  const i = ALPHA_ETFS_IN.find(e => e.sym === sym);
  if (i) return i.cagr;
  const u = ALPHA_ETFS_US.find(e => e.sym === sym);
  if (u) return u.cagr;
  if (sym.includes('XAU') || sym.includes('XAG')) return 8;
  return mkt?.toUpperCase() === 'IN' ? 14 : 12;
}

export function formatCurrency(amount: number, currency: string = '₹'): string {
  if (amount >= 10000000) return `${currency}${(amount / 10000000).toFixed(2)} Cr`;
  if (amount >= 100000) return `${currency}${(amount / 100000).toFixed(2)} L`;
  return `${currency}${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export function formatPrice(price: number, currency: string = '₹'): string {
  const locale = currency === '₹' ? 'en-IN' : 'en-US';
  if (price >= 1000) return `${currency}${price.toLocaleString(locale, { maximumFractionDigits: 2 })}`;
  return `${currency}${price.toFixed(price < 1 ? 6 : 2)}`;
}
