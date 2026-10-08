// ============================================================
// test/bseOptionChain.test.ts — v11.1 NSE + SENSEX ADDENDUM
// ------------------------------------------------------------
// Locks the SENSEX honesty contract end-to-end:
//   1. fetchBSEOptionChain (REAL module, stubbed fetch): parses a
//      BSE-shaped chain, normalizes expiries, nulls on 403-block and
//      arms the negative cache (the documented datacenter case).
//   2. getOptionsDesk('SENSEX') with a REAL BSE chain → source 'bse',
//      full analytics parity (PCR/max-pain computed from real OI).
//   3. getOptionsDesk('SENSEX') with BSE blocked → the PERMANENT
//      limitation: source 'bs-model-sensex-always' + the persistent
//      banner text + honest null analytics. NIFTY's fallback stays
//      the RECOVERABLE 'bs-model-nifty-fallback' framing. The two
//      model cases can never be visually confused again.
//   4. buildOptionSignalCards: SENSEX model cards carry the STRUCTURAL
//      confidence discount (beyond model-uncertainty handling) and
//      their own source tag; NIFTY model cards carry none.
//   5. optionsScan: 'bse' counts as a LIVE chain (bonus + synthetic
//      flag + live/model classification).
// Hermetic — no network. All fetches stubbed/mocked.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- data.js: partially mocked (fetchers controllable; the REAL
// module stays importable via importActual for the parse tests) ----
const ctrl = {
  bse: null as any,
  nse: null as any,
  yahoo: {} as any,
};
vi.mock('../server/ai/data.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    fetchBSEOptionChain: vi.fn(async () => ctrl.bse),
    fetchNSEOptionChain: vi.fn(async () => ctrl.nse),
    fetchYahooQuotes: vi.fn(async () => ctrl.yahoo),
  };
});

import { getOptionsDesk, buildOptionSignalCards, buildSyntheticChain, SENSEX_MODEL_BANNER, LOT_SIZES } from '../server/ai/optionsDesk.js';
import { optionScanRow, scanScoreOf } from '../server/ai/optionsScan.js';

const nextThursday = () => {
  const d = new Date();
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + ((4 - day + 7) % 7 || 7));
  return d.toISOString().slice(0, 10);
};

// Phase-0 fix (2026-09-23): the fixtures below used a HARDCODED '2026-09-17'
// expiry — once the IST calendar rolled past it, chain.expiryDates had no
// d >= today row left, getOptionsDesk correctly honest-fell-back to
// 'bs-model-sensex-always', and the parity test failed as a STALE FIXTURE
// (production logic was right). Both fixtures are now SELF-HEALING: the
// expiry is always the next (future) Thursday, computed at run time.
const THU_ISO = nextThursday();
const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const THU_DMY = (() => { const [y, m, d] = THU_ISO.split('-'); return `${Number(d)} ${MONS[Number(m) - 1]} ${y}`; })();

// A deep-signal payload like getDeepSignal returns for a LONG consensus.
const mkDeep = (side: string) => ({
  ok: true,
  signal: { symbol: 'SENSEX', side, confidence: 74, grade: 'ACTION', agreement: 0.7 },
});

