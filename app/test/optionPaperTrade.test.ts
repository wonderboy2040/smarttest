// ============================================================
// v9.5 F&O OPTION PAPER TRADING + direction-vocabulary tests
//   • openPaperTrade OPTION — validation, storage, lot-multiplied P&L
//   • injectOptionPaperQuotes — BS re-pricing from the index spot
//   • evaluatePaper on an option row — T1 50% book + lot math
//   • _publicTrade/_sanitizeRestoredTrade — option fields round-trip
//   • evaluateExecutionGate — BUY/SELL aliases accepted (the
//     "signal side is LONG, requested BUY" bug class)
// Store + journal are mocked so tests never touch server/data/.
// Fake timers pin IST to ~10:00 (pre-square-off, market window) so
// the 15:10 EOD close never interferes with the assertions.
// ============================================================
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

vi.mock('../server/intraday/store.js', () => ({
  loadJSON: () => ({ trades: [], nextId: 1, dayKey: '' }),
  saveJSON: vi.fn(() => true),
  DATA_DIR: '/tmp/unused',
}));
vi.mock('../server/intraday/journal.js', () => ({
  recordTradeClose: vi.fn(),
}));

import {
  openPaperTrade, evaluatePaper, injectOptionPaperQuotes,
  optionUnderlyingsForWatcher, getPaperSummary, restorePaperTrades,
  _resetForTests,
} from '../server/intraday/paperTrading.js';
import { evaluateExecutionGate } from '../server/ai/ensemble.js';
import { bsPrice, yearsToExpiry } from '../server/ai/lib/blackScholes.js';

// IST 10:00 on a weekday → istMinutes 600 (< 910 sqoff, NSE window).
const FAKE_NOW = new Date('2026-09-11T04:30:00Z');
beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(FAKE_NOW); });
afterAll(() => { vi.useRealTimers(); });

const NOW_MS = FAKE_NOW.getTime();
const nextWeek = new Date(NOW_MS + 7 * 24 * 3600_000).toISOString().slice(0, 10);

const OPTION_BODY = {
  symbol: 'NIFTY23400CE',
  direction: 'LONG',
  entry: 86.5, qty: 2,
  stopLoss: 77, target1: 110, target2: 145,
  market: 'INDIA',
  assetKind: 'OPTION', underlying: 'NIFTY',
  strike: 23400, optType: 'CE', expiry: nextWeek,
  iv: 13, lotSize: 75,
  label: 'Nifty50 15Sep 23400 CE',
};

beforeEach(() => {
  _resetForTests();
});

describe('v9.5 — F&O option paper trade: open + validation', () => {
  it('opens with the full option identity and premium-LONG direction', () => {
    const r = openPaperTrade(OPTION_BODY);
    expect(r.ok).toBe(true);
    expect(r.trade.assetKind).toBe('OPTION');
    expect(r.trade.underlying).toBe('NIFTY');
    expect(r.trade.strike).toBe(23400);
    expect(r.trade.optType).toBe('CE');
    expect(r.trade.expiry).toBe(nextWeek);
    expect(r.trade.lotSize).toBe(75);
    expect(r.trade.label).toBe('Nifty50 15Sep 23400 CE');
    expect(r.trade.direction).toBe('LONG');        // premium BUY = LONG
    expect(r.trade.capital).toBeCloseTo(86.5 * 75 * 2, 1); // lots × lot premium
  });

  it('rejects option rows that try to pass direction SHORT (option BUY is premium-LONG)', () => {
    const r = openPaperTrade({ ...OPTION_BODY, direction: 'SHORT' });
    expect(r.ok).toBeUndefined();
    expect(r.error).toMatch(/premium-BUY/i);
  });

  it('rejects unsupported underlying / missing IV / bad expiry / bad lotSize', () => {
    expect(openPaperTrade({ ...OPTION_BODY, underlying: 'AAPL' }).error).toMatch(/unsupported underlying/i);
    expect(openPaperTrade({ ...OPTION_BODY, iv: 0 }).error).toMatch(/IV required/i);
    expect(openPaperTrade({ ...OPTION_BODY, expiry: '15/09/2026' }).error).toMatch(/expiry/i);
    expect(openPaperTrade({ ...OPTION_BODY, lotSize: 0 }).error).toMatch(/lotSize/i);
  });

  it('rejects CRYPTO market on option rows', () => {
    const r = openPaperTrade({ ...OPTION_BODY, market: 'CRYPTO' });
    expect(r.error).toMatch(/INDIA-market only/i);
  });
});

