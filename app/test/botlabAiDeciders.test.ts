// ============================================================
// test/botlabAiDeciders.test.ts — v21.2.0 (dual-provider plan Step-3)
// ------------------------------------------------------------
// aiDecider contract (makeDecider arms: laya / consensus / auto):
//   • single-provider modes (laya / jev)
//   • CONSENSUS truth table: take/take, take/wait, wait/take,
//     side mismatch, ek down × {wait|single}
//   • AUTO failover: breaker_open / http_5xx trigger, http_4xx NAHI
//   • SHADOW call: result logged (verdict.ai[name].shadow), action
//     par ZERO asar
//   • provider exception → WAIT (kabhi crash nahi)
//   • makeDecider guards: missing provider → throw
// Provider mocks = createJev-shaped raw verdicts {action, probs,
// note, cached, latencyMs} — the REAL engine layer ke upar.
// ============================================================
import { describe, it, expect } from 'vitest';
import { makeDecider, aiDecider } from '../server/bots/deciders.js';

// ---- strategy mock (aiDecider ko snapshot/jevPrompt/desk chahiye) ----
const strat = {
  desk: 'crypto',
  snapshot: (_sym, _ts, _row, cand) => ({
    proposed: cand?.side === 'LONG' ? 'enter_long' : 'enter_short',
    contextLines: ['Instrument: BTC', 'Proposed trade'],
    features: {},
  }),
  jevPrompt: () => ({ instructions: 'take or wait?', criteria: { enter_long: 'L', enter_short: 'S', wait: 'W' } }),
};
const cand = { symbol: 'BTC', side: 'LONG', features: {} };
const row = { bar: { time: Date.UTC(2026, 9, 12, 3, 30, 0) } };

// provider mock factory — createJev ke raw verdict shape me
const prov = (fn) => fn;
const P = (action, extra = {}) => prov(async () => ({ action, probs: { [action]: 0.6 }, cached: false, latencyMs: 5, ...extra }));
const DOWNP = () => P('wait', { note: 'breaker_open' });
const H503 = () => P('wait', { note: 'http_503' });
const H422 = () => P('wait', { note: 'http_422' });

const both = (l, j, extra = {}) => ({ providers: { laya: l, jev: j }, strategy: strat, ...extra });

describe('v21.2.0 aiDecider — single-provider modes', () => {
  it('laya arm: approve on proposed side → take; verdict.ai.laya populated, arm identity preserved', async () => {
    const d = makeDecider({ arm: 'laya', ...both(P('enter_long'), P('enter_long')) });
    const v = await d(cand, row);
    expect(v.action).toBe('take');
    expect(v.arm).toBe('laya');
    expect(v.ai.laya.choice).toBe('enter_long');
    expect(v.ai.jev).toBeNull();
    // compat field: deciding provider ka telemetry `jev` key pe
    expect(v.jev.choice).toBe('enter_long');
  });

  it('laya arm: provider wait → wait with honest reason', async () => {
    const d = makeDecider({ arm: 'laya', ...both(P('wait', { note: 'below_threshold(0.20)' }), P('enter_long')) });
    const v = await d(cand, row);
    expect(v.action).toBe('wait');
    expect(v.reason).toContain('below_threshold');
  });

  it('side flip is BANNED in the decider layer too (defense in depth): provider picks the other side → wait', async () => {
    const d = makeDecider({ arm: 'laya', ...both(P('enter_short'), P('enter_long')) });
    const v = await d(cand, row);
    expect(v.action).toBe('wait');
  });
});