beforeEach(() => { ctrl.bse = null; ctrl.nse = null; ctrl.yahoo = {}; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// ============================================================
// 1. fetchBSEOptionChain — the REAL module with stubbed global fetch
// ============================================================
describe('fetchBSEOptionChain (real module, stubbed fetch)', () => {
  it('parses a BSE-shaped chain (records.data, "DD Mon YYYY" expiries) into the NSE-normalized row shape', async () => {
    const real: any = await vi.importActual('../server/ai/data.js');
    real.__resetBseForTests();
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      json: async () => ({
        records: {
          underlyingValue: 82350.5,
          data: [
            { strikePrice: 82000, expiryDate: THU_DMY, CE: { openInterest: 1200, changeinOpenInterest: 80, impliedVolatility: 12.4, lastPrice: 410.2, totalTradedVolume: 9000 }, PE: { openInterest: 3000, changeinOpenInterest: 200, impliedVolatility: 13.1, lastPrice: 85.4, totalTradedVolume: 21000 } },
            { strikePrice: 82100, expiryDate: THU_DMY, CE: { openInterest: 1500, changeinOpenInterest: 90, impliedVolatility: 12.1, lastPrice: 355.1, totalTradedVolume: 8000 }, PE: { openInterest: 2600, changeinOpenInterest: 120, impliedVolatility: 12.8, lastPrice: 120.6, totalTradedVolume: 15000 } },
            { strikePrice: 82200, expiryDate: THU_DMY, CE: { openInterest: 2100, changeinOpenInterest: 110, impliedVolatility: 11.9, lastPrice: 305.0, totalTradedVolume: 12000 }, PE: { openInterest: 1900, changeinOpenInterest: 60, impliedVolatility: 12.5, lastPrice: 170.3, totalTradedVolume: 11000 } },
            { strikePrice: 82300, expiryDate: THU_DMY, CE: { openInterest: 2600, changeinOpenInterest: 130, impliedVolatility: 11.7, lastPrice: 255.4, totalTradedVolume: 14000 }, PE: { openInterest: 1500, changeinOpenInterest: 40, impliedVolatility: 12.2, lastPrice: 230.1, totalTradedVolume: 9000 } },
            { strikePrice: 82400, expiryDate: THU_DMY, CE: { openInterest: 2900, changeinOpenInterest: 150, impliedVolatility: 11.6, lastPrice: 210.9, totalTradedVolume: 16000 }, PE: { openInterest: 1100, changeinOpenInterest: 30, impliedVolatility: 12.0, lastPrice: 295.2, totalTradedVolume: 7000 } },
            { strikePrice: 82500, expiryDate: THU_DMY, CE: { openInterest: 3200, changeinOpenInterest: 170, impliedVolatility: 11.5, lastPrice: 170.2, totalTradedVolume: 18000 }, PE: { openInterest: 900, changeinOpenInterest: 20, impliedVolatility: 11.9, lastPrice: 360.8, totalTradedVolume: 6000 } },
          ],
        },
      }),
    })) as any);
    const out = await real.fetchBSEOptionChain('SENSEX');
    expect(out).toBeTruthy();
    expect(out.source).toBe('bse');
    expect(out.spot).toBeCloseTo(82350.5, 1);
    expect(out.expiryDates).toEqual([THU_ISO]);
    expect(out.rows.length).toBe(6);
    expect(out.rows[0]).toMatchObject({
      strike: 82000, expiry: THU_ISO,
      callOI: 1200, callOIChange: 80, callIV: 12.4, callLTP: 410.2, callVolume: 9000,
      putOI: 3000, putOIChange: 200, putIV: 13.1, putLTP: 85.4, putVolume: 21000,
    });
    void calls;
  });

  it('returns null on the 403 Akamai block and arms the negative cache (no re-probe inside the window)', async () => {
    const real: any = await vi.importActual('../server/ai/data.js');
    real.__resetBseForTests();
    let fetches = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      fetches++;
      return { ok: false, status: 403, text: async () => 'Access Denied' };
    }) as any);
    expect(await real.fetchBSEOptionChain('SENSEX')).toBeNull();
    expect(fetches).toBeGreaterThanOrEqual(2); // bootstrap + both candidate endpoints attempted
    const { negUntil } = real.__bseNegForTests();
    expect(negUntil).toBeGreaterThan(Date.now());
    // Inside the 10-min hold: NO further upstream traffic.
    const before = fetches;
    expect(await real.fetchBSEOptionChain('SENSEX')).toBeNull();
    expect(fetches).toBe(before);
    real.__resetBseForTests();
  });

  it('only serves the SENSEX index (the single wired BSE underlying)', async () => {
    const real: any = await vi.importActual('../server/ai/data.js');
    real.__resetBseForTests();
    let fetches = 0;
    vi.stubGlobal('fetch', vi.fn(async () => { fetches++; throw new Error('no'); }) as any);
    expect(await real.fetchBSEOptionChain('NIFTY')).toBeNull();
    expect(await real.fetchBSEOptionChain('BANKNIFTY')).toBeNull();
    expect(fetches).toBe(0);
    real.__resetBseForTests();
  });
});

