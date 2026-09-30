// ============================================================
// scripts/smoke_v128.mjs — v12.8 LIVE smoke: SUPERINTELLIGENCE
// REVERSAL RECOVERY ENGINE (the user's XRP ₹-cycle story)
// ------------------------------------------------------------
// Proves the engine + wiring in-process:
//   S1  loadReversalConfig — clamped defaults + custom echo
//   S2  pure leg math — ₹ P&L, triggers, price-level stamping
//   S3  the DECISION brain — loss-cap cut + guarded flip veto
//   S4  the FULL XRP cycle end-to-end via the journal-mutating
//       engine (paper mode, deps injected):
//       LEG-1 LONG cut −₹150 → LEG-2 SHORT flip → +₹500 BOOKED
//       → WAITING window → ensemble confirm → LEG-3 LONG re-entry
//   S5  reversalCyclesView — the /api/ai/reversal board payload
//   S6  routes registration — /api/ai/reversal + PUT config mount
//       + the futures watcher injects getDeepSignal
// Run: node scripts/smoke_v128.mjs   (no network needed)
// ============================================================
process.env.SMARTAI_DATA_DIR = '/tmp/smoke-v128-data';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

const rev = await import('../server/ai/reversalEngine.js');
rev.__resetReversalForTests();

// ---- S1: config ----
console.log('\n[S1] loadReversalConfig — v12.9 NO-CAPS + defaults');
const dflt = rev.loadReversalConfig({});
ok('default OFF (opt-in)', dflt.enabled === false);
ok('default ₹ loss-cap 150', dflt.lossCapINR === 150, `₹${dflt.lossCapINR}`);
ok('default ₹ target 500', dflt.profitTargetINR === 500, `₹${dflt.profitTargetINR}`);
ok('default 3 legs / 3m cooldown / 45m window', dflt.maxLegs === 3 && dflt.cooldownMin === 3 && dflt.reentryWindowMin === 45);
// v12.9 USER SPEC: NO CAPS — user values pass VERBATIM
const custom = rev.loadReversalConfig({ reversalEnabled: true, reversalLossCapINR: 999999, reversalProfitTargetINR: 50, reversalMaxLegs: 99, reversalCooldownMin: 0.25, reversalReentryWindowMin: 600 });
ok('NO CAPS: user values verbatim (loss-cap 999999 · legs 99 · cooldown 0.25m · window 600m)',
  custom.lossCapINR === 999999 && custom.profitTargetINR === 50 && custom.maxLegs === 99 && custom.cooldownMin === 0.25 && custom.reentryWindowMin === 600,
  `cap ₹${custom.lossCapINR} · target ₹${custom.profitTargetINR} · legs ${custom.maxLegs}`);

// ---- S2: pure leg math ----
console.log('\n[S2] pure leg math — ₹ P&L / triggers / price levels');
// XRP: entry 0.50, qty 2000 USDT notional... qty 1000 @ 0.50 = 500 USDT notional
// price → 0.485: LONG pnl = (0.485-0.5)*1000 = -15 USDT → ×84 = -₹1260 (way past cap)
const legPnl = rev.reversalLegPnlINR({ p: { side: 'LONG', entryPrice: 0.5, qty: 1000 }, price: 0.485, usdInr: 84 });
ok('LONG ₹ P&L math', legPnl != null && Math.abs(legPnl + 1260) < 1, `₹${legPnl}`);
const shortPnl = rev.reversalLegPnlINR({ p: { side: 'SHORT', entryPrice: 0.5, qty: 1000 }, price: 0.485, usdInr: 84 });
ok('SHORT ₹ P&L math (mirror)', shortPnl != null && Math.abs(shortPnl - 1260) < 1, `₹${shortPnl}`);
const trigHit = rev.reversalTriggerOf({ pnlINR: -160, cfg: dflt });
const trigTgt = rev.reversalTriggerOf({ pnlINR: 512, cfg: dflt });
ok('trigger LOSS_CAP at −₹160', trigHit === 'LOSS_CAP');
ok('trigger PROFIT_TARGET at +₹512', trigTgt === 'PROFIT_TARGET');
const lv = rev.priceLevelsForLeg({ side: 'LONG', entry: 0.5, qty: 1000, lossCapINR: 150, profitTargetINR: 500, usdInr: 84 });
ok('price levels stamped (SL/TP from ₹)', lv.sl != null && lv.tp != null && lv.sl < 0.5 && lv.tp > 0.5,
  `SL ${lv.sl} / TP ${lv.tp}`);
