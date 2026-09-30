// ============================================================
// test/futuresResilience.test.ts — v11.3 fetchFuturesPrices CHAIN
// ------------------------------------------------------------
// Production reality (Render, 2026-09-17): public.coindcx.com REST is
// Cloudflare-fronted and can be IP-blocked from datacenter egress —
// the futures board's ONLY price source used to die with it.
//
// THE CHAIN (locked here):
//   1. REST RT (public.coindcx.com)          → rows with NO source
//   2. official WS book (cxBookState, fed by the stream socket)
//                                             → source 'ws-book'
//   3. Binance fapi / Bybit linear 24h books → source 'binance-fut'
//      (30s negative cache when a leg returns nothing — no 2s hammer)
//   4. 3-min deep-stale cache serve
//   5. throw (honest failure)
// Hermetic: global fetch routed per-URL, book state injected.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockPrivate = vi.fn();
vi.mock('../server/mcp/coindcx.js', () => ({
  coindcxPrivate: (...args) => mockPrivate(...args),
  coindcxPrivateGET: (...args) => mockPrivate(...args),
  coindcxConnected: () => false,
}));

import { fetchFuturesPrices, __resetFuturesForTests } from '../server/ai/futures.js';
import { mergeFutBook, futBookSnapshot, _resetFutBookForTest } from '../server/ai/cxBookState.js';

const RT_URL = 'https://public.coindcx.com/market_data/v3/current_prices/futures/rt';
const BINANCE_FUT = 'https://fapi.binance.com/fapi/v1/ticker/24hr';
const BYBIT_FUT = 'https://api.bybit.com/v5/market/tickers?category=linear';

const rtPayload = (rows: Record<string, Record<string, number>>) => ({
  ts: Math.floor(Date.now() / 1000), // CoinDCX serves SECONDS (the unit guard)
  prices: rows,
});
const restDead = () => ({ ok: false, status: 403, json: async () => ({}) });

function routeFetch(handler: (url: string) => { ok: boolean; status: number; json: () => Promise<unknown> } | null) {
  globalThis.fetch = vi.fn(async (url: any) => {
    const r = handler(String(url));
    if (!r) return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
    return { ...r, text: async () => JSON.stringify({}) };
  }) as any;
}

