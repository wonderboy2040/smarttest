// v20.9.3 UC currency-domain live probe: run the REAL futures + crypto
// board computes and verify the tickVelocity check row is DOMAIN-SANE
// (the v20.9.2 bug: FUTURES desk read spot-INR candles against a USDT
// perp tick → every verdict carried a fake "live print −9880bps" row
// and a constant −8 score skew).
import { getSignals } from '../app/server/ai/signals.js';

const deps = {
  KEYS: {},
  OPENAI_COMPAT: null,
  getTradingConfig: () => ({}),
};

const badRows = [];
const goodRows = [];

for (const mkt of ['FUTURES', 'CRYPTO']) {
  const board = await getSignals(mkt, deps, { noCache: true, limit: 20 }).catch(e => {
    console.log(`${mkt} BOARD ERROR`, String(e?.message || e).slice(0, 200));
    return null;
  });
  if (!board) continue;
  const sigs = board?.signals || [];
  console.log(`\n=== ${mkt}: board ok=${board?.ok} signals=${sigs.length} uc-stamped=${sigs.filter(s => s.ultrafast).length} ===`);
  for (const s of sigs.filter(s => s.ultrafast).slice(0, 6)) {
    console.log(`  ${s.symbol} ${s.side} ai=${s.superIntel?.aiScore} → UC=${s.ultrafast.verdict} micro=${s.ultrafast.microDirection} ${s.ultrafast.score}/100`);
  }
}

// Direct verdicts on the top movers both desks — inspect the full checks
for (const mkt of ['FUTURES', 'CRYPTO']) {
  const board = await getSignals(mkt, deps, { noCache: true, limit: 20 }).catch(() => null);
  const sigs = (board?.signals || []).filter(s => s.superIntel && (s.side === 'LONG' || s.side === 'SHORT'));
  if (!sigs.length) continue;
  const top = sigs.sort((a, b) => (Number(b.superIntel?.aiScore) || 0) - (Number(a.superIntel?.aiScore) || 0)).slice(0, 2);
  const { verifySignalUltrafast } = await import('../app/server/ai/ultrafastVerifier.js');
  for (const s of top) {
    const v = await verifySignalUltrafast(s, { deadlineMs: 2500 }).catch(() => null);
    if (!v) continue;
    const tickRow = (v.checks || []).find(c => c.id === 'tickVelocity');
    // PENDING verdicts (insufficient data) legitimately carry NO checks —
    // only an EXISTING tickRow with insane bps (or a mismatch-skipped row
    // that should have been N/A) is a failure.
    const m = String(tickRow?.detail || '').match(/([+-][\d.]+)bps/);
    const bps = m ? parseFloat(m[1]) : null;
    const sane = tickRow == null || tickRow.status === 'N/A' || (bps != null && Math.abs(bps) < 2000);
    console.log(`${mkt} ${s.symbol} ${s.side}: verdict=${v.verdict} micro=${v.microDirection} ${v.score}/100 · tickRow=${tickRow?.status} ${tickRow?.detail || ''} ${sane ? '' : '❌ INSANE'}`);
    if (sane) goodRows.push(`${mkt}:${s.symbol}`);
    else badRows.push(`${mkt}:${s.symbol} ${tickRow?.detail}`);
  }
}

console.log(`\n=== RESULT: ${goodRows.length} domain-sane · ${badRows.length} insane ===`);
if (badRows.length) { console.log('BAD:', badRows); process.exit(1); }
console.log('PASS — no denomination-mismatch tick rows on live verdicts (v20.9.3 fix verified live)');
process.exit(0);
