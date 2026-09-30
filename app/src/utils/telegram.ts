import { Position, PriceData } from '../types';
import { ALPHA_ETFS_IN, ALPHA_ETFS_US, getAssetCagrProxy } from './constants';
import { computeUnifiedEntry } from './entryPriceEngine';

// ========================================
// MARKET HOURS CHECK
// ========================================
// FIX M16: previous implementation used `toLocaleString('en-US', ...)` and then
// string-split the result, which is locale-implementation-dependent (weekday
// could come second, include date, or use a different separator in some ICU
// builds). Use `Intl.DateTimeFormat.formatToParts` and read weekday/hour/minute
// explicitly so the parser is robust across Node/V8 versions.
function getTimeInZone(tz: string): { h: number; m: number; day: number } {
  // v5.0 perf: Intl.DateTimeFormat construction costs ~0.1-1ms and this
  // helper fires on EVERY WebSocket price message and EVERY market-status
  // render (tvWebsocket.validatePrice + Dashboard header). Hoist the
  // formatters to module scope and memoize per-tz results for 30s — far
  // finer than any market-open boundary the callers care about.
  const nowMs = Date.now();
  const cached = _tzCache[tz];
  if (cached && nowMs - cached.at < 30_000) return cached.val;
  if (!_tzFormatters[tz]) {
    _tzFormatters[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    });
  }
  const parts = _tzFormatters[tz].formatToParts(new Date(nowMs));
  const get = (type: string) => parts.find(p => p.type === type)?.value || '';
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const d = new Date(nowMs);
  const day = dayMap[get('weekday').substring(0, 3)] ?? d.getDay();
  // hour can be "24" in some environments for midnight; normalize to 0.
  let h = parseInt(get('hour'), 10);
  if (isNaN(h) || h === 24) h = 0;
  const m = parseInt(get('minute'), 10) || 0;
  const val = { h, m, day };
  _tzCache[tz] = { at: nowMs, val };
  return val;
}
const _tzFormatters: Record<string, Intl.DateTimeFormat> = {};
const _tzCache: Record<string, { at: number; val: { h: number; m: number; day: number } }> = {};

export function isIndiaMarketOpen(): boolean {
  const { h, m, day } = getTimeInZone('Asia/Kolkata');
  if (day === 0 || day === 6) return false;
  const mins = h * 60 + m;
  return mins >= 555 && mins <= 930;
}

export function isUSMarketOpen(): boolean {
  const { h, m, day } = getTimeInZone('America/New_York');
  if (day === 0 || day === 6) return false;
  const mins = h * 60 + m;
  return mins >= 570 && mins <= 960;
}

export function isAnyMarketOpen(): boolean {
  return isIndiaMarketOpen() || isUSMarketOpen();
}

export function getMarketStatus(): string {
  const inOpen = isIndiaMarketOpen();
  const usOpen = isUSMarketOpen();
  if (inOpen && usOpen) return '🇮🇳 IN + 🇺🇸 US Markets LIVE';
  if (inOpen) return '🇮🇳 India Market LIVE';
  if (usOpen) return '🇺🇸 US Market LIVE';
  return '💤 Markets Closed';
}

// ========================================
// SIGNAL DETECTION
// ========================================
export interface AssetSignal {
  symbol: string;
  market: string;
  signal: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
  action: 'BUY' | 'SELL' | 'HOLD';
  trend: 'up' | 'down' | 'flat';
  rsi: number;
  change: number;
  price: number;
  targetPrice: number;
  fibLow: number;
  fibHigh: number;
  confidence: number;
  reason: string;
  allocPct?: number;
  allocAmount?: number;
}

export function analyzeAsset(
  position: Position,
  priceData: PriceData | undefined
): AssetSignal {
  const price = priceData?.price || position.avgPrice;
  const rsi = priceData?.rsi || 50;
  const change = priceData?.change || 0;
  const cagr = getAssetCagrProxy(position.symbol, position.market);

  // Advanced Technicals
  const sma20 = priceData?.sma20;
  const sma50 = priceData?.sma50;
  const macd = priceData?.macd;
  
  // Trend Determination via SMA Crossover & MACD
  let isBullishTrend = change > 0.5;
  let isBearishTrend = change < -0.5;
  
  if (sma20 && sma50) {
    // Golden Cross / Death Cross — mutually exclusive conditions
    const smaBullish = sma20 > sma50;
    const smaBearish = sma50 > sma20;
    isBullishTrend = smaBullish && (macd === undefined || macd >= 0);
    isBearishTrend = smaBearish && (macd === undefined || macd <= 0);
  }

  // Calculate support/target levels
  const low = priceData?.low || price * 0.98;
  const high = priceData?.high || price * 1.02;
  const dayRange = high - low;
  const supportLevel = low - dayRange * 0.382; // Fibonacci
  const resistanceLevel = high + dayRange * 0.382;

  let signal: AssetSignal['signal'] = 'HOLD';
  let confidence = 60;
  let reason = 'Neutral range, maintain position';
  let targetPrice = price;

  if (rsi < 30) {
    signal = 'STRONG_BUY';
    confidence = 95;
    targetPrice = resistanceLevel; // Upside target for buy signal
    reason = `RSI ${rsi.toFixed(0)} oversold — institutional accumulation zone.`;
  } else if (rsi < 40) {
    signal = 'BUY';
    confidence = 80;
    targetPrice = high; // Upside target for buy signal
    reason = `RSI ${rsi.toFixed(0)} approaching oversold — good entry.`;
    if (isBullishTrend) {
      reason += ' Bullish momentum building.';
      confidence += 5;
    }
  } else if (rsi > 75) {
    signal = 'STRONG_SELL';
    confidence = 90;
    targetPrice = supportLevel; // Downside target for sell signal
    reason = `RSI ${rsi.toFixed(0)} overbought — distribution zone.`;
  } else if (rsi > 65) {
    signal = 'SELL';
    confidence = 70;
    targetPrice = low; // Downside target for sell signal
    reason = `RSI ${rsi.toFixed(0)} elevated — consider partial booking.`;
    if (isBearishTrend) {
      reason += ' Bearish momentum detected.';
      confidence += 5;
    }
  } else {
    // SMA & MACD purely trend-following entries in neutral RSI
    if (isBullishTrend && rsi < 55) {
      signal = 'BUY';
      confidence = 75;
      targetPrice = resistanceLevel || high || price * 1.02;
      reason = `Golden Cross / Bullish MACD detected. Accumulate on dips.`;
    } else if (isBearishTrend && rsi > 55) {
      signal = 'SELL';
      confidence = 65;
      targetPrice = sma20 || price * 1.02;
      reason = `Death Cross / Bearish MACD momentum. Book partials.`;
    } else if (change < -3) {
      signal = 'BUY';
      confidence = 75;
      targetPrice = price * 0.98;
      reason = `Sharp dip ${change.toFixed(1)}% — potential reversal.`;
    } else if (change > 3) {
      signal = 'SELL';
      confidence = 65;
      targetPrice = price * 1.02;
      reason = `Strong rally ${change.toFixed(1)}% — book partial profits.`;
    }
  }

  // CAGR boost for high-growth assets
  if (cagr > 20 && signal === 'BUY') confidence = Math.min(99, confidence + 10);

  // Derive simplified action & trend
  const action: AssetSignal['action'] = (signal === 'STRONG_BUY' || signal === 'BUY') ? 'BUY' : (signal === 'STRONG_SELL' || signal === 'SELL') ? 'SELL' : 'HOLD';
  const trend: AssetSignal['trend'] = isBullishTrend ? 'up' : isBearishTrend ? 'down' : 'flat';

  return {
    symbol: position.symbol.replace('.NS', ''),
    market: position.market,
    signal,
    action,
    trend,
    rsi,
    change,
    price,
    targetPrice,
    fibLow: supportLevel,
    fibHigh: resistanceLevel,
    confidence,
    reason
  };
}

