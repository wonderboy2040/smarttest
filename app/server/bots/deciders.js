// ============================================================
// server/bots/deciders.js — Jev Bot Lab v20.8.0 → v21.2.0 dual-provider
// ------------------------------------------------------------
// Plan §7.1: SAB ARMS, SAME CANDIDATES.
//   rules    — har candidate lo (baseline)
//   gated    — hand-written gates (CONTROL ARM — AI isi se compare hota
//              hai; plan ground rule #3)
//   jev      — Jev wahi candidates filter kare        (cloud)
//   laya     — Laya wahi candidates filter kare        (local, $0)
//   consensus— dono "take" bolein (same side) tabhi entry
//   auto     — AI_PRIMARY provider; down/error pe dusra (failover)
// Deciders NEVER generate or mutate candidates — identical input
// set is what makes the A/B meaningful (plan §7.1: "Alag
// candidates = alag strategies, A/B bekar").
//
// v21.2.0 SAFETY (dual-provider plan §3.1 — koi bhi mode nahi todta):
//   • AI sirf ENTRY pe, flat position pe; side flip / sizing / SL/TP
//     kabhi nahi (createJev ke andar + yahan approves() — defense in
//     depth)
//   • error/timeout/exception = WAIT; 'rule' fallback sirf conscious
//     config (jev arm, JEV_FALLBACK=rule)
//   • shadow provider ka decision SIRF log hota hai — trade pe asar nahi
// ============================================================

/**
 * rules arm: take everything.
 */
export function rulesDecider() {
  return async (_candidate, _row) => ({ action: 'take', arm: 'rules' });
}

/**
 * gated arm: strategy's hand-written gates, first veto wins.
 * Every gate returns a STABLE reason string (plan §6.1: "har ek
 * ek stable veto reason return kare") — veto breakdown reporting
 * depends on this.
 */
export function gatedDecider(strategy, { eventGuardCheck = null } = {}) {
  const gates = typeof strategy.gates === 'function' ? strategy.gates() : [];
  return async (candidate, row) => {
    const ctx = {
      features: candidate?.features || {},
      side: candidate?.side,
      frictionRiskR: candidate?.frictionRiskR,
      atr: row?.atr,
      emaFastSlope: row?.emaFastSlope,
    };
    // runtime event-day gate (needs live calendar) when provided
    if (eventGuardCheck) {
      try {
        const eg = eventGuardCheck({ symbol: candidate.symbol, desk: strategy.desk === 'india' ? 'INDIA' : 'CRYPTO' });
        if (eg?.blocked) ctx.eventDay = true;
      } catch { /* event guard failure must not fake a veto */ }
    }
    for (const g of gates) {
      let veto = null;
      try { veto = g(row, ctx); } catch { veto = `${g.name || 'gate'}:error`; }
      if (veto) return { action: 'wait', reason: veto, arm: 'gated' };
    }
    return { action: 'take', arm: 'gated' };
  };
}

/**
 * Snapshot + prompt build with the event-day context line — jevDecider
 * (v20.9.0 A3) wali logic, ab dono deciders share karte hain.
 */
function _snapPrompt(strategy, candidate, row, eventGuardCheck) {
  let snap = strategy.snapshot(candidate.symbol, row?.bar?.time ?? Date.now(), row, candidate);
  let eventDayLine = 'event_day: no';
  if (eventGuardCheck) {
    try {
      const eg = eventGuardCheck({ symbol: candidate.symbol, desk: strategy.desk === 'india' ? 'INDIA' : 'CRYPTO' });
      if (eg?.blocked) eventDayLine = `event_day: yes (${eg.label || 'blackout window'})`;
    } catch { /* event guard failure must not fake a veto */ }
  }
  if (typeof snap === 'string') snap = `${snap}\n${eventDayLine}`;
  else if (snap && typeof snap === 'object') snap.eventDay = eventDayLine;
  const prompt = strategy.jevPrompt();
  return { snap, prompt };
}

/**
 * jev arm: strategy proposes, Jev approves/vetoes.
 * NO side flips, NO sizing, NO SL/TP from Jev (ground rule #2).
 */
export function jevDecider({ jev, strategy, eventGuardCheck = null }) {
  return async (candidate, row) => {
    // v20.8.2 FIX (L — dead code): a gatedDecider instance used to be
    // built here but never called (the commented gatesInFront config
    // never existed) — removed; re-add BOTH together if that experiment
    // ever lands (plan: jev replaces gates, comparison is the point).
    const { snap, prompt } = _snapPrompt(strategy, candidate, row, eventGuardCheck);
    const v = await jev(snap, prompt);
    // v20.8.1 FIX (H1 — the Jev arm was a placebo): the Jev client
    // returns the RAW choice ('enter_long'|'enter_short'|'wait') but
    // BOTH consumers (engine.js + botRunner.js) gate on
    // verdict.action !== 'take' -> every Jev APPROVAL was treated as
    // a veto and the jev arm could never take a trade. Normalize to
    // the decider contract here ('take'|'wait') and keep the raw
    // choice as `jevChoice` for telemetry/decisionBreakdown.
    const verdict = {
      action: v.action === 'wait' ? 'wait' : 'take',
      reason: v.note || null,
      arm: 'jev',
      jev: { choice: v.action || null, probs: v.probs, confidence: v.confidence, cached: v.cached, latencyMs: v.latencyMs, aux: v.aux },
    };
    return verdict;
  };
}

