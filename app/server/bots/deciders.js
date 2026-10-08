// ============================================================
// server/bots/deciders.js — Jev Bot Lab v20.8.0
// ------------------------------------------------------------
// Plan §7.1: TEEN ARMS, SAME CANDIDATES.
//   rules  — har candidate lo (baseline)
//   gated  — hand-written gates (CONTROL ARM — Jev isi se compare
//            hota hai, sirf rules se nahi; plan ground rule #3)
//   jev    — Jev wahi candidates filter kare
// Deciders NEVER generate or mutate candidates — identical input
// set is what makes the A/B meaningful (plan §7.1: "Alag
// candidates = alag strategies, A/B bekar").
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
 * jev arm: strategy proposes, Jev approves/vetoes.
 * NO side flips, NO sizing, NO SL/TP from Jev (ground rule #2).
 */
export function jevDecider({ jev, strategy, eventGuardCheck = null }) {
  return async (candidate, row) => {
    // v20.8.2 FIX (L — dead code): a gatedDecider instance used to be
    // built here but never called (the commented gatesInFront config
    // never existed) — removed; re-add BOTH together if that experiment
    // ever lands (plan: jev replaces gates, comparison is the point).
    let snap = strategy.snapshot(candidate.symbol, row?.bar?.time ?? Date.now(), row, candidate);
    // v20.9.0 (A3/M1 — A/B fairness): Jev ko bhi wahi event-day info
    // milti hai jo gated arm ke gates ko milti hai. Pehle jev arm
    // eventGuardCheck param LETA tha par use HI nahi karta tha — live
    // me Jev-armed bot result/RBI/expiry din bhi trade kar sakta tha
    // (aur A/B unfair thi: gated ko info thi, jev ko nahi).
    // HARD BLOCK to pre-decider me hi hota hai (botRiskPreCheck);
    // ye line snapshot me CONTEXT deti hai taaki Jev ka 'wait' reason
    // informative ho, blackout window me decision lene par.
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

/**
 * Decider factory by arm name (plan §9 flow step 4: "Decider
 * (rules/gated/jev) config se").
 */
export function makeDecider({ arm, strategy, jev = null, eventGuardCheck = null }) {
  if (arm === 'rules') return rulesDecider();
  if (arm === 'gated') return gatedDecider(strategy, { eventGuardCheck });
  if (arm === 'jev') {
    if (!jev) throw new Error('deciders: jev arm needs a jev instance');
    return jevDecider({ jev, strategy, eventGuardCheck });
  }
  throw new Error(`deciders: unknown arm '${arm}'`);
}
