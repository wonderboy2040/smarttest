import { PriceData, Position } from '../types';
import { EXACT_TICKER_MAP, guessMarket, API_URL as VITE_API_URL, DEFAULT_USD_INR, isCryptoSymbol, getTodayString } from './constants';
// FIX H10: imports must come before any runtime code per ES module style +
// future bundler strictness. Was previously after `getApiUrl()`.
import { isAnyMarketOpen, isIndiaMarketOpen, isUSMarketOpen, getTimeInZone } from './telegram';

// Proxy base helper — resolves backend server URL dynamically
// 1. Checks localStorage ('WEALTH_AI_BACKEND_URL')
// 2. Checks build-time VITE_API_PROXY
// 3. Defaults to production Render backend (https://smartback-iyuq.onrender.com) if hosted on Vercel/Netlify/GitHub Pages
export function getProxyBase(): string {
  try {
    const custom = localStorage.getItem('WEALTH_AI_BACKEND_URL');
    if (custom && custom.startsWith('http')) return custom.trim().replace(/\/$/, '');
  } catch {}

  const envProxy = (import.meta.env.VITE_API_PROXY as string) || '';
  if (envProxy) return envProxy.replace(/\/$/, '');

  if (typeof window !== 'undefined' && window.location) {
    const host = window.location.hostname;
    if (host.includes('.vercel.app') || host.includes('.github.io') || host.includes('.netlify.app')) {
      // v9.6: the CURRENT production backend. The old smartback URL was
      // a dead service — every Vercel deploy without VITE_API_PROXY set
      // silently pointed at it and login failed. Set VITE_API_PROXY in
      // Vercel to override this default.
      return 'https://smartai1.onrender.com';
    }
  }

  return '';
}

// (v10.13: the legacy module-const PROXY_BASE was removed — every call site
// now resolves getProxyBase() LIVE so a runtime backend switch applies
// everywhere at once. See the batchFetchPrices note.)

// ============================================================
// Centralized API fetch — sends auth token via Authorization header
// (bulletproof for cross-origin: Vercel frontend → Render backend)
// Also sends credentials (httpOnly cookie) as a fallback.
// ============================================================
let _sessionToken: string | null = null;
export function setSessionToken(token: string | null) {
  _sessionToken = token;
  // Store in BOTH sessionStorage (per-tab) and localStorage (persists across
  // browser restarts). This ensures the token survives page refresh, new tab,
  // and browser restart — fixing the "401 after refresh" bug.
  try {
    if (token) {
      sessionStorage.setItem('wealthai_session_token', token);
      localStorage.setItem('wealthai_session_token', token);
    } else {
      sessionStorage.removeItem('wealthai_session_token');
      localStorage.removeItem('wealthai_session_token');
    }
  } catch {}
}
// Restore token on module load — try sessionStorage first, then localStorage.
try {
  const t = sessionStorage.getItem('wealthai_session_token') || localStorage.getItem('wealthai_session_token');
  if (t) _sessionToken = t;
} catch {}

// Track the in-flight auth check so we don't fire it multiple times.
let _authCheckPromise: Promise<boolean> | null = null;

// Check if the current session is valid. If the token is missing or
// invalid, this returns false so the caller can force re-login.
// The check is cached — only runs once per page load.
export async function ensureAuthenticated(): Promise<boolean> {
  // If we already have a token, verify it's still valid.
  if (_sessionToken) {
    if (_authCheckPromise) return _authCheckPromise;
    _authCheckPromise = (async () => {
      try {
        const res = await apiFetch(`/api/auth/check`);
        if (res.ok) {
          const data = await res.json();
          if (data.authenticated) return true;
        }
        // Token invalid — clear it.
        setSessionToken(null);
        return false;
      } catch {
        return false;
      } finally {
        _authCheckPromise = null;
      }
    })();
    return _authCheckPromise;
  }
  return false;
}

export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const proxyBase = getProxyBase();
  let url = input;
  if (!input.startsWith('http')) {
    const cleanPath = input.startsWith('/') ? input : `/${input}`;
    url = `${proxyBase}${cleanPath}`;
  }

  const headers: Record<string, string> = { ...(init.headers as Record<string, string> || {}) };
  // PRIMARY auth: Authorization Bearer token — works cross-origin ALWAYS,
  // no SameSite/cookie/CORS-credential issues.
  if (_sessionToken) {
    headers['Authorization'] = `Bearer ${_sessionToken}`;
  }
  // v1.3 THROTTLE-GUARD: default 30s timeout when the caller didn't supply
  // its own AbortSignal. Prevents corner-case hung requests from stalling
  // the UI indefinitely (all existing explicit timeouts still take priority).
  // v10.13 (deep-recheck L3): no longer MUTATES the caller's init object —
  // a shared/reused init gained a surprise .signal side effect.
  const signal = init.signal ?? AbortSignal.timeout(30000);
  return fetch(url, { ...init, signal, credentials: 'include', headers })
    .then(res => {
      // MIRROR-BANNER FIX (v4.4): any successful API round-trip is proof the
      // Express backend is alive (the /health probe can false-negative on a
      // cold free-tier boot >9s). Throttled global event — StaticMirrorBanner
      // listens and hides itself the moment real traffic succeeds.
      if (res.ok) notifyBackendOnline();
      // v20.1 FIX (deep audit): mid-session 401 — the token expired while the
      // terminal was open. Every REST call used to silently 401 (boards
      // "unreachable", SSE 401-loops) and the UI never fell back to the PIN
      // gate until a manual F5. A throttled 'session-expired' event resets
      // the auth state; useAuthState listens. Wrong-PIN logins also 401 —
      // the reset is a no-op there (user is already at the gate).
      if (res.status === 401) notifySessionExpired();
      return res;
    });
}

let _last401At = 0;
function notifySessionExpired() {
  try {
    if (typeof window === 'undefined' || !window.dispatchEvent) return;
    if (Date.now() - _last401At < 3000) return; // one event per burst
    _last401At = Date.now();
    window.dispatchEvent(new CustomEvent('session-expired'));
  } catch { /* non-browser env */ }
}
/** v20.1 test hook — reset the session-expired burst throttle between cases. */
export function __resetSessionExpiredThrottleForTests() { _last401At = 0; }

let _lastOnlinePing = 0;
function notifyBackendOnline() {
  try {
    if (typeof window === 'undefined' || !window.dispatchEvent) return;
    if (Date.now() - _lastOnlinePing < 5000) return; // throttle event spam
    _lastOnlinePing = Date.now();
    window.dispatchEvent(new CustomEvent('backend-online'));
  } catch { /* non-browser env */ }
}
export function getSessionToken(): string | null { return _sessionToken; }

// SECURITY FIX (audit C1 + v10.13 deep-recheck H-1): Cloud sync auth token.
// Previously a hardcoded shared token was shipped to EVERY browser bundle;
// the audit removed the literal but kept a VITE_API_TOKEN build-time fallback
// — render.yaml invited setting it to the same value as the server's master
// API_TOKEN, which would inline a VALID MASTER BEARER TOKEN into the public
// JS bundle (requireAuth accepts it on every endpoint). The build-time read
// is now REMOVED entirely: cloud sync auth comes from the explicit runtime
// localStorage override (WEALTH_AI_CLOUD_TOKEN) only.
function getCloudAuthToken(): string {
  try {
    const customToken = localStorage.getItem('WEALTH_AI_CLOUD_TOKEN');
    if (customToken) return customToken.trim();
  } catch {}
  return '';
}

export function isCloudSyncConfigured(): boolean {
  return !!getCloudAuthToken();
}

// Runtime API_URL — tries localStorage, server config, then VITE build-time env var
let _runtimeApiUrl: string | null | undefined = undefined;
let _apiUrlPromise: Promise<string> | null = null;

function getApiUrlSync(): string {
  try {
    const custom = localStorage.getItem('WEALTH_AI_CLOUD_URL');
    if (custom && custom.startsWith('http')) return custom.trim();
  } catch {}
  if (_runtimeApiUrl !== undefined && _runtimeApiUrl !== null) return _runtimeApiUrl || VITE_API_URL;
  return VITE_API_URL;
}

function getApiUrl(): Promise<string> {
  try {
    const custom = localStorage.getItem('WEALTH_AI_CLOUD_URL');
    if (custom && custom.startsWith('http')) return Promise.resolve(custom.trim());
  } catch {}
  if (_runtimeApiUrl !== undefined && _runtimeApiUrl !== null) return Promise.resolve(_runtimeApiUrl || VITE_API_URL);
  if (_apiUrlPromise) return _apiUrlPromise;
  _apiUrlPromise = (async () => {
    try {
      const res = await apiFetch(`/api/config`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const cfg = await res.json();
        if (cfg.apiUrl) { _runtimeApiUrl = cfg.apiUrl; return cfg.apiUrl; }
      }
    } catch { /* server not available */ }
    _runtimeApiUrl = null;
    return VITE_API_URL;
  })();
  return _apiUrlPromise;
}

export function getCustomCloudConfig() {
  try {
    return {
      cloudUrl: localStorage.getItem('WEALTH_AI_CLOUD_URL') || '',
      backendUrl: localStorage.getItem('WEALTH_AI_BACKEND_URL') || '',
      cloudToken: localStorage.getItem('WEALTH_AI_CLOUD_TOKEN') || '',
    };
  } catch {
    return { cloudUrl: '', backendUrl: '', cloudToken: '' };
  }
}

export function saveCustomCloudConfig(cloudUrl: string, backendUrl?: string, cloudToken?: string) {
  try {
    if (cloudUrl) localStorage.setItem('WEALTH_AI_CLOUD_URL', cloudUrl.trim());
    else localStorage.removeItem('WEALTH_AI_CLOUD_URL');

    if (backendUrl) localStorage.setItem('WEALTH_AI_BACKEND_URL', backendUrl.trim().replace(/\/$/, ''));
    else localStorage.removeItem('WEALTH_AI_BACKEND_URL');

    if (cloudToken) localStorage.setItem('WEALTH_AI_CLOUD_TOKEN', cloudToken.trim());
    else localStorage.removeItem('WEALTH_AI_CLOUD_TOKEN');

    _runtimeApiUrl = undefined;
    _apiUrlPromise = null;
  } catch {}
}

/**
 * Fetch CoinDCX tickers through the server proxy.
 * CoinDCX's public API does NOT serve Access-Control-Allow-Origin headers,
 * so every direct browser fetch is blocked by CORS. The server's
 * /api/crypto-prices endpoint proxies the call server-side.
 */
