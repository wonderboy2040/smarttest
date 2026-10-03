// ============================================================
//  v20.7.6 ORDER-FORM DRIVER — jsdom end-to-end tests.
//  The in-page scripts (cxPlaceOrderScript etc.) are evaluated via
//  new Function() against a REAL jsdom document with a mocked
//  getBoundingClientRect — so the exact code that runs inside the
//  user's Chrome tab is verified here:
//    • label-only price inputs (CoinDCX futures: placeholder = live
//      price NUMBER, no name/aria — the DOT LONG "wait timeout:
//      price input" root cause)
//    • limit-tab click + VERIFY + retry
//    • market-order fallback (no limit UI → market entry, not a fail)
//    • safety gate (no price AND no qty → NEVER blind-click buy)
//    • side-strict buy/sell regex (SHORT can never click "Long")
//    • failure diagnostics (inputs dump in the error payload)
// ============================================================
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { __orderFormScriptsForTests } from '../server/ai/browserAgent.js';

const S = __orderFormScriptsForTests();

// ---- jsdom vis() mock: hidden/[hidden] → 0x0, baaki sab 120x28 ----
beforeAll(() => {
  (window.Element.prototype as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = function (this: Element) {
    const el = this as HTMLElement;
    if (el.hasAttribute('hidden') || el.closest('[hidden]')) {
      return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    }
    return { width: 120, height: 28, top: 0, left: 0, right: 120, bottom: 28, x: 0, y: 28, toJSON: () => ({}) } as DOMRect;
  };
});

afterEach(() => { document.body.innerHTML = ''; });

/** Evaluate a generated in-page script inside jsdom (async, JSON result). */
async function run(script: string): Promise<Record<string, unknown>> {
  const fn = new Function(`return (async () => { ${script} })();`);
  const raw = await fn();
  return typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : raw;
}

/** CoinDCX FUTURES order form — label-only inputs (the real-world DOT
 *  breakage): placeholder is the live price number, "Price (USDT)" is a
 *  sibling label. Tabs are DIVs, not buttons. */
function futuresForm({ limit = true, market = true, priceField = true } = {}) {
  document.body.innerHTML = `
    <div class="trade-pane">
      <input type="text" placeholder="Search pairs" id="searchBox">
      <div class="order-form" id="orderForm">
        <div class="tabs">
          ${limit ? '<div class="tab" id="tabLimit">Limit</div>' : ''}
          ${market ? '<div class="tab" id="tabMarket">Market</div>' : ''}
          <div class="tab">Stop Limit</div>
        </div>
        <div class="field" id="priceField">
          <label>Price (USDT)</label>
          <input id="px" type="text" inputmode="decimal" placeholder="3.1524" ${priceField ? '' : 'hidden'}>
        </div>
        <div class="field">
          <label>Amount (DOT)</label>
          <input id="amt" type="text" inputmode="decimal" placeholder="0.00">
        </div>
        <button id="btnBuy">Buy / Long</button>
        <button id="btnSell">Sell / Short</button>
      </div>
    </div>`;
  // Market mode simulation: Limit tab click → price input visible;
  // (price field starts hidden only when we want market-default)
  if (priceField) return;
}

const sleepRef = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('v20.7.6 order-form driver — CoinDCX futures label-only inputs (DOT LONG fix)', () => {
  it('findOrderField: label-only price input milta hai (placeholder = live price NUMBER, no name/aria)', async () => {
    futuresForm();
    const r = await run(`
      ${S.DOM_HELPERS}
      const px = findOrderField('price');
      const amt = findOrderField('qty');
      return JSON.stringify({ px: px ? px.id : null, amt: amt ? amt.id : null });
    `);
    expect(r.px).toBe('px');
    expect(r.amt).toBe('amt');
  });

  it('findOrderField: <label for> association bhi chalta hai (Dhan pattern)', async () => {
    document.body.innerHTML = `
      <div class="order-window">
        <label for="dhanPx">Price</label><input id="dhanPx" type="text" placeholder="0.00">
        <label for="dhanQty">Quantity</label><input id="dhanQty" type="text" placeholder="0">
        <button>BUY</button>
      </div>`;
    const r = await run(`
      ${S.DOM_HELPERS}
      return JSON.stringify({ px: findOrderField('price')?.id || null, amt: findOrderField('qty')?.id || null });
    `);
    expect(r.px).toBe('dhanPx');
    expect(r.amt).toBe('dhanQty');
  });

  it('findOrderField: search box kabhi price/qty nahi ban sakta (anti-regex)', async () => {
    futuresForm();
    const r = await run(`
      ${S.DOM_HELPERS}
      const hits = $$('input').filter(isOrderNumInput).map((el) => el.id);
      return JSON.stringify({ hits });
    `);
    expect((r.hits as string[])).not.toContain('searchBox');
    expect((r.hits as string[])).toContain('px');
    expect((r.hits as string[])).toContain('amt');
  });

  it('findOrderField: positional pass — bina kisi label/attr wale 2 inputs (pehla price, doosra qty)', async () => {
    document.body.innerHTML = `
      <div class="order-form">
        <input id="first" type="text" inputmode="decimal">
        <input id="second" type="text" inputmode="decimal">
        <button id="b">Buy / Long</button>
      </div>`;
    const r = await run(`
      ${S.DOM_HELPERS}
      return JSON.stringify({ px: findOrderField('price')?.id || null, amt: findOrderField('qty')?.id || null });
    `);
    expect(r.px).toBe('first');
    expect(r.amt).toBe('second');
  });

  it('full place-order LIMIT flow: tab(div) click + verify + price/qty set + buy click', async () => {
    futuresForm({ priceField: false }); // price input shuru me hidden (market-default panel)
    // Limit tab click → price field visible ho jata hai (React re-render sim)
    document.getElementById('tabLimit')!.addEventListener('click', () => {
      document.getElementById('px')!.removeAttribute('hidden');
    });
    const r = await run(S.cxPlaceOrderScript({ side: 'LONG', price: 3.15, totalINR: 100, leverage: 1, useMargin: false }));
    expect(r.ok).toBe(true);
    const steps = r.steps as string[];
    expect(steps).toContain('limit-order');
    expect(steps).toContain('price=3.15');
    expect(steps).toContain('qty-set');
    expect(steps).toContain('clicked:buy');
    expect((document.getElementById('px') as HTMLInputElement).value).toBe('3.15');
    expect((document.getElementById('amt') as HTMLInputElement).value).toBe(String(Math.round((100 / 3.15) * 1e6) / 1e6));
  }, 15000);

  it('MARKET FALLBACK: limit UI absent → market order entry, ENTRY FAIL nahi', async () => {
    futuresForm({ limit: false, priceField: false }); // sirf Market tab, amount only
    const r = await run(S.cxPlaceOrderScript({ side: 'LONG', price: 3.15, totalINR: 100, leverage: 1, useMargin: false }));
    expect(r.ok).toBe(true);
    const steps = r.steps as string[];
    expect(steps).toContain('fallback:market-order');
    expect(steps).toContain('qty-set');
    expect(steps).toContain('clicked:buy');
    expect((document.getElementById('amt') as HTMLInputElement).value).not.toBe('');
  }, 15000);

  it('SAFETY GATE: na price na qty input → buy click KABHI nahi (blind order block)', async () => {
    document.body.innerHTML = `
      <div class="pane">
        <button id="btnBuy">Buy / Long</button>
        <button id="btnSell">Sell / Short</button>
      </div>`;
    let buyClicked = false;
    document.getElementById('btnBuy')!.addEventListener('click', () => { buyClicked = true; });
    const r = await run(S.cxPlaceOrderScript({ side: 'LONG', price: 3.15, totalINR: 100, leverage: 1, useMargin: false }));
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/order form inputs nahi mile/);
    expect(buyClicked).toBe(false);
    // diagnostics: inputs dump error payload me present (empty array — koi visible input hi nahi)
    expect(String(r.inputs)).toBe('[]');
  }, 15000);

  it('SIDE-STRICT: SHORT order "Buy / Long" (DOM me pehle) kabhi click nahi karta', async () => {
    futuresForm();
    let buyClicked = false; let sellClicked = false;
    document.getElementById('btnBuy')!.addEventListener('click', () => { buyClicked = true; });
    document.getElementById('btnSell')!.addEventListener('click', () => { sellClicked = true; });
    const r = await run(S.cxPlaceOrderScript({ side: 'SHORT', price: 3.15, totalINR: 100, leverage: 1, useMargin: false }));
    expect(r.ok).toBe(true);
    expect((r.steps as string[])).toContain('clicked:sell');
    expect(buyClicked).toBe(false);
    expect(sellClicked).toBe(true);
  }, 15000);

  it('page error element → ok:false + pageError surface (honest fail)', async () => {
    futuresForm();
    document.body.insertAdjacentHTML('beforeend', '<div class="error" role="alert">Insufficient margin</div>');
    const r = await run(S.cxPlaceOrderScript({ side: 'LONG', price: 3.15, totalINR: 100, leverage: 1, useMargin: false }));
    expect(r.ok).toBe(false);
    expect(String(r.pageError)).toMatch(/Insufficient margin/);
  }, 15000);

  it('DIAGNOSTICS: buy button missing → wait timeout error + inputs dump ke saath', async () => {
    // form with price/qty inputs par koi buy/sell button nahi
    document.body.innerHTML = `
      <div class="order-form">
        <div class="field"><label>Price (USDT)</label><input id="px" type="text" placeholder="3.1524"></div>
        <div class="field"><label>Amount (DOT)</label><input id="amt" type="text" placeholder="0.00"></div>
      </div>`;
    const r = await run(S.cxPlaceOrderScript({ side: 'LONG', price: 3.15, totalINR: 100, leverage: 1, useMargin: false }));
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/wait timeout: buy button/);
    const dump = JSON.parse(String(r.inputs)) as Array<{ id: string | null }>;
    expect(dump.map((d) => d.id)).toContain('px');
    expect(dump.map((d) => d.id)).toContain('amt');
  }, 15000);

  it('generated script side-regex: SHORT ke liye sell|short — purana combined want|long|short pattern GAYA', () => {
    const shortScript = S.cxPlaceOrderScript({ side: 'SHORT', price: 1, totalINR: 1, leverage: 1, useMargin: false });
    const longScript = S.cxPlaceOrderScript({ side: 'LONG', price: 1, totalINR: 1, leverage: 1, useMargin: false });
    expect(shortScript).toContain(`SIDE === 'LONG' ? 'buy|long' : 'sell|short'`);
    expect(longScript).toContain(`SIDE === 'LONG' ? 'buy|long' : 'sell|short'`);
    // purana buggy pattern (want + '|long|short' — jisme SELL bhi Long pe match hota tha) ja chuka hai
    expect(shortScript).not.toMatch(/'\+ want \+ '\|long\|short/);
    expect(shortScript).not.toContain(`'|long|short'`);
  });

  it('market-mode form: single input = qty (price kabhi nahi)', async () => {
    document.body.innerHTML = `
      <div class="order-form">
        <div class="field"><label>Amount (DOT)</label><input id="amt" type="text" placeholder="0.00"></div>
        <button id="btnBuy">Buy / Long</button>
      </div>`;
    const r = await run(`
      ${S.DOM_HELPERS}
      return JSON.stringify({ px: findOrderField('price') ? 'FOUND' : null, amt: findOrderField('qty')?.id || null });
    `);
    expect(r.px).toBeNull();
    expect(r.amt).toBe('amt');
  });
});

