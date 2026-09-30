// ============================================================
// scripts/smoke_v131.mjs — SVA SIGNAL VERIFICATION AGENT smoke
// ------------------------------------------------------------
// User spec: "ek Aisa Agent ko add karo jo tab me Signal mila usse
// advance pro trader level pe check karke final result bole long
// jana hai ya short accurate and high accuracy ke sath"
// LOCKS:
//   S1 — the live XRP burn (RSI 70 + 2.31×ATR chase + 28% quorum)
//        NEVER confirms → FLIP → SHORT (the exact trade that bled)
//   S2 — clean pullback → CONFIRM LONG at full risk
//   S3 — checklist integrity (10 checks · weights sum 100)
//   S4 — wire payload compact + idempotent
//   S5 — the manual-trade stamp (verify on the trade record)
// Run: node scripts/smoke_v131.mjs
// ============================================================
import { verifySignal, verificationWire } from '../server/ai/signalVerifier.js';

let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ''}`); }
  else { fail++; console.error(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ''}`); }
};

console.log('[S1] the live XRP-class burn — verifier rejects the chase LONG');
{
  const v = verifySignal({
    symbol: 'XRP', market: 'FUTURES', side: 'LONG', confidence: 48,
    voters: 3, totalModels: 11, agreement: 1,
    obOs: { tag: 'OVERBOUGHT', rsi: 70.4 },
    chasing: { side: 'LONG', extAtr: 2.31, ref: 'EMA20', runBars: 4, runAtr: 2.8, severity: 'HARD', reason: 'stretched leg' },
    plan: { entry: 1.62, stopLoss: 1.54, target1: 1.7, target2: 1.78, rewardRisk: 1.0 },
    superIntel: { aiScore: 57, winProb: { edgePts: -2 } },
  });
  ok(v.veto === true, 'PRO VETO fires (chase HARD + RSI extreme)');
  ok(v.action === 'FLIP' && v.finalCall === 'SHORT', 'final call FLIP → SHORT', `score ${v.score}`);
  ok(v.sizeHint === 0, 'size hint: NO entry');
}

console.log('[S2] clean pullback setup — CONFIRM LONG at full risk');
{
  const v = verifySignal({
    symbol: 'XRP', market: 'FUTURES', side: 'LONG', confidence: 66,
    voters: 8, totalModels: 11, agreement: 0.73,
    entryQuality: { band: 'PULLBACK', extAtr: 0.02, ref: 'EMA20' },
    mtf: { agreement: 0.8 },
    plan: { entry: 1.52, stopLoss: 1.46, target1: 1.64, target2: 1.74, rewardRisk: 2.2 },
    superIntel: { aiScore: 78, winProb: { edgePts: 23.7 }, perp: { positioningScore: 70 } },
  });
  ok(v.action === 'CONFIRM' && v.finalCall === 'LONG', 'CONFIRM LONG', `score ${v.score}/100`);
  ok(v.sizeHint === 1, 'size hint: full risk');
}

console.log('[S3] checklist integrity');
{
  const v = verifySignal({ symbol: 'BTC', market: 'FUTURES', side: 'LONG' });
  ok(v.checklist.length === 10, 'exactly 10 pro checks');
  ok(v.checklist.reduce((s, c) => s + c.weight, 0) === 100, 'weights sum to 100');
  ok(v.score > 0 && v.score <= 100, `partial input degrades honestly (score ${v.score})`);
}

console.log('[S4] wire payload — compact + idempotent');
{
  const w1 = verificationWire(verifySignal({ symbol: 'ETH', market: 'FUTURES', side: 'SHORT', voters: 2, totalModels: 11 }));
  const w2 = verificationWire(w1);
  ok(w1 && w1.agent === 'SVA-v1' && w1.checklist === undefined, 'compact (no checklist on the wire)');
  ok(JSON.stringify(w1) === JSON.stringify(w2), 'idempotent re-wire (stamp survives)');
}

console.log('[S5] verdict language — the desk reads Hinglish');
{
  const v = verifySignal({
    symbol: 'XRP', market: 'FUTURES', side: 'LONG', voters: 3, totalModels: 11,
    obOs: { tag: 'OVERBOUGHT', rsi: 70.4 },
    chasing: { side: 'LONG', extAtr: 2.31, ref: 'EMA20', runBars: 4, severity: 'HARD', reason: 'x' },
    plan: { rewardRisk: 1.0 }, superIntel: { winProb: { edgePts: -2 } },
  });
  ok(/FLIP/.test(v.verdict) && /SHORT/.test(v.verdict), 'verdict line names the final call');
  ok(v.proNote.includes('SVA-v1'), 'proNote carries the agent tag + reasoning');
}

console.log(`===== SMOKE v13.1: ${pass} pass / ${fail} fail =====`);
process.exit(fail > 0 ? 1 : 0);