async function fetchCoinDcxTickers(): Promise<CoinDcxTicker[] | null> {
  try {
    const res = await apiFetch('/api/crypto-prices', {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}
interface CoinDcxTicker {
  market: string;
  last_price: string;
  change_24_hour: string;
  high: string;
  low: string;
  volume: string;
}

interface TvScannerItem {
  s: string;
  d: (string | number | null)[];
}

// ========================================
// SMART CACHE with TTL
// ========================================
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

class SmartCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  private maxSize: number;

  constructor(maxSize: number = 50) {
    this.maxSize = maxSize;
  }

  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.store.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key: string, data: T, ttl: number = 5000): void {
    if (this.store.size >= this.maxSize) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey) this.store.delete(oldestKey);
    }
    this.store.set(key, { data, timestamp: Date.now(), ttl });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }
}

const priceCache = new SmartCache<PriceData>(50);
const pendingRequests = new Map<string, Promise<PriceData | null>>();

/**
 * Get market-aware batch interval. WebSocket handles real-time;
 * HTTP batch is supplementary for technical indicators (SMA/MACD/RSI).
 */
export function getBatchInterval(): number {
  // PERF (2026 lag audit): 8s → 15s while markets are open. This sync loop
  // complements the SSE/WebSocket streams — it does not need to race them,
  // and every tick re-renders the whole app tree.
  return isAnyMarketOpen() ? 15000 : 60000;
}

/**
 * Poll cadence for the dedicated NSE/BSE realtime streamer.
 * Ultra-fast (3s) while the Indian market is open (9:15 AM - 3:30 PM IST) so
 * holdings tick like a live feed, aggressive pre-market warm-up in the 15 min
 * BEFORE open (9:00-9:15 AM IST) to catch the very first tick, relaxed (30s)
 * when closed to save bandwidth. Mirrors getUSPollInterval exactly.
 */
export function getIndiaPollInterval(): number {
  // 2026-09 ultra-fast pass: 5s → 3s — the server /api/quote path is
  // 3s-micro-cached, so a 3s client poll aligns exactly with the cache
  // cadence (zero extra upstream load) while visible freshness doubles.
  // Real-time ticks still arrive instantly via the TradingView WebSocket
  // (subscribeToPrices) and the server SSE stream — this HTTP poller is
  // only the enrichment/fallback path.
  if (isIndiaMarketOpen()) return 3000;
  // Pre-market warm-up so prices render the instant NSE opens at 9:15 AM IST.
  // v20.7.3 FIX: reuse telegram.ts's robust getTimeInZone (the old
  // `new Date(now.toLocaleString('en-US', { timeZone }))` round-trip is
  // locale-implementation-dependent — FIX M16 documented exactly this).
  const { day, h, m } = getTimeInZone('Asia/Kolkata');
  if (day !== 0 && day !== 6) {
    const mins = h * 60 + m;
    if (mins >= 540 && mins < 555) return 3000; // 9:00-9:15 AM IST pre-open warm-up
    if (mins >= 525 && mins < 540) return 5000;  // 8:45-9:00 AM IST early warm-up
  }
  return 30000;
}

/**
 * Poll cadence for the dedicated US market realtime streamer.
 * Ultra-fast (3s) while the US market is open (7:00 PM IST / 9:30 AM ET),
 * aggressive pre-market (3s) in the 15-minute window BEFORE open to catch
 * the very first tick, relaxed (30s) when closed.
 */
export function getUSPollInterval(): number {
  // 2026-09 ultra-fast pass: 5s → 3s — the server /api/quote path serves
  // from the live usStream session (Finnhub WS trades + TV america/scan
  // batch, both fresher than 3s), so a 3s poll aligns with the server
  // cadence instead of re-fetching upstream.
  if (isUSMarketOpen()) return 3000;
  // Pre-market warm-up: 15 min before US open (9:15-9:30 AM ET / 6:45-7:00 PM IST).
  // Poll fast so the VERY FIRST trade at 9:30 AM ET (7:00 PM IST) renders instantly.
  // v20.7.3 FIX: same robust getTimeInZone path as the India poller above.
  const { day, h, m } = getTimeInZone('America/New_York');
  if (day !== 0 && day !== 6) {
    const mins = h * 60 + m;
    if (mins >= 555 && mins < 570) return 3000; // 9:15-9:30 AM ET pre-open warm-up
    if (mins >= 540 && mins < 555) return 5000;  // 9:00-9:15 AM ET early warm-up
  }
  return 30000;
}

/**
 * Pick the freshest valid price from a TradingView scanner row.
 * Prefers real-time 'last' when the scanner serves it (zero delay), otherwise
 * falls back to 'close' — which IS the live intraday price during market hours.
 * TradingView's anonymous scanner frequently returns last=null; relying on it
 * alone blanked every price and made the UI fall back to the buy price.
 */
function pickScannerPrice(closeVal: unknown, lastVal: unknown): number {
  const last = parseFloat(String(lastVal ?? ''));
  if (!isNaN(last) && last > 0) return last;
  const close = parseFloat(String(closeVal ?? ''));
  return !isNaN(close) && close > 0 ? close : 0;
}

/**
 * REALTIME NSE / BSE STREAMING (HTTP)
 * ------------------------------------------------------------------
 * TradingView's anonymous WebSocket (`unauthorized_user_token`) only streams
 * US exchanges (NASDAQ / NYSE / AMEX / CBOE) in real-time. NSE / BSE quotes are
 * NOT pushed to unauthorized clients, which is exactly why Indian assets looked
 * "frozen" while US assets ticked live.
 *
 * This dedicated fast poller hits the TradingView India scanner directly and
 * feeds prices through the SAME callback pipeline as the WebSocket, so every
 * NSE / BSE holding (stocks AND ETFs) updates in near-real-time just like the
 * US holdings. ETFs are resolved against EXACT_TICKER_MAP first, then fall back
 * to trying BOTH the NSE and BSE listings so either exchange resolves.
 */
