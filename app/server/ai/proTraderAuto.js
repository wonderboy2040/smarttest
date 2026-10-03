// ============================================================
//  SUPERINTELLIGENCE ADVANCE AI PRO TRADER AUTO (SAPTA)
//  v18.6 — auto-trade engine driven by the USER's open browser.
//
//  USER SPEC (exact):
//   * Auto trades ONLY when: AI score >= 75, confidence >= 65,
//     verified score >= 90 (SVA CONFIRM, finalCall matches side)
//     — LONG or SHORT both allowed.
//   * Executes INSIDE the user's already-open logged-in browser
//     tabs (CoinDCX + Dhan) via the CDP browserAgent:
//     search symbol -> set entry price -> apply leverage ->
//     place trade -> monitor from backend.
//   * Continuous data analysis for REVERSAL; close the trade
//     ONLY when reversal is CONFIRMED SURE (2 consecutive
//     confirmations; SL closes immediately).
//
//  Safety:
//   * OFF by default. Paper mode default. LIVE requires typed
//     phrase "LIVE". Global kill-switch (ai-trading-config.json)
//     always respected. Nothing auto-deletes; every action
//     journaled + screenshot on every browser order.
//   * Pure gate/reversal functions are exported for tests.
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { loadJSON, saveJSON, DATA_DIR } from '../lib/store.js';
import {
  browserConnect, browserStatus, cxPairUrl,
  cxEnsureTradePage, cxSelectPair, cxPlaceOrder, cxClosePosition, cxReadPositions,
  dhanEnsurePage, dhanSelectScrip, dhanPlaceOrder, dhanClosePosition,
} from './browserAgent.js';
import { getTick } from '../liveFeed.js';
import { fetchCoinDcxTickers } from '../cryptoStream.js';
// v18.9: shared NSE holiday calendar (pure module — no cycle)
import { isNseHoliday } from '../intraday/time.js';

export const PROTRADER_TICK_SEC = 30;
const CFG_FILE = 'protrader-auto-config.json';
const JOURNAL_FILE = 'protrader-auto-journal.json';
const TRADING_CFG_FILE = 'ai-trading-config.json';
const LOG_MAX = 300;
const REVERSAL_CONFIRM_NEEDED = 2; // "confirm sure hoke close" — consecutive ticks

export const PROTRADER_DEFAULTS = {
  enabled: false,
  mode: 'paper',                 // 'paper' | 'live'
  // ---- USER SPEC GATES ----
  minAiScore: 75,
  minConfidence: 65,
  minVerifiedScore: 90,
  requireVerifyConfirm: true,    // SVA action must be CONFIRM + finalCall === side
  // ---- desks ----
  desks: { crypto: true, india: true },
  // v19.0 USER SPEC: "Coindcx tab me auto trading sirf Global Futures
  // USDT & Equity SIM USDC me — Spot me nahi". SAPTA's crypto desk
  // therefore trades the CoinDCX FUTURES board (B-{SYM}_USDT,
  // USDT-margined) by default. 'spot' restores the legacy v18.6
  // {SYM}INR spot flow (explicit user opt-in via config).
  cryptoProduct: 'futures',          // 'futures' (default) | 'spot' (legacy)
  // ---- sizing ----
  stakeINR: 500,                 // per trade (crypto total / india order value)
  cryptoLeverage: 3,
  indiaProduct: 'MTF',           // 'MTF' | 'INTRADAY' | 'DELIVERY' (leverage = MTF)
  // ---- caps ----
  maxConcurrent: 3,
  maxTradesPerDay: 6,
  cooldownMin: 30,               // per symbol
  // ---- reversal exit ----
  minReversalConf: 65,           // ensemble deep side flipped + conf >= this
  minMtfAgreePct: 62,            // MTF-6 consensus flipped + agreement >= this
  slImmediate: true,             // plan SL hit -> close now (no double-confirm)
  // ---- misc ----
  monitorEveryTicks: 1,
};

const CLAMPS = {
  minAiScore: [50, 95], minConfidence: [50, 95], minVerifiedScore: [50, 100],
  stakeINR: [100, 100000], cryptoLeverage: [1, 10], maxConcurrent: [1, 10],
  maxTradesPerDay: [1, 50], cooldownMin: [5, 720], minReversalConf: [50, 95],
  minMtfAgreePct: [50, 95],
};

// ---------------- config / journal ----------------
export function loadProTraderConfig() {
  const saved = loadJSON(CFG_FILE, {}) || {};
  const cfg = { ...PROTRADER_DEFAULTS, ...(saved.config || saved) };
  if (saved && !saved.config) saveProTraderConfig(cfg);
  for (const [k, [lo, hi]] of Object.entries(CLAMPS)) {
    if (Number.isFinite(Number(cfg[k]))) cfg[k] = Math.min(hi, Math.max(lo, Number(cfg[k])));
  }
  if (!['paper', 'live'].includes(cfg.mode)) cfg.mode = 'paper';
  if (!['MTF', 'INTRADAY', 'DELIVERY', 'MARKET'].includes(cfg.indiaProduct)) cfg.indiaProduct = 'MTF';
  // v19.0 migration (USER SPEC, spot-off): a saved config without
  // cryptoProduct rises to the new default 'futures' — ONCE (stamp).
  // A user who deliberately sets 'spot' afterwards keeps it.
  if (!cfg.__migrations?.v19_0 || cfg.cryptoProduct == null) {
    if (cfg.cryptoProduct == null) cfg.cryptoProduct = 'futures';
    cfg.__migrations = { ...(cfg.__migrations || {}), v19_0: true };
  }
  if (cfg.cryptoProduct !== 'spot') cfg.cryptoProduct = 'futures';
  cfg.enabled = Boolean(cfg.enabled);
  cfg.desks = { ...PROTRADER_DEFAULTS.desks, ...(cfg.desks || {}) };
  return cfg;
}

export function saveProTraderConfig(cfg) {
  saveJSON(CFG_FILE, { config: cfg, savedAt: Date.now() });
}

export function updateProTraderConfig(patch = {}) {
  const cfg = loadProTraderConfig();
  const next = { ...cfg };
  for (const [k, v] of Object.entries(patch || {})) {
    if (!(k in PROTRADER_DEFAULTS) && k !== 'enabled' && k !== 'mode') continue;
    if (k === 'mode') continue; // start/stop own mode; typed LIVE phrase required
    if (k === 'enabled') continue; // start/stop own enabled
    if (typeof PROTRADER_DEFAULTS[k] === 'boolean') next[k] = Boolean(v);
    else if (typeof PROTRADER_DEFAULTS[k] === 'number') { const n = Number(v); if (Number.isFinite(n)) next[k] = n; }
    else if (k === 'desks' || k === 'indiaProduct') next[k] = v;
    else if (k === 'cryptoProduct' && (v === 'futures' || v === 'spot')) next[k] = v; // v19.0 — explicit values only
  }
  for (const [k, [lo, hi]] of Object.entries(CLAMPS)) {
    if (Number.isFinite(Number(next[k]))) next[k] = Math.min(hi, Math.max(lo, Number(next[k])));
  }
  saveProTraderConfig(next);
  return next;
}