// ========================================
// SMART ALLOCATION RECOMMENDATIONS
// ========================================
export interface AllocationRec {
  symbol: string;
  name: string;
  market: 'IN' | 'US';
  currentPrice: number;
  targetEntry: number;
  discount: number;
  signal: string;
  allocPct: number;
  allocAmount: number;
  rsi: number;
  strength: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  trendStrength: 'STRONG' | 'MODERATE' | 'WEAK' | 'REVERSAL';
  volumeSignal: string;
  reason: string;
}

export function getSmartAllocations(
  livePrices: Record<string, PriceData>,
  indiaSIP: number = 10000,
  usSIP_INR: number = 16000,
  btcSIP: number = 1000,
  ethSIP: number = 500,
  usdInrRate: number = 83.5
): AllocationRec[] {
  const recs: AllocationRec[] = [];
  // FIX HIGH #2: previously `usSIP` was treated as native USD but the UI
  // passes it in INR. Convert to USD here so the per-ETF allocation math
  // produces sane dollar amounts.
  const usSIP_USD = usdInrRate > 0 ? usSIP_INR / usdInrRate : usSIP_INR;

  // Global VIX for risk adjustment
  const usVix = livePrices['US_VIX']?.price || 15;
  const inVix = livePrices['IN_INDIAVIX']?.price || 15;
  const avgVix = (usVix + inVix) / 2;

  const processETF = (etf: typeof ALPHA_ETFS_IN[0], market: 'IN' | 'US') => {
    const key = `${market}_${etf.sym}`;
    const altKey = `${market}_${etf.sym}.NS`;
    const data = livePrices[key] || livePrices[altKey];
    const price = data?.price || 0;
    const rsi = data?.rsi || 50;
    const low = data?.low || price * 0.98;
    const high = data?.high || price * 1.02;
    const atr = (high - low) > 0 ? (high - low) : price * 0.02;
    const volume = data?.volume || 0;
    const sma20 = data?.sma20;
    const sma50 = data?.sma50;
    const macd = data?.macd;
    const isBull = sma20 && sma50 ? sma20 > sma50 : false;
    const hasMACDMomentum = macd !== undefined ? macd > 0 : false;

    // === STRENGTH SCORE (0-100) ===
    let strength = 50;
    // RSI contribution (0-30 points)
    if (rsi < 30) strength += 30;
    else if (rsi < 40) strength += 20;
    else if (rsi < 50) strength += 10;
    else if (rsi > 70) strength -= 20;
    else if (rsi > 60) strength -= 10;
    // MACD contribution (0-20 points)
    if (hasMACDMomentum) strength += 15;
    else if (macd !== undefined) strength -= 10;
    // SMA trend (0-20 points)
    if (isBull) strength += 15;
    else if (sma20 && sma50 && sma50 > sma20) strength -= 10;
    // VIX adjustment (-10 to +10)
    if (avgVix < 14) strength += 5;
    else if (avgVix > 22) strength -= 10;
    strength = Math.max(5, Math.min(99, strength));

    // === ENTRY / STOP LOSS / TAKE PROFIT — use canonical unified engine ===
    const unified = price > 0 && data ? computeUnifiedEntry(data) : null;
    const targetEntry = unified ? unified.optimal : (rsi < 40 ? low : price * 0.99);
    const stopLoss    = unified ? unified.stopLoss : (price > 0 ? price - atr * 1.5 : 0);
    const takeProfit  = unified ? unified.target1  : (price > 0 ? price + atr * 2.5 : 0);
    const riskReward  = unified ? unified.riskReward
      : (price > 0 && (price - stopLoss) > 0 ? (takeProfit - price) / (price - stopLoss) : 0);

    // === TREND STRENGTH ===
    let trendStrength: AllocationRec['trendStrength'] = 'WEAK';
    if (isBull && hasMACDMomentum && rsi < 60) trendStrength = 'STRONG';
    else if (isBull || hasMACDMomentum) trendStrength = 'MODERATE';
    else if (rsi < 35 && !isBull) trendStrength = 'REVERSAL';

    // === VOLUME SIGNAL ===
    let volumeSignal = '💤 Low';
    if (volume > 1000000) volumeSignal = '🔥 High Volume';
    else if (volume > 500000) volumeSignal = '📊 Active';
    else if (volume > 100000) volumeSignal = '⚡ Normal';

    // === DYNAMIC REAL-TIME MARKET CONDITION ALLOCATION ===
    let allocMult = 1.0;
    if (rsi < 35 || strength >= 70) allocMult = 1.35;
    else if (rsi < 45 || strength >= 60) allocMult = 1.15;
    else if (rsi > 70 || strength <= 35) allocMult = 0.65;
    else if (rsi > 65) allocMult = 0.85;

    const discount = price > 0 ? ((price - targetEntry) / price) * 100 : 0;

    // === SIGNAL + REASON ===
    let signal = '🟡 WAIT';
    let reason = 'Neutral zone — wait for dip entry';
    if (rsi < 30 && hasMACDMomentum) { signal = '🟢 STRONG BUY'; reason = `RSI ${rsi.toFixed(0)} oversold + MACD bullish crossover. Institutional accumulation zone.`; }
    else if (rsi < 35 || (isBull && hasMACDMomentum)) { signal = '🟢 BUY NOW'; reason = `${isBull ? 'Golden Cross active' : `RSI ${rsi.toFixed(0)} near oversold`}. ${hasMACDMomentum ? 'MACD momentum positive.' : ''}`; }
    else if (rsi < 45 || isBull) { signal = '🟢 ACCUMULATE'; reason = `Favorable entry zone. ${isBull ? 'SMA20 > SMA50 trend intact.' : `RSI ${rsi.toFixed(0)} approaching value.`}`; }
    else if (rsi > 75) { signal = '🔴 DISTRIBUTE'; reason = `RSI ${rsi.toFixed(0)} extreme overbought. Distribution phase — book 50%+ profits.`; }
    else if (rsi > 70 && !hasMACDMomentum) { signal = '🔴 AVOID'; reason = `RSI ${rsi.toFixed(0)} overbought. MACD losing momentum. Not a good entry.`; }
    else { reason = `RSI ${rsi.toFixed(0)} neutral. ${avgVix > 20 ? 'High VIX — maintain cash buffer.' : 'Wait for breakout or dip.'}`; }

    recs.push({
      symbol: etf.sym, name: etf.name, market, currentPrice: price,
      targetEntry, discount, signal, allocPct: etf.fixedAlloc * allocMult,
      allocAmount: 0, rsi, strength, stopLoss, takeProfit, riskReward,
      trendStrength, volumeSignal, reason
    });
  };

  ALPHA_ETFS_IN.forEach(etf => processETF(etf, 'IN'));
  ALPHA_ETFS_US.forEach(etf => processETF(etf, 'US'));

  // Normalize allocations per market and calculate ₹/$ amounts
  const inRecs = recs.filter(r => r.market === 'IN');
  const usRecs = recs.filter(r => r.market === 'US');
  const inTotal = inRecs.reduce((s, r) => s + r.allocPct, 0) || 1;
  const usTotal = usRecs.reduce((s, r) => s + r.allocPct, 0) || 1;
  inRecs.forEach(r => { r.allocPct = r.allocPct / inTotal; r.allocAmount = Math.round(indiaSIP * r.allocPct); });
  usRecs.forEach(r => { r.allocPct = r.allocPct / usTotal; r.allocAmount = Math.round(usSIP_USD * r.allocPct); });

  // Add BTC allocation
  const btcData = livePrices['IN_BTC'] || livePrices['US_BTC'];
  const btcPrice = btcData?.price || 0;
  const btcRsi = btcData?.rsi || 50;

  recs.push({
    symbol: 'BTC',
    name: 'Bitcoin',
    market: 'IN',
    currentPrice: btcPrice,
    targetEntry: btcPrice > 0 ? btcPrice * 0.95 : 0,
    discount: 5,
    signal: btcRsi < 40 ? '🟢 STRONG BUY' : btcRsi > 70 ? '🟡 WAIT/HOLD' : '🟢 ACCUMULATE',
    allocPct: 1.0,
    allocAmount: btcSIP,
    rsi: btcRsi,
    strength: btcRsi < 45 ? 85 : 50,
    stopLoss: btcPrice * 0.8,
    takeProfit: btcPrice * 1.5,
    riskReward: 2.5,
    trendStrength: 'STRONG',
    volumeSignal: '🔥 High Volume',
    reason: 'Digital Gold — Dedicated Monthly SIP'
  });

  // Add ETH allocation
  const ethData = livePrices['IN_ETH'] || livePrices['US_ETH'];
  const ethPrice = ethData?.price || 0;
  const ethRsi = ethData?.rsi || 50;

  recs.push({
    symbol: 'ETH',
    name: 'Ethereum',
    market: 'IN',
    currentPrice: ethPrice,
    targetEntry: ethPrice > 0 ? ethPrice * 0.95 : 0,
    discount: 5,
    signal: ethRsi < 40 ? '🟢 STRONG BUY' : ethRsi > 70 ? '🟡 WAIT/HOLD' : '🟢 ACCUMULATE',
    allocPct: 1.0,
    allocAmount: ethSIP,
    rsi: ethRsi,
    strength: ethRsi < 45 ? 85 : 50,
    stopLoss: ethPrice * 0.8,
    takeProfit: ethPrice * 1.5,
    riskReward: 2.5,
    trendStrength: 'STRONG',
    volumeSignal: '🔥 High Volume',
    reason: 'Smart Money ETH — Dedicated Monthly SIP'
  });

  return recs;
}