export async function batchFetchIndianPrices(
  positions: Position[],
  onUpdate: (key: string, data: PriceData) => void
): Promise<void> {
  // ---- REAL-TIME NSE / BSE PRICES (the India 15-min-delay fix) ----------
  // Price / change / high / low / volume come from the server's /api/quote
  // proxy (Groww NSE live feed — genuine last-traded price — with Yahoo .NS as
  // fallback). The old path read the TradingView India scanner, whose anonymous
  // feed is delayed. SMA / RSI / MACD indicators are still merged from the
  // TradingView India scanner (computed on daily bars, so delay is irrelevant).
  const cleanToKey: Record<string, string> = {};   // RELIANCE -> IN_RELIANCE.NS
  const tvTickers: string[] = [];                    // for indicator enrichment
  const tvToClean: Record<string, string> = {};      // NSE:RELIANCE -> RELIANCE

  positions.forEach(p => {
    if (!p?.symbol) return;
    const mkt = (p.market || guessMarket(p.symbol)).toUpperCase();
    if (mkt !== 'IN') return;
    const cleanSym = p.symbol.replace('.NS', '').replace('.BO', '').trim().toUpperCase();
    if (isCryptoSymbol(cleanSym)) return; // crypto handled by the CoinDCX poller
    cleanToKey[cleanSym] = `IN_${p.symbol.trim()}`;

    if (EXACT_TICKER_MAP[cleanSym]) {
      const t = EXACT_TICKER_MAP[cleanSym];
      tvTickers.push(t);
      tvToClean[t] = cleanSym;
    } else {
      [`NSE:${cleanSym}`, `BSE:${cleanSym}`].forEach(t => {
        tvTickers.push(t);
        tvToClean[t] = cleanSym;
      });
    }
  });

  // Always include India VIX for the regime / fear-greed widgets.
  cleanToKey['INDIAVIX'] = 'IN_INDIAVIX';
  tvTickers.push('NSE:INDIAVIX');
  tvToClean['NSE:INDIAVIX'] = 'INDIAVIX';

  const cleanSyms = Object.keys(cleanToKey);
  if (cleanSyms.length === 0) return;

  const realtimeReq = (async (): Promise<Record<string, PriceData>> => {
    const out: Record<string, PriceData> = {};
    try {
      const url = `/api/quote?market=IN&symbols=${encodeURIComponent(cleanSyms.join(','))}`;
      const res = await apiFetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) return out;
      const json = await res.json();
      const quotes = json?.quotes || {};
      Object.keys(quotes).forEach(sym => {
        const q = quotes[sym];
        if (!q || !(q.price > 0)) return;
        out[sym] = {
          price: q.price,
          change: typeof q.change === 'number' ? q.change : 0,
          high: q.high || q.price,
          low: q.low || q.price,
          volume: q.volume || 0,
          time: q.time || Date.now(),
          prevClose: (typeof q.prevClose === 'number' && q.prevClose > 0) ? q.prevClose : undefined,
          market: 'IN',
        } as PriceData;
      });
    } catch { /* fall back to TradingView below */ }
    return out;
  })();

  const indicatorReq = (async (): Promise<Record<string, Partial<PriceData> & { tvExchange?: string; tvExactSymbol?: string }>> => {
    const out: Record<string, Partial<PriceData> & { tvExchange?: string; tvExactSymbol?: string }> = {};
    const uniqueTv = [...new Set(tvTickers)];
    if (uniqueTv.length === 0) return out;
    try {
      const res = await fetch(`https://scanner.tradingview.com/india/scan?t=${Date.now()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({
          symbols: { tickers: uniqueTv },
          columns: ['name', 'close', 'change', 'high', 'low', 'volume', 'SMA20', 'SMA50', 'RSI', 'MACD.macd', 'last']
        }),
        signal: AbortSignal.timeout(6000)
      });
      if (!res.ok) return out;
      const data = await res.json();
      if (!data?.data) return out;
      (data.data as TvScannerItem[]).forEach(item => {
        if (!item.d) return;
        const clean = tvToClean[item.s];
        if (!clean) return;
        const dv = (idx: number) => item.d![idx] as number | string | undefined;
        const changeVal = parseFloat(item.d[2] as string) || 0;
        if (out[clean]) return; // first exchange that resolves wins
        out[clean] = {
          price: pickScannerPrice(item.d[1], item.d[10]) || undefined,
          change: changeVal,
          high: parseFloat(String(dv(3) ?? '')) || undefined,
          low: parseFloat(String(dv(4) ?? '')) || undefined,
          volume: parseFloat(String(dv(5) ?? '')) || undefined,
          sma20: parseFloat(String(dv(6) ?? '')) || undefined,
          sma50: parseFloat(String(dv(7) ?? '')) || undefined,
          rsi: parseFloat(String(dv(8) ?? '')) || Math.max(10, Math.min(90, 50 + (changeVal * 5))),
          macd: parseFloat(String(dv(9) ?? '')) || undefined,
          tvExchange: item.s.split(':')[0],
          tvExactSymbol: item.s,
        };
      });
    } catch { console.warn('NSE indicator poll failed'); }
    return out;
  })();

  const [realtime, indicators] = await Promise.all([realtimeReq, indicatorReq]);

  cleanSyms.forEach(clean => {
    const key = cleanToKey[clean];
    const rt = realtime[clean];
    const ind = indicators[clean];
    if (!rt && !ind) return;

    // Indian indices (NIFTY, BANKNIFTY etc.) → prefer TV scanner (live index data, more reliable than Yahoo ^NSEI)
    const INDIAN_INDICES = new Set(['NIFTY','BANKNIFTY','SENSEX','INDIAVIX','CNXIT']);
    const useTvPrice = INDIAN_INDICES.has(clean) && !!(ind as any)?.price;
    const price = useTvPrice ? (ind as any).price : (rt?.price ?? (ind as any)?.price);
    if (!price || price <= 0) return;

    // Exact day baseline: real previous close from the quote source when
    // available; else derive from the day-change % (rounded — small drift).
    const dayChange = rt?.change ?? ind?.change ?? 0;
    const derivedPrev = dayChange > -100 ? price / (1 + dayChange / 100) : undefined;

    onUpdate(key, {
      price,
      change: dayChange,
      high: rt?.high ?? ind?.high ?? price,
      low: rt?.low ?? ind?.low ?? price,
      volume: rt?.volume ?? ind?.volume ?? 0,
      sma20: ind?.sma20,
      sma50: ind?.sma50,
      rsi: ind?.rsi ?? Math.max(10, Math.min(90, 50 + (dayChange * 5))),
      macd: ind?.macd,
      time: rt?.time ?? Date.now(),
      prevClose: rt?.prevClose ?? derivedPrev,
      market: 'IN',
      tvExchange: ind?.tvExchange,
      tvExactSymbol: ind?.tvExactSymbol,
      isRealtime: true,
    } as PriceData);
  });
}

/**
 * REALTIME US MARKET STREAMING (HTTP)
 * ------------------------------------------------------------------
 * Mirror of batchFetchIndianPrices but for US assets (SMH, VGT, QQQ, MU etc.).
 * The TradingView WebSocket *does* push US prices, but the scanner HTTP poller
 * provides richer data (SMA/RSI/MACD) and acts as a reliable secondary channel.
 *
 * PRICE FIELD: requests BOTH 'close' and 'last' and uses pickScannerPrice() —
 * prefers real-time 'last' when TradingView serves it, otherwise falls back to
 * 'close' (the live intraday price during market hours). TradingView's anonymous
 * scanner frequently returns last=null; relying on 'last' alone blanked every
 * price and made the portfolio fall back to the buy price (0% change everywhere).
 *
 * Poll cadence: 3s during US market hours, 5s in pre-market (5 min before open),
 * 30s when closed — controlled by getUSPollInterval().
 */
export async function batchFetchUSPrices(
  positions: Position[],
  onUpdate: (key: string, data: PriceData) => void
): Promise<void> {
  // ---- REAL-TIME US PRICES (the 15-min-delay fix) ----------------------
  // Price / change / high / low / volume come from the server's /api/quote
  // proxy (Finnhub or Yahoo real-time — NOT the 15-min-delayed TradingView
  // scanner). Technical indicators (SMA / RSI / MACD) are computed on daily
  // bars, so a small delay there is irrelevant; we still grab them from the
  // TradingView scanner in parallel and MERGE them onto the real-time price.
  const cleanToKey: Record<string, string> = {};   // SMH -> US_SMH
  const tvTickers: string[] = [];                    // for indicator enrichment
  const tvToClean: Record<string, string> = {};      // NASDAQ:SMH -> SMH

  positions.forEach(p => {
    if (!p?.symbol) return;
    const mkt = (p.market || guessMarket(p.symbol)).toUpperCase();
    if (mkt !== 'US') return;
    const cleanSym = p.symbol.replace('.NS', '').replace('.BO', '').trim().toUpperCase();
    if (isCryptoSymbol(cleanSym)) return; // crypto handled by CoinDCX poller
    cleanToKey[cleanSym] = `US_${p.symbol.trim()}`;

    if (EXACT_TICKER_MAP[cleanSym]) {
      const t = EXACT_TICKER_MAP[cleanSym];
      tvTickers.push(t);
      tvToClean[t] = cleanSym;
    } else {
      [`NASDAQ:${cleanSym}`, `NYSE:${cleanSym}`, `AMEX:${cleanSym}`, `ARCA:${cleanSym}`].forEach(t => {
        tvTickers.push(t);
        tvToClean[t] = cleanSym;
      });
    }
  });

  // Always include US VIX for the regime / fear-greed widgets.
  cleanToKey['VIX'] = 'US_VIX';
  tvTickers.push('CBOE:VIX');
  tvToClean['CBOE:VIX'] = 'VIX';

  const cleanSyms = Object.keys(cleanToKey);
  if (cleanSyms.length === 0) return;

  // Fire both requests in parallel: real-time quotes + delayed-but-fine indicators.
  const realtimeReq = (async (): Promise<Record<string, PriceData>> => {
    const out: Record<string, PriceData> = {};
    try {
      const url = `/api/quote?market=US&symbols=${encodeURIComponent(cleanSyms.join(','))}`;
      const res = await apiFetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) return out;
      const json = await res.json();
      const quotes = json?.quotes || {};
      Object.keys(quotes).forEach(sym => {
        const q = quotes[sym];
        if (!q || !(q.price > 0)) return;
        out[sym] = {
          price: q.price,
          change: typeof q.change === 'number' ? q.change : 0,
          high: q.high || q.price,
          low: q.low || q.price,
          volume: q.volume || 0,
          time: q.time || Date.now(),
          prevClose: (typeof q.prevClose === 'number' && q.prevClose > 0) ? q.prevClose : undefined,
          market: 'US',
        } as PriceData;
      });
    } catch { /* fall back to TradingView below */ }
    return out;
  })();

  const indicatorReq = (async (): Promise<Record<string, Partial<PriceData> & { tvExchange?: string; tvExactSymbol?: string }>> => {
    const out: Record<string, Partial<PriceData> & { tvExchange?: string; tvExactSymbol?: string }> = {};
    const uniqueTv = [...new Set(tvTickers)];
    if (uniqueTv.length === 0) return out;
    try {
      const res = await fetch(`https://scanner.tradingview.com/america/scan?t=${Date.now()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({
          symbols: { tickers: uniqueTv },
          columns: ['name', 'close', 'change', 'high', 'low', 'volume', 'SMA20', 'SMA50', 'RSI', 'MACD.macd', 'last']
        }),
        signal: AbortSignal.timeout(6000)
      });
      if (!res.ok) return out;
      const data = await res.json();
      if (!data?.data) return out;
      (data.data as TvScannerItem[]).forEach(item => {
        if (!item.d) return;
        const clean = tvToClean[item.s];
        if (!clean) return;
        const dv = (idx: number) => item.d![idx] as number | string | undefined;
        const changeVal = parseFloat(item.d[2] as string) || 0;
        // First exchange that resolves wins (don't overwrite with a later empty row).
        if (out[clean]) return;
        out[clean] = {
          // delayed fallback price (only used if real-time quote missing)
          price: pickScannerPrice(item.d[1], item.d[10]) || undefined,
          change: changeVal,
          high: parseFloat(String(dv(3) ?? '')) || undefined,
          low: parseFloat(String(dv(4) ?? '')) || undefined,
          volume: parseFloat(String(dv(5) ?? '')) || undefined,
          sma20: parseFloat(String(dv(6) ?? '')) || undefined,
          sma50: parseFloat(String(dv(7) ?? '')) || undefined,
          rsi: parseFloat(String(dv(8) ?? '')) || Math.max(10, Math.min(90, 50 + (changeVal * 5))),
          macd: parseFloat(String(dv(9) ?? '')) || undefined,
          tvExchange: item.s.split(':')[0],
          tvExactSymbol: item.s,
        };
      });
    } catch { console.warn('US indicator poll failed'); }
    return out;
  })();

  const [realtime, indicators] = await Promise.all([realtimeReq, indicatorReq]);

  // Merge: real-time price wins; indicators enrich. Emit one update per holding.
  cleanSyms.forEach(clean => {
    const key = cleanToKey[clean];
    const rt = realtime[clean];
    const ind = indicators[clean];
    if (!rt && !ind) return;

    // Price source priority: real-time quote → delayed scanner close (fallback).
    const price = rt?.price ?? ind?.price;
    if (!price || price <= 0) return;

    // Exact day baseline: real previous close when the quote source served
    // one; else derive from the day-change % (rounded — small drift).
    const dayChange = rt?.change ?? ind?.change ?? 0;
    const derivedPrev = dayChange > -100 ? price / (1 + dayChange / 100) : undefined;

    onUpdate(key, {
      price,
      change: dayChange,
      high: rt?.high ?? ind?.high ?? price,
      low: rt?.low ?? ind?.low ?? price,
      volume: rt?.volume ?? ind?.volume ?? 0,
      sma20: ind?.sma20,
      sma50: ind?.sma50,
      rsi: ind?.rsi ?? Math.max(10, Math.min(90, 50 + (dayChange * 5))),
      macd: ind?.macd,
      time: rt?.time ?? Date.now(),
      prevClose: rt?.prevClose ?? derivedPrev,
      market: 'US',
      tvExchange: ind?.tvExchange,
      tvExactSymbol: ind?.tvExactSymbol,
      isRealtime: true,
    } as PriceData);
  });
}

export async function fetchSinglePrice(symbol: string, retryAttempt = 0): Promise<PriceData | null> {
  if (!symbol) return null;

  const sym = symbol.toUpperCase().trim();

  // Check cache first (stale-while-revalidate pattern)
  const cached = priceCache.get(sym);
  if (cached) {
    // Return cached data but fetch fresh in background (SWR)
    const data = { ...cached, time: Date.now() };
    fetchWithStaleCheck(sym, retryAttempt);
    return data;
  }

  // Deduplicate in-flight requests
  if (pendingRequests.has(sym)) {
    return pendingRequests.get(sym)!;
  }

  const promise = fetchWithStaleCheck(sym, retryAttempt);
  pendingRequests.set(sym, promise);
  promise.finally(() => pendingRequests.delete(sym));
  return promise;
}