let _jCache = null;
let _jMtime = -1;
function _journal() {
  // v20.7.4 FIX: pehle har _trades() call readFileSync + JSON.parse
  // kar raha tha (ek tick me 4-6 baar — 400-trade journal MB-scale
  // ho sakta hai) — event-loop freeze ka contributor. Ab mtime-checked
  // cache: statSync (microseconds) se file badli ya nahi verify hota,
  // sirf badle par re-read hota hai (external writes — tests / dusra
  // process — turant dikhte hain, TTL race nahi).
  const p = path.join(DATA_DIR, JOURNAL_FILE);
  try {
    const m = fs.statSync(p).mtimeMs;
    if (_jCache && m === _jMtime) return _jCache;
    _jCache = loadJSON(JOURNAL_FILE, { trades: [] }) || { trades: [] };
    _jMtime = m;
  } catch {
    // file abhi nahi bani — fallback load (JSON.parse + merge) ek hi baar
    if (!_jCache) _jCache = loadJSON(JOURNAL_FILE, { trades: [] }) || { trades: [] };
    _jMtime = -1;
  }
  return _jCache;
}
function _saveJournal(j) {
  _jCache = j;
  saveJSON(JOURNAL_FILE, j);
  try { _jMtime = fs.statSync(path.join(DATA_DIR, JOURNAL_FILE)).mtimeMs; } catch { _jMtime = -1; }
}
function _trades() { return _journal().trades || []; }

// ---------------- IST clock ----------------
export function istNow() {
  const now = new Date();
  return new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 60_000);
}
export function indiaMarketOpen(nowIst = istNow()) {
  const m = nowIst.getHours() * 60 + nowIst.getMinutes();
  if (nowIst.getDay() !== 0 && nowIst.getDay() !== 6 && m >= 9 * 60 + 30 && m <= 15 * 60) {
    // v18.9: weekday NSE holidays (Republic Day / Diwali / …) — the browser
    // agent used to try trading a closed market and burn attempts on
    // broker rejects. Shares the intraday/time.js calendar.
    try { return !isNseHoliday(nowIst); } catch { return true; } // fail-open (old behavior)
  }
  return false;
}
function indiaSquareOffDue(nowIst = istNow()) {
  return nowIst.getDay() >= 1 && nowIst.getDay() <= 5 && (nowIst.getHours() * 60 + nowIst.getMinutes()) >= 15 * 60 + 15;
}

// ---------------- PURE: the USER-SPEC gate ----------------
export function proTraderGate(sig, cfg = PROTRADER_DEFAULTS) {
  const reasons = [];
  if (!sig) { reasons.push('no-signal'); return { pass: false, reasons }; }
  const ai = Number(sig?.superIntel?.aiScore ?? 0);
  const conf = Number(sig?.confidence ?? 0);
  const verify = sig?.verify || {};
  const vScore = Number(verify.score ?? 0);
  const side = sig?.side;

  if (!['LONG', 'SHORT'].includes(side)) reasons.push('side:' + (side || 'FLAT'));
  if (sig?.grade !== 'STRONG') reasons.push('grade:' + (sig?.grade || 'NONE'));
  if (!sig?.plan?.entry) reasons.push('no-plan-entry');
  if (ai < cfg.minAiScore) reasons.push(`aiScore:${ai}<${cfg.minAiScore}`);
  if (conf < cfg.minConfidence) reasons.push(`conf:${conf}<${cfg.minConfidence}`);
  if (vScore < cfg.minVerifiedScore) reasons.push(`verified:${vScore}<${cfg.minVerifiedScore}`);
  if (cfg.requireVerifyConfirm) {
    if (verify.action !== 'CONFIRM') reasons.push('verify:' + (verify.action || 'NONE'));
    if (verify.finalCall !== side) reasons.push(`finalCall:${verify.finalCall || '?'}!=${side}`);
  }
  // v18.6.4: `executable` sirf CRYPTO/FUTURES/GLOBALFUTURES seats set hota
  // hai (ensemble.js) — INDIA STRONG signals pe ye hamesha false tha, is
  // liye India desk kabhi trade hi nahi kar pata tha. INDIA ke liye gate
  // grade STRONG + plan + side (upar enforce) par chalta hai.
  if (sig?.executable === false && String(sig?.market || '').toUpperCase() !== 'INDIA') reasons.push('not-executable');
  return { pass: reasons.length === 0, reasons, score: { ai, conf, verified: vScore } };
}

// ---------------- PURE: candidate selection ----------------
export function pickProTraderCandidate(signals, cfg, { existingSymbols = [], cooldowns = {}, now = Date.now() } = {}) {
  const evaluated = [];
  for (const s of signals || []) {
    const g = proTraderGate(s, cfg);
    evaluated.push({ symbol: s?.symbol, side: s?.side, ai: g.score?.ai, conf: g.score?.conf, verified: g.score?.verified, pass: g.pass, reasons: g.reasons });
    if (!g.pass) continue;
    if ((existingSymbols || []).includes(s.symbol)) { evaluated[evaluated.length - 1].skip = 'already-open'; continue; }
    const until = cooldowns[s.symbol] || 0;
    if (now < until) { evaluated[evaluated.length - 1].skip = 'cooldown'; continue; }
  }
  const ok = (signals || []).filter((s) => evaluated.find((e) => e.symbol === s.symbol && e.pass && !e.skip));
  ok.sort((a, b) => (Number(b?.superIntel?.aiScore) || 0) - (Number(a?.superIntel?.aiScore) || 0));
  return { best: ok[0] || null, evaluated: evaluated.slice(0, 8) };
}

// ---------------- PURE: reversal decision ----------------
// Inputs per tick; streak tracked by caller on the trade record.
export function proTraderReversalCheck({ trade, ltp, deepSide, deepConf, mtfConsensus, mtfAgreePct, cfg = PROTRADER_DEFAULTS }) {
  const reasons = [];
  const side = trade.side;
  const entry = Number(trade.entryPrice);
  const sl = Number(trade.sl || trade.signal?.sl || 0);
  const p = Number(ltp);
  if (!Number.isFinite(p) || p <= 0) return { hit: false, reasons: ['no-ltp'], wantClose: false };

  // 1) SL breach — the SURE case, closes immediately.
  if (cfg.slImmediate && sl > 0) {
    if (side === 'LONG' && p <= sl) reasons.push(`SL-hit:${p}<=${sl}`);
    if (side === 'SHORT' && p >= sl) reasons.push(`SL-hit:${p}>=${sl}`);
  }
  // 2) Ensemble deep flip.
  if (deepSide && deepSide !== side && side !== 'FLAT' && Number(deepConf) >= cfg.minReversalConf) {
    reasons.push(`ensemble-flip:${deepSide}@${deepConf}`);
  }
  // 3) MTF-6 consensus flip with strong agreement.
  if (mtfConsensus === 'BULLISH' && side === 'SHORT') reasons.push(`mtf-flip:BULLISH@${mtfAgreePct ?? 0}%`);
  if (mtfConsensus === 'BEARISH' && side === 'LONG') reasons.push(`mtf-flip:BEARISH@${mtfAgreePct ?? 0}%`);
  const mtfFlip = reasons.some((r) => r.startsWith('mtf-flip:'));
  if (mtfFlip && Number(mtfAgreePct || 0) < cfg.minMtfAgreePct) {
    // weak agreement — not "sure", drop it
    const idx = reasons.findIndex((r) => r.startsWith('mtf-flip:'));
    if (idx >= 0) reasons.splice(idx, 1);
  }
  const slHit = reasons.some((r) => r.startsWith('SL-hit:'));
  const hard = reasons.length > 0 && (slHit || reasons.length >= 2); // SL alone OR 2+ independent signals
  return { hit: reasons.length > 0, reasons, wantClose: hard, immediate: slHit };
}