describe('v9.5 — injectOptionPaperQuotes: BS re-pricing from the index spot', () => {
  it('injects a live BS premium quote for the open option row', async () => {
    openPaperTrade(OPTION_BODY);
    const quotes: Record<string, { price: number }> = {};
    const spot = 23460;
    await injectOptionPaperQuotes(quotes, async (u) => {
      expect(u).toBe('NIFTY');
      return { price: spot };
    });
    // SAME T formula as the engine — exact expectation, no drift.
    const T = Math.max(0, yearsToExpiry(`${nextWeek}T15:30:00+05:30`, new Date(NOW_MS)));
    const expected = +Math.max(0.05, bsPrice(spot, 23400, T, 0.065, 13 / 100, 'CE')).toFixed(2);
    expect(quotes.NIFTY23400CE).toBeDefined();
    expect(quotes.NIFTY23400CE.price).toBeCloseTo(expected, 2);
  });

  it('prices at intrinsic when expiry has passed (T = 0)', async () => {
    openPaperTrade({ ...OPTION_BODY, expiry: '2020-01-01' });
    const quotes: Record<string, { price: number }> = {};
    await injectOptionPaperQuotes(quotes, async () => ({ price: 24000 }));
    expect(quotes.NIFTY23400CE.price).toBe(600); // 24000 − 23400
  });

  it('no-op with no fetcher or no open option rows', async () => {
    openPaperTrade(OPTION_BODY);
    const quotes: Record<string, unknown> = {};
    await injectOptionPaperQuotes(quotes, undefined);
    expect(quotes.NIFTY23400CE).toBeUndefined();
    _resetForTests();
    const q2: Record<string, unknown> = {};
    await injectOptionPaperQuotes(q2, async () => ({ price: 23400 }));
    expect(Object.keys(q2)).toHaveLength(0);
  });

  it('PE option re-prices off the same machinery', async () => {
    openPaperTrade({ ...OPTION_BODY, symbol: 'SENSEX80000PE', optType: 'PE', type: 'PE', underlying: 'SENSEX', strike: 80000 });
    const quotes: Record<string, { price: number }> = {};
    await injectOptionPaperQuotes(quotes, async () => ({ price: 79500 }));
    const T = Math.max(0, yearsToExpiry(`${nextWeek}T15:30:00+05:30`, new Date(NOW_MS)));
    const expected = +Math.max(0.05, bsPrice(79500, 80000, T, 0.065, 13 / 100, 'PE')).toFixed(2);
    expect(quotes.SENSEX80000PE.price).toBeCloseTo(expected, 2);
  });

  it('optionUnderlyingsForWatcher lists the open underlying only', () => {
    expect(optionUnderlyingsForWatcher()).toHaveLength(0);
    openPaperTrade(OPTION_BODY);
    expect(optionUnderlyingsForWatcher()).toEqual(['NIFTY']);
  });
});