async function fetchWithStaleCheck(sym: string, retryAttempt: number): Promise<PriceData | null> {
  if (!sym || typeof sym !== 'string') {
    return null;
  }

  const cleanSym = sym.replace('.NS', '').replace('.BO', '');
  const isIndian = sym.includes('.NS') || sym.includes('.BO') || sym.endsWith('BEES') || guessMarket(sym) === 'IN'; // FIX M10: endswith

  // Try CoinDCX first via server proxy (direct INR price — matches user's exchange)
  // NOTE: CoinDCX's API does NOT serve CORS headers, so browser-side fetches
  // are always blocked. We use the server proxy at /api/crypto-prices instead.
  if (isCryptoSymbol(cleanSym)) {
    try {
      const tickers = await fetchCoinDcxTickers();
      if (tickers) {
        // CoinDCX markets: BTCINR, ETHINR, SOLINR, etc.
        const inrTicker = tickers.find((t: any) => t.market === `${cleanSym}INR`);
        if (inrTicker && inrTicker.last_price) {
          const priceVal = parseFloat(inrTicker.last_price);
          const changeVal = parseFloat(inrTicker.change_24_hour) || 0;
          if (!isNaN(priceVal) && priceVal > 0) {
            const result: PriceData = {
              price: priceVal,
              change: changeVal,
              high: parseFloat(inrTicker.high) || priceVal,
              low: parseFloat(inrTicker.low) || priceVal,
              volume: parseFloat(inrTicker.volume) || 0,
              rsi: 50,
              market: 'IN',
              tvExchange: 'COINDCX',
              tvExactSymbol: `${cleanSym}INR`,
              time: Date.now()
            };
            const cacheTTL = 5000; // Crypto is 24/7
            priceCache.set(sym, result, cacheTTL);
            return result;
          }
        }
      }
    } catch (e) { console.warn('CoinDCX fetch failed:', e); }
  }

  // Binance fallback for crypto (USD price — will be converted to INR by WebSocket handler)
  if (isCryptoSymbol(cleanSym)) {
    try {
      const binanceSym = `${cleanSym}USDT`;
      const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${binanceSym}`, {
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) {
        const data = await res.json();
        const priceVal = parseFloat(data.lastPrice);
        const changeVal = parseFloat(data.priceChangePercent);
        if (!isNaN(priceVal) && priceVal > 0) {
          const result: PriceData = {
            price: priceVal,
            change: changeVal,
            high: parseFloat(data.highPrice) || priceVal,
            low: parseFloat(data.lowPrice) || priceVal,
            volume: parseFloat(data.volume) || 0,
            rsi: 50,
            market: 'IN',
            tvExchange: 'BINANCE',
            tvExactSymbol: binanceSym,
            time: Date.now()
          };
          const cacheTTL = 5000;
          priceCache.set(sym, result, cacheTTL);
          return result;
        }
      }
    } catch (e) { console.warn('Binance fetch failed:', e); }
  }

  // Try TradingView first
  try {
    const tvResult = await tryTradingView(sym, cleanSym, isIndian);
    if (tvResult && tvResult.price > 0) {
      const cacheTTL = isAnyMarketOpen() ? 5000 : 30000;
      priceCache.set(sym, tvResult, cacheTTL);
      return tvResult;
    }
  } catch (e) { console.warn('TradingView fetch failed:', e); }

  // Retry with alternate symbol
  if (retryAttempt < 1 && !sym.includes('.NS') && guessMarket(sym) === 'IN') {
    return fetchSinglePrice(sym + '.NS', retryAttempt + 1);
  }

  return null;
}

async function tryTradingView(_sym: string, cleanSym: string, isIndian: boolean): Promise<PriceData | null> {
  const endpoint = isIndian ? 'india' : 'america';

  let tvTickers: string[];
  if (EXACT_TICKER_MAP[cleanSym]) {
    tvTickers = [EXACT_TICKER_MAP[cleanSym]];
  } else if (isIndian) {
    tvTickers = [`NSE:${cleanSym}`, `BSE:${cleanSym}`];
  } else {
    tvTickers = [`NASDAQ:${cleanSym}`, `NYSE:${cleanSym}`, `AMEX:${cleanSym}`, `ARCA:${cleanSym}`];
  }

  try {
    const res = await fetch(`https://scanner.tradingview.com/${endpoint}/scan?t=${Date.now()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({
        symbols: { tickers: tvTickers },
        columns: ['name', 'close', 'change', 'high', 'low', 'volume', 'SMA20', 'SMA50', 'RSI', 'MACD.macd', 'last']
      }),
      signal: AbortSignal.timeout(3000)
    });

    if (res.ok) {
      const data = await res.json();
      if (data?.data?.length > 0) {
        const items = data.data as TvScannerItem[];
        const item = items.find(x => x.d && pickScannerPrice(x.d[1], x.d[10]) > 0) || items.find(x => x.d) || items[0];
        if (!item?.d) return null;
        const f = (idx: number) => parseFloat(String(item.d![idx] ?? ''));
        const priceVal = pickScannerPrice(item.d[1], item.d[10]);
        const changeVal = f(2) || 0;

        if (!isNaN(priceVal) && priceVal > 0) {
          return {
            price: priceVal,
            change: changeVal,
            high: f(3) || priceVal,
            low: f(4) || priceVal,
            volume: f(5) || 0,
            sma20: f(6) || undefined,
            sma50: f(7) || undefined,
            rsi: f(8) || Math.max(10, Math.min(90, 50 + (changeVal * 5))),
            macd: f(9) || undefined,
            market: isIndian ? 'IN' : 'US',
            tvExchange: item.s.split(':')[0],
            tvExactSymbol: item.s,
            time: Date.now()
          };
        }
      }
    }
  } catch (e) { console.warn('TradingView single fetch failed:', e); }

  return null;
}