// ---------------- engine state ----------------
const _s = {
  running: false,
  startedAt: null,
  mode: 'paper',
  lastTickAt: 0,
  lastBrowserCheckAt: 0,
  lastScan: null,          // { at, candidates: evaluated[], bestSymbol }
  log: [],
  busyPlacing: false,
  _ticking: false,        // v18.6.4 re-entrancy guard — overlapped ticks double-click the browser
  _overlapLogAt: 0,       // v20.7.4 — overlap skip-log throttle (5 min)
  _noBrowserLogAt: 0,
  _lastStatusBroadcast: 0,
};

function _log(level, text) {
  const line = { ts: Date.now(), level, text: String(text).slice(0, 300) };
  _s.log.push(line);
  if (_s.log.length > LOG_MAX) _s.log.splice(0, _s.log.length - LOG_MAX);
  _broadcast('log', line);
}

// ---------------- SSE stream (positionsStream pattern) ----------------
const _clients = new Set();
function _broadcast(event, data) {
  if (_clients.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of _clients) {
    try { c.res.write(payload); } catch { try { c.res.destroy(); } catch {} }
  }
}
let _keepAlive = null;
export function proTraderStreamHandler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store, no-transform',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
  });
  res.write('retry: 3000\n\n');
  const client = { req, res };
  _clients.add(client);
  res.write(`event: status\ndata: ${JSON.stringify(proTraderStatusView())}\n\n`);
  if (!_keepAlive) {
    _keepAlive = setInterval(() => {
      for (const c of _clients) { try { c.res.write(`event: ping\ndata: {}\n\n`); } catch {} }
    }, 15_000);
    if (_keepAlive.unref) _keepAlive.unref();
  }
  req.on('close', () => _clients.delete(client));
}
function _broadcastStatusThrottled() {
  if (Date.now() - _s._lastStatusBroadcast < 3000) return;
  _s._lastStatusBroadcast = Date.now();
  _broadcast('status', proTraderStatusView());
}

// ---------------- lifecycle ----------------
export function proTraderStart({ mode, liveConfirmPhrase } = {}) {
  const cfg = loadProTraderConfig();
  if (mode !== 'live' && mode !== 'paper') return { ok: false, error: 'mode must be paper or live' };
  if (mode === 'live') {
    if (liveConfirmPhrase !== 'LIVE') return { ok: false, error: 'LIVE mode ke liye liveConfirmPhrase "LIVE" chahiye' };
    const tcfg = loadJSON(TRADING_CFG_FILE, {}) || {};
    if (tcfg.killSwitch) return { ok: false, error: 'global kill-switch ON hai — pehle usse hatao' };
  }
  cfg.enabled = true;
  cfg.mode = mode;
  saveProTraderConfig(cfg);
  _s.running = true; _s.startedAt = Date.now(); _s.mode = mode;
  _log('entry', `PRO TRADER AUTO START (${mode.toUpperCase()}) — gates: AI>=${cfg.minAiScore} conf>=${cfg.minConfidence} verified>=${cfg.minVerifiedScore}`);
  _broadcast('status', proTraderStatusView());
  return { ok: true, mode };
}

export function proTraderStop() {
  const cfg = loadProTraderConfig();
  cfg.enabled = false; saveProTraderConfig(cfg);
  _s.running = false;
  _log('exit', 'PRO TRADER AUTO STOP — open positions monitoring band (manual close karo)');
  _broadcast('status', proTraderStatusView());
  return { ok: true };
}

// ---------------- browser health ----------------
async function _refreshBrowser(force = false) {
  if (!force && Date.now() - _s.lastBrowserCheckAt < 60_000) return browserStatus();
  _s.lastBrowserCheckAt = Date.now();
  try { await browserConnect({}); } catch { /* status records error */ }
  return browserStatus();
}

// ---------------- execution ----------------
/** v19.0: the trade pair. FUTURES → B-{SYM}_USDT (CoinDCX USDT-margined
 * perps — the user-spec auto-trading scope). CRYPTO (legacy spot) →
 * {SYM}INR. INDIA → scrip as-is. */
function _pairOf(symbol, market) {
  if (market === 'INDIA') return String(symbol);
  if (market === 'FUTURES') return `B-${String(symbol).toUpperCase()}_USDT`;
  return `${String(symbol).toUpperCase()}INR`;
}

/** v19.0: USDT-INR fx for futures sizing/P&L (USDTINR spot ticker,
 * honest fallback 84 when the feed is down — stamped on the trade so
 * the close math uses the SAME rate, never a mix). */
async function _usdInr() {
  try {
    const t = await fetchCoinDcxTickers();
    const usdt = (Array.isArray(t) ? t : []).find((x) => String(x?.symbol || x?.pair || '').toUpperCase().replace(/[^A-Z]/g, '') === 'USDTINR');
    const px = Number(usdt?.last_price ?? usdt?.p ?? usdt?.price);
    if (Number.isFinite(px) && px > 50 && px < 200) return Math.round(px * 100) / 100;
  } catch { /* feed down → fallback */ }
  return 84;
}