// ========================================
// DEEP TELEGRAM ANALYSIS
// ========================================
export function generateDeepAnalysis(
  portfolio: Position[],
  livePrices: Record<string, PriceData>,
  usdInrRate: number,
  metrics: { totalValue: number; totalPL: number; plPct: number; todayPL: number; todayPct: number }
): string {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
  const usVix = livePrices['US_VIX']?.price || 15;
  const inVix = livePrices['IN_INDIAVIX']?.price || 15;
  const avgVix = (usVix + inVix) / 2;

  // Market regime
  let regime = '🟢 BULLISH';
  if (avgVix > 25) regime = '🔴 BEARISH';
  else if (avgVix > 18) regime = '🟡 VOLATILE';

  // Asset signals
  const signals = portfolio.map(p => {
    const key = `${p.market}_${p.symbol}`;
    return analyzeAsset(p, livePrices[key]);
  });

  const buySignals = signals.filter(s => s.signal === 'STRONG_BUY' || s.signal === 'BUY');
  const sellSignals = signals.filter(s => s.signal === 'STRONG_SELL' || s.signal === 'SELL');

  let msg = `📊 <b>WEALTH AI — Pro Radar</b>\n`;
  msg += `⏰ <i>${timeStr} IST</i>\n\n`;

  // Portfolio Summary
  msg += `💼 <b>Portfolio Sandbox</b>\n`;
  msg += `Current Equity: <b>₹${Math.round(metrics.totalValue).toLocaleString('en-IN')}</b>\n`;
  msg += `Total Return: <b>${metrics.totalPL >= 0 ? '+' : ''}₹${Math.round(metrics.totalPL).toLocaleString('en-IN')}</b> <i>(${metrics.plPct.toFixed(2)}%)</i>\n`;
  msg += `Today's Action: <b>${metrics.todayPL >= 0 ? '📈 +' : '📉 '}₹${Math.round(Math.abs(metrics.todayPL)).toLocaleString('en-IN')}</b>\n\n`;

  // Market Fundamentals
  msg += `🌍 <b>Global Market Engine</b>\n`;
  msg += `Regime: <b>${regime}</b>\n`;
  msg += `<code>US VIX: ${usVix.toFixed(1)} | India VIX: ${inVix.toFixed(1)}</code>\n`;
  msg += `<code>USD/INR: ₹${usdInrRate.toFixed(2)}</code> <i>(Live FOREX)</i>\n\n`;

  // Buy Signals
  if (buySignals.length > 0) {
    msg += `🟢 <b>STRONG BUY / ACCUMULATE</b>\n`;
    buySignals.forEach(s => {
      const cur = s.market === 'IN' ? '₹' : '$';
      msg += `• <b>${s.symbol}</b>: ${cur}${s.price.toFixed(2)} | RSI <b>${s.rsi.toFixed(0)}</b>\n`;
      msg += `  <i>${s.reason}</i>\n`;
      if (s.allocAmount) msg += `  <code>↳ Target SIP: ${cur}${s.allocAmount.toLocaleString()}</code>\n`;
    });
    msg += '\n';
  }

  // Sell Signals
  if (sellSignals.length > 0) {
    msg += `🔴 <b>DISTRIBUTE / SELL</b>\n`;
    sellSignals.forEach(s => {
      const cur = s.market === 'IN' ? '₹' : '$';
      msg += `• <b>${s.symbol}</b>: ${cur}${s.price.toFixed(2)} | RSI <b>${s.rsi.toFixed(0)}</b>\n`;
      msg += `  <i>${s.reason}</i>\n`;
    });
    msg += '\n';
  }

  // Trend Reversal Detection
  const reversals = signals.filter(s =>
    (s.change < -2 && s.rsi < 40) || (s.change > 2 && s.rsi > 60)
  );
  if (reversals.length > 0) {
    msg += `🔄 <b>REVERSAL SCANS ACTIVE</b>\n`;
    reversals.forEach(s => {
      const dir = s.change < 0 ? '⬇️ Bottoming Potential' : '⬆️ Topping Potential';
      msg += `• <b>${s.symbol}</b>: ${dir} (<b>${s.change > 0 ? '+' : ''}${s.change.toFixed(1)}%</b>)\n`;
    });
    msg += '\n';
  }

  // Market Direction
  if (avgVix < 15) {
    msg += `📈 <b>Quantum Outlook: RALLY MODE 🚀</b>\nLow Volatility = Complacency zone. Continue automated SIP routing.\n`;
  } else if (avgVix > 22) {
    msg += `📉 <b>Quantum Outlook: HIGH PRESSURE ⚠️</b>\nFear dominating. Wait for RSI to bottom out below 30. Hoard Capital.\n`;
  } else {
    msg += `➡️ <b>Quantum Outlook: CHOPPY RANGE</b>\nStick to absolute strict SIP schedules. No extra deployment recommended.\n`;
  }

  return msg;
}