const lvDist = (lv.tp - 0.5) * 1000 * 84;
ok('TP distance ≈ ₹500', Math.abs(lvDist - 500) < 5, `₹${Math.round(lvDist)}`);

// ---- S3: decision brain ----
console.log('\n[S3] reversalDecision — the cut is unconditional, the flip is guarded');
const p1 = { side: 'LONG', entryPrice: 0.5, qty: 1000, status: 'OPEN', source: 'signal', reversal: { cycleId: 'c1', leg: 1, rootId: 'r1' }, openedAt: Date.now() - 10 * 60_000 };
const cyc1 = { legCount: 1, netINR: 0, lastLegOpenedAt: Date.now() - 10 * 60_000 };
// realistic ₹-scale prices: qty 1000 @ 84 fx → ₹150 ≈ 0.00179 dist, ₹500 ≈ 0.00595
const cut = rev.reversalDecision({ p: p1, price: 0.498, usdInr: 84, cfg: { ...dflt, enabled: true }, cycle: cyc1, ensemble: null });
ok('loss-cap → CLOSE_LOSS_CAP + SHORT flip', cut.action === 'CLOSE_LOSS_CAP' && cut.flipSide === 'SHORT');
const vetoed = rev.reversalDecision({ p: p1, price: 0.498, usdInr: 84, cfg: { ...dflt, enabled: true }, cycle: cyc1, ensemble: { side: 'LONG', confidence: 75 } });
ok('ensemble still LONG-strong → flip VETOED (cut still fires)', vetoed.action === 'CLOSE_LOSS_CAP' && vetoed.flipSide === null && vetoed.blocked === 'ensemble-still-original');
const churn = rev.reversalDecision({ p: p1, price: 0.498, usdInr: 84, cfg: { ...dflt, enabled: true }, cycle: { legCount: 3, netINR: 0, lastLegOpenedAt: Date.now() - 10 * 60_000 }, ensemble: null });
ok('maxLegs guard → flip vetoed', churn.blocked === 'maxLegs');
const tgt = rev.reversalDecision({ p: { ...p1, side: 'SHORT' }, price: 0.4, usdInr: 84, cfg: { ...dflt, enabled: true }, cycle: cyc1, ensemble: null });
ok('target → CLOSE_TARGET (no flip)', tgt.action === 'CLOSE_TARGET' && tgt.flipSide === null);

// ---- S4: the FULL XRP cycle (journal-mutating, deps injected) ----
console.log('\n[S4] the XRP ₹-cycle end-to-end — evaluateReversalForPosition + processReversalWaiting');
rev.__resetReversalForTests();
const cfg = { ...dflt, enabled: true }; // ₹150 cap / ₹500 target / 3 legs / 3m cooldown
// ALSO persist via the agent-config bridge (the real PUT /config path) —
// proves updateAgentConfig → ai-agent-config.json → loadReversalConfig(force)
const { updateAgentConfig, loadAgentConfig } = await import('../server/ai/agent.js');
updateAgentConfig({ reversalEnabled: true, reversalLossCapINR: 150, reversalProfitTargetINR: 500 });
const persisted = rev.loadReversalConfig(null, { force: true });
ok('agent-config bridge: updateAgentConfig → loadReversalConfig(force)', persisted.enabled === true && persisted.lossCapINR === 150 && persisted.profitTargetINR === 500);
const deps = {
  exitFuturesPosition: async () => ({ ok: true }),
  createFuturesOrder: async () => ({ ok: true, orderId: 'sim-1' }),
  createFuturesTpsl: async () => ({ ok: true }),
  roundFuturesQty: (pair, q) => Math.round(q),
  coindcxConnected: () => false, // paper leg
};
const j = { positions: [], entries: [] };
const root = {
  id: 'root-xrp', pair: 'B-XRP_USDT', symbol: 'XRP', market: 'FUTURES', side: 'LONG', mode: 'paper', source: 'signal',
  qty: 1000, entryPrice: 0.5, notionalUSDT: 500, leverage: 5, openedAt: Date.now() - 20 * 60_000, status: 'OPEN',
};
j.positions.push(root);
const noEnsemble = { getDeepSignal: null, deps, sendTelegram: null };