export async function batchFetchPrices(
  positions: Position[],
  onUpdate: (key: string, data: PriceData) => void
): Promise<void> {
  const inCleanSyms: string[] = [];
  const usCleanSyms: string[] = [];
  const cleanToKey: Record<string, string> = {};
  const tvTickers: string[] = [];
  const tvToClean: Record<string, string> = {};
  const cryptoPositions: Position[] = [];

  positions.forEach(p => {
    if (!p?.symbol) return;
    const mkt = (p.market || guessMarket(p.symbol)).toUpperCase();
    const key = `${mkt}_${p.symbol.trim()}`;
    const cleanSym = p.symbol.replace('.NS', '').replace('.BO', '').trim().toUpperCase();

    if (isCryptoSymbol(cleanSym)) {
      cryptoPositions.push(p);
      return;
    }

    if (mkt === 'IN' || mkt === 'US') {
      if (mkt === 'IN') inCleanSyms.push(cleanSym);
      else usCleanSyms.push(cleanSym);
      cleanToKey[cleanSym] = key;

      if (EXACT_TICKER_MAP[cleanSym]) {
        const t = EXACT_TICKER_MAP[cleanSym];
        tvTickers.push(t);
        tvToClean[t] = cleanSym;
      } else if (mkt === 'IN') {
        [`NSE:${cleanSym}`, `BSE:${cleanSym}`].forEach(t => {
          tvTickers.push(t);
          tvToClean[t] = cleanSym;
        });
      } else {
        [`NASDAQ:${cleanSym}`, `NYSE:${cleanSym}`, `AMEX:${cleanSym}`, `ARCA:${cleanSym}`].forEach(t => {
          tvTickers.push(t);
          tvToClean[t] = cleanSym;
        });
      }
    }
  });

  // Add VIX indices
  inCleanSyms.push('INDIAVIX');
  cleanToKey['INDIAVIX'] = 'IN_INDIAVIX';
  tvTickers.push('NSE:INDIAVIX');
  tvToClean['NSE:INDIAVIX'] = 'INDIAVIX';

  usCleanSyms.push('VIX');
  cleanToKey['VIX'] = 'US_VIX';
  tvTickers.push('CBOE:VIX');
  tvToClean['CBOE:VIX'] = 'VIX';

  const allInSyms = [...new Set(inCleanSyms)];
  const allUsSyms = [...new Set(usCleanSyms)];

  // 1) REAL-TIME PRICES from server /api/quote (never delayed — Yahoofinance/Finnhub/Groww)
  const realtimeReq = (async (): Promise<Record<string, PriceData>> => {
    const out: Record<string, PriceData> = {};
    const tasks: Promise<void>[] = [];

    if (allInSyms.length > 0) {
      tasks.push((async () => {
        try {
          // v10.13 (deep-recheck L4): live base — the module-const PROXY_BASE
          // froze the backend at bundle load, so a runtime backend switch
          // (WEALTH_AI_BACKEND_URL) left these batch quotes hitting the OLD
          // server while every apiFetch call used the new one.
          const url = `${getProxyBase()}/api/quote?market=IN&symbols=${encodeURIComponent(allInSyms.join(','))}`;
          const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
          if (!res.ok) return;
          const json = await res.json();
          const quotes = json?.quotes || {};
          Object.entries(quotes).forEach(([sym, q]: [string, any]) => {
            if (!q || !(q.price > 0)) return;
            out[sym] = {
              price: q.price,
              change: typeof q.change === 'number' ? q.change : 0,
              high: q.high || q.price,
              low: q.low || q.price,
              volume: q.volume || 0,
              prevClose: (typeof q.prevClose === 'number' && q.prevClose > 0) ? q.prevClose : undefined,
              time: q.time || Date.now(),
              market: 'IN',
            } as PriceData;
          });
        } catch { /* fallback */ }
      })());
    }

    if (allUsSyms.length > 0) {
      tasks.push((async () => {
        try {
          const url = `${getProxyBase()}/api/quote?market=US&symbols=${encodeURIComponent(allUsSyms.join(','))}`;
          const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
          if (!res.ok) return;
          const json = await res.json();
          const quotes = json?.quotes || {};
          Object.entries(quotes).forEach(([sym, q]: [string, any]) => {
            if (!q || !(q.price > 0)) return;
            out[sym] = {
              price: q.price,
              change: typeof q.change === 'number' ? q.change : 0,
              high: q.high || q.price,
              low: q.low || q.price,
              volume: q.volume || 0,
              prevClose: (typeof q.prevClose === 'number' && q.prevClose > 0) ? q.prevClose : undefined,
              time: q.time || Date.now(),
              market: 'US',
            } as PriceData;
          });
        } catch { /* fallback */ }
      })());
    }

    await Promise.allSettled(tasks);
    return out;
  })();

  // 2) TECHNICAL INDICATORS from TV scanner (SMA/RSI/MACD — computed on daily bars, delay irrelevant)
  const indicatorReq = (async (): Promise<Record<string, Partial<PriceData> & { tvExchange?: string; tvExactSymbol?: string }>> => {
    const out: Record<string, Partial<PriceData> & { tvExchange?: string; tvExactSymbol?: string }> = {};
    const uniqueTv = [...new Set(tvTickers)];
    if (uniqueTv.length === 0) return out;
    try {
      const res = await fetch(`https://scanner.tradingview.com/global/scan?t=${Date.now()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({
          symbols: { tickers: uniqueTv },
          columns: ['name', 'close', 'change', 'high', 'low', 'volume', 'SMA20', 'SMA50', 'RSI', 'MACD.macd', 'last']
        }),
        signal: AbortSignal.timeout(6000)
      });
      if (!res.ok) return out;
      const data = await res.json();
      if (!data?.data) return out;
      (data.data as TvScannerItem[]).forEach(item => {
        if (!item.d) return;
        const clean = tvToClean[item.s];
        if (!clean || out[clean]) return;
        const dv = (idx: number) => item.d![idx] as number | string | undefined;
        const changeVal = parseFloat(item.d[2] as string) || 0;
        out[clean] = {
          // delayed fallback price (only used if real-time quote missing)
          price: pickScannerPrice(item.d[1], item.d[10]) || undefined,
          change: changeVal,
          high: parseFloat(String(dv(3) ?? '')) || undefined,
          low: parseFloat(String(dv(4) ?? '')) || undefined,
          volume: parseFloat(String(dv(5) ?? '')) || undefined,
          sma20: parseFloat(String(dv(6) ?? '')) || undefined,
          sma50: parseFloat(String(dv(7) ?? '')) || undefined,
          rsi: parseFloat(String(dv(8) ?? '')) || Math.max(10, Math.min(90, 50 + (changeVal * 5))),
          macd: parseFloat(String(dv(9) ?? '')) || undefined,
          tvExchange: item.s.split(':')[0],
          tvExactSymbol: item.s,
        };
      });
    } catch { console.warn('TV indicator poll failed'); }
    return out;
  })();

  // 3) CRYPTO from CoinDCX via server proxy
  const cryptoReq = (async (): Promise<void> => {
    if (cryptoPositions.length === 0) return;
    try {
      const tickers = await fetchCoinDcxTickers();
      if (tickers) {
        cryptoPositions.forEach(p => {
          const cleanSym = p.symbol.replace('.NS', '').replace('.BO', '').trim().toUpperCase();
          const inrTicker = (tickers as CoinDcxTicker[]).find(t => t.market === `${cleanSym}INR`);
          if (inrTicker && inrTicker.last_price) {
            const priceVal = parseFloat(inrTicker.last_price);
            const changeVal = parseFloat(inrTicker.change_24_hour) || 0;
            const key = `IN_${p.symbol.trim()}`;
            if (!isNaN(priceVal) && priceVal > 0) {
              onUpdate(key, {
                price: priceVal,
                change: changeVal,
                high: parseFloat(inrTicker.high) || priceVal,
                low: parseFloat(inrTicker.low) || priceVal,
                volume: parseFloat(inrTicker.volume) || 0,
                rsi: 50,
                time: Date.now(),
                market: 'IN',
                tvExchange: 'COINDCX',
                tvExactSymbol: `${cleanSym}INR`,
                isRealtime: true
              });
            }
          }
        });
      }
    } catch { console.warn('CoinDCX batch fetch failed'); }
  })();

  const [realtime, indicators] = await Promise.all([realtimeReq, indicatorReq]);
  await cryptoReq;

  // 4) MERGE: real-time price wins, technical indicators enrich
  const allSyms = [...new Set([...Object.keys(cleanToKey)])];
  allSyms.forEach(sym => {
    const key = cleanToKey[sym];
    if (!key) return;
    const rt = realtime[sym];
    const ind = indicators[sym];
    if (!rt && !ind) return;

    // Indian indices (NIFTY, BANKNIFTY etc.) → prefer TV scanner (live index data, more reliable than Yahoo ^NSEI)
    const INDIAN_INDICES = new Set(['NIFTY','BANKNIFTY','SENSEX','INDIAVIX','CNXIT']);
    const useTvPrice = INDIAN_INDICES.has(sym) && !!(ind as any)?.price;
    const price = useTvPrice ? (ind as any).price : (rt?.price ?? (ind as any)?.price);
    if (!price || price <= 0) return;

    const usingRealtime = !useTvPrice && !!rt;
    onUpdate(key, {
      price,
      change: usingRealtime ? (rt!.change ?? 0) : (ind?.change ?? 0),
      high: rt?.high ?? ind?.high ?? price,
      low: rt?.low ?? ind?.low ?? price,
      volume: rt?.volume ?? ind?.volume ?? 0,
      sma20: ind?.sma20,
      sma50: ind?.sma50,
      rsi: ind?.rsi ?? Math.max(10, Math.min(90, 50 + ((rt?.change ?? 0) * 5))),
      macd: ind?.macd,
      time: rt?.time ?? Date.now(),
      market: key.startsWith('IN_') ? 'IN' : 'US',
      tvExchange: ind?.tvExchange,
      tvExactSymbol: ind?.tvExactSymbol,
      isRealtime: usingRealtime,
    } as PriceData);
  });
}

export async function fetchForexRate(): Promise<number> {
  // Primary: server-side proxy (cached, no CORS issues, fastest)
  try {
    const res = await apiFetch('/api/forex', {
      signal: AbortSignal.timeout(4000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.usdInr) {
        const price = parseFloat(data.usdInr);
        if (!isNaN(price) && price > 50 && price < 150) return price;
      }
    }
  } catch { /* fall through to direct APIs */ }

  // Fallback 1: Open ER-API (CORS-friendly)
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/USD?t=${Date.now()}`, {
      signal: AbortSignal.timeout(4000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.rates?.INR) {
        const price = parseFloat(data.rates.INR);
        if (!isNaN(price) && price > 50 && price < 150) return price;
      }
    }
  } catch (e) { console.warn('Open ER-API forex fetch failed:', e); }

  // Fallback 2: Frankfurter API (free, CORS-friendly, no key)
  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=USD&to=INR&t=${Date.now()}`, {
      signal: AbortSignal.timeout(4000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.rates?.INR) {
        const price = parseFloat(data.rates.INR);
        if (!isNaN(price) && price > 50 && price < 150) return price;
      }
    }
  } catch (e) { console.warn('Frankfurter forex fallback failed:', e); }

  // Fallback 3: ExchangeRate-API free tier
  try {
    const res = await fetch(`https://api.exchangerate-api.com/v4/latest/USD?t=${Date.now()}`, {
      signal: AbortSignal.timeout(4000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.rates?.INR) {
        const price = parseFloat(data.rates.INR);
        if (!isNaN(price) && price > 50 && price < 150) return price;
      }
    }
  } catch (e) { console.warn('ExchangeRate-API fallback failed:', e); }

  return DEFAULT_USD_INR; // Default fallback
}

// FIX (audit M6): fetchForexRate() returns the hardcoded DEFAULT_USD_INR
// (83.5) when ALL sources fail — callers that blindly setUsdInrRate(rate)
// then overwrite a good, previously-fetched rate with the stale default,
// silently skewing every USD→INR conversion (metrics, planner, ledger).
// This variant returns null on failure so callers can keep the last good rate.
export async function fetchForexRateOrNull(): Promise<number | null> {
  try {
    const rate = await fetchForexRate();
    // fetchForexRate returns exactly DEFAULT_USD_INR on total failure. Treat
    // an exact-default hit as "no data" ONLY when it also matches the
    // well-known fallback constant; a genuine live rate equal to the default
    // is astronomically unlikely (and harmless to skip for one cycle).
    if (rate === DEFAULT_USD_INR) return null;
    return rate;
  } catch {
    return null;
  }
}

// ============================================================
// CLOUD SYNC — Dual-mode: backend proxy first, direct fallback
// ============================================================
// Mode 1: Backend proxy (/api/cloud/load) — works cross-origin, keeps
//         token server-side. Used when API_URL + API_TOKEN are set on
//         the Render backend.
// Mode 2: Direct Google Apps Script call — fallback when backend proxy
//         is not configured (503) or unreachable. Uses VITE_API_URL +
//         VITE_API_TOKEN (build-time env vars). This is the original
//         mode that worked on Render.
//
// This dual-mode approach ensures cloud sync works in ALL deployment
// scenarios: Render same-origin, Vercel cross-origin, and any mix of
// env var configurations.
// ============================================================

// Extract the first complete top-level JSON object from a string.
function extractBalancedJSON(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return text.substring(start, i + 1); }
  }
  return null;
}

// Parse the response from Google Apps Script (which sometimes wraps JSON).
function parseCloudResponse(text: string): any | null {
  let data;
  try { data = JSON.parse(text); }
  catch {
    const extracted = extractBalancedJSON(text);
    if (!extracted) return null;
    try { data = JSON.parse(extracted); } catch { return null; }
  }
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return null; }
  }
  return data;
}

// Helper to extract portfolio items array from various response object shapes or top-level arrays
function extractPortfolioList(data: any): any[] | null {
  if (!data) return null;
  if (Array.isArray(data)) return data;
  if (typeof data === 'object') {
    if (Array.isArray(data.portfolio)) return data.portfolio;
    if (Array.isArray(data.positions)) return data.positions;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data.assets)) return data.assets;
    if (Array.isArray(data.items)) return data.items;
    // Check if any top-level key contains an array of objects
    for (const key of Object.keys(data)) {
      if (Array.isArray(data[key]) && data[key].length > 0 && typeof data[key][0] === 'object') {
        return data[key];
      }
    }
  }
  return null;
}