async function _placeBrowserCrypto(sig, cfg, fxPre = null) {
  const pair = _pairOf(sig.symbol, sig.market);
  const isFut = sig.market === 'FUTURES';
  // v19.0: futures desk → the B-{SYM}_USDT trade page (USDT-margined —
  // margin is NATIVE on the futures page, so the spot 'margin trade'
  // tab toggle is skipped). Prices are USDT → stake converts ₹→USDT.
  // fxPre: the SAME rate _tryEntry stamped on the journal row (one fetch,
  // one truth — pass null to fetch fresh on standalone calls).
  // v20.7.4 FIX: futures URL ab OFFICIAL futures desk hai —
  // https://coindcx.com/futures/B-{SYM}_USDT (user-verified live).
  // Purana /trade/{pair} spot URL galag page kholta tha jahan futures
  // search box milta hi nahi tha ("select-pair: search box nahi mila").
  const fx = isFut ? (Number(fxPre) > 50 ? Number(fxPre) : await _usdInr()) : 1;
  const total = isFut ? Math.round((Number(cfg.stakeINR) / fx) * 1e6) / 1e6 : Number(cfg.stakeINR);
  const page = await cxEnsureTradePage(cxPairUrl(pair, isFut ? 'futures' : 'spot'));
  const pick = await cxSelectPair(page, pair);
  if (!pick?.ok) return { ok: false, stage: 'select-pair', detail: pick };
  const useMargin = !isFut && Number(cfg.cryptoLeverage) > 1; // futures page: leverage native, no margin-tab toggle
  const order = await cxPlaceOrder(page, {
    side: sig.side, price: sig.plan.entry, totalINR: total, leverage: cfg.cryptoLeverage, useMargin,
    // v20.7.7: direct qty belt-and-suspenders — market-fallback fire hone
    // par in-page total/price math ke saath-saath exact qty bhi available
    // rehta hai (form default-qty ka koi chance hi nahi).
    qty: total / Math.max(1e-8, Number(sig.plan.entry) || 1),
  });
  return { ok: order?.ok, stage: 'place-order', detail: order, steps: [pick, order], fx, total, product: isFut ? 'futures' : 'spot' };
}

async function _placeBrowserIndia(sig, cfg) {
  const page = await dhanEnsurePage();
  const pick = await dhanSelectScrip(page, sig.symbol);
  if (!pick?.ok) return { ok: false, stage: 'select-scrip', detail: pick };
  const entry = Math.max(0.05, Number(sig.plan.entry) || 1);
  // v18.6.4 qty affordability: Math.max(1, floor(stake/entry)) ek ₹500
  // stake ko ₹4000 scrip par 8x oversized order bana deta tha. Stake ek
  // pura share nahi khareed sakta → honest skip (small-cap filter).
  const qty = Math.floor(Number(cfg.stakeINR) / entry);
  if (qty < 1) {
    return { ok: false, stage: 'qty', detail: { error: `stake ₹${cfg.stakeINR} me ${sig.symbol} @ ₹${entry} ka 1 share nahi aata — entry skip (sizing protect)` } };
  }
  const order = await dhanPlaceOrder(page, {
    side: sig.side, price: sig.plan.entry, quantity: qty, product: cfg.indiaProduct,
  });
  return { ok: order?.ok, stage: 'place-order', detail: order, steps: [pick, order], qty };
}

