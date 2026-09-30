// ============================================================
// scripts/smoke_v120.mjs — v12.0 LIVE smoke: Pro Trader upgrade
// ------------------------------------------------------------
// Proves, against REAL upstreams (Binance fapi public, CoinDCX
// chain, the live ensemble):
//   S1  perpIntel — live funding + OI + top-trader L/S + taker
//       flow for BTC, the full 5-call assembly + derived read
//   S2  perpIntelBoardView — the desk view (top perps + summary)
//   S3  calibrationSnapshot — honest (sufficient OR insufficient,
//       never a crash)
//   S4  the FUTURES signal board carries superIntel.winProb
//       (calibrated P(win) + EV + verdict) and perp intel wire
//   S5  expert picks (FUTURES) carry per-pick winProb
//   S6  the DEEP dive now carries superIntel (AI score + blueprint
//       + winProb) — it was MISSING entirely pre-v12.0
//   S7  manualStats — the tracker's own track-record block
// Run: node scripts/smoke_v120.mjs   (expects network; ~120s)
// ============================================================
process.env.SMARTAI_DATA_DIR = '/tmp/smoke-v120-data';
process.env.AI_ENABLE_V2_MODELS = 'true';
process.env.AI_ENABLE_MESH_MODELS = 'true';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

// ---- S1: live perp intel ----
console.log('\n[S1] getPerpIntel(BTC) — the 5-call Binance fapi assembly');
const { getPerpIntel, perpIntelBoardView } = await import('../server/ai/perpIntel.js');
const intel = await getPerpIntel('BTC').catch(e => ({ ok: false, reason: String(e?.message || e) }));
ok('record ok', intel?.ok === true, intel?.reason || '');
ok('funding present (bps/8h)', intel?.ok && intel.fundingBps8h != null, `${intel?.fundingBps8h} bps`);
ok('open interest present', intel?.ok && intel.openInterest != null, String(intel?.openInterest));
ok('OI 24h change derived', intel?.ok && intel.oiChangePct24h != null, `${intel?.oiChangePct24h}%`);
ok('top-trader L/S present', intel?.ok && intel.topLongShortRatio != null, String(intel?.topLongShortRatio));
ok('taker ratio present', intel?.ok && intel.takerRatio24h != null, String(intel?.takerRatio24h));
ok('positioning read derived', intel?.ok && intel.read?.bias != null && Array.isArray(intel.read.reasons), `${intel?.read?.label} (conf ${intel?.read?.confidence})`);
console.log('      read reasons:', (intel?.read?.reasons || []).slice(0, 3).join(' | '));

// ---- S2: board view ----
console.log('\n[S2] perpIntelBoardView — the FUTURES desk positioning view');
const view = await perpIntelBoardView(12).catch(e => ({ ok: false, reason: String(e?.message || e) }));
ok('view ok', view?.ok === true, view?.reason || '');
ok('symbols with honest intel', Array.isArray(view?.symbols) && view.symbols.length > 3, `${view?.symbols?.length} symbols`);
ok('summary funding regime', view?.ok && view.summary?.fundingRegime != null, `${view.summary?.avgFundingBps8h}bps avg · ${view.summary?.fundingRegime}`);
ok('positioning breadth counted', view?.ok && (view.summary.bullish + view.summary.bearish + view.summary.neutral) === view.summary.scanned,
  `${view.summary?.bullish}B/${view.summary?.bearish}S/${view.summary?.neutral}N`);

// ---- S3: calibration snapshot ----
console.log('\n[S3] calibrationSnapshot — the ledger-calibration feed');
const { calibrationSnapshot } = await import('../server/ai/winProb.js');
const cal = await calibrationSnapshot().catch(() => null);
ok('snapshot answers honestly', cal != null && typeof cal.sufficient === 'boolean',
  cal?.sufficient ? `sufficient (${cal.settled} settled, ${cal.buckets?.length || 0} buckets)` : 'insufficient (uncalibrated prior — honest)');