// Parse CSV output published directly from Google Sheets
function parseCSVPortfolio(text: string): Position[] {
  if (!text || typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const splitLine = (line: string): string[] => {
    const res: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; }
      else if (c === ',' && !inQ) { res.push(cur.trim()); cur = ''; }
      else { cur += c; }
    }
    res.push(cur.trim());
    return res;
  };

  const headers = splitLine(lines[0]);
  const rows: Record<string, any>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = splitLine(lines[i]);
    if (vals.length < 2) continue;
    const row: Record<string, any> = {};
    headers.forEach((h, idx) => {
      if (vals[idx] !== undefined) row[h] = vals[idx];
    });
    rows.push(row);
  }

  return validatePortfolio(rows);
}

// Helper to parse numbers from strings containing currency symbols (₹, $, €, Rs) and commas (1,000)
function parseNumeric(val: any): number {
  if (typeof val === 'number') return val;
  if (val === null || val === undefined) return NaN;
  const str = String(val).trim();
  const cleaned = str.replace(/[^0-9.-]/g, '');
  return parseFloat(cleaned);
}

// Validate and filter portfolio positions with ultra-flexible field mapping.
function validatePortfolio(portfolio: any[]): Position[] {
  if (!Array.isArray(portfolio)) return [];
  const valid: Position[] = [];

  const SYMBOL_ALIASES = ['symbol', 'ticker', 'stock', 'asset', 'company', 'companyname', 'stockname', 'assetname', 'name', 'scrip', 'scrips', 'instrument', 'particulars'];
  const QTY_ALIASES = ['qty', 'quantity', 'shares', 'units', 'noofshares', 'numshares', 'totalqty', 'count', 'holding', 'holdings', 'nos', 'volume', 'noofunits'];
  const PRICE_ALIASES = ['avgprice', 'buyprice', 'price', 'cost', 'avg', 'averageprice', 'buyingprice', 'purchaseprice', 'buyrate', 'rate', 'costprice', 'avgcost', 'entryprice', 'unitprice', 'buypriceinr', 'priceinr'];
  const MARKET_ALIASES = ['market', 'exchange', 'type', 'segment', 'country'];
  const LEVERAGE_ALIASES = ['leverage', 'leverageratio', 'lev'];
  const DATE_ALIASES = ['dateadded', 'date', 'buydate', 'purchasedate', 'time', 'createdat'];

  portfolio.forEach((p: any, idx: number) => {
    if (!p || typeof p !== 'object') return;

    // Build a map of normalized keys (lowercase, no non-alphanumeric chars)
    const normObj: Record<string, any> = {};
    Object.keys(p).forEach(k => {
      const cleanKey = k.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (p[k] !== undefined && p[k] !== null && p[k] !== '') {
        normObj[cleanKey] = p[k];
      }
    });

    // Lookup symbol
    let rawSym = '';
    for (const alias of SYMBOL_ALIASES) {
      if (normObj[alias] !== undefined) {
        rawSym = String(normObj[alias]).trim();
        if (rawSym) break;
      }
    }
    if (!rawSym) return;

    // Clean exchange prefix (NSE:RELIANCE -> RELIANCE)
    const cleanSym = rawSym.toUpperCase()
      .replace(/^(NSE|BSE|NASDAQ|AMEX|NYSE|TVC|SP|CBOE):/i, '')
      .trim();
    if (!cleanSym) return;

    // Lookup qty
    let rawQtyVal: any = undefined;
    for (const alias of QTY_ALIASES) {
      if (normObj[alias] !== undefined) {
        rawQtyVal = normObj[alias];
        break;
      }
    }

    // Lookup price
    let rawPriceVal: any = undefined;
    for (const alias of PRICE_ALIASES) {
      if (normObj[alias] !== undefined) {
        rawPriceVal = normObj[alias];
        break;
      }
    }

    const qty = parseNumeric(rawQtyVal);
    let avgPrice = parseNumeric(rawPriceVal);

    if (isNaN(qty) || qty <= 0) return;
    if (isNaN(avgPrice) || avgPrice < 0) avgPrice = 0;

    // Lookup market
    let rawMarket: any = undefined;
    for (const alias of MARKET_ALIASES) {
      if (normObj[alias] !== undefined) {
        rawMarket = String(normObj[alias]).trim().toUpperCase();
        break;
      }
    }
    const market = (rawMarket === 'US' || rawMarket === 'IN')
      ? rawMarket
      : (cleanSym.includes('.NS') || cleanSym.includes('.BO') ? 'IN' : guessMarket(cleanSym));

    // Lookup leverage
    let rawLevVal: any = 1;
    for (const alias of LEVERAGE_ALIASES) {
      if (normObj[alias] !== undefined) {
        rawLevVal = normObj[alias];
        break;
      }
    }
    const lev = parseNumeric(rawLevVal);

    // Lookup date
    let dateAdded = getTodayString();
    for (const alias of DATE_ALIASES) {
      if (normObj[alias] !== undefined) {
        const dStr = String(normObj[alias]).trim();
        if (dStr) { dateAdded = dStr; break; }
      }
    }

    valid.push({
      id: p.id || `cloud-${cleanSym.replace(/[^A-Z0-9]/g, '')}-${idx}-${Date.now()}`,
      symbol: cleanSym,
      market,
      qty,
      avgPrice,
      leverage: (isNaN(lev) || lev <= 0) ? 1 : lev,
      dateAdded,
    });
  });
  return valid;
}

// ============================================================
// APP STATE CLOUD SYNC — planner settings, transaction ledger,
// price alerts. Survives browser cache/cookie clears (stored in
// Google Sheets via the backend proxy).
// ============================================================
export interface CloudAppState {
  v?: number;
  savedAt?: number;
  plannerSettings?: Record<string, unknown>;
  usFrequency?: 'monthly' | 'quarterly';
  transactions?: unknown[];
  priceAlerts?: unknown[];
}

/** Push the full app-state blob to cloud storage (debounce upstream). */
export async function syncStateToCloud(state: CloudAppState): Promise<boolean> {
  try {
    const res = await apiFetch(`/api/state/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return data?.ok === true;
    }
    // 503 = cloud sync not configured on server — expected for local
    // setups; stay quiet (local secureStorage remains the fallback).
    if (res.status !== 503) console.warn('☁️ State save via proxy failed:', res.status);
    return false;
  } catch (e) {
    console.warn('☁️ State save via proxy error:', e);
    return false;
  }
}

/**
 * Pull the app-state blob from cloud. Uses the same /api/cloud/load
 * payload which now carries `appState` alongside the portfolio.
 * Returns null when cloud has no state (first run / not configured).
 */
export async function loadAppStateFromCloud(): Promise<CloudAppState | null> {
  try {
    const res = await apiFetch(`/api/cloud/load`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const s = data?.appState;
    if (s && typeof s === 'object' && !Array.isArray(s)) return s as CloudAppState;
    return null;
  } catch (e) {
    console.warn('☁️ State load via proxy error:', e);
    return null;
  }
}

export async function syncToCloud(portfolio: Position[], usdInr: number): Promise<boolean> {
  if (!portfolio || portfolio.length === 0) {
    console.warn('☁️ Cloud Sync: Blocking sync because portfolio is empty.');
    return false;
  }

  // Mode 1: Backend proxy (preferred — cross-origin safe).
  try {
    const res = await apiFetch(`/api/cloud/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ portfolio, usdInr }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.ok === true) return true;
    }
    // If proxy returned 503 (not configured), fall through to Mode 2.
    if (res.status !== 503) {
      console.warn('☁️ Cloud save via proxy failed:', res.status);
    }
  } catch (e) {
    console.warn('☁️ Cloud save via proxy error:', e);
  }

  // Mode 2: Direct Google Apps Script call (fallback).
  const apiUrl = getApiUrlSync() || await getApiUrl();
  const authToken = getCloudAuthToken();
  if (!apiUrl || !authToken) {
    console.warn('☁️ Cloud sync: no proxy, no direct config — cannot save.');
    return false;
  }
  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow',
      body: JSON.stringify({ action: 'update', authToken, portfolio, timestamp: Date.now(), usdInr }),
      signal: AbortSignal.timeout(15000),
    });
    return res.ok;
  } catch (e) {
    console.warn('☁️ Cloud save direct failed:', e);
    return false;
  }
}