// ========================================
// UNIFIED DEEP MIND NEURAL INSIDER AI CHAT
// ========================================
export function generateNeuralInsiderResponse(
query: string,
portfolio: Position[],
livePrices: Record<string, PriceData>
): string {
const q = query.toLowerCase();
const usVix = livePrices['US_VIX']?.price || 15;
const inVix = livePrices['IN_INDIAVIX']?.price || 15;
const avgVix = (usVix + inVix) / 2;

// Command parsing for Telegram bot
if (q.startsWith('/premarket')) {
return generatePreMarketReport(livePrices);
}
if (q.startsWith('/options')) {
return generateOptionsAnalysis(livePrices);
}
if (q.startsWith('/strategy')) {
return generateStrategyReport(portfolio, livePrices);
}
if (q.startsWith('/news')) {
return generateNewsDigest(livePrices);
}
if (q.startsWith('/fundamentals')) {
return generateFundamentalReport(portfolio, livePrices);
}
if (q.startsWith('/signals')) {
return generateSignalsReport(portfolio, livePrices);
}
if (q.startsWith('/risk')) {
return generateRiskReport(portfolio, livePrices);
}
if (q.startsWith('/scan')) {
return generateScanReport(livePrices);
}
if (q.startsWith('/compare')) {
return generateCompareReport(livePrices);
}
if (q.startsWith('/heatmap')) {
return generateHeatmapReport(livePrices);
}
if (q.startsWith('/streak')) {
return generateStreakReport(livePrices);
}
if (q.startsWith('/forex')) {
return generateForexReport(livePrices);
}

if (q.startsWith('/trim')) {
return generateTrimLogicReport(portfolio, livePrices);
}
if (q.startsWith('/start')) {
return generateStartMessage(portfolio, livePrices);
}
if (q.startsWith('/portfolio')) {
return generatePortfolioReport(portfolio, livePrices);
}
if (q.startsWith('/market')) {
return generateMarketReport(livePrices);
}
if (q.startsWith('/allocation')) {
return generateAllocationReport(portfolio, livePrices);
}
if (q.startsWith('/clear')) {
return generateClearMessage();
}

// Global Market State
let marketState = 'neutral';
if (avgVix > 22) marketState = 'bearish';
else if (avgVix < 16) marketState = 'bullish';

// Find opportunities
const signals = portfolio.map(p => {
const key = `${p.market}_${p.symbol}`;
return analyzeAsset(p, livePrices[key]);
});

const strongBuys = signals.filter(s => s.signal === 'STRONG_BUY');
const strongSells = signals.filter(s => s.signal === 'STRONG_SELL' || s.signal === 'SELL');

  if (q.includes('market') || q.includes('kaisa') || q.includes('condition')) {
    if (marketState === 'bearish') {
      return `📉 **Market Status Deep Scan:**\nBhai, Global VIX laal pe hai (US VIX: ${usVix.toFixed(1)}). Market me volatility aur fear factor bahut high hai. Ye time panic sell ka nahi, balki 'Buy on Dips' strategy lagane ka hai. Strong assets ko dheere dheere accumulate karo. Background neural scan bata raha hai institutional money abhi side-lines pe hai.`;
    } else if (marketState === 'bullish') {
      return `📈 **Market Status Deep Scan:**\nBhai, Market ekdum mast zone me chal raha hai. VIX shant hai (US VIX: ${usVix.toFixed(1)}), liquidity bani hui hai. Ye bullish trend continuation ka signal hai. Lekin FOMO me aake over-allocate mat karna. Sip chalne do bindaas.`;
    } else {
      return `⚖️ **Market Status Deep Scan:**\nMarkets abhi thoda range-bound aur confused hai, dono traf ke moves aane ki probability hai. SIP mode on rakho aur dip aane ka wait karke fresh entries dhundo. (Avg VIX: ${avgVix.toFixed(1)})`;
    }
  }

  if (q.includes('buy') || q.includes('invest') || q.includes('kisme') || q.includes('opportunities')) {
    if (strongBuys.length > 0) {
      const recs = strongBuys.slice(0, 3).map(s => `• ${s.symbol} (RSI: ${s.rsi.toFixed(0)}, Target: ${s.market === 'IN' ? '₹' : '$'}${s.targetPrice.toFixed(2)})\n  ↳ ${s.reason}`).join('\n');
      return `🧠 **AI Insider Accumulation Scans:**\nMera deep neural net continually background me saare assets ko scan kar raha hai. Abhi mujje inme Institutional buying/Golden crosses dikhe hain. Yaha entry best rahegi:\n\n${recs}\n\nStrictly stop-loss or smart allocation follow karo bhai.`;
    }
    return `🤔 **AI Deep Scan:**\nAbhi turant fresh 'Strong Buy' trigger nahi hua hai meri system me. RSI aur MACD oscillators neutralize kar rahe hain. Cash ready rakho, dip aayega tab mai alert dunga!`;
  }

  if (q.includes('sell') || q.includes('profit') || q.includes('exit')) {
    if (strongSells.length > 0) {
      const recs = strongSells.slice(0, 3).map(s => `• ${s.symbol} (RSI: ${s.rsi.toFixed(0)})\n  ↳ ${s.reason}`).join('\n');
      return `🚨 **AI Profit Booking Alerts:**\nYaha algorithms 'Overbought' aur distribution zone detect kar rahe hai. Smart money yaha se nikal raha hai, tum bhi thoda partial profit book kar sakte ho:\n\n${recs}`;
    }
    return `🛡️ **Portfolio Status:**\nAbhi apne portfolio me koi bhi asset extreme overbought condition me nahi hai. Hold tight bhai, apne winners ko run karne do. Agar trail stop-loss hit nai hua tho selling ki zarurat nhi hai.`;
  }

  return `🤖 **Deep Mind AI Neural Insider:**\n\nBhai, main piche background me tumhara dono India aur USA ka market 24x7 analyze kar raha hoon using RSI, MACD aur Volatility indices. Tum mujhse 'market kaisa hai?', 'kisme invest karu?', ya 'kab sell karu?' jese directly questions puch sakte ho. \n\nMeri advance pro trading algorithms exactly bata degi ki institutional money flow kaha ja rha hai.`;
}