// ---- S4: the FUTURES board carries winProb ----
console.log('\n[S4] getSignals(FUTURES) — superIntel.winProb on the board (universe scan, ~40s)');
const { getSignals } = await import('../server/ai/signals.js');
const board = await getSignals('FUTURES', {}, { limit: 10 }).catch(e => ({ ok: false, reason: String(e?.message || e) }));
ok('board ok', board?.ok === true, board?.reason || '');
const scored = (board?.signals || []).filter(s => s.superIntel);
ok('signals scored with superIntel', scored.length > 0, `${scored.length}/${board?.signals?.length}`);
const withWp = scored.filter(s => s.superIntel.winProb);
ok('winProb attached', withWp.length > 0, `${withWp.length}/${scored.length}`);
if (withWp.length > 0) {
  const w = withWp[0].superIntel.winProb;
  ok('winProb shape complete', w.pWin != null && w.pNeed != null && w.edgePts != null && w.evRealisticR != null && w.verdict != null && Array.isArray(w.drivers),
    `${withWp[0].symbol}: P(win) ${w.pWin}% vs need ${w.pNeed}% → ${w.verdict} · EV ${w.evRealisticR}R`);
  const withPerp = withWp.filter(s => s.superIntel.perp);
  ok('perp intel wire on futures signals', withPerp.length > 0, `${withPerp.length}/${withWp.length} carry funding/OI/taker`);
  if (withPerp[0]) {
    const p = withPerp[0].superIntel.perp;
    ok('perp wire shape', p.pair != null && p.read?.bias != null, `${p.pair} · ${p.read.label}`);
  }
}

// ---- S5: expert picks carry winProb ----
console.log('\n[S5] getExpertPicks(FUTURES) — per-pick calibrated win probability');
const { getExpertPicks } = await import('../server/ai/expertPicks.js');
const picks = await getExpertPicks('FUTURES', { minScore: 65, limit: 6 }).catch(e => ({ ok: false, reason: String(e?.message || e) }));
ok('picks ok', picks?.ok === true, picks?.reason || `${picks?.picks?.length || 0} picks`);
const pk = (picks?.picks || []).filter(p => p.winProb);
ok('picks carry winProb', pk.length > 0, `${pk.length}/${picks?.picks?.length}`);
if (pk[0]) {
  const w = pk[0].winProb;
  ok('pick winProb verdict present', w.verdict != null && w.pWin != null,
    `${pk[0].symbol} (${pk[0].score}): P(win) ${w.pWin}% · need ${w.pNeed}% → ${w.verdict}`);
  const withPerpPick = (picks?.picks || []).filter(p => p.perp);
  ok('FUTURES picks carry perp intel', withPerpPick.length > 0, `${withPerpPick.length}/${picks?.picks?.length}`);
}

// ---- S6: the deep dive now carries superIntel ----
console.log('\n[S6] getDeepSignal(BTC, FUTURES) — the previously-MISSING deep superIntel');
const { getDeepSignal } = await import('../server/ai/signals.js');
const deep = await getDeepSignal('BTC', 'FUTURES', {}).catch(e => ({ ok: false, reason: String(e?.message || e) }));
ok('deep ok', deep?.ok === true, deep?.reason || '');
const ds = deep?.signal;
ok('deep signal carries superIntel', ds?.superIntel != null, `AI score ${ds?.superIntel?.aiScore} · tier ${ds?.superIntel?.tier}`);
ok('deep superIntel has blueprint', ds?.superIntel?.blueprint != null, `entry ${ds?.superIntel?.blueprint?.entry} · ${ds?.superIntel?.blueprint?.exitPlan?.length || 0}-step exit`);
ok('deep superIntel has winProb', ds?.superIntel?.winProb != null,
  ds?.superIntel?.winProb ? `P(win) ${ds.superIntel.winProb.pWin}% → ${ds.superIntel.winProb.verdict}` : '');
ok('deep superIntel has perp intel (FUTURES)', ds?.superIntel?.perp != null, ds?.superIntel?.perp?.read?.label || '');

// ---- S7: manual stats ----
console.log('\n[S7] manualStats — the tracker track-record block');
const { manualStats } = await import('../server/ai/manualTrades.js');
const ms = manualStats([]);
ok('empty book → honest nulls', ms.closed === 0 && ms.winRate == null && ms.avgR == null, ms.note.slice(0, 60));

console.log(`\n===== SMOKE v12.0: ${pass} pass / ${fail} fail =====`);
process.exit(fail > 0 ? 1 : 0);