// Helper to convert any standard Google Sheet URL (editing/sharing link) into a direct CSV export URL
function toGoogleSheetCsvUrl(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  if (url.includes('output=csv') || url.includes('format=csv')) return url;
  const match = url.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    const sheetId = match[1];
    const gidMatch = url.match(/[?&#]gid=([0-9]+)/);
    const gidParam = gidMatch ? `&gid=${gidMatch[1]}` : '';
    return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gidParam}`;
  }
  return null;
}

export async function loadFromCloud(): Promise<Position[] | null> {
  // Mode 1: Backend proxy (preferred — cross-origin safe).
  try {
    const res = await apiFetch(`/api/cloud/load`, {
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      const list = extractPortfolioList(data);
      if (list && list.length > 0) {
        const valid = validatePortfolio(list);
        if (valid.length > 0) return valid;
      }
    } else if (res.status !== 503) {
      console.warn('☁️ Cloud load via proxy failed:', res.status);
    }
    // If 503 (not configured) or no data, fall through to Mode 2.
  } catch (e) {
    console.warn('☁️ Cloud load via proxy error:', e);
  }

  // Mode 2: Direct Google Apps Script call or Published Sheet CSV (fallback).
  const apiUrl = getApiUrlSync() || await getApiUrl();
  const authToken = getCloudAuthToken();
  if (!apiUrl) {
    console.warn('☁️ Cloud sync: no proxy, no direct config — cannot load.');
    return null;
  }

  try {
    // 2a. Direct Google Sheet link check (supports sharing URLs & published CSV links)
    const directCsvUrl = toGoogleSheetCsvUrl(apiUrl);
    if (directCsvUrl) {
      try {
        const res = await fetch(directCsvUrl, { redirect: 'follow', signal: AbortSignal.timeout(12000) });
        if (res.ok) {
          const text = await res.text();
          const csvValid = parseCSVPortfolio(text);
          if (csvValid.length > 0) return csvValid;
        }
      } catch (err) {
        console.warn('Direct Google Sheet CSV fetch failed, trying Apps Script endpoint:', err);
      }
    }

    // SECURITY FIX (audit): the universal public backdoor token 'WEALTH_AI_SYNC'
    // was removed — it authenticated ANYONE to the Apps Script backend. If no
    // real token is configured, direct cloud mode is skipped entirely (the
    // authenticated /api/cloud/* server proxy remains the supported path).
    if (!authToken) return null;
    const fetchUrl = apiUrl.includes('?')
      ? `${apiUrl}&action=load&authToken=${encodeURIComponent(authToken)}&t=${Date.now()}`
      : `${apiUrl}?action=load&authToken=${encodeURIComponent(authToken)}&t=${Date.now()}`;

    const res = await fetch(fetchUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;

    const text = await res.text();

    // Check if raw output is CSV
    if (text.includes(',') && !text.trim().startsWith('{') && !text.trim().startsWith('[')) {
      const csvValid = parseCSVPortfolio(text);
      if (csvValid.length > 0) return csvValid;
    }

    const data = parseCloudResponse(text);
    const list = extractPortfolioList(data);
    if (list && list.length > 0) {
      const valid = validatePortfolio(list);
      if (valid.length > 0) return valid;
    }
  } catch (e) {
    console.warn('☁️ Cloud load direct failed:', e);
  }

  return null;
}

/**
 * Extract the first complete top-level JSON object from a string that
 * may contain trailing/leading junk (HTML, debug logs, etc.).
 * (Defined above as extractBalancedJSON — kept here as a comment for context.)
 */

export async function sendTelegramAlert(token: string, chatId: string, message: string): Promise<boolean> {
  // 1) Try direct send if browser has local token + chatId
  if (token && chatId) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
        signal: AbortSignal.timeout(8000) // v1.3: 8s cap → falls back to server proxy fast
      });
      if (res.ok) return true;
    } catch (e) {
      // fall through to server proxy
    }
  }
  // 2) Fallback to server proxy (uses bot's TG_TOKEN/TG_CHAT_ID env) so the
  //    website can still notify even without local config. Fixes "No Telegram Config".
  return sendTelegramViaServer(message, chatId || undefined);
}

// Server-side Telegram proxy fallback — uses the bot's configured token/chat.
// FIX C11: server now ignores client-supplied chatId to prevent abuse, so we
// no longer forward it.
export async function sendTelegramViaServer(message: string, _chatId?: string): Promise<boolean> {
  try {
    const res = await apiFetch('/api/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

// ========================================
// GROQ API KEY — CLOUD SYNC (dual-mode: proxy first, direct fallback)
// ========================================
export async function syncGroqKeyToCloud(key: string): Promise<boolean> {
  if (!key) return false;

  // Mode 1: Backend proxy.
  try {
    const res = await apiFetch(`/api/cloud/save-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groqKey: key }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) return true;
  } catch (e) { /* fall through */ }

  // Mode 2: Direct Google Apps Script call.
  const apiUrl = getApiUrlSync() || await getApiUrl();
  const authToken = getCloudAuthToken();
  if (!apiUrl || !authToken) return false;
  try {
    await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow',
      body: JSON.stringify({ groqKey: key, action: 'saveKey', authToken, timestamp: Date.now() }),
      signal: AbortSignal.timeout(10000),
    });
    return true;
  } catch (e) {
    return false;
  }
}