// LEG-1: price 0.498 → −₹168 just past cap ₹150 (netAfter > cycle-stop) → CUT + FLIP SHORT
const r1 = await rev.evaluateReversalForPosition(j, root, 0.498, { cfg, usdInr: 84, ...noEnsemble });
ok('LEG-1 cut + SHORT flip opened', r1.closed != null && r1.opened?.side === 'SHORT',
  `${r1.closed?.reason} → leg-2 ${r1.opened?.side} qty ${r1.opened?.qty}`);
const leg2 = j.positions.find(p => p.reversal?.leg === 2);
ok('LEG-2 journal-stamped (cycle + ₹ levels)', leg2?.reversal?.cycleId === root.reversal?.cycleId && leg2?.sl > 0.498 && leg2?.tp < 0.498,
  `SL ${leg2?.sl} / TP ${leg2?.tp} (SHORT-side levels)`);
ok('same cycleId across legs', root.reversal.cycleId != null && leg2.reversal.cycleId === root.reversal.cycleId);

// LEG-2: SHORT @ 0.498 → price 0.492 → +₹504 ≥ ₹500 → BOOKED (no instant flip)
const r2 = await rev.evaluateReversalForPosition(j, leg2, 0.492, { cfg, usdInr: 84, ...noEnsemble });
ok('LEG-2 +₹630 BOOKED (target)', r2.closed != null && r2.opened == null && /BOOKED/.test(String(r2.closed?.reason)));
ok('waiting window staged post-target', rev.__waitingStateForTests().get('B-XRP_USDT')?.closedSide === 'SHORT');

// WAITING: ensemble confirms LONG → LEG-3 re-entry
const wmap = rev.__waitingStateForTests();
const w = wmap.get('B-XRP_USDT');
w.lastCloseAt = Date.now() - 5 * 60_000; // cooldown served
const getDeep = async () => ({ ok: true, signal: { side: 'LONG', confidence: 78 } });
const r3 = await rev.processReversalWaiting(j, new Map([['B-XRP_USDT', 0.492]]), { cfg, getDeepSignal: getDeep, deps, sendTelegram: null });
ok('LEG-3 LONG re-entry on confirmed reversal', r3.dirty === true);
const leg3 = j.positions.find(p => p.reversal?.leg === 3);
ok('LEG-3 journal present (LONG)', leg3?.side === 'LONG' && leg3?.status === 'OPEN', `@${leg3?.entryPrice} SL ${leg3?.sl} / TP ${leg3?.tp}`);

// cycle math: net = leg1 (−₹168) + leg2 (+₹504) = +₹336, leg3 live
const summary = rev.cycleSummary(j, root.reversal.cycleId);
ok('cycle summary: 3 legs, net +₹336, live leg open', summary.legCount === 3 && Math.abs(summary.netINR - 336) < 2 && summary.openLeg != null,
  `net ₹${summary.netINR} · state ${summary.state}`);