// v21.2.0 (dual-provider): notes jo AUTO-FAILOVER trigger karte hain.
// 4xx (http_422/400/401) is list me NAHI hain — bad request dusre
// provider pe bhi waisa hi fail hoga; usse failover sirf latency
// badhata. no_answer/no_probability bhi nahi — wo malformed-response
// hai provider-down nahi.
const _FAILOVER_NOTES = new Set(['breaker_open', 'network_error', 'provider_unavailable']);
const _isFailoverNote = (note) => !!note
  && (_FAILOVER_NOTES.has(note) || /^http_5\d\d$/.test(String(note)));

const _pack = (v) => ({
  choice: v?.action || null,
  probs: v?.probs ?? null,
  confidence: v?.confidence ?? null,
  cached: !!v?.cached,
  latencyMs: v?.latencyMs ?? null,
  note: v?.note ?? null,
});

/**
 * v21.2.0 — THE DUAL-PROVIDER DECIDER (plan §3.1 / Step-3).
 *
 *   mode='laya'|'jev'  : single provider approve/veto
 *   mode='auto'        : primary call; failover-note (breaker/network/5xx)
 *                         pe dusra provider — dono down to WAIT
 *   mode='consensus'   : dono se poocha jaata hai; TAKE sirf jab dono
 *                        proposed side approve karein. Ek provider down
 *                        ho to `onDown`: 'wait' (default, safe) ya
 *                        'single' (bacha hua provider decide kare).
 *
 * `shadow` ('laya'|'jev'|'off'): jo provider is decision me already
 * call NAHI hua, uski ek aur call hoti hai jiska result SIRF verdict.ai
 * me log hota hai — action par ZERO asar (R3 shadow-weeks isipe chalte
 * hain: agreement % + outcome-by-agreement analysis).
 *
 * Verdict: { action:'take'|'wait', reason, arm:mode,
 *            ai:{ laya:{...}|null, jev:{...}|null },
 *            jev: <deciding provider ka compat block> }
 */
