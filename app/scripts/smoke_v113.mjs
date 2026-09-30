// ============================================================
// scripts/smoke_v113.mjs — v11.3 LIVE smoke: official CoinDCX WS layer
// ------------------------------------------------------------
// Proves, against the REAL production sockets/hosts:
//   S1  cxSpotWs connects (EIO=4), the currentPrices@spot book
//       populates, the synth ticker array is CoinDCX-shaped
//   S2  fetchCoinDcxTickers SURVIVES the sandbox's REST block via the
//       chain (WS book and/or Binance-fx synth) with an honest source
//   S3  cxRtStream joins currentPrices@futures@rt, FUT_ ticks land
//       from book updates with the honest coindcx-fut-ws label, and
//       the shared book state serves fetchFuturesPrices's fallback
//   S4  fetchFuturesPrices survives the REST block (WS book or
//       Binance-fut synth) with an honest source
// Run: node scripts/smoke_v113.mjs   (expects network; ~60s)
// ============================================================
process.env.SMARTAI_DATA_DIR = '/tmp/smoke-v113-data';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

const { spotWsDemand, spotWsStatus, spotWsTickerArray, spotWsPrice, _setSpotWsEnabledForTest } = await import('../server/ai/cxSpotWs.js');
const { fetchCoinDcxTickers, lastTickerSource, ensureCryptoSubscribed, cryptoClientUp, cryptoClientDown } = await import('../server/cryptoStream.js');
const { ensureCxRtSubscribed, cxRtClientUp, cxRtClientDown, _cxRtStateForTest } = await import('../server/ai/cxRtStream.js');
const { fetchFuturesPrices } = await import('../server/ai/futures.js');
const { getTick } = await import('../server/liveFeed.js');

// ---- S1: the official spot socket ----
console.log('\n[S1] cxSpotWs — official spot WebSocket (stream-spot.coindcx.com)');
_setSpotWsEnabledForTest(true);
spotWsDemand();
let status = spotWsStatus();
for (let i = 0; i < 40 && !(status.connected && status.markets > 20); i++) {
  await new Promise(r => setTimeout(r, 1000));
  status = spotWsStatus();
}
ok('socket connected', status.connected);
ok('book populated (>20 markets)', status.markets > 20, `${status.markets} markets`);
ok('book SERVABLE (≥25 fresh)', status.servable, `${status.freshMarkets} fresh`);
const arr = spotWsTickerArray();
ok('synth ticker array is CoinDCX-shaped', Array.isArray(arr) && arr.length > 20
  && typeof arr[0].market === 'string' && typeof arr[0].last_price === 'string');
// INR pairs ride the book in ~10s bursts — wait for them explicitly
let inrRows = arr.filter(t => t.market.endsWith('INR'));
for (let i = 0; i < 30 && inrRows.length === 0; i++) {
  await new Promise(r => setTimeout(r, 1000));
  inrRows = spotWsTickerArray().filter(t => t.market.endsWith('INR'));
}
ok('INR rows present', inrRows.length > 0, `${inrRows.length} INR markets, e.g. ${inrRows.slice(0, 3).map(t => `${t.market}=${t.last_price}`).join(' ')}`);

// ---- S2: the ticker chain under the sandbox REST block ----
console.log('\n[S2] fetchCoinDcxTickers — the chain vs the blocked REST (api.coindcx.com 403 here)');
// wait for INR coverage in the WS book first (the chain's WS leg needs it)
for (let i = 0; i < 30 && !spotWsPrice('BTCINR'); i++) {
  await new Promise(r => setTimeout(r, 1000));
}
let tickers = null, src = null, err = null;
try { tickers = await fetchCoinDcxTickers(); src = lastTickerSource(); } catch (e) { err = e; }
ok('chain answered (no 502)', Array.isArray(tickers) && tickers.length > 0, err ? `error: ${err.message}` : `${tickers?.length} rows`);
ok('honest source label', src && src !== 'coindcx-rest', `source=${src} (REST is 403-blocked from this network)`);
const btcRow = (tickers || []).find(t => t.market === 'BTCINR');
ok('BTC INR row present', !!btcRow, btcRow ? `last_price=${btcRow.last_price}` : 'missing');

// ---- S3: the futures book channel ----
console.log('\n[S3] cxRtStream — official futures book channel (currentPrices@futures@rt)');
ensureCxRtSubscribed({ fut: ['BTC', 'ETH'] });
cxRtClientUp();
// The Binance REST fallback serves a tick within seconds — wait for the
// WS-ATTRIBUTED tick specifically (the book channel needs a few seconds
// to connect + deliver its first attributable row).
let futTick = null;
for (let i = 0; i < 40 && !(futTick && futTick.source === 'coindcx-fut-ws'); i++) {
  await new Promise(r => setTimeout(r, 1000));
  futTick = getTick('FUT_BTC');
}
ok('FUT_BTC tick landed from the book channel', !!futTick, futTick ? `price=${futTick.price} source=${futTick.source}` : 'no tick in 40s');
ok('honest WS label', futTick?.source === 'coindcx-fut-ws', `source=${futTick?.source}`);
// wait for the shared book state to accumulate pairs before asserting
let st = _cxRtStateForTest();
for (let i = 0; i < 20 && st.book.pairs < 50; i++) {
  await new Promise(r => setTimeout(r, 1000));
  st = _cxRtStateForTest();
}
ok('shared book state populated', st.book.pairs > 50, `${st.book.pairs} pairs, ${st.book.fresh} fresh`);
ok('WS health proven → REST at the 10s floor', st.wsHealthy && st.restMs === 10_000, `healthy=${st.wsHealthy} restMs=${st.restMs}`);

// ---- S4: fetchFuturesPrices under the REST block ----
console.log('\n[S4] fetchFuturesPrices — the chain vs the blocked REST (public.coindcx.com 403 here)');
let futRows = null, futErr = null;
try { futRows = await fetchFuturesPrices({ maxAgeMs: 0 }); } catch (e) { futErr = e; }
ok('chain answered (no throw)', Array.isArray(futRows) && futRows.length > 0, futErr ? `error: ${futErr.message}` : `${futRows?.length} rows`);
const btcFut = (futRows || []).find(r => r.pair === 'B-BTC_USDT');
ok('B-BTC_USDT row present', !!btcFut, btcFut ? `last=${btcFut.last} source=${btcFut.source ?? 'rest'}` : 'missing');
ok('honest source (ws-book / binance-fut / bybit-fut)', !btcFut?.source || ['ws-book', 'binance-fut', 'bybit-fut'].includes(btcFut?.source), `source=${btcFut?.source ?? 'rest'}`);

cryptoClientDown();
cxRtClientDown();
console.log(`\n==== SMOKE v11.3: ${pass} passed, ${fail} failed ====`);
process.exit(fail > 0 ? 1 : 0);
