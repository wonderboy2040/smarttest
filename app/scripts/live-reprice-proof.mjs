// v21.0.6 LIVE PROOF — B1 live-chain re-pricing end-to-end (real network):
// real data.js Groww/NSE ladder → paperTrading.injectOptionPaperQuotes
// with the SAME fetcher wiring stream.js uses. Post-market NSE-closed
// rejection prevents opening via API, so the engine path is proven here.
import { _resetForTests, openPaperTrade, injectOptionPaperQuotes } from '../server/intraday/paperTrading.js';
import { fetchNSEOptionChain, fetchBSEOptionChain } from '../server/ai/data.js';

// mirror of index.js fetchOptionChainFor (the stream wiring)
const fetchOptionChainFor = async (underlying) => {
  const u = String(underlying || '').toUpperCase();
  if (u === 'SENSEX') return fetchBSEOptionChain('SENSEX');
  return fetchNSEOptionChain(u);
};

_resetForTests();
const chain = await fetchOptionChainFor('NIFTY');
const row = chain.rows.find(r => r.strike === 22500);
console.log('live chain:', chain.source, 'via', chain.via, '| spot', chain.spot, '| 22500CE LTP', row.callLTP, '| 22500PE LTP', row.putLTP);

const r = openPaperTrade({
  symbol: 'NIFTY22500CE', direction: 'LONG', entry: row.callLTP, qty: 1,
  stopLoss: row.callLTP * 0.85, target1: row.callLTP * 1.08, target2: row.callLTP * 1.16,
  market: 'INDIA', assetKind: 'OPTION', underlying: 'NIFTY', strike: 22500,
  optType: 'CE', expiry: chain.expiryDates[0], iv: 12.16, lotSize: chain.lotSize,
  label: 'LIVE-REPRICE PROOF',
});
console.log('open ok:', r.ok);

const quotes = {};
// stream.js call shape: fetchIndexSpot still passed (BS fallback), fetchChain = live ladder
await injectOptionPaperQuotes(quotes, async () => null, fetchOptionChainFor);
const q = quotes.NIFTY22500CE;
console.log('re-priced quote:', JSON.stringify(q));
const ok = q && Math.abs(q.price - row.callLTP) < 0.51; // live LTP may drift a tick
console.log(ok ? 'PROOF OK — paper exit premium == live chain LTP (desk parity)' : 'PROOF FAILED');
process.exit(ok ? 0 : 1);