// ============================================================
// 2/3. getOptionsDesk — SENSEX full-parity vs the honest fallback
// ============================================================
describe('getOptionsDesk — SENSEX source honesty', () => {
  const bseChain = () => ({
    symbol: 'SENSEX', spot: 82350, expiryDates: [THU_ISO],
    source: 'bse', fetchedAt: Date.now(),
    rows: Array.from({ length: 13 }, (_, i) => {
      const strike = 82300 + (i - 6) * 100;
      return {
        strike, expiry: THU_ISO,
        callOI: 2000 - i * 50, callOIChange: 60, callIV: 12, callLTP: Math.max(5, 300 - Math.abs(i - 6) * 45), callVolume: 9000,
        putOI: 1500 + i * 50, putOIChange: 40, putIV: 12.5, putLTP: Math.max(5, 180 - Math.abs(i - 6) * 30), putVolume: 7000,
      };
    }),
  });

  it('a REAL BSE chain gets full parity: source "bse" + real-OI analytics (PCR computed)', async () => {
    ctrl.bse = bseChain();
    ctrl.yahoo = { SENSEX: { price: 82355, changePct: 0.4 }, INDIAVIX: { price: 12.9 } };
    const d = await getOptionsDesk('SENSEX');
    expect(d.ok).toBe(true);
    expect(d.source).toBe('bse');
    expect(d.analytics).toBeTruthy();
    expect(d.analytics!.pcr).toBeGreaterThan(0);
    expect(d.analytics!.maxPain).toBeGreaterThan(0);
    expect(d.syntheticNote).toBeNull();
  });

  it('BSE blocked → the PERMANENT limitation: "bs-model-sensex-always" + the exact banner text + honest null analytics', async () => {
    ctrl.bse = null; // the datacenter-blocked case (null = expected)
    ctrl.yahoo = { SENSEX: { price: 82355, changePct: 0.4 }, INDIAVIX: { price: 12.9 } };
    const d = await getOptionsDesk('SENSEX');
    expect(d.ok).toBe(true);
    expect(d.source).toBe('bs-model-sensex-always');
    expect(d.syntheticNote).toBeTruthy();
    // the plan's exact persistent-banner sentence, verbatim
    expect(d.syntheticNote).toContain('SENSEX premiums are model-estimated — BSE does not expose a public real-time option feed usable from this server.');
    expect(d.syntheticNote).toContain('cross-check your broker');
    expect(d.analytics).toBeNull(); // honest: no real OI → no PCR/max-pain
    expect((d as any).rows.length).toBeGreaterThan(0);
  });

  it('NIFTY with NSE blocked stays the RECOVERABLE framing: "bs-model-nifty-fallback" + "temporarily unreachable"', async () => {
    ctrl.nse = null;
    ctrl.yahoo = { NIFTY: { price: 23400, changePct: -0.2 }, INDIAVIX: { price: 13.4 } };
    const d = await getOptionsDesk('NIFTY');
    expect(d.ok).toBe(true);
    expect(d.source).toBe('bs-model-nifty-fallback');
    expect(d.syntheticNote).toContain('temporarily unreachable');
    expect(d.syntheticNote!.startsWith('NSE chain')).toBe(true);
  });

  it('buildSyntheticChain default keeps the legacy "bs-model" tag (back-compat), and honours an explicit source tag', () => {
    const exp = nextThursday();
    const legacy = buildSyntheticChain('SENSEX', 82000, 0.13, exp, 5);
    expect(legacy!.source).toBe('bs-model');
    const tagged = buildSyntheticChain('SENSEX', 82000, 0.13, exp, 5, 'bs-model-sensex-always');
    expect(tagged!.source).toBe('bs-model-sensex-always');
  });
});