describe('v20.7.6 order-form driver — health probe + dhan upgrade', () => {
  it('cxHealthScript: label-only futures form par priceInput/qtyInput ab DETECT hote hain', async () => {
    futuresForm();
    const r = await run(S.cxHealthScript());
    expect(r.ok).toBe(true);
    const found = r.found as Record<string, boolean>;
    expect(found.priceInput).toBe(true);
    expect(found.qtyInput).toBe(true);
    expect(found.buyBtn).toBe(true);
    expect(found.sellBtn).toBe(true);
  });

  it('dhanPlaceOrderScript: label-for wale Price/Quantity inputs fill hote hain', async () => {
    document.body.innerHTML = `
      <div class="order-window">
        <label for="dhanPx">Price</label><input id="dhanPx" type="text" placeholder="0.00">
        <label for="dhanQty">Quantity</label><input id="dhanQty" type="text" placeholder="0">
        <button id="buy">BUY</button>
      </div>`;
    const r = await run(S.dhanPlaceOrderScript({ side: 'LONG', price: 450.5, quantity: 3, product: 'INTRADAY' }));
    expect(r.ok).toBe(true);
    expect((r.steps as string[])).toContain('price');
    expect((r.steps as string[])).toContain('qty');
    expect((document.getElementById('dhanPx') as HTMLInputElement).value).toBe('450.5');
    expect((document.getElementById('dhanQty') as HTMLInputElement).value).toBe('3');
  }, 15000);
});

describe('v20.7.6 CDP send() timeout override', () => {
  it('generated scripts me hardcoded-15s evaluate wall ka dependency khatam — evaluate timeout ab passthrough hai (source-level lock)', async () => {
    // browserAgent.js source me send() ab { timeoutMs } option leta hai —
    // lock: evaluate apna timeoutMs + 3000 send ko deta hai
    const fs = await import('node:fs');
    const p = await import('node:path');
    const src = fs.readFileSync(p.resolve(process.cwd(), 'server/ai/browserAgent.js'), 'utf8');
    expect(src).toContain('send(method, params = {}, { timeoutMs = 15000 } = {})');
    expect(src).toContain('{ timeoutMs: Math.max(15000, timeoutMs + 3000) }');
    expect(src).not.toContain('}, 15000).unref();');
  });
});

// silence unused warning (sleepRef kept for future timing tests)
void sleepRef;