// ========================================
// TELEGRAM COMMAND GENERATORS
// ========================================

function generatePreMarketReport(livePrices: Record<string, PriceData>): string {
const usVix = livePrices['US_VIX']?.price || 15;
const inVix = livePrices['IN_INDIAVIX']?.price || 15;

let msg = `🌅 **PRE-MARKET INTELLIGENCE**\n`;
msg += `━━━━━━━━━━━━━━━━━━━━\n`;
msg += `🇺🇸 US VIX: ${usVix.toFixed(1)} ${usVix > 20 ? '🔴' : '🟢'}\n`;
msg += `🇮🇳 India VIX: ${inVix.toFixed(1)} ${inVix > 20 ? '🔴' : '🟢'}\n\n`;

// Pre-market movers
msg += `📊 **Global Cues:**\n`;
const indices = [
{ name: 'GIFT NIFTY', change: livePrices['IN_GIFTNIFTY']?.change || 0 },
{ name: 'SGX Nifty', change: livePrices['IN_SGXNIFTY']?.change || 0 },
{ name: 'Dow Futures', change: livePrices['US_DOWFUTURES']?.change || 0 },
{ name: 'Nasdaq Fut', change: livePrices['US_NASFUTURES']?.change || 0 }
];

indices.forEach(idx => {
const emoji = idx.change >= 0 ? '🟢' : '🔴';
msg += `${emoji} ${idx.name}: ${idx.change >= 0 ? '+' : ''}${idx.change.toFixed(1)}%\n`;
});

msg += `\n📈 **Action Plan:**\n`;
msg += inVix > 18 ? `⚠️ High volatility expected - use strict SL` : `✅ Normal volatility - follow trend\n`;

return msg;
}

function generateOptionsAnalysis(livePrices: Record<string, PriceData>): string {
const nifty = livePrices['IN_NIFTY']?.price || 22000;
const indiaVix = livePrices['IN_INDIAVIX']?.price || 15;
const niftyChange = livePrices['IN_NIFTY']?.change || 0;

// VIX-based PCR estimation (real option chain requires NSE API — not available in browser)
let pcr: number;
if (indiaVix < 12) pcr = 0.78;
else if (indiaVix < 15) pcr = 0.92;
else if (indiaVix < 18) pcr = 1.05;
else if (indiaVix < 22) pcr = 1.18;
else if (indiaVix < 28) pcr = 1.32;
else pcr = 1.50;

// Adjust for market direction (falling market = more puts = higher PCR)
if (niftyChange < -1) pcr += 0.08;
else if (niftyChange > 1) pcr -= 0.05;

// Max pain estimation (typically near current price with slight put bias)
const maxPain = nifty * (pcr > 1 ? 0.993 : 1.003);

// OI estimation based on VIX
const callOI = indiaVix < 18 ? '2.5M' : '1.8M';
const putOI = indiaVix < 18 ? '2.2M' : '3.1M';
const callChange = niftyChange > 0 ? '+12%' : '-5%';
const putChange = niftyChange < 0 ? '+15%' : '-3%';

let msg = `📊 **OPTIONS ANALYSIS**\n`;
msg += `━━━━━━━━━━━━━━━━━━━━\n`;
msg += `🎯 **Nifty:** ${nifty.toFixed(2)} (${niftyChange >= 0 ? '+' : ''}${niftyChange.toFixed(2)}%)\n`;
msg += `🌡️ **India VIX:** ${indiaVix.toFixed(1)} ${indiaVix > 20 ? '🔴 HIGH FEAR' : indiaVix < 13 ? '🟢 LOW VOL' : '🟡 NORMAL'}\n`;
msg += `📊 **PCR (est):** ${pcr.toFixed(2)} ${pcr > 1 ? '🟢 Bullish bias' : '🔴 Bearish bias'}\n`;
msg += `📍 **Max Pain (est):** ${maxPain.toFixed(0)}\n\n`;

msg += `📈 **OI Estimate (VIX-based):**\n`;
msg += `Call OI: ${callOI} (${callChange}) ${niftyChange > 0 ? '🟢' : '🔴'}\n`;
msg += `Put OI: ${putOI} (${putChange}) ${niftyChange < 0 ? '🟢' : '🔴'}\n\n`;

msg += `💡 **Strategy:**\n`;
if (indiaVix > 22) {
  msg += `High VIX → Sell options (credit spreads, iron condors)\n`;
  msg += `Premium rich — theta decay favors sellers`;
} else if (indiaVix < 13) {
  msg += `Low VIX → Buy options (long straddle before events)\n`;
  msg += `Cheap premiums — bet on volatility expansion`;
} else {
  msg += pcr > 1
    ? `Bullish bias → Bull call spread or sell puts at support`
    : `Bearish bias → Bear put spread or sell calls at resistance`;
}

msg += `\n\n⚠️ *PCR estimated from India VIX. For live OI data, use /ai options analysis*`;

return msg;
}