describe('v21.2.0 aiDecider — consensus truth table', () => {
  it('take/take (same side) → TAKE (consensus_both_take)', async () => {
    const d = makeDecider({ arm: 'consensus', ...both(P('enter_long'), P('enter_long')) });
    const v = await d(cand, row);
    expect(v.action).toBe('take');
    expect(v.reason).toBe('consensus_both_take');
    expect(v.ai.laya.choice).toBe('enter_long');
    expect(v.ai.jev.choice).toBe('enter_long');
  });

  it('take/wait → WAIT (consensus_veto)', async () => {
    const d = makeDecider({ arm: 'consensus', ...both(P('enter_long'), P('wait')) });
    const v = await d(cand, row);
    expect(v.action).toBe('wait');
    expect(v.reason).toContain('consensus_veto');
  });

  it('wait/take → WAIT (consensus_veto)', async () => {
    const d = makeDecider({ arm: 'consensus', ...both(P('wait'), P('enter_long')) });
    const v = await d(cand, row);
    expect(v.action).toBe('wait');
  });

  it('side mismatch (jev picks the OTHER side) → WAIT (consensus_disagreed_side)', async () => {
    const d = makeDecider({ arm: 'consensus', ...both(P('enter_long'), P('enter_short')) });
    const v = await d(cand, row);
    expect(v.action).toBe('wait');
    expect(v.reason).toBe('consensus_disagreed_side');
  });

  it('ek provider down + onDown=wait (DEFAULT) → WAIT (consensus_provider_down)', async () => {
    const d = makeDecider({ arm: 'consensus', ...both(DOWNP(), P('enter_long'), { onDown: 'wait' }) });
    const v = await d(cand, row);
    expect(v.action).toBe('wait');
    expect(v.reason).toContain('consensus_provider_down');
    expect(v.reason).toContain('laya');
  });

  it('ek provider down + onDown=single → bacha hua provider decide karta hai', async () => {
    const d = makeDecider({ arm: 'consensus', ...both(DOWNP(), P('enter_long'), { onDown: 'single' }) });
    const v = await d(cand, row);
    expect(v.action).toBe('take');
    expect(v.reason).toContain('consensus_degraded_single(jev)');
    // laya down hona verdict.ai me honest dikhta hai
    expect(v.ai.laya.note).toBe('breaker_open');
  });

  it('jev down + onDown=single → laya decides', async () => {
    const d = makeDecider({ arm: 'consensus', ...both(P('enter_long'), DOWNP(), { onDown: 'single' }) });
    const v = await d(cand, row);
    expect(v.action).toBe('take');
    expect(v.reason).toContain('consensus_degraded_single(laya)');
  });

  it('laya INSTANCE absent (config) + onDown=wait → provider_unavailable note + WAIT', async () => {
    const d = makeDecider({ arm: 'consensus', ...both(null, P('enter_long'), { onDown: 'wait' }) });
    const v = await d(cand, row);
    expect(v.action).toBe('wait');
    expect(v.ai.laya.note).toBe('provider_unavailable');
    expect(v.reason).toContain('consensus_provider_down');
  });
});

describe('v21.2.0 aiDecider — auto (primary + failover)', () => {
  it('primary healthy → primary decides (take)', async () => {
    const d = makeDecider({ arm: 'auto', ...both(P('enter_long'), P('enter_short')), primary: 'laya' });
    const v = await d(cand, row);
    expect(v.action).toBe('take');
    expect(v.ai.jev).toBeNull(); // jev call hi nahi hua
  });

  it('primary breaker_open → FAILOVER to secondary (reason stamped)', async () => {
    const d = makeDecider({ arm: 'auto', ...both(DOWNP(), P('enter_long')), primary: 'laya' });
    const v = await d(cand, row);
    expect(v.action).toBe('take');
    expect(v.reason).toContain('failover(laya->jev)');
    expect(v.ai.laya.note).toBe('breaker_open');
    expect(v.ai.jev.choice).toBe('enter_long');
  });

  it('primary http_503 → FAILOVER (5xx counts as down)', async () => {
    const d = makeDecider({ arm: 'auto', ...both(H503(), P('enter_long')), primary: 'laya' });
    const v = await d(cand, row);
    expect(v.action).toBe('take');
    expect(v.reason).toContain('failover');
  });

  it('primary http_422 → NO failover (bad request dusre pe bhi fail hoga) — wait', async () => {
    const d = makeDecider({ arm: 'auto', ...both(H422(), P('enter_long')), primary: 'laya' });
    const v = await d(cand, row);
    expect(v.action).toBe('wait');
    expect(v.reason).toBe('http_422');
    expect(v.ai.jev).toBeNull(); // jev call NAHI hua — failover burn nahi
  });

  it('primary=jev direction bhi kaam karta hai', async () => {
    const d = makeDecider({ arm: 'auto', ...both(P('enter_long'), DOWNP()), primary: 'jev' });
    const v = await d(cand, row);
    expect(v.action).toBe('take'); // jev down tha, failover laya ne approve kiya
    expect(v.reason).toContain('failover(jev->laya)');
  });

  it('dono down → WAIT (kabhi AI ke bina trade nahi)', async () => {
    const d = makeDecider({ arm: 'auto', ...both(DOWNP(), DOWNP()), primary: 'laya' });
    const v = await d(cand, row);
    expect(v.action).toBe('wait');
  });
});