// ============================================================
// 4. buildOptionSignalCards — the STRUCTURAL confidence discount
// ============================================================
describe('buildOptionSignalCards — SENSEX structural discount', () => {
  const mkDesk = (symbol: string, source: string) => {
    const exp = nextThursday();
    return {
      ok: true, symbol, spot: symbol === 'SENSEX' ? 82000 : 23400, expiry: exp, dte: 4,
      lotSize: LOT_SIZES[symbol] || 1, source, syntheticNote: 'model chain',
      rows: buildSyntheticChain(symbol, symbol === 'SENSEX' ? 82000 : 23400, 0.13, exp, 8)!.rows,
    } as any;
  };

  it('SENSEX model cards lose the structural discount points vs an identical NIFTY model card', () => {
    const niftyCards = buildOptionSignalCards(mkDesk('NIFTY', 'bs-model-nifty-fallback'), mkDeep('LONG'));
    const sensexCards = buildOptionSignalCards(mkDesk('SENSEX', 'bs-model-sensex-always'), mkDeep('LONG'));
    expect(niftyCards.length).toBeGreaterThan(0);
    expect(sensexCards.length).toBeGreaterThan(0);
    const n = niftyCards.find((c: any) => c.strikeBias === 'ATM');
    const s = sensexCards.find((c: any) => c.strikeBias === 'ATM');
    expect(s!.source).toBe('bs-model-sensex-always');
    expect(s!.structuralDiscount).toBe(8);            // default AI_SENSEX_MODEL_DISCOUNT
    expect(s!.aiScoreRaw).toBe(n!.aiScore);           // same raw blend (IV/lot differ only in scale)
    expect(s!.aiScore).toBe(Math.max(0, n!.aiScore - 8));
    expect(String(s!.machineNote)).toContain('SENSEX model-only');
    expect(n!.structuralDiscount).toBeUndefined();    // NIFTY's model mode is recoverable — no haircut
    expect(n!.aiScoreRaw).toBeUndefined();
  });

  it('a LIVE BSE desk produces cards with NO structural discount (parity restored)', () => {
    const cards = buildOptionSignalCards(mkDesk('SENSEX', 'bse'), mkDeep('LONG'));
    const atm = cards.find((c: any) => c.strikeBias === 'ATM');
    expect(atm!.source).toBe('bse');
    expect(atm!.structuralDiscount).toBeUndefined();
  });
});

// ============================================================
// 5. optionsScan — 'bse' is a LIVE chain
// ============================================================
describe('optionsScan — BSE live parity', () => {
  it('counts the bse chain as live: +5 score bonus, synthetic=false, live classification', () => {
    expect(scanScoreOf({ source: 'bse', directionPts: 0 } as any)).toBe(5);
    expect(scanScoreOf({ source: 'nse', directionPts: 0 } as any)).toBe(5);
    expect(scanScoreOf({ source: 'bs-model-sensex-always', directionPts: 0 } as any)).toBe(0);
    const desk: any = { ok: true, symbol: 'SENSEX', spot: 82000, source: 'bse', analytics: {}, dte: 2, expiry: nextThursday() };
    const row = optionScanRow(desk, 'index');
    expect(row.source).toBe('bse');
    expect(row.synthetic).toBe(false);
    const modelDesk: any = { ok: true, symbol: 'SENSEX', spot: 82000, source: 'bs-model-sensex-always', analytics: {}, dte: 2, expiry: nextThursday() };
    expect(optionScanRow(modelDesk, 'index').synthetic).toBe(true);
  });
});