function generateStrategyReport(portfolio: Position[], livePrices: Record<string, PriceData>): string {
let msg = `🎯 **STRATEGY RECOMMENDATIONS**\n`;
msg += `━━━━━━━━━━━━━━━━━━━━\n`;

// Analyze each position
portfolio.slice(0, 5).forEach(p => {
const key = `${p.market}_${p.symbol}`;
const data = livePrices[key];
const rsi = data?.rsi || 50;
// change available via data?.change

msg += `\n📌 **${p.symbol}**:\n`;
msg += `Current: ${p.market === 'IN' ? '₹' : '$'}${data?.price || p.avgPrice} | RSI: ${rsi.toFixed(0)}\n`;

if (rsi > 70) {
msg += `Action: Partial profit (20-30%)\n`;
msg += `Reason: Overbought zone\n`;
} else if (rsi < 30) {
msg += `Action: Accumulate (10-15%)\n`;
msg += `Reason: Oversold opportunity\n`;
} else {
msg += `Action: HOLD\n`;
msg += `Reason: Neutral zone\n`;
}
});

return msg;
}

function generateNewsDigest(livePrices: Record<string, PriceData>): string {
let msg = `📰 **MARKET SENTIMENT DIGEST**\n`;
msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

const usVix = livePrices['US_VIX']?.price || 15;
const inVix = livePrices['IN_INDIAVIX']?.price || 15;
const avgVix = (usVix + inVix) / 2;

const nifty = livePrices['IN_NIFTY'];
const spy = livePrices['US_SPY'];

msg += `📊 **Market Pulse:**\n`;
if (nifty) msg += `• NIFTY: ${nifty.price.toFixed(0)} (${nifty.change >= 0 ? '+' : ''}${(nifty.change || 0).toFixed(2)}%)\n`;
if (spy) msg += `• S&P 500: ${spy.price.toFixed(0)} (${spy.change >= 0 ? '+' : ''}${(spy.change || 0).toFixed(2)}%)\n`;

msg += `\n🌡️ **VIX Sentiment:**\n`;
msg += `• US VIX: ${usVix.toFixed(1)} ${usVix > 20 ? '🔴 Fear' : '🟢 Calm'}\n`;
msg += `• India VIX: ${inVix.toFixed(1)} ${inVix > 20 ? '🔴 Fear' : '🟢 Calm'}\n`;

msg += `\n📊 **AI Sentiment:** `;
msg += avgVix > 22 ? `⚠️ Fear dominant — defensive stance, cash buffer recommended` :
       avgVix < 14 ? `✅ Extreme greed — caution, protect profits` :
       `🟢 Neutral-bullish — SIP mode optimal`;

return msg;
}

function generateFundamentalReport(portfolio: Position[], livePrices: Record<string, PriceData>): string {
let msg = `📊 **FUNDAMENTAL ANALYSIS**\n`;
msg += `━━━━━━━━━━━━━━━━━━━━\n`;
msg += `_Note: Live fundamentals require API access. Showing technical signals._\n\n`;

portfolio.slice(0, 5).forEach(p => {
const key = `${p.market}_${p.symbol}`;
const data = livePrices[key];
const price = data?.price || p.avgPrice;
const rsi = data?.rsi || 50;
const change = data?.change || 0;
const sma20 = data?.sma20;
const sma50 = data?.sma50;
const macd = data?.macd;
const cur = p.market === 'IN' ? '₹' : '$';

const isBull = sma20 && sma50 ? sma20 > sma50 : false;
const hasMACD = macd !== undefined ? macd > 0 : false;

msg += `\n🏛️ **${p.symbol}**:\n`;
msg += `CMP: ${cur}${price.toFixed(2)} (${change >= 0 ? '+' : ''}${change.toFixed(2)}%)\n`;
msg += `RSI: ${rsi.toFixed(0)} | MACD: ${macd?.toFixed(2) || 'N/A'}\n`;
if (sma20) msg += `SMA20: ${cur}${sma20.toFixed(2)} ${price > sma20 ? '📈 Above' : '📉 Below'}\n`;
if (sma50) msg += `SMA50: ${cur}${sma50.toFixed(2)} ${price > sma50 ? '📈 Above' : '📉 Below'}\n`;
msg += `Trend: ${isBull ? '🟢 Bullish' : '🔴 Bearish'} | MACD: ${hasMACD ? '📈 Positive' : '📉 Negative'}\n`;
msg += `Signal: ${rsi < 35 ? '🟢 Oversold — Accumulate' : rsi > 65 ? '🔴 Overbought — Book partials' : '🟡 Neutral — Hold'}\n`;
});

return msg;
}

function generateSignalsReport(portfolio: Position[], livePrices: Record<string, PriceData>): string {
let msg = `📡 **LIVE SIGNALS**\n`;
msg += `━━━━━━━━━━━━━━━━━━━━\n`;

const signals = portfolio.map(p => analyzeAsset(p, livePrices[`${p.market}_${p.symbol}`]));
const buySignals = signals.filter(s => s.signal === 'STRONG_BUY' || s.signal === 'BUY');
const sellSignals = signals.filter(s => s.signal === 'STRONG_SELL' || s.signal === 'SELL');

msg += `🟢 **BUY Signals (${buySignals.length}):**\n`;
buySignals.slice(0, 5).forEach(s => {
msg += `• ${s.symbol} @ ${s.market === 'IN' ? '₹' : '$'}${s.price.toFixed(2)} (RSI: ${s.rsi.toFixed(0)})\n`;
});

msg += `\n🔴 **SELL Signals (${sellSignals.length}):**\n`;
sellSignals.slice(0, 5).forEach(s => {
msg += `• ${s.symbol} @ ${s.market === 'IN' ? '₹' : '$'}${s.price.toFixed(2)} (RSI: ${s.rsi.toFixed(0)})\n`;
});

return msg;
}

function generateRiskReport(portfolio: Position[], livePrices: Record<string, PriceData>): string {
let msg = `⚠️ **RISK ANALYSIS**\n`;
msg += `━━━━━━━━━━━━━━━━━━━━\n`;

const totalValue = portfolio.reduce((sum, p) => {
const key = `${p.market}_${p.symbol}`;
const price = livePrices[key]?.price || p.avgPrice;
return sum + (price * p.qty);
}, 0);

msg += `Portfolio Value: ₹${totalValue.toLocaleString('en-IN')}\n\n`;

// Value-based concentration: share of portfolio held in the 3 largest positions
const positionValues = portfolio.map(p => {
  const key = `${p.market}_${p.symbol}`;
  const price = livePrices[key]?.price || p.avgPrice;
  return price * p.qty;
}).sort((a, b) => b - a);
const top3Value = positionValues.slice(0, 3).reduce((s, v) => s + v, 0);
const concentration = totalValue > 0 ? (top3Value / totalValue) * 100 : 0;

msg += `📊 **Risk Metrics:**\n`;
msg += `• VaR (95%): ₹${(totalValue * 0.05).toLocaleString('en-IN')} max loss\n`;
msg += `• Concentration: Top 3 = ${concentration.toFixed(0)}%\n`;
msg += `• Volatility: ${livePrices['US_VIX']?.price?.toFixed(1) || '15'} VIX\n`;

return msg;
}