export function aiDecider({ providers, mode, primary = 'laya', shadow = 'off', onDown = 'wait', strategy, eventGuardCheck = null }) {
  const P = providers || {};
  return async (candidate, row) => {
    try {
      const { snap, prompt } = _snapPrompt(strategy, candidate, row, eventGuardCheck);
      const ai = { laya: null, jev: null };
      const called = new Set();
      const call = async (name) => {
        const inst = P[name];
        if (!inst) return { action: 'wait', note: 'provider_unavailable', cached: false, latencyMs: 0 };
        called.add(name);
        try { return await inst(snap, prompt); }
        catch (e) {
          // provider exception = WAIT, kabhi crash nahi (plan: koi bhi
          // exception -> wait)
          return { action: 'wait', note: 'provider_exception', error: String(e?.message || e).slice(0, 120), cached: false, latencyMs: 0 };
        }
      };
      // approve = raw provider choice EXACTLY proposed side pe (side flip
      // createJev ke andar bhi banned hai — ye second layer hai)
      const approves = (v) => v?.action === snap.proposed;

      let action = 'wait';
      let reason = null;
      let deciderProvider = null;

      if (mode === 'consensus') {
        const [vl, vj] = await Promise.all([call('laya'), call('jev')]);
        ai.laya = _pack(vl); ai.jev = _pack(vj);
        const downL = _isFailoverNote(vl.note), downJ = _isFailoverNote(vj.note);
        if (downL || downJ) {
          // ek provider down: AI_CONSENSUS_ON_DOWN policy
          if (onDown === 'single' && !(downL && downJ)) {
            const v = downL ? vj : vl;
            deciderProvider = downL ? 'jev' : 'laya';
            action = approves(v) ? 'take' : 'wait';
            reason = `consensus_degraded_single(${deciderProvider})${v.note ? `: ${v.note}` : ''}`;
          } else {
            action = 'wait';
            reason = `consensus_provider_down(${downL ? 'laya' : 'jev'}) — AI_CONSENSUS_ON_DOWN=${onDown}`;
          }
        } else if (approves(vl) && approves(vj)) {
          action = 'take';
          reason = 'consensus_both_take';
          deciderProvider = primary === 'jev' ? 'jev' : 'laya';
        } else {
          action = 'wait';
          const sideFlip = [vl, vj].some((v) => v?.action && v.action !== 'wait' && v.action !== snap.proposed);
          if (sideFlip) reason = 'consensus_disagreed_side';
          else {
            const first = approves(vl) ? { name: 'jev', v: vj } : { name: 'laya', v: vl };
            reason = `consensus_veto(${first.name}${first.v?.note ? `: ${first.v.note}` : ''})`;
          }
          deciderProvider = primary === 'jev' ? 'jev' : 'laya';
        }
      } else if (mode === 'auto') {
        const prim = primary === 'jev' ? 'jev' : 'laya';
        const sec = prim === 'jev' ? 'laya' : 'jev';
        const v = await call(prim);
        ai[prim] = _pack(v);
        if (!approves(v) && _isFailoverNote(v.note) && P[sec]) {
          const v2 = await call(sec);
          ai[sec] = _pack(v2);
          deciderProvider = sec;
          action = approves(v2) ? 'take' : 'wait';
          reason = `failover(${prim}->${sec})${v2.note ? `: ${v2.note}` : `: ${v2.action || 'wait'}`}`;
        } else {
          deciderProvider = prim;
          action = approves(v) ? 'take' : 'wait';
          reason = v.note || (approves(v) ? null : (v.action || 'wait'));
        }
      } else {
        // single-provider mode: 'laya' | 'jev'
        const v = await call(mode);
        ai[mode] = _pack(v);
        deciderProvider = mode;
        action = approves(v) ? 'take' : 'wait';
        reason = v.note || (approves(v) ? null : (v.action || 'wait'));
      }

      // ---- shadow call (dual-provider plan §3.2) ----
      // Sirf us provider pe jo is decision me abhi call NAHI hua, aur jo
      // configured hai. Result SIRF log (verdict.ai[name].shadow=true) —
      // action pe asar nahi. Awaited + bounded by provider timeout taaki
      // decision event me THEEK jagah dikhe (event-ordering races nahi).
      if (shadow === 'laya' || shadow === 'jev') {
        if (!called.has(shadow) && P[shadow]) {
          try {
            const vs = await P[shadow](snap, prompt);
            ai[shadow] = { ..._pack(vs), shadow: true };
          } catch {
            ai[shadow] = { choice: null, probs: null, confidence: null, cached: false, latencyMs: null, note: 'shadow_error', shadow: true };
          }
        }
      }

      return {
        action,
        reason,
        arm: mode,
        ai,
        // compat: botRunner event write + purana UI `verdict.jev` padhte
        // hain — deciding provider ka telemetry yahan baithta hai
        jev: deciderProvider ? { ...ai[deciderProvider] } : null,
      };
    } catch (e) {
      // koi bhi exception -> WAIT (plan ground rule: AI failure kabhi
      // trade nahi karta, aur kabhi crash bhi nahi karta)
      return { action: 'wait', reason: `ai_decider_error: ${String(e?.message || e).slice(0, 120)}`, arm: mode, ai: { laya: null, jev: null }, jev: null };
    }
  };
}

/**
 * Decider factory by arm name (plan §9 flow step 4: "Decider
 * (rules/gated/jev) config se"; v21.2.0: laya/consensus/auto bhi).
 *
 * Provider missing ho to THROW — botRunner usse pakad ke arm_fallback
 * event ke saath gated pe girta hai (silent nahi), routes 409 dete hain.
 */
export function makeDecider({ arm, strategy, jev = null, providers = null, primary = 'laya', shadow = 'off', onDown = 'wait', eventGuardCheck = null }) {
  if (arm === 'rules') return rulesDecider();
  if (arm === 'gated') return gatedDecider(strategy, { eventGuardCheck });
  if (arm === 'jev') {
    const inst = providers?.jev || jev;
    if (!inst) throw new Error('deciders: jev arm needs a jev instance');
    // v21.2.0 (dual-provider): jev arm ab bhi aiDecider se hota hai (ek hi
    // code path) — shadow support + approves() side-flip defense (pehle
    // jevDecider createJev par bharosa karta tha). Purana verdict contract
    // (arm:'jev', jev.{choice,probs,cached,latencyMs}, take|wait) same.
    const provs = { ...(providers || {}), jev: inst, laya: providers?.laya || null };
    return aiDecider({ providers: provs, mode: 'jev', primary, shadow, onDown, strategy, eventGuardCheck });
  }
  if (arm === 'laya' || arm === 'consensus' || arm === 'auto') {
    const provs = providers || { jev: jev || null, laya: null };
    if (arm === 'laya' && !provs.laya) throw new Error('deciders: laya arm needs a laya instance (LAYA_ENABLED=1 + LAYA_API_KEY)');
    // consensus: DONO absent → throw (botRunner isse pakad ke gated karta hai).
    // EK absent → allowed — aiDecider per-decision AI_CONSENSUS_ON_DOWN policy
    // chalata hai (wait=har decision WAIT; single=bacha hua provider decide).
    if (arm === 'consensus' && !(provs.jev || provs.laya)) throw new Error('deciders: consensus arm needs at least one AI provider');
    if (arm === 'auto' && !(provs.jev || provs.laya)) throw new Error('deciders: auto arm needs at least one AI provider');
    return aiDecider({ providers: provs, mode: arm, primary, shadow, onDown, strategy, eventGuardCheck });
  }
  throw new Error(`deciders: unknown arm '${arm}'`);
}