function _todayIST() { const d = istNow(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }

async function _tryEntry(deps, cfg, sig) {
  if (_s.busyPlacing) return { ok: false, error: 'busy' };
  _s.busyPlacing = true;
  try {
    const g = proTraderGate(sig, cfg);
    // v19.0: FUTURES is a first-class market here (B-{SYM}_USDT pair,
    // USDT prices, fx-converted sizing) — only INDIA routes to Dhan.
    const market = sig.market === 'INDIA' ? 'INDIA' : (sig.market === 'FUTURES' ? 'FUTURES' : 'CRYPTO');
    // v19.0: fx fetched ONCE here (the record and the browser order
    // share the SAME rate — never a mix of two fetches).
    const fxPre = market === 'FUTURES' ? await _usdInr() : null;
    if (market === 'INDIA' && !indiaMarketOpen()) return { ok: false, error: 'NSE band hai (9:30-15:00 IST entry window)' };
    // v18.6.4 sizing protect (BOTH modes): stake ek pura share nahi
    // khareedta → skip (paper me bhi 8x oversize lie journal hota tha).
    if (market === 'INDIA' && Math.floor(Number(cfg.stakeINR) / Math.max(0.05, Number(sig.plan.entry) || 1)) < 1) {
      return { ok: false, error: `sizing skip: stake ₹${cfg.stakeINR} me ${sig.symbol} @ ${sig.plan.entry} ka 1 share nahi aata` };
    }
    const browser = browserStatus();
    if (cfg.mode === 'live' && !browser.tabs?.[market === 'INDIA' ? 'dhan' : 'coindcx']?.found) {
      if (Date.now() - _s._noBrowserLogAt > 10 * 60_000) {
        _s._noBrowserLogAt = Date.now();
        _log('error', `BROWSER TAB missing (${market}) — Start-AutoBrowser.bat chalao aur ${market === 'INDIA' ? 'dhan.co' : 'coindcx.com'} login karke tab khula rakho`);
      }
      return { ok: false, error: 'browser tab not available' };
    }

    const trade = {
      id: `PTA-${Date.now().toString(36).toUpperCase()}`,
      ts: Date.now(), day: _todayIST(),
      market, symbol: sig.symbol, pair: _pairOf(sig.symbol, market), side: sig.side,
      entryPrice: Number(sig.plan.entry), sl: Number(sig.plan.stopLoss || 0),
      tp: Number(sig.plan.target1 || 0), tp2: Number(sig.plan.target2 || 0),
      stakeINR: Number(cfg.stakeINR), leverage: market === 'INDIA' ? (cfg.indiaProduct === 'MTF' ? 'MTF' : 1) : Number(cfg.cryptoLeverage),
      // v19.0: futures prices are USDT — stamp the entry fx so qty math
      // and the CLOSE P&L use the SAME rate (never a mix of two days').
      fxAtEntry: market === 'FUTURES' ? (Number(fxPre) || 84) : null,
      // v18.6.4 P&L-basis: the browser order actually enters qty =
      // stake/entry (crypto amount field) ya floor(stake/entry) (India) —
      // the position NOTIONAL is ≈ stake. Journal P&L = qty × Δprice
      // (no ×leverage guess); ROE (margin lens) = move% × leverage.
      // v19.0 FUTURES: stake converts to USDT first (qty = USDT/price);
      // the journal's ₹ P&L multiplies ΔUSDT × qty × fxAtEntry.
      qtyEstimate: market === 'INDIA'
        ? Math.max(1, Math.floor(Number(cfg.stakeINR) / Math.max(0.05, Number(sig.plan.entry) || 1)))
        : market === 'FUTURES'
          ? Math.round((Number(cfg.stakeINR) / (Number(fxPre) || 84)) / Math.max(1e-8, Number(sig.plan.entry) || 1) * 1e6) / 1e6
          : Math.round((Number(cfg.stakeINR) / Math.max(1e-8, Number(sig.plan.entry) || 1)) * 1e6) / 1e6,
      product: market === 'INDIA' ? cfg.indiaProduct : null,
      pnlBasis: 'notional',
      mode: cfg.mode, source: 'protrader-auto',
      signal: {
        aiScore: g.score.ai, conf: g.score.conf, verified: g.score.verified,
        verifyAction: sig.verify?.action, finalCall: sig.verify?.finalCall,
        grade: sig.grade, entry: sig.plan.entry, sl: sig.plan.stopLoss, tp1: sig.plan.target1, tp2: sig.plan.target2,
        mtfConsensus: sig?.mtf?.consensus || null, mtfAgreePct: sig?.mtf?.agreementPct ?? null,
      },
      browser: { actions: [], shots: [] },
      status: cfg.mode === 'paper' ? 'MONITORING' : 'PLACED',
      confirmStreak: 0, lastLtp: Number(sig.ltp || sig.plan.entry), lastCheckAt: Date.now(),
      reversalReasons: [],
    };

    if (cfg.mode === 'paper') {
      trade.browser.actions.push('PAPER-SIM: browser click nahi hua — journal entry only (limit @ entry)');
    } else {
      const r = market === 'INDIA' ? await _placeBrowserIndia(sig, cfg) : await _placeBrowserCrypto(sig, cfg, fxPre);
      trade.browser.actions.push(...(r.steps || []).map((s) => ({ ok: s?.ok, stage: s?.stage || 'step', steps: s?.detail?.steps || s?.picked || s?.error || null })));
      for (const s of r.steps || []) if (s?.shot) trade.browser.shots.push(s.shot);
      if (s_shot(r)) trade.browser.shots.push(s_shot(r));
      if (!r.ok) {
        // v20.7.6: place-order fail par page ke visible inputs ka dump
        // (browserAgent diagnostics) bhi error me pack hota hai — agla
        // UI break LOG se hi diagnosable ("price input" wale errors ka
        // root-cause loop khatam).
        const diag = r.detail?.inputs ? ` | inputs: ${String(r.detail.inputs).slice(0, 220)}` : '';
        trade.status = 'FAILED'; trade.error = `${r.stage}: ${r.detail?.error || r.detail?.pageError || 'unknown'}${diag}`;
        _saveTrade(trade);
        _log('error', `ENTRY FAILED ${sig.symbol} ${sig.side} — ${trade.error}`);
        return { ok: false, error: trade.error, trade };
      }
      trade.status = 'PLACED';
      _log('entry', `ORDER PLACED ${sig.symbol} ${sig.side} @ ${sig.plan.entry} (browser) — fill verify agla tick`);
    }
    _saveTrade(trade);
    _log('entry', `NEW TRADE ${sig.symbol} ${sig.side} | AI ${g.score.ai} conf ${g.score.conf} verified ${g.score.verified} | entry ${sig.plan.entry} SL ${sig.plan.stopLoss} | mode ${cfg.mode}`);
    return { ok: true, trade };
  } finally { _s.busyPlacing = false; }
}
function s_shot(r) { return r?.detail?.shot || null; }

function _saveTrade(trade) {
  const j = _journal();
  const i = (j.trades || []).findIndex((t) => t.id === trade.id);
  if (i >= 0) j.trades[i] = trade; else j.trades.push(trade);
  if (j.trades.length > 400) j.trades.splice(0, j.trades.length - 400);
  _saveJournal(j);
}
function _updTrade(id, patch) {
  const j = _journal();
  const t = (j.trades || []).find((x) => x.id === id);
  if (!t) return null;
  Object.assign(t, patch);
  _saveJournal(j);
  return t;
}

// ---------------- monitoring + reversal exit ----------------
// v18.6.4: LTP for monitoring no longer depends on the symbol staying in
// the board's top-N. Chain: fresh liveFeed tick (≤30s) → CoinDCX ticker
// batch (internally cached) → board signal → last-known. Returns
// { ltp, stale } — stale:true means the number is last-known (monitor
// still runs, journal honestly flags it).
async function _monitorLtpOf(t, boards, deps) {
  // v19.0: FUTURES rows price in USDT from the FUTURES feed (a spot
  // INR ticker / spot board is meaningless for a B-{SYM}_USDT row).
  const market = t.market === 'INDIA' ? 'INDIA' : (t.market === 'FUTURES' ? 'FUTURES' : 'CRYPTO');
  // deps-injectable (tests stub these; production uses the real store/tickers)
  const tickFn = typeof deps?.getTick === 'function' ? deps.getTick : getTick;
  const tickersFn = typeof deps?.fetchCoinDcxTickers === 'function' ? deps.fetchCoinDcxTickers : fetchCoinDcxTickers;
  try {
    const tick = tickFn(`IN_${t.symbol}`);
    if (tick?.price > 0 && Date.now() - (tick.time || 0) < 30_000) {
      return { ltp: Number(tick.price), stale: false };
    }
  } catch { /* store read — never fatal */ }
  if (market === 'FUTURES') {
    try {
      // deps-injectable like the spot ticker above (tests stub it; the
      // real path uses futures.js's cached REST feed)
      let rows = [];
      if (typeof deps?.fetchFuturesPrices === 'function') {
        rows = await Promise.resolve(deps.fetchFuturesPrices({})).catch(() => []);
      } else {
        const { fetchFuturesPrices } = await import('./futures.js');
        rows = await fetchFuturesPrices({ maxAgeMs: 30_000 }).catch(() => []);
      }
      const row = (rows || []).find((r) => r?.base === String(t.symbol).toUpperCase());
      const px = Number(row?.last);
      if (px > 0) return { ltp: px, stale: false };
    } catch { /* honest degrade */ }
  } else if (market !== 'INDIA') {
    try {
      const rows = await tickersFn();
      const row = (rows || []).find((r) => String(r?.market || '') === `${t.symbol}INR`);
      const px = Number(row?.last_price);
      if (px > 0) return { ltp: px, stale: false };
    } catch { /* honest degrade */ }
  }
  const boardSig = ((boards[market] || {}).signals || []).find((s) => s?.symbol === t.symbol);
  const bl = Number(boardSig?.ltp);
  if (bl > 0) return { ltp: bl, stale: false };
  const last = Number(t.lastLtp);
  if (last > 0) return { ltp: last, stale: true };
  return { ltp: Number(t.entryPrice), stale: true };
}

async function _monitorPositions(deps, cfg, sendTelegram) {
  // v18.6.4: CLOSE_UNKNOWN rows stay in the loop — the close RE-ATTEMPTS
  // every tick (max 8) + alerts until the broker position is really gone.
  const open = _trades().filter((t) => ['MONITORING', 'PLACED', 'CLOSE_UNKNOWN'].includes(t.status));
  if (open.length === 0) return;
  const boards = _s.lastScan?.boards || {};
  for (const t of open) {
    try {
      const market = t.market === 'INDIA' ? 'INDIA' : (t.market === 'FUTURES' ? 'FUTURES' : 'CRYPTO');

      // ---- CLOSE_UNKNOWN: the broker close did not verify — re-attempt ----
      if (t.status === 'CLOSE_UNKNOWN') {
        const attempts = (t.closeAttempts || 0) + 1;
        if (attempts > 8) {
          _updTrade(t.id, { status: 'CLOSE_FAILED', closeAttempts: attempts });
          _log('error', `CLOSE FAILED ${t.symbol} — 8 attempts ke baad bhi verify nahi hua. BROKER PANEL me manually check/close karo!`);
          try { sendTelegram?.(`[PRO TRADER AUTO] ⚠️ ${t.symbol} ${t.side} CLOSE FAILED — 8 attempts. Broker app me manually close karo aur verify karo.`); } catch {}
          continue;
        }
        _log('warn', `CLOSE RETRY ${t.symbol} (attempt ${attempts}/8) — broker position abhi bhi dikha/dhang se verify nahi hua`);
        await _closeTrade(t, `${t.closed?.reason || 're-close'} (RETRY ${attempts}/8)`, cfg, sendTelegram, null);
        continue;
      }

      // ---- PLACED fill verification (live only, crypto): read the
      //      positions table — row mila → MONITORING (fill confirmed);
      //      10 min tak nahi mila → honest telegram nudge. ----
      if (t.status === 'PLACED' && t.mode === 'live' && market !== 'INDIA'
        && Date.now() - (t.ts || 0) > 60_000 && Date.now() - (t.fillCheckedAt || 0) > 90_000) {
        try {
          const read = await cxReadPositions();
          if (read?.ok) {
            const found = (read.positions || []).some((p) => String(p.text || '').toUpperCase().includes(String(t.pair).toUpperCase()));
            if (found) {
              _updTrade(t.id, { fillCheckedAt: Date.now(), status: 'MONITORING' });
              _log('info', `FILL CONFIRMED ${t.symbol} — positions table me row mil gayi`);
            } else {
              _updTrade(t.id, { fillCheckedAt: Date.now() });
              if (Date.now() - (t.ts || 0) > 10 * 60_000 && !t.fillAlertedAt) {
                _updTrade(t.id, { fillAlertedAt: Date.now() });
                _log('warn', `FILL UNVERIFIED ${t.symbol} — 10 min se positions table me row nahi mili (order maybe unfilled/cancelled)`);
                try { sendTelegram?.(`[PRO TRADER AUTO] ⚠️ ${t.symbol} order FILL verify nahi hua (10 min, positions me row nahi). Exchange app me order status check karo.`); } catch {}
              }
            }
          }
        } catch { /* positions read best-effort */ }
      }

      // ---- EOD squareoff: INTRADAY products only (MTF/DELIVERY hold
      //      overnight — reversal/SL monitoring continues next session). ----
      const product = t.product || cfg.indiaProduct;
      if (t.market === 'INDIA' && indiaSquareOffDue() && product === 'INTRADAY') {
        await _closeTrade(t, 'EOD-SQUAREOFF (15:15 IST, INTRADAY)', cfg, sendTelegram, null);
        continue;
      }

      // ---- LTP: independent of board top-N (see _monitorLtpOf) ----
      const { ltp, stale } = await _monitorLtpOf(t, boards, deps);
      const boardSig = ((boards[market] || {}).signals || []).find((s) => s?.symbol === t.symbol);
      const deepSide = boardSig?.side || null;
      const deepConf = Number(boardSig?.confidence || 0);
      const mtfCons = boardSig?.mtf?.consensus || null;
      const mtfAgree = boardSig?.mtf?.agreementPct ?? null;
      const rc = proTraderReversalCheck({ trade: t, ltp, deepSide, deepConf, mtfConsensus: mtfCons, mtfAgreePct: mtfAgree, cfg });

      const pnl = _pnlOf(t, ltp);
      const roePct = _roePctOf(t, ltp);
      const patch = { lastLtp: ltp, ltpStale: Boolean(stale), lastCheckAt: Date.now(), lastPnlINR: pnl, lastRoePct: roePct, reversalReasons: rc.reasons };
      if (!rc.hit) { patch.confirmStreak = 0; _updTrade(t.id, patch); continue; }

      if (rc.immediate || rc.wantClose) {
        t.confirmStreak = (t.confirmStreak || 0) + 1;
        patch.confirmStreak = t.confirmStreak;
        const need = rc.immediate ? 1 : REVERSAL_CONFIRM_NEEDED;
        if (t.confirmStreak >= need) {
          await _closeTrade(t, `REVERSAL CONFIRMED [${rc.reasons.join(' + ')}] (streak ${t.confirmStreak}/${need})`, cfg, sendTelegram, ltp);
        } else {
          _updTrade(t.id, patch);
          _log('info', `REVERSAL watch ${t.symbol} — signal mila (streak ${t.confirmStreak}/${need}): ${rc.reasons.join(', ')}`);
        }
      } else {
        _updTrade(t.id, patch);
      }
    } catch (e) {
      _log('error', `monitor ${t.symbol}: ${String(e?.message || e).slice(0, 120)}`);
    }
  }
}

// v18.6.4: journal P&L is NOTIONAL-based — the browser order enters
// qty = stake/entry, so position notional ≈ stake and P&L = qty × Δprice.
// (Pehle ye stake × move% × leverage tha — leverage slider DOM me
// best-effort cosmetic hai, isliye ×3 default journal ko overstate karta
// tha. ROE margin-lens ab alag field hai.)
function _pnlOf(t, ltp) {
  const p = Number(ltp); const e = Number(t.entryPrice);
  if (!Number.isFinite(p) || !Number.isFinite(e) || p <= 0 || e <= 0) return null;
  const dir = t.side === 'LONG' ? 1 : -1;
  const qty = Number(t.qtyEstimate) > 0 ? Number(t.qtyEstimate) : (Number(t.stakeINR) || 0) / e;
  // v19.0: FUTURES rows price in USDT → ΔUSDT × qty needs the entry fx
  // stamp to speak INR (the journal's ₹ basis). Legacy CRYPTO/INDIA rows
  // have no stamp → exact old math (zero regression).
  const fx = t.market === 'FUTURES' ? (Number(t.fxAtEntry) > 50 ? Number(t.fxAtEntry) : 84) : 1;
  return Math.round((p - e) * qty * dir * fx);
}

/** ROE % (margin lens): move% × leverage — display-only, never the
 *  journal's ₹ basis (crypto margin rows only). */
function _roePctOf(t, ltp) {
  const p = Number(ltp); const e = Number(t.entryPrice);
  if (!Number.isFinite(p) || !Number.isFinite(e) || p <= 0 || e <= 0) return null;
  const dir = t.side === 'LONG' ? 1 : -1;
  const lev = t.market === 'INDIA' ? 1 : Math.max(1, Number(t.leverage) || 1);
  return Math.round(((p - e) / e) * 100 * dir * lev * 100) / 100;
}

// v18.6.4 — close is now HONEST at every layer:
//   * INDIA: real dhanClosePosition DOM close (was a no-op {ok:true}!
//     journal CLOSED likh deta tha jabki broker pe position chalti rehti thi)
//   * CRYPTO: cxClosePosition + VERIFY via cxReadPositions — row abhi
//     bhi dikhi → CLOSE_UNKNOWN (retry loop upar)
//   * failure → CLOSE_UNKNOWN, trade monitored rehta hai + telegram alert
async function _closeTrade(t, reason, cfg, sendTelegram, ltpOverride) {
  t.browser ??= { actions: [], shots: [] };
  let exitPrice = Number(ltpOverride || t.lastLtp || t.entryPrice);
  let closeOk = true; let closeDetail = null; let verify = null;
  if (cfg.mode === 'live') {
    try {
      const r = t.market === 'INDIA'
        ? await dhanClosePosition(t.symbol, t.side)
        : await cxClosePosition(t.pair, t.side);
      closeOk = Boolean(r?.ok);
      closeDetail = r;
      if (r?.shot) t.browser.shots.push(r.shot);
      // crypto: verify the row actually left the positions table
      if (closeOk && t.market !== 'INDIA') {
        try {
          const read = await cxReadPositions();
          if (read?.ok && Array.isArray(read.positions)) {
            const still = read.positions.some((p) => String(p.text || '').toUpperCase().includes(String(t.pair).toUpperCase()));
            if (still) { closeOk = false; verify = 'row-still-present'; }
            else verify = 'row-gone';
          } else {
            verify = 'unread'; // positions read failed — trust the close, journal honestly
          }
        } catch { verify = 'unread'; }
      }
    } catch (e) { closeOk = false; closeDetail = { error: String(e?.message || e) }; verify = 'exception'; }
  }
  const pnl = _pnlOf(t, exitPrice);
  if (closeOk) {
    _updTrade(t.id, {
      status: 'CLOSED',
      closed: { ts: Date.now(), reason, exitPrice, pnlINR: pnl, closeDetail: closeDetail ? { ok: true, steps: closeDetail.steps || closeDetail.error || null } : null, verify },
    });
    _log('exit', `CLOSE ${t.symbol} ${t.side} @ ~${exitPrice} — ${reason} | PnL ~${pnl ?? '?'} INR${verify === 'unread' ? ' (positions read nahi hua — verify nahi)' : ''}`);
    try { sendTelegram?.(`[PRO TRADER AUTO] CLOSE ${t.symbol} ${t.side} @ ~${exitPrice} — ${reason} — PnL ~${pnl ?? '?'} INR`); } catch {}
  } else {
    // v18.6.4: NEVER journal a close that did not happen — the trade
    // stays in CLOSE_UNKNOWN, the monitor re-attempts + alerts.
    const attempts = (t.closeAttempts || 0) + 1;
    _updTrade(t.id, {
      status: 'CLOSE_UNKNOWN', closeAttempts: attempts,
      closed: { ts: Date.now(), reason, exitPrice, pnlINR: pnl, closeDetail: closeDetail ? { ok: false, steps: closeDetail.steps || closeDetail.error || null } : null, verify },
    });
    _log('error', `CLOSE UNVERIFIED ${t.symbol} — attempt ${attempts}/8 RE-ATTEMPT hoga — ${reason}${verify ? ` (${verify})` : ''}`);
    try { sendTelegram?.(`[PRO TRADER AUTO] ⚠️ ${t.symbol} ${t.side} CLOSE verify NAHI hua (attempt ${attempts}/8) — ${reason}. Engine RETRY karega, par broker panel me bhi check karo.`); } catch {}
  }
}

// ---------------- the tick ----------------
export async function proTraderTick(deps = {}, sendTelegram) {
  // v18.6.4 re-entrancy guard: ek tick me board compute + CDP browser
  // waits (select-pair 20s + place-order 30s + per-position close 25s)
  // 30s se aage nikal sakte hain — overlapped ticks double browser
  // clicks + journal read-modify-write races karte the.
  // v20.7.4: skip-log ab 5-min throttled — har tick repeat hone wale
  // "tick overlap" lines console flood kar rahe the.
  if (_s._ticking) {
    if (Date.now() - (_s._overlapLogAt || 0) > 5 * 60_000) {
      _s._overlapLogAt = Date.now();
      _log('skip', 'tick overlap — previous tick abhi bhi chal raha hai (browser CDP wait). Skip.');
    }
    return { ok: true, overlapped: true };
  }
  _s._ticking = true;
  try {
    const cfg = loadProTraderConfig();
    _s.lastTickAt = Date.now();
    _s.running = Boolean(cfg.enabled);
    _s.mode = cfg.mode;
    if (!cfg.enabled) { _broadcastStatusThrottled(); return { ok: true, idle: true }; }

    // global kill-switch always wins
    const tcfg = loadJSON(TRADING_CFG_FILE, {}) || {};
    if (tcfg.killSwitch) { _log('skip', 'global kill-switch ON — trades skip'); _broadcastStatusThrottled(); return { ok: true, killed: true }; }

    await _refreshBrowser().catch(() => {});

    // ---- scan boards (in-process, 60s-cached by signals.js) ----
    // v19.0: cryptoProduct 'futures' (default) → the CoinDCX FUTURES
    // board (B-{SYM}_USDT, USDT-margined — user-spec scope); 'spot'
    // restores the legacy CRYPTO/INR board.
    const { getSignals } = await import('./signals.js');
    const cryptoBoardKey = cfg.cryptoProduct === 'spot' ? 'CRYPTO' : 'FUTURES';
    const boards = {};
    if (cfg.desks.crypto) boards[cryptoBoardKey] = await getSignals(cryptoBoardKey, deps, { limit: 20 }).catch(() => null);
    if (cfg.desks.india) boards.INDIA = await getSignals('INDIA', deps, { limit: 20 }).catch(() => null);

    const all = [
      ...(boards[cryptoBoardKey]?.signals || []).map((s) => ({ ...s, market: cryptoBoardKey })),
      ...(boards.INDIA?.signals || []).map((s) => ({ ...s, market: 'INDIA' })),
    ];
    const open = _trades().filter((t) => ['MONITORING', 'PLACED', 'CLOSE_UNKNOWN'].includes(t.status));
    const cooldowns = {};
    for (const t of _trades()) {
      const closedAt = t.closed?.ts || 0;
      cooldowns[t.symbol] = Math.max(cooldowns[t.symbol] || 0, closedAt + cfg.cooldownMin * 60_000);
      // v20.7.4 FIX: browser-stage FAILED entry bhi symbol ko cool down
      // karo (min(cooldownMin,10) min) — warna wahi signal HAR 30s tick pe
      // fail hota rehta tha (user log: ENTRY FAILED ETH LONG har tick,
      // tick-overlap skip spam ka doosra root cause).
      if (t.status === 'FAILED' && t.ts) {
        cooldowns[t.symbol] = Math.max(cooldowns[t.symbol] || 0, t.ts + Math.min(cfg.cooldownMin, 10) * 60_000);
      }
    }
    const { best, evaluated } = pickProTraderCandidate(all, cfg, {
      existingSymbols: open.map((t) => t.symbol), cooldowns, now: Date.now(),
    });
    _s.lastScan = { at: Date.now(), candidates: evaluated, bestSymbol: best?.symbol || null, boards };

    // ---- caps ----
    const today = _todayIST();
    const todayCount = _trades().filter((t) => t.day === today && t.status !== 'FAILED').length;
    if (best && open.length < cfg.maxConcurrent && todayCount < cfg.maxTradesPerDay && !_s.busyPlacing) {
      const r = await _tryEntry(deps, cfg, best).catch((e) => ({ ok: false, error: String(e?.message || e) }));
      if (!r?.ok && r?.error && r.error !== 'busy' && !String(r.error).includes('browser tab')) {
        _log('skip', `entry skip ${best.symbol}: ${String(r.error).slice(0, 140)}`);
      }
    }

    await _monitorPositions(deps, cfg, sendTelegram);
    _broadcastStatusThrottled();
    return { ok: true };
  } finally {
    _s._ticking = false;
  }
}

// ---------------- status view ----------------
export function proTraderStatusView() {
  const cfg = loadProTraderConfig();
  const trades = _trades();
  const open = trades.filter((t) => ['MONITORING', 'PLACED', 'CLOSE_UNKNOWN'].includes(t.status));
  const today = _todayIST();
  const todayTrades = trades.filter((t) => t.day === today && t.status !== 'FAILED');
  const closedToday = trades.filter((t) => t.day === today && t.closed && t.status === 'CLOSED');
  const browser = browserStatus();
  return {
    ok: true,
    engine: 'SAPTA v18.6.4 — Superintelligence Advance AI Pro Trader Auto',
    running: Boolean(cfg.enabled && _s.running),
    mode: cfg.mode,
    startedAt: _s.startedAt,
    lastTickAt: _s.lastTickAt || null,
    lastTickAgeSec: _s.lastTickAt ? Math.max(0, Math.round((Date.now() - _s.lastTickAt) / 1000)) : null,
    nextScanInSec: Math.max(0, PROTRADER_TICK_SEC - Math.round((Date.now() - _s.lastTickAt) / 1000)),
    gates: { minAiScore: cfg.minAiScore, minConfidence: cfg.minConfidence, minVerifiedScore: cfg.minVerifiedScore, requireVerifyConfirm: cfg.requireVerifyConfirm, reversalConfirmTicks: REVERSAL_CONFIRM_NEEDED },
    config: cfg,
    browser: { connected: browser.connected, browser: browser.browser, host: browser.host, port: browser.port, portsTried: browser.portsTried, tabs: browser.tabs, lastError: browser.lastError, hint: browser.hint },
    candidates: (_s.lastScan?.candidates || []).slice(0, 6),
    positions: open.map((t) => ({
      id: t.id, market: t.market, symbol: t.symbol, side: t.side, entryPrice: t.entryPrice, sl: t.sl, tp: t.tp,
      lastLtp: t.lastLtp, ltpStale: Boolean(t.ltpStale), lastPnlINR: t.lastPnlINR ?? null, lastRoePct: t.lastRoePct ?? null,
      pnlBasis: t.pnlBasis || 'notional', qtyEstimate: t.qtyEstimate ?? null, product: t.product ?? null,
      leverage: t.leverage, mode: t.mode, status: t.status,
      closeAttempts: t.closeAttempts || 0,
      confirmStreak: t.confirmStreak || 0, reversalReasons: t.reversalReasons || [], lastCheckAt: t.lastCheckAt,
      signal: t.signal,
    })),
    today: { trades: todayTrades.length, cap: cfg.maxTradesPerDay, closed: closedToday.length, pnlINR: closedToday.reduce((a, t) => a + (Number(t.closed?.pnlINR) || 0), 0) },
    log: _s.log.slice(-120),
    shotsDir: 'server/data/protrader-shots',
  };
}

// ---------------- browser test (DOM health probe) ----------------
export async function proTraderBrowserTest() {
  const r = await browserConnect({ probe: true, force: true }).catch((e) => ({ connected: false, error: String(e?.message || e) }));
  const cx = r?.tabs?.coindcx?.found ? 'found' : 'missing';
  const dh = r?.tabs?.dhan?.found ? 'found' : 'missing';
  // v18.6.2: reason + fix hint log me hi dikhao — user ko batana KYU fail hua.
  const why = String(r?.lastError || r?.error || r?.tabs?.coindcx?.hint || r?.tabs?.dhan?.hint || '').trim();
  _log('info', `BROWSER HEALTH: connected=${r.connected} coindcx=${cx} dhan=${dh}${why ? ` — ${why.slice(0, 200)}` : ''}`);
  return r;
}

// ---------------- dry run: what WOULD the agent do now ----------------
export async function proTraderTestRun(deps = {}) {
  const cfg = loadProTraderConfig();
  const { getSignals } = await import('./signals.js');
  const boards = {};
  boards[cfg.cryptoProduct === 'spot' ? 'CRYPTO' : 'FUTURES'] = await getSignals(cfg.cryptoProduct === 'spot' ? 'CRYPTO' : 'FUTURES', deps, { limit: 20 }).catch(() => null);
  boards.INDIA = await getSignals('INDIA', deps, { limit: 20 }).catch(() => null);
  const all = [
    ...((boards[cfg.cryptoProduct === 'spot' ? 'CRYPTO' : 'FUTURES']?.signals) || []).map((s) => ({ ...s, market: cfg.cryptoProduct === 'spot' ? 'CRYPTO' : 'FUTURES' })),
    ...(boards.INDIA?.signals || []).map((s) => ({ ...s, market: 'INDIA' })),
  ];
  const open = _trades().filter((t) => ['MONITORING', 'PLACED'].includes(t.status));
  const { best, evaluated } = pickProTraderCandidate(all, cfg, { existingSymbols: open.map((t) => t.symbol), cooldowns: {}, now: Date.now() });
  const plan = best ? {
    market: best.market, symbol: best.symbol, side: best.side,
    entry: best.plan.entry, sl: best.plan.stopLoss, tp1: best.plan.target1,
    scores: { ai: best.superIntel?.aiScore, conf: best.confidence, verified: best.verify?.score, verifyAction: best.verify?.action, finalCall: best.verify?.finalCall },
    browserFlow: best.market === 'INDIA'
      ? [`dhan.co me "${best.symbol}" search`, `LIMIT price ${best.plan.entry}`, `qty = floor(${cfg.stakeINR}/${best.plan.entry})`, `product ${cfg.indiaProduct}`, `${best.side === 'LONG' ? 'BUY' : 'SELL'} click + confirm`]
      : best.market === 'FUTURES'
        ? [`coindcx.com/futures/B-${best.symbol}_USDT page`, `LIMIT price ${best.plan.entry} (read-back verify)`, `amount = ${cfg.stakeINR}₹ / fx / price`, `qty verify + ${best.side === 'LONG' ? 'BUY' : 'SELL'} click`]
        : [`coindcx.com me ${best.symbol}INR search`, useMarginText(cfg), `LIMIT price ${best.plan.entry}`, `total ${cfg.stakeINR} INR`, `${best.side === 'LONG' ? 'BUY' : 'SELL'} click + confirm`],
    liveWouldClick: cfg.mode === 'live' && cfg.enabled,
  } : null;
  return { ok: true, dryRun: true, plan, evaluated: evaluated.slice(0, 10) };
}
function useMarginText(cfg) { return Number(cfg.cryptoLeverage) > 1 ? `Margin tab + leverage ~${cfg.cryptoLeverage}x` : 'Spot order (no leverage)'; }