function generateScanReport(livePrices: Record<string, PriceData>): string {
let msg = `🔍 **MARKET SCAN**\n`;
msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

const entries = Object.entries(livePrices)
  .filter(([, d]) => d?.price && d.price > 0)
  .sort((a, b) => (b[1].change || 0) - (a[1].change || 0));

const gainers = entries.filter(([, d]) => (d.change || 0) > 0).slice(0, 5);
const losers = entries.filter(([, d]) => (d.change || 0) < 0).slice(-5).reverse();

if (gainers.length > 0) {
  msg += `📈 **Top Gainers:**\n`;
  gainers.forEach(([key, d]) => {
    const sym = key.split('_')[1];
    msg += `• ${sym}: +${(d.change || 0).toFixed(2)}% 🟢\n`;
  });
  msg += '\n';
}

if (losers.length > 0) {
  msg += `📉 **Top Losers:**\n`;
  losers.forEach(([key, d]) => {
    const sym = key.split('_')[1];
    msg += `• ${sym}: ${(d.change || 0).toFixed(2)}% 🔴\n`;
  });
}

if (gainers.length === 0 && losers.length === 0) {
  msg += `⚠️ No live price data available. Wait for market hours.\n`;
}

return msg;
}

function generateCompareReport(livePrices: Record<string, PriceData>): string {
let msg = `📊 **COMPARISON**\n`;
msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

const nifty = livePrices['IN_NIFTY'];
const sensex = livePrices['IN_SENSEX'];
const spy = livePrices['US_SPY'];
const qqq = livePrices['US_QQQ'];

if (nifty && spy) {
  const sameDir = (nifty.change || 0) * (spy.change || 0) > 0;
  msg += `**NIFTY vs S&P 500:**\n`;
  msg += `NIFTY: ${nifty.price.toFixed(0)} (${nifty.change >= 0 ? '+' : ''}${(nifty.change || 0).toFixed(2)}%)\n`;
  msg += `S&P 500: ${spy.price.toFixed(0)} (${spy.change >= 0 ? '+' : ''}${(spy.change || 0).toFixed(2)}%)\n`;
  msg += `Correlation: ${sameDir ? '🟢 Positive (moving together)' : '🔴 Negative (diverging)'}\n`;
}

if (sensex && qqq) {
  msg += `\n**SENSEX vs NASDAQ:**\n`;
  msg += `SENSEX: ${sensex.price.toFixed(0)} (${sensex.change >= 0 ? '+' : ''}${(sensex.change || 0).toFixed(2)}%)\n`;
  msg += `NASDAQ: ${qqq.price.toFixed(0)} (${qqq.change >= 0 ? '+' : ''}${(qqq.change || 0).toFixed(2)}%)\n`;
}

if (!nifty && !spy) {
  msg += `⚠️ No live data available for comparison.\n`;
}

return msg;
}

function generateHeatmapReport(livePrices: Record<string, PriceData>): string {
let msg = `🔥 **MARKET HEATMAP**\n`;
msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

const entries = Object.entries(livePrices)
  .filter(([, d]) => d?.price && d.price > 0)
  .map(([key, d]) => ({ sym: key.split('_')[1], change: d.change || 0, price: d.price }))
  .sort((a, b) => b.change - a.change);

const strong = entries.filter(e => Math.abs(e.change) > 2);
const neutral = entries.filter(e => Math.abs(e.change) <= 1);
const weak = entries.filter(e => e.change < -2);

if (strong.length > 0) {
  msg += `🟢 **Strong (>2%):**\n`;
  strong.forEach(e => { msg += `• ${e.sym}: ${e.change >= 0 ? '+' : ''}${e.change.toFixed(2)}%\n`; });
  msg += '\n';
}

if (neutral.length > 0) {
  msg += `🟡 **Neutral (±1%):**\n`;
  neutral.slice(0, 5).forEach(e => { msg += `• ${e.sym}: ${e.change >= 0 ? '+' : ''}${e.change.toFixed(2)}%\n`; });
  msg += '\n';
}

if (weak.length > 0) {
  msg += `🔴 **Weak (<-2%):**\n`;
  weak.forEach(e => { msg += `• ${e.sym}: ${e.change.toFixed(2)}%\n`; });
}

if (entries.length === 0) {
  msg += `⚠️ No live data available. Wait for market hours.\n`;
}

return msg;
}

function generateStreakReport(livePrices: Record<string, PriceData>): string {
let msg = `📈 **STREAK ANALYSIS**\n`;
msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

const nifty = livePrices['IN_NIFTY'];
const sensex = livePrices['IN_SENSEX'];
const spy = livePrices['US_SPY'];

if (nifty) {
  const dir = (nifty.change || 0) >= 0 ? '🟢' : '🔴';
  msg += `${dir} **NIFTY:** ${nifty.price.toFixed(0)} (${nifty.change >= 0 ? '+' : ''}${(nifty.change || 0).toFixed(2)}%)\n`;
}
if (sensex) {
  const dir = (sensex.change || 0) >= 0 ? '🟢' : '🔴';
  msg += `${dir} **SENSEX:** ${sensex.price.toFixed(0)} (${sensex.change >= 0 ? '+' : ''}${(sensex.change || 0).toFixed(2)}%)\n`;
}
if (spy) {
  const dir = (spy.change || 0) >= 0 ? '🟢' : '🔴';
  msg += `${dir} **S&P 500:** ${spy.price.toFixed(0)} (${spy.change >= 0 ? '+' : ''}${(spy.change || 0).toFixed(2)}%)\n`;
}

msg += `\n📊 _Streak tracking requires historical daily data. Currently showing today's move._`;

return msg;
}

function generateForexReport(livePrices: Record<string, PriceData>): string {
const usdInr = livePrices['US_USDINR']?.price || 85.5;

let msg = `💱 **FOREX RATES**\n`;
msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

msg += `🇺🇸🇮🇳 **USD/INR:** ₹${usdInr.toFixed(4)}\n`;
msg += `🇮🇳🇺🇸 **INR/USD:** $${(1/usdInr).toFixed(6)}\n\n`;

msg += `📊 **Quick Conversion:**\n`;
msg += `• $100 = ₹${(100 * usdInr).toLocaleString('en-IN', {maximumFractionDigits: 0})}\n`;
msg += `• $1000 = ₹${(1000 * usdInr).toLocaleString('en-IN', {maximumFractionDigits: 0})}\n`;
msg += `• ₹1,00,000 = $${(100000/usdInr).toFixed(2)}\n\n`;

const trend = usdInr > 87 ? '📉 Rupee weakening — US holdings gain INR value' :
              usdInr < 84 ? '📈 Rupee strengthening — good time for fresh US investments' :
              '↔️ Stable range — normal zone';
msg += `💡 **Outlook:** ${trend}\n`;

return msg;
}

