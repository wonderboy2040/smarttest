// In-process integration probe: run the REAL crypto board compute and
// verify the UCV-A1 layer stamps verdicts on the 80+/STRONG tier.
import { getSignals } from '../app/server/ai/signals.js';

const deps = {
  KEYS: {},
  OPENAI_COMPAT: null,
  getTradingConfig: () => ({}),
};

const board = await getSignals('CRYPTO', deps, { noCache: true, limit: 20 }).catch(e => {
  console.log('BOARD ERROR', String(e?.message || e).slice(0, 200));
  process.exit(1);
});
const sigs = board?.signals || [];
console.log(`board ok=${board?.ok} signals=${sigs.length}`);
const scored = sigs.filter(s => s.superIntel);
console.log(`scored (superIntel)=${scored.length}`);
const uc = sigs.filter(s => s.ultrafast);
console.log(`ultrafast-stamped=${uc.length}`);
for (const s of uc.slice(0, 6)) {
  console.log(`  ${s.symbol} ${s.side} ai=${s.superIntel?.aiScore} grade=${s.grade} → UC=${s.ultrafast.verdict} micro=${s.ultrafast.microDirection} ${s.ultrafast.score}/100`);
  console.log(`    answer: ${s.ultrafast.answer}`);
}
const rejected = sigs.filter(s => s.ucRejected);
console.log(`ucRejected (demoted)=${rejected.length}`);
for (const s of rejected) {
  console.log(`  ${s.symbol} ${s.side} ai=${s.superIntel?.aiScore} grade=${s.grade} drivers=${JSON.stringify(s.superIntel?.drivers?.slice(-1))}`);
}
if (uc.length === 0 && scored.length > 0) {
  console.log('NOTE: no ultrafast stamps this cycle (no 80+/STRONG directional signal, or candle sources unreachable from this host) — the layer degrades honestly by design.');
  const any80 = sigs.some(s => (s.superIntel?.aiScore ?? 0) >= 80 || s.grade === 'STRONG');
  console.log(`80+/STRONG present: ${any80}`);
}
process.exit(0);