describe('futures.js — v11.3 fetchFuturesPrices resilience chain', () => {
  beforeEach(() => {
    __resetFuturesForTests();
    _resetFutBookForTest();
  });
  afterEach(() => {
    routeFetch(() => null);
    __resetFuturesForTests();
    _resetFutBookForTest();
  });

  it('leg 1 — REST healthy: normal rows, seconds ts normalized to ms, no source marker', async () => {
    const tsSec = Math.floor(Date.now() / 1000);
    routeFetch(url => (url === RT_URL
      ? { ok: true, status: 200, json: async () => rtPayload({ 'B-BTC_USDT': { ls: 76_421.4, mp: 76_420.9, pc: 1.1, h: 77_000, l: 75_500, v: 2_100 } }) }
      : null));
    const rows = await fetchFuturesPrices();
    expect(rows.length).toBeGreaterThan(0);
    const btc = rows.find(r => r.pair === 'B-BTC_USDT')!;
    expect(btc.last).toBeCloseTo(76_421.4, 6);
    expect(btc.base).toBe('BTC');
    expect(btc.ts).toBe(tsSec * 1000); // ms — the unit guard held
    expect(btc.source).toBeUndefined(); // real REST rows carry no marker
  });

  it('leg 2 — REST dead + fresh WS book: the OFFICIAL book serves (source ws-book)', async () => {
    routeFetch(() => restDead());
    // the stream socket fed the shared book (ts in SECONDS like the live wire)
    mergeFutBook({ 'B-BTC_USDT': { ls: 76_100.2, pc: 0.8, v: 500, mp: 76_099.9 } }, Math.floor(Date.now() / 1000));
    const rows = await fetchFuturesPrices();
    const btc = rows.find(r => r.pair === 'B-BTC_USDT')!;
    expect(btc.last).toBeCloseTo(76_100.2, 6);
    expect(btc.source).toBe('ws-book');
    expect(btc.mark).toBeCloseTo(76_099.9, 6);
  });

  it('leg 3 — REST dead + book empty + Binance reachable: same-domain synth rows (source binance-fut) + the v12.7 ?symbols= universe filter', async () => {
    let fapiUrl = '';
    routeFetch(url => (url.startsWith(BINANCE_FUT)
      ? (() => { fapiUrl = url; return { ok: true, status: 200, json: async () => ([
        { symbol: 'BTCUSDT', lastPrice: '61000.5', priceChangePercent: '1.1', highPrice: '61500', lowPrice: '60200', volume: '21000.5', markPrice: '60999.1' },
        { symbol: 'ETHUSDT', lastPrice: '3120.75', priceChangePercent: '-0.4', highPrice: '3150', lowPrice: '3080', volume: '15000.2' },
      ]) }; })()
      : restDead()));
    const rows = await fetchFuturesPrices();
    const btc = rows.find(r => r.pair === 'B-BTC_USDT')!;
    expect(btc.last).toBeCloseTo(61_000.5, 6);
    expect(btc.source).toBe('binance-fut');
    expect(btc.changePct).toBeCloseTo(1.1, 6);
    expect(rows.find(r => r.pair === 'B-ETH_USDT')!.last).toBeCloseTo(3_120.75, 6);
    // v12.7 BANDWIDTH LOCK: the dark-fallback fapi leg must request ONLY the
    // board's universe (FUTURES_UNIVERSE) via Binance's ?symbols= JSON-array
    // param — never the full ~500-symbol 1-2MB book.
    expect(fapiUrl.startsWith(`${BINANCE_FUT}?symbols=`)).toBe(true);
    const symbols = JSON.parse(decodeURIComponent(fapiUrl.slice(`${BINANCE_FUT}?symbols=`.length)));
    expect(Array.isArray(symbols)).toBe(true);
    expect(symbols).toContain('BTCUSDT');
    expect(symbols).toContain('ETHUSDT');
    expect(symbols.length).toBeLessThanOrEqual(20); // the static universe, never the ~500-symbol book
  });

  it('leg 3′ — Bybit linear serves when Binance fapi is dark (source bybit-fut)', async () => {
    routeFetch(url => (url === BYBIT_FUT
      ? { ok: true, status: 200, json: async () => ({ result: { list: [
        { symbol: 'BTCUSDT', lastPrice: '62000.25', price24hPcnt: '0.009', highPrice24h: '62500', lowPrice24h: '61500', volume24h: '9000', markPrice: '61999.5' },
      ] } }) }
      : restDead()));
    const rows = await fetchFuturesPrices();
    const btc = rows.find(r => r.pair === 'B-BTC_USDT')!;
    expect(btc.last).toBeCloseTo(62_000.25, 6);
    expect(btc.source).toBe('bybit-fut');
    expect(btc.changePct).toBeCloseTo(0.9, 6);
  });

  it('the synth leg is negative-cached — an empty Binance book is NOT re-hammered on the next immediate call', async () => {
    let fapiHits = 0;
    routeFetch(url => {
      if (url.startsWith(BINANCE_FUT)) { fapiHits++; return { ok: true, status: 200, json: async () => [] }; }
      return restDead();
    });
    await expect(fetchFuturesPrices()).rejects.toThrow(); // empty book → all legs dead → throw
    expect(fapiHits).toBe(1);
    await expect(fetchFuturesPrices()).rejects.toThrow();
    expect(fapiHits).toBe(1); // held off — no 2s hammer while CoinDCX is dark
  });

  it('leg 4 — everything dead but the cache is <3 min old: deep-stale serve beats a dead board', async () => {
    // step 1: REST serves once → cache populated
    routeFetch(url => (url === RT_URL
      ? { ok: true, status: 200, json: async () => rtPayload({ 'B-BTC_USDT': { ls: 76_421.4, pc: 1.1, v: 2_100 } }) }
      : restDead()));
    await fetchFuturesPrices();
    // step 2: EVERYTHING goes dark (REST, Binance, Bybit) — no synth leg
    // can answer (fapi returns an empty array), no book
    routeFetch(url => (url.startsWith(BINANCE_FUT)
      ? { ok: true, status: 200, json: async () => [] }
      : restDead()));
    const rows = await fetchFuturesPrices();
    expect(rows.find(r => r.pair === 'B-BTC_USDT')!.last).toBeCloseTo(76_421.4, 6);
  });

  it('leg 5 — truly everything dead → the honest throw', async () => {
    routeFetch(() => restDead());
    await expect(fetchFuturesPrices()).rejects.toThrow();
  });

  it('book rows with ONLY mp (no ls) still serve via mark fallback — an illiquid-but-alive perp', async () => {
    routeFetch(() => restDead());
    mergeFutBook({ 'B-OBSCURE_USDT': { mp: 1.2345, bmST: Date.now(), cmRT: Date.now() } }, Date.now());
    const rows = await fetchFuturesPrices();
    const row = rows.find(r => r.pair === 'B-OBSCURE_USDT')!;
    expect(row.last).toBeCloseTo(1.2345, 6); // mark fallback
    expect(row.mark).toBeCloseTo(1.2345, 6);
    expect(row.source).toBe('ws-book');
  });

  it('stale book rows (beyond the freshness window) are NOT served', async () => {
    routeFetch(() => restDead());
    mergeFutBook({ 'B-BTC_USDT': { ls: 76_421.4 } }, Date.now());
    expect(futBookSnapshot(5_000).size).toBe(1);   // fresh window → served
    expect(futBookSnapshot(-1).size).toBe(0);      // negative window → nothing fresh
  });
});