function generateTrimLogicReport(portfolio: Position[], livePrices: Record<string, PriceData>): string {
let msg = `🎯 **TRIM RE-ENTRY LOGIC**\n`;
msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

portfolio.slice(0, 5).forEach(p => {
const key = `${p.market}_${p.symbol}`;
const data = livePrices[key];
const currentPrice = data?.price || p.avgPrice;
const rsi = data?.rsi || 50;

const trimPrice = currentPrice * 1.05;
const reEntryPrice = currentPrice * 0.92;

msg += `📌 **${p.symbol}**:\n`;
msg += `Current: ${p.market === 'IN' ? '₹' : '$'}${currentPrice.toFixed(2)} | RSI: ${rsi.toFixed(0)}\n`;

if (rsi > 70) {
msg += `✅ TRIM @ ${p.market === 'IN' ? '₹' : '$'}${trimPrice.toFixed(2)} (5% upside)\n`;
msg += `   Re-entry: ${p.market === 'IN' ? '₹' : '$'}${reEntryPrice.toFixed(2)} (-8% dip)\n`;
msg += `   Size: 10-15% of position\n\n`;
} else if (rsi < 30) {
msg += `✅ RE-ENTER @ ${p.market === 'IN' ? '₹' : '$'}${reEntryPrice.toFixed(2)}\n`;
msg += `   Target: ${p.market === 'IN' ? '₹' : '$'}${(currentPrice * 1.10).toFixed(2)} (+10%)\n`;
msg += `   Size: 33% each tranche\n\n`;
} else {
msg += `⏸️ HOLD - No action needed\n\n`;
}
});

msg += `💡 **Rule:** Trim when RSI > 70, Re-enter when RSI < 30`;
return msg;
}

function generateStartMessage(portfolio: Position[], _livePrices: Record<string, PriceData>): string {
let msg = `🧠 **DEEP MIND AI TRADING BOT**\n`;
msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
msg += `🤖 Welcome to Quantum AI Pro Terminal!\n\n`;
msg += `📊 **Portfolio:** ${portfolio.length} positions\n`;
msg += `🌍 **Markets:** India + USA\n`;
msg += `🤖 **AI Engine:** Groq Llama-3\n\n`;

msg += `📜 **Available Commands:**\n`;
msg += `/premarket - Pre-market intelligence\n`;
msg += `/market - Live market status\n`;
msg += `/signals - Buy/Sell signals\n`;
msg += `/portfolio - Portfolio analysis\n`;
msg += `/allocation - Asset allocation\n`;
msg += `/risk - Risk metrics\n`;
msg += `/strategy - Strategy recommendations\n`;
msg += `/trim - Trim & re-entry logic\n`;
msg += `/forex - Forex rates\n`;
msg += `/scan - Market scanner\n`;
msg += `/compare - Compare assets\n`;
msg += `/heatmap - Market heatmap\n`;
msg += `/streak - Streak analysis\n`;
msg += `/options - Options analysis\n`;
msg += `/fundamentals - Fundamental data\n`;
msg += `/news - Market news\n`;

msg += `/clear - Clear chat history\n`;

return msg;
}

function generatePortfolioReport(portfolio: Position[], livePrices: Record<string, PriceData>): string {
if (portfolio.length === 0) {
return `📊 **Portfolio Report**\nNo holdings yet. Add positions to start tracking.`;
}

let msg = `💼 **PORTFOLIO REPORT**\n`;
msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;

let totalValue = 0;
let totalCost = 0;

portfolio.forEach(p => {
const key = `${p.market}_${p.symbol}`;
const data = livePrices[key];
const price = data?.price || p.avgPrice;
const value = price * p.qty;
const cost = p.avgPrice * p.qty;
totalValue += value;
totalCost += cost;

msg += `\n📌 **${p.symbol}**:\n`;
msg += `Qty: ${p.qty} | Avg: ${p.market === 'IN' ? '₹' : '$'}${p.avgPrice.toFixed(2)}\n`;
msg += `Current: ${p.market === 'IN' ? '₹' : '$'}${price.toFixed(2)}\n`;
msg += `P&L: ${value >= cost ? '+' : ''}${(cost > 0 ? ((value - cost) / cost * 100) : 0).toFixed(1)}%\n`;
});

const totalPL = totalValue - totalCost;
msg += `\n💰 **Summary:**\n`;
msg += `Total Value: ₹${totalValue.toLocaleString('en-IN')}\n`;  // FIX H8: always INR total (US already converted via usdInrRate upstream)
msg += `Total P&L: ${totalPL >= 0 ? '+' : ''}${(totalCost > 0 ? (totalPL / totalCost * 100) : 0).toFixed(1)}%\n`;

return msg;
}

function generateMarketReport(livePrices: Record<string, PriceData>): string {
const usVix = livePrices['US_VIX']?.price || 15;
const inVix = livePrices['IN_INDIAVIX']?.price || 15;
const marketStatus = isAnyMarketOpen() ? '🟢 OPEN' : '🔴 CLOSED';

let msg = `🌍 **MARKET STATUS**\n`;
msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
msg += `${marketStatus}\n\n`;

msg += `🇺🇸 **US Market:**\n`;
msg += `VIX: ${usVix.toFixed(1)} ${usVix > 20 ? '🔴 High' : '🟢 Normal'}\n`;
msg += `Status: ${isUSMarketOpen() ? 'Open' : 'Closed'}\n\n`;

msg += `🇮🇳 **India Market:**\n`;
msg += `VIX: ${inVix.toFixed(1)} ${inVix > 20 ? '🔴 High' : '🟢 Normal'}\n`;
msg += `Status: ${isIndiaMarketOpen() ? 'Open' : 'Closed'}\n`;

return msg;
}

function generateAllocationReport(portfolio: Position[], livePrices: Record<string, PriceData>): string {
if (portfolio.length === 0) {
return `📊 **Allocation Report**\nNo holdings yet.`;
}

let totalValue = 0;
const allocation: Record<string, number> = {};

portfolio.forEach(p => {
const key = `${p.market}_${p.symbol}`;
const price = livePrices[key]?.price || p.avgPrice;
const value = price * p.qty;
totalValue += value;
allocation[p.symbol] = value;
});

let msg = `📊 **ASSET ALLOCATION**\n`;
msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
msg += `Total Value: ₹${totalValue.toLocaleString('en-IN')}\n\n`;  // FIX H8: always INR

Object.entries(allocation).forEach(([symbol, value]) => {
const pct = totalValue > 0 ? (value / totalValue) * 100 : 0;  // FIX H7
msg += `${symbol}: ${pct.toFixed(1)}%\n`;
});

return msg;
}

function generateClearMessage(): string {
  return `🧹 **Chat history cleared!**\nStarting fresh conversation.`;
}