describe('v21.2.0 aiDecider — shadow (R3 shadow-weeks)', () => {
  it('shadow provider call hoti hai, result LOGGED — action par ZERO asar', async () => {
    let shadowCalls = 0;
    const shadowProv = async () => { shadowCalls++; return { action: 'wait', probs: { wait: 0.9 }, note: 'below_threshold(0.11)', cached: false, latencyMs: 3 }; };
    const d = makeDecider({ arm: 'laya', ...both(P('enter_long'), shadowProv), shadow: 'jev' });
    const v = await d(cand, row);
    expect(v.action).toBe('take');          // shadow ka wait action nahi badalta
    expect(shadowCalls).toBe(1);
    expect(v.ai.jev.shadow).toBe(true);      // logged with shadow marker
    expect(v.ai.jev.note).toContain('below_threshold');
  });

  it('jo provider already decision me call ho chuka uski shadow call NAHI hoti', async () => {
    let jevCalls = 0;
    const jProv = async () => { jevCalls++; return { action: 'enter_long', probs: { enter_long: 0.6 }, cached: false, latencyMs: 2 }; };
    const d = makeDecider({ arm: 'consensus', ...both(P('enter_long'), jProv), shadow: 'jev' });
    const v = await d(cand, row);
    expect(v.action).toBe('take');
    expect(jevCalls).toBe(1); // decision call only — shadow duplicate nahi
    expect(v.ai.jev.shadow).toBeUndefined();
  });

  it('shadow provider exception → sirf note, decision unaffected', async () => {
    const badShadow = async () => { throw new Error('laya laptop band hai'); };
    const d = makeDecider({ arm: 'jev', providers: { laya: badShadow, jev: P('enter_long') }, strategy: strat, shadow: 'laya' });
    const v = await d(cand, row);
    expect(v.action).toBe('take');
    expect(v.ai.laya.note).toBe('shadow_error');
    expect(v.ai.laya.shadow).toBe(true);
  });
});

describe('v21.2.0 aiDecider — failure discipline', () => {
  it('provider exception (deciding) → WAIT, kabhi crash nahi', async () => {
    const boom = async () => { throw new Error('ECONNRESET'); };
    const d = makeDecider({ arm: 'laya', ...both(boom, P('enter_long')) });
    const v = await d(cand, row);
    expect(v.action).toBe('wait');
    expect(v.reason).toContain('provider_exception');
  });

  it('snapshot building exception → WAIT (whole decider fail-closed)', async () => {
    const badStrat = { ...strat, snapshot: () => { throw new Error('bad snapshot'); } };
    const d = aiDecider({ providers: { laya: P('enter_long'), jev: null }, mode: 'laya', strategy: badStrat });
    const v = await d(cand, row);
    expect(v.action).toBe('wait');
    expect(v.reason).toContain('ai_decider_error');
  });
});

describe('v21.2.0 makeDecider — guards (backstop; botRunner pehle resolve karta hai)', () => {
  it('laya arm without a laya instance → throw', () => {
    expect(() => makeDecider({ arm: 'laya', ...both(null, P('enter_long')) })).toThrow(/laya/);
  });

  it('consensus with BOTH absent → throw; ek present → allowed (onDown policy)', () => {
    expect(() => makeDecider({ arm: 'consensus', ...both(null, null) })).toThrow(/consensus/);
    // ek present — nahi throw karega (aiDecider provider_unavailable path)
    expect(() => makeDecider({ arm: 'consensus', ...both(null, P('enter_long')) })).not.toThrow();
  });

  it('auto with NO provider → throw', () => {
    expect(() => makeDecider({ arm: 'auto', ...both(null, null) })).toThrow(/auto/);
  });

  it('unknown arm still throws honestly', () => {
    expect(() => makeDecider({ arm: 'psychic', ...both(P('wait'), P('wait')) })).toThrow(/unknown arm/);
  });

  it('jev arm via providers registry (no `jev` param) works', async () => {
    const d = makeDecider({ arm: 'jev', providers: { laya: null, jev: P('enter_long') }, strategy: strat });
    const v = await d(cand, row);
    expect(v.action).toBe('take');
    expect(v.arm).toBe('jev');
  });
});