export async function loadGroqKeyFromCloud(): Promise<string | null> {
  // Mode 1: Backend proxy.
  try {
    const res = await apiFetch(`/api/cloud/load-key`, {
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = await res.json();
      const key = data?.groqKey;
      if (key && typeof key === 'string' && key.length > 10) return key;
    }
  } catch (e) { /* fall through */ }

  // Mode 2: Direct Google Apps Script call.
  const apiUrl = getApiUrlSync() || await getApiUrl();
  const authToken = getCloudAuthToken();
  if (!apiUrl || !authToken) return null;
  try {
    const res = await fetch(`${apiUrl}?action=loadKey&authToken=${encodeURIComponent(authToken)}&t=${Date.now()}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    const data = parseCloudResponse(text);
    const key = data?.groqKey;
    if (key && typeof key === 'string' && key.length > 10) return key;
  } catch (e) { console.warn('Groq key cloud load failed:', e); }
  return null;
}

// ========================================
// MARKET INTELLIGENCE — LIVE GLOBAL DATA
// ========================================
export interface MarketIntelligence {
  globalIndices: { name: string; price: number; change: number }[];
  sectors: { name: string; change: number }[];
  fearGreedScore: number;
  marketNarrative: string;
  keyLevels: { nifty: number; sensex: number; spy: number; qqq: number };
  timestamp: number;
}

export async function fetchMarketIntelligence(): Promise<MarketIntelligence> {
  const intelligence: MarketIntelligence = {
    globalIndices: [],
    sectors: [],
    fearGreedScore: 50,
    marketNarrative: '',
    keyLevels: { nifty: 0, sensex: 0, spy: 0, qqq: 0 },
    timestamp: Date.now()
  };

  // Batch fetch major global indices + sectors via TradingView
  try {
    const indexTickers = [
      'NSE:NIFTY', 'BSE:SENSEX', 'NSE:BANKNIFTY',
      'AMEX:SPY', 'NASDAQ:QQQ', 'AMEX:DIA', 'AMEX:IWM',
      'TVC:DXY', 'COMEX:GC1!', 'NYMEX:CL1!',
      'CBOE:VIX', 'NSE:INDIAVIX'
    ];
    const sectorTickers = [
      'AMEX:XLK', 'AMEX:XLF', 'AMEX:XLE', 'AMEX:XLV', 'AMEX:XLI',
      'NSE:CNXIT', 'NSE:CNXFIN', 'NSE:CNXPHARMA'
    ];

    const [indexRes, sectorRes] = await Promise.allSettled([
      fetch('https://scanner.tradingview.com/global/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({
          symbols: { tickers: indexTickers },
          columns: ['name', 'close', 'change', 'volume', 'SMA20', 'SMA50', 'RSI', 'MACD.macd', 'last']
        }),
        signal: AbortSignal.timeout(6000)
      }),
      fetch('https://scanner.tradingview.com/global/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({
          symbols: { tickers: sectorTickers },
          columns: ['name', 'close', 'change', 'volume', 'SMA20', 'SMA50', 'RSI', 'MACD.macd', 'last']
        }),
        signal: AbortSignal.timeout(6000)
      })
    ]);

    if (indexRes.status === 'fulfilled' && indexRes.value.ok) {
      const data = await indexRes.value.json();
      if (data?.data) {
        const nameMap: Record<string, string> = {
          'NSE:NIFTY': 'NIFTY 50', 'BSE:SENSEX': 'SENSEX', 'NSE:BANKNIFTY': 'BANK NIFTY',
          'AMEX:SPY': 'S&P 500', 'NASDAQ:QQQ': 'NASDAQ 100', 'AMEX:DIA': 'DOW JONES',
          'AMEX:IWM': 'RUSSELL 2000', 'TVC:DXY': 'US DOLLAR', 'COMEX:GC1!': 'GOLD',
          'NYMEX:CL1!': 'CRUDE OIL', 'CBOE:VIX': 'VIX', 'NSE:INDIAVIX': 'INDIA VIX'
        };
        (data.data as TvScannerItem[]).forEach(item => {
          if (!item.d) return;
          const ri = (idx: number) => parseFloat(String(item.d![idx] ?? ''));
          const px = pickScannerPrice(item.d[1], item.d[8]);
          if (px > 0) {
            intelligence.globalIndices.push({
              name: nameMap[item.s] || String(item.d[0] ?? ''),
              price: px,
              change: ri(2) || 0
            });
            if (item.s === 'NSE:NIFTY') intelligence.keyLevels.nifty = px;
            if (item.s === 'BSE:SENSEX') intelligence.keyLevels.sensex = px;
            if (item.s === 'AMEX:SPY') intelligence.keyLevels.spy = px;
            if (item.s === 'NASDAQ:QQQ') intelligence.keyLevels.qqq = px;
          }
        });
      }
    }

    if (sectorRes.status === 'fulfilled' && sectorRes.value.ok) {
      const data = await sectorRes.value.json();
      if (data?.data) {
        const sectorNameMap: Record<string, string> = {
          'AMEX:XLK': 'US Tech', 'AMEX:XLF': 'US Finance', 'AMEX:XLE': 'US Energy',
          'AMEX:XLV': 'US Healthcare', 'AMEX:XLI': 'US Industrial',
          'NSE:CNXIT': 'IN IT', 'NSE:CNXFIN': 'IN Finance', 'NSE:CNXPHARMA': 'IN Pharma'
        };
        (data.data as TvScannerItem[]).forEach(item => {
          if (item.d && item.d[2] !== null) {
            intelligence.sectors.push({
              name: sectorNameMap[item.s] || String(item.d[0] ?? ''),
              change: parseFloat(String(item.d[2] ?? '')) || 0
            });
          }
        });
      }
    }
  } catch (e) {
    console.warn('Market intelligence fetch partial failure');
  }

  // Calculate Fear/Greed from VIX
  const vix = intelligence.globalIndices.find(i => i.name === 'VIX');
  const inVix = intelligence.globalIndices.find(i => i.name === 'INDIA VIX');
  // FIX M1: if both VIX feeds are missing, the old `|| 15` fallback made the
  // dashboard claim "EXTREME GREED — VIX ultra-low at 15" while no VIX was
  // actually available. Only compute a score when at least one VIX is real.
  const vixVal = vix?.price;
  const inVixVal = inVix?.price;
  const realVixCount = (typeof vixVal === 'number' && vixVal > 0 ? 1 : 0) + (typeof inVixVal === 'number' && inVixVal > 0 ? 1 : 0);
  if (realVixCount === 0) {
    intelligence.fearGreedScore = 50; // neutral — no data
    intelligence.marketNarrative = (intelligence.marketNarrative + ' VIX unavailable — Fear/Greed held neutral.').trim();
  } else {
    const sum = (vixVal ?? 0) + (inVixVal ?? 0);
    const avgVix = sum / realVixCount;
    if (avgVix > 30) intelligence.fearGreedScore = 10;
    else if (avgVix > 25) intelligence.fearGreedScore = 20;
    else if (avgVix > 20) intelligence.fearGreedScore = 35;
    else if (avgVix > 16) intelligence.fearGreedScore = 50;
    else if (avgVix > 12) intelligence.fearGreedScore = 70;
    else intelligence.fearGreedScore = 85;
  }

  // Build market narrative
  const bullSectors = intelligence.sectors.filter(s => s.change > 1).map(s => s.name);
  const bearSectors = intelligence.sectors.filter(s => s.change < -1).map(s => s.name);
  const niftyMove = intelligence.globalIndices.find(i => i.name === 'NIFTY 50')?.change || 0;
  const spyMove = intelligence.globalIndices.find(i => i.name === 'S&P 500')?.change || 0;

  // FIX M1 (follow-up): compute avgVix once and reuse, so the narrative
  // logic below still has access to it after the M1 fix above split the
  // VIX-missing branch. When both VIX feeds are missing, narrative will
  // reflect that via the `vixUnavailable` flag instead.
  const vixForNarrative = intelligence.globalIndices.find(i => i.name === 'VIX');
  const inVixForNarrative = intelligence.globalIndices.find(i => i.name === 'INDIA VIX');
  const vixCount = (typeof vixForNarrative?.price === 'number' && vixForNarrative!.price > 0 ? 1 : 0) + (typeof inVixForNarrative?.price === 'number' && inVixForNarrative!.price > 0 ? 1 : 0);
  const avgVix = vixCount > 0 ? ((vixForNarrative?.price ?? 0) + (inVixForNarrative?.price ?? 0)) / vixCount : 0;
  const vixUnavailable = vixCount === 0;

  let narrative = '';
  if (vixUnavailable) narrative = `VIX unavailable —Fear/Greed held neutral. Sector + index signals still active.`;
  else if (avgVix > 25) narrative = `FEAR DOMINANT — VIX at ${avgVix.toFixed(1)}. Institutional hedging active. Cash is king.`;
  else if (avgVix > 18) narrative = `CAUTIOUS — Elevated volatility (VIX ${avgVix.toFixed(1)}). Mixed signals, selective entries only.`;
  else if (avgVix < 13) narrative = `EXTREME GREED — VIX ultra-low at ${avgVix.toFixed(1)}. Complacency high, protect profits.`;
  else narrative = `NEUTRAL-BULLISH — VIX steady at ${avgVix.toFixed(1)}. SIP mode optimal, accumulate quality.`;

  if (niftyMove > 1.5 || spyMove > 1.5) narrative += ` Strong rally underway (NIFTY ${niftyMove > 0 ? '+' : ''}${niftyMove.toFixed(1)}%, SPY ${spyMove > 0 ? '+' : ''}${spyMove.toFixed(1)}%).`;
  else if (niftyMove < -1.5 || spyMove < -1.5) narrative += ` Selloff in progress (NIFTY ${niftyMove.toFixed(1)}%, SPY ${spyMove.toFixed(1)}%). Look for value.`;

  if (bullSectors.length > 0) narrative += ` Sectors leading: ${bullSectors.join(', ')}.`;
  if (bearSectors.length > 0) narrative += ` Sectors lagging: ${bearSectors.join(', ')}.`;

  intelligence.marketNarrative = narrative;

  return intelligence;
}

export function formatMarketIntelligenceForAI(intel: MarketIntelligence): string {
  let ctx = `INTEL: `;
  intel.globalIndices.forEach(i => {
    ctx += `${i.name}:${i.price.toFixed(1)}(${i.change.toFixed(1)}%),`;
  });
  ctx += ` SECTORS: `;
  intel.sectors.forEach(s => {
    ctx += `${s.name}:${s.change.toFixed(1)}%,`;
  });
  ctx += ` F&G:${intel.fearGreedScore}/100 `;
  ctx += `NARRATIVE:${intel.marketNarrative}\n`;

  return ctx;
}

// ============================================================
// INDMoney synced ASSET TABLE (server: 2×-daily scheduled sync).
// GET  /api/mcp/indmoney/assets → persisted snapshot (+scheduler info)
// POST /api/mcp/indmoney/sync   → force sync NOW (manual button)
// POST /api/mcp/indmoney/assets/hide   → REMOVE an asset row (restore-able)
// POST /api/mcp/indmoney/assets/unhide → restore removed row(s)
// CoinDCX (crypto source, server-side API keys):
// GET  /api/mcp/coindcx/status     → connection + last balance sync
// POST /api/mcp/coindcx/connect    → validate + save API key/secret
// POST /api/mcp/coindcx/disconnect → forget keys + drop crypto rows
// ============================================================
export interface IndmAsset {
  id: string;
  /** Stable removal key — survives index shifts between syncs. */
  key: string;
  name: string;
  /** Which sync source owns this row: 'indmoney' (MCP) | 'coindcx' (exchange). */
  source: 'indmoney' | 'coindcx';
  symbol: string | null;
  market: 'IN' | 'US';
  kind: string;
  qty: number;
  avgPrice: number;
  lastPrice: number | null;
  value: number | null;
  invested: number | null;
  pnl: number | null;
  pnlPct: number | null;
  oneDayChangePct: number | null;
  assetType: string;
  assetEnum: string | null;
  noLive: boolean;
}

export interface CoinDcxInfo {
  connected: boolean;
  connectedAt: number | null;
  lastSyncAt: number | null;
  balanceCount: number;
  lastError: string | null;
  /** Durable (encrypted GitHub) credential backup status — restart-safe? */
  durable?: { configured: boolean; keySource: string };
}

export interface IndmNetWorthCategory {
  category: 'Equity' | 'Mutual Funds' | 'EPF' | 'Gold' | 'Crypto' | 'Fixed Income' | 'Other';
  valueINR: number;
  count: number;
  /** share of the total, 0-100 (null when the total is 0) */
  pct: number | null;
}

/** v10.5 (Upgrade 3): the unified net-worth view — every visible asset
 * bucketed by class, the INR total, and the source stamps. */
export interface IndmNetWorth {
  ok: boolean;
  totalValueINR: number;
  valuedCount: number;
  holdingCount: number;
  categories: IndmNetWorthCategory[];
  sources?: { indmoney: boolean; coindcx: boolean };
  syncedAt: number | null;
  lastError?: string | null;
  note?: string;
}

export interface IndmAssetsResponse {
  ok: boolean;
  reason?: string | null;
  assets: IndmAsset[];
  /** Rows the user REMOVED (restore-able via unhideIndmAsset). */
  hiddenAssets?: IndmAsset[];
  hiddenCount?: number;
  counts?: { assets: number; live: number; noLive: number; resolved: number; coindcx?: number } | null;
  summary?: {
    totalValue: number; totalInvested: number | null; totalPnl: number | null;
    totalPnlPct: number | null; holdingCount?: number;
    oneDayChange?: number | null; oneDayChangePct?: number | null;
  } | null;
  positions?: { name: string; symbol: string | null; kind: string; qty: number | null; avgPrice: number | null; invested: number | null; realisedPnl: number | null; t1Qty: number; positionId: string | null }[];
  sources?: { indmoney: boolean; coindcx: boolean };
  coindcx?: CoinDcxInfo | null;
  syncedAt: number | null;
  stale?: boolean;
  /** v10.5 (Upgrade 3): the unified by-class net-worth view. */
  netWorth?: IndmNetWorth | null;
  slots?: string[];
  lastRuns?: Record<string, number>;
  nextSyncAt?: number | null;
  lastError?: string | null;
}

export async function fetchIndmAssets(): Promise<IndmAssetsResponse | null> {
  try {
    const res = await apiFetch('/api/mcp/indmoney/assets', { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return (await res.json()) as IndmAssetsResponse;
  } catch { return null; }
}

export async function forceIndmSync(): Promise<IndmAssetsResponse | null> {
  try {
    const res = await apiFetch('/api/mcp/indmoney/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      // A full sync = up to 12 MCP tool calls + CoinDCX balances + first-time
      // symbol resolution (Groww lookups) — 120s ceiling; later syncs are
      // much faster (cached).
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) return null;
    return (await res.json()) as IndmAssetsResponse;
  } catch { return null; }
}

/** REMOVE an asset row from the synced table (stays restorable server-side). */
export async function hideIndmAsset(key: string): Promise<boolean> {
  try {
    const res = await apiFetch('/api/mcp/indmoney/assets/hide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch { return false; }
}

/** Restore a removed asset row (or ALL rows when all=true). */
export async function unhideIndmAsset(key: string, all = false): Promise<boolean> {
  try {
    const res = await apiFetch('/api/mcp/indmoney/assets/unhide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(all ? { all: true } : { key }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch { return false; }
}

// v5.2 — CoinDCX manual cost basis (the view-only-key fallback so crypto
// rows show the app's Invested / P&L). Server persists per-coin amounts
// and merges them ONLY where the trade-ledger basis is missing.
export async function setCoindcxManualBasis(coin: string, invested: number): Promise<boolean> {
  try {
    const res = await apiFetch('/api/mcp/coindcx/basis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coin, invested }),
      signal: AbortSignal.timeout(30000),
    });
    return res.ok;
  } catch { return false; }
}

export async function clearCoindcxManualBasis(coin?: string): Promise<boolean> {
  try {
    const res = await apiFetch('/api/mcp/coindcx/basis/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(coin ? { coin } : {}),
      signal: AbortSignal.timeout(30000),
    });
    return res.ok;
  } catch { return false; }
}

// v6.1 — SERVER-side app settings (multi-device + cache-clear proof).
// The Portfolio tab's user calibrations (e.g. usdAppRate from the
// "Match App" flow) now live on the server (durable-backed, same
// encrypted GitHub pipeline as the MCP credentials) so every device
// that logs in with the PIN sees the SAME numbers. localStorage stays
// only as an instant-render cache / offline fallback.
export type ServerSettings = { usdAppRate?: number };

export async function fetchServerSettings(): Promise<ServerSettings | null> {
  try {
    const res = await apiFetch('/api/mcp/settings', { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = await res.json();
    return (data && typeof data === 'object' && data.settings) ? (data.settings as ServerSettings) : {};
  } catch { return null; }
}

export async function saveServerSetting(key: string, value: number | null): Promise<boolean> {
  try {
    const res = await apiFetch('/api/mcp/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
      signal: AbortSignal.timeout(15000),
    });
    return res.ok;
  } catch { return false; }
}

export async function fetchCoinDcxStatus(): Promise<CoinDcxInfo | null> {
  try {
    const res = await apiFetch('/api/mcp/coindcx/status', { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return (await res.json()) as CoinDcxInfo;
  } catch { return null; }
}

/** Connect the user's CoinDCX account — validated server-side with a real
 *  balances call before the keys are ever stored. Never throws; returns
 *  { ok, error? }. */
export async function connectCoinDcx(apiKey: string, secret: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch('/api/mcp/coindcx/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, secret }),
      signal: AbortSignal.timeout(30000),
    });
    if (res.ok) return { ok: true };
    const data = await res.json().catch(() => null);
    return { ok: false, error: data?.error?.message || `Connect failed (${res.status})` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Connect failed' };
  }
}

export async function disconnectCoinDcx(): Promise<boolean> {
  try {
    const res = await apiFetch('/api/mcp/coindcx/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch { return false; }
}