describe('v9.5 — option P&L uses the lot multiplier', () => {
  it('unrealized P&L = qty(lots) × (premium − entry) × lotSize', () => {
    const r = openPaperTrade(OPTION_BODY);
    expect(r.ok).toBe(true);
    const events: unknown[] = [];
    evaluatePaper({ NIFTY23400CE: { price: 91.5 } }, events); // +5 premium pts
    const t = getPaperSummary().open[0];
    expect(t).toBeDefined();
    expect(t.status).toBe('OPEN');
    expect(t.unrealizedPnl).toBeCloseTo(2 * 5 * 75, 1); // 2 lots × ₹5 × 75
    expect(t.assetKind).toBe('OPTION');
    expect(t.label).toBe('Nifty50 15Sep 23400 CE');
  });

  it('T1 books half the lots, realized part is lot-multiplied, rest trails', () => {
    const r = openPaperTrade(OPTION_BODY);
    expect(r.ok).toBe(true);
    const events: unknown[] = [];
    evaluatePaper({ NIFTY23400CE: { price: 111 } }, events); // T1 = 110 hit
    const t = getPaperSummary().open[0];
    expect(t.status).toBe('PARTIAL');
    expect(t.t1Hit).toBe(true);
    expect(t.remainingQty).toBe(1);           // 1 of 2 lots booked
    expect(t.realizedPnl).toBeCloseTo(1 * (110 - 86.5) * 75, 1); // 1 lot × ₹23.5 × 75
    // trail: premium back to entry closes the rest at breakeven
    evaluatePaper({ NIFTY23400CE: { price: 86.5 } }, events);
    const t2 = getPaperSummary().open[0];
    expect(t2).toBeUndefined(); // fully closed now
  });
});

describe('v9.5 — option fields survive the restore round-trip', () => {
  it('sanitize keeps assetKind/strike/expiry/lotSize/label', () => {
    openPaperTrade(OPTION_BODY);
    const pub = getPaperSummary().open[0];
    const r = restorePaperTrades({
      trades: [{
        ...pub,
        // simulate a wiped server: force-merge under a fresh id
        id: pub.id + 1000,
      }],
    });
    expect(r.ok).toBe(true);
    const restored = (r.summary.open || []).find((t) => t.id === pub.id + 1000);
    expect(restored?.assetKind).toBe('OPTION');
    expect(restored?.strike).toBe(23400);
    expect(restored?.lotSize).toBe(75);
    expect(restored?.label).toBe('Nifty50 15Sep 23400 CE');
    expect(restored?.expiry).toBe(nextWeek);
  });

  it('drops option identity when the option fields are corrupted', () => {
    openPaperTrade(OPTION_BODY);
    const pub = getPaperSummary().open[0];
    const r = restorePaperTrades({
      trades: [{
        ...pub,
        id: pub.id + 1001,
        strike: 'NaN',
        iv: 0,
      }],
    });
    expect(r.ok).toBe(true);
    const row = (r.summary.open || []).find((t) => t.id === pub.id + 1001);
    expect(row?.assetKind).toBeUndefined(); // equity-shaped fallback row
  });
});

describe('v9.5 — evaluateExecutionGate side-vocabulary aliases', () => {
  const mkSignal = (side: string, over: Record<string, unknown> = {}) => ({
    symbol: 'BTC', market: 'FUTURES', side, grade: 'STRONG',
    confidence: 80, agreement: 1, generatedAt: Date.now(),
    plan: { riskPct: 1, stopLoss: 100, target1: 120 },
    ...over,
  });

  it('accepts BUY against a LONG signal (the futures paper-trades bug)', () => {
    const v = evaluateExecutionGate(mkSignal('LONG'), { side: 'BUY', venue: 'FUTURES', requireStrong: true });
    expect(v.ok).toBe(true);
  });

  it('accepts SELL against a SHORT signal', () => {
    const v = evaluateExecutionGate(mkSignal('SHORT'), { side: 'SELL', venue: 'FUTURES', requireStrong: true });
    expect(v.ok).toBe(true);
  });

  it('still rejects a genuine direction conflict (BUY vs SHORT)', () => {
    const v = evaluateExecutionGate(mkSignal('SHORT'), { side: 'BUY', venue: 'FUTURES', requireStrong: true });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/fresh consensus SHORT hai, aapne LONG/);
  });

  it('still rejects FLAT and cross-venue signals', () => {
    expect(evaluateExecutionGate(mkSignal('FLAT'), { side: 'BUY', venue: 'FUTURES' }).ok).toBe(false);
    expect(evaluateExecutionGate(mkSignal('LONG', { market: 'INDIA' }), { side: 'LONG', venue: 'FUTURES' }).ok).toBe(false);
  });
});