// ---- S5: board view ----
console.log('\n[S5] reversalCyclesView — the UI payload');
const view = rev.reversalCyclesView(j, { usdInr: 84, byPair: new Map([['B-XRP_USDT', 0.5]]) });
ok('view ok + config echo', view.ok === true && view.config.enabled === true && Array.isArray(view.cycles));
ok('one cycle, ACTIVE, live leg P&L attached', view.cycles.length === 1 && view.cycles[0].state === 'ACTIVE' && view.cycles[0].live?.pnlINR != null,
  `live ₹${Math.round(view.cycles[0].live.pnlINR)}`);

// ---- S6: routes registration ----
console.log('\n[S6] routes + watcher wiring — module-level');
const routesMod = await import('../server/ai/routes.js');
ok('registerAITradingRoutes exported', typeof routesMod.registerAITradingRoutes === 'function');
const futMod = await import('../server/ai/futures.js');
ok('watchFuturesPositions accepts getDeepSignal', /getDeepSignal/.test(String(futMod.watchFuturesPositions).slice(0, 400)));
const src = await import('node:fs').then(m => m.promises.readFile('server/ai/routes.js', 'utf8'));
ok("GET /api/ai/reversal mounted", src.includes("app.get('/api/ai/reversal'"));
ok("PUT /api/ai/reversal/config mounted", src.includes("app.put('/api/ai/reversal/config'"));
ok('watcher injects getDeepSignal (ensemble gate)', src.includes('getDeepSignal: (sym) => getDeepSignal(sym'));

// ---- S7: v12.9 MANUAL-TRADE ENGINE CONNECTION ----
console.log('\n[S7] manual trades — Reversal ENGINE connection (activation + cycles)');
const mt = await import('../server/ai/manualTrades.js');
mt.__resetManualStoreForTests();
const cfgM = { ...rev.loadReversalConfig({ reversalEnabled: true }), enabled: true };
const xrpTrade = { market: 'FUTURES', symbol: 'XRP', side: 'BUY', entryPrice: 0.5, qty: 1000, status: 'OPEN', id: 77 };
const act = mt.activateReversalOnManualTrade(xrpTrade, 0.498, { usdInr: 84, cfg: cfgM });
ok('manual trade LOSS_CAP → cycle ACTIVATED + FLIP plan stamped',
  act?.to === 'LOSS_CAP' && xrpTrade.reversal.flip.side === 'SHORT' && xrpTrade.reversal.flip.sl > 0.498 && xrpTrade.reversal.flip.tp < 0.498,
  `flip SHORT qty ${xrpTrade.reversal.flip.qty} · SL ${xrpTrade.reversal.flip.sl} / TP ${xrpTrade.reversal.flip.tp}`);
const txt = mt.reversalActivationText(act, { usdInr: 84 });
ok('activation text: native $ P&L (no INR price amount) + ₹ cap + levels',
  txt.includes('−$2') && txt.includes('cap ₹150') && !txt.includes('−₹168') && txt.includes('FLIP <b>SHORT</b>'));
const book = { market: 'FUTURES', symbol: 'XRP', side: 'SELL', entryPrice: 0.5, qty: 1000, status: 'OPEN', id: 78 };
const actB = mt.activateReversalOnManualTrade(book, 0.492, { usdInr: 84, cfg: cfgM });
ok('manual trade ₹ TARGET → PROFIT_TARGET (BOOK call)', actB?.to === 'PROFIT_TARGET' && book.reversal.state === 'PROFIT_TARGET');
const cycles = mt.manualReversalCycles([xrpTrade, book], { usdInr: 84 });
ok('manualReversalCycles board view: 2 ACTIVE cycles with legs + plan',
  cycles.length === 2 && cycles.every(c => c.state === 'ACTIVE' && c.mode === 'manual' && c.legCount === 1) && cycles[0].plan != null);

console.log(`\n===== SMOKE v12.8: ${pass} pass / ${fail} fail =====`);
process.exit(fail > 0 ? 1 : 0);
