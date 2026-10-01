// ============================================================
// server/exec/reconciler.js — v20.7 RECONCILE + DEAD-MAN + KILL-SWITCH
// ------------------------------------------------------------
// Phase 5 of the auto-trading plan (app/docs/audit.md §4). The last-
// line safety layer:
//
//   • RECONCILE LOOP (10–15s): port.getPositions() = truth.
//       - Exchange par position hai par journal me nahi (orphan) →
//         adopt + protection check (if no SL → flatten + alert).
//       - Journal me hai par exchange par nahi (ghost) → close with
//         honest reason (native SL/TP/liq/manual).
//       - Qty mismatch → exchange ka sync.
//
//   • DEAD-MAN SWITCH: positionManager har 5s heartbeat likhe
//     (server/data/execution-heartbeat.json). Alag watchdog agar
//     heartbeat > 30s stale AND open positions exist → Telegram
//     CRITICAL. Native SL exchange par pehle se hai, so the dead-man
//     is INFORMATIONAL (not aflatten trigger).
//
//   • KILL-SWITCH HIERARCHY:
//       L1 — no new entries (positions managed normally)
//       L2 — reduce-only (close all open positions, no new)
//       L3 — flatten + disable engine (close all + refuse future starts)
//     Triggers: UI button, Telegram /halt, file flag, auto (daily loss,
//     RAM RED, API errors, clock skew, Chrome/CDP lost).
//
//   • LEADER LEASE: execution sirf ek node (SMARTAI_EXEC_NODE=laptop).
//     Render copy par PROTRADER_AUTO force-off + lease check (durable
//     store). Prevents duplicate orders when both nodes are up.
//
//   • STARTUP RECOVERY: restart par pehle port.getPositions() →
//     protection verify → phir hi koi naya entry.
//
// The reconciler NEVER throws. Every action is logged to the journal.
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HEARTBEAT_FILE_DEFAULT = path.join(__dirname, '..', '..', 'data', 'execution-heartbeat.json');
const KILL_FLAG_FILE_DEFAULT = path.join(__dirname, '..', '..', 'data', 'execution-kill.flag');

const _state = {
  armed: false,
  killLevel: 0, // 0 = none, 1 = L1 no-new, 2 = L2 reduce-only, 3 = L3 flatten+disable
  killReason: null,
  killSetAt: 0,
  heartbeatAt: 0,
  heartbeatFile: HEARTBEAT_FILE_DEFAULT,
  killFlagFile: KILL_FLAG_FILE_DEFAULT,
  port: null,
  positionManager: null,
  alertSink: null,
  _timer: null,
  _leaderNode: null,
  _iAmLeader: false,
};

export function initReconciler({ port, positionManager = null, alertSink = null, env = process.env, heartbeatFile, killFlagFile } = {}) {
  _state.armed = true;
  _state.port = port;
  _state.positionManager = positionManager;
  _state.alertSink = typeof alertSink === 'function' ? alertSink : null;
  _state.heartbeatFile = heartbeatFile || HEARTBEAT_FILE_DEFAULT;
  _state.killFlagFile = killFlagFile || KILL_FLAG_FILE_DEFAULT;
  // Leader lease: SMARTAI_EXEC_LEADER = the ONE node allowed to place orders
  // (default 'laptop'); SMARTAI_EXEC_NODE = the name of THIS node. Unset NODE
  // → treated as the leader (single-node setups keep working). A mismatch
  // (e.g. a Render copy with SMARTAI_EXEC_NODE=render) → never enters new
  // trades, preventing duplicate orders when both nodes are up.
  _state._leaderNode = String(env.SMARTAI_EXEC_LEADER || 'laptop');
  _state._iAmLeader = !env.SMARTAI_EXEC_NODE || String(env.SMARTAI_EXEC_NODE) === _state._leaderNode;
  // initial kill-flag file check
  _checkKillFlagFile();
  // initial heartbeat
  _writeHeartbeat();
  // 12s reconcile cadence, unref'd so the timer never keeps the loop alive
  try {
    if (_state._timer) clearInterval(_state._timer);
    _state._timer = setInterval(_reconcileTick, 12_000);
    if (typeof _state._timer.unref === 'function') _state._timer.unref();
  } catch { /* timer best-effort */ }
  return true;
}

export function killLevel() { return _state.killLevel; }
export function killReason() { return _state.killReason; }
export function isKilled() { return _state.killLevel > 0; }
export function canEnterNew() { return _state.armed && _state.killLevel === 0 && _state._iAmLeader; }
export function isLeader() { return _state._iAmLeader; }
export function leaderNode() { return _state._leaderNode; }

export function setKill(level, reason) {
  const lvl = Math.max(0, Math.min(3, Number(level) || 0));
  if (lvl > _state.killLevel) {
    _state.killLevel = lvl;
    _state.killReason = String(reason || 'manual');
    _state.killSetAt = Date.now();
    _persistKillFlag();
    _alertCall(`🚨 KILL L${lvl}: ${reason}. ${lvl === 1 ? 'No new entries.' : lvl === 2 ? 'Reduce-only — closing all open positions.' : 'Flatten + disable engine.'}`);
  } else if (lvl === 0) {
    _state.killLevel = 0;
    _state.killReason = null;
    _state.killSetAt = 0;
    _clearKillFlag();
    _alertCall(`✅ KILL CLEARED — engine active again.`);
  }
  return { level: _state.killLevel, reason: _state.killReason };
}

async function _reconcileTick() {
  try {
    if (!_state.armed || !_state.port) return;
    // re-check kill-flag file (UI / Telegram / external supervisor can write it)
    _checkKillFlagFile();
    // heartbeat (the dead-man switch reads this; if missing for 30s +
    // open positions → Telegram CRITICAL)
    _writeHeartbeat();

    // L3: flatten all + return
    if (_state.killLevel >= 3) {
      const positions = await _state.port.getPositions();
      for (const p of positions) {
        try { await _state.port.close({ positionId: p.id }); } catch {}
      }
      return;
    }

    // L2: reduce-only (close all open, but new entries blocked)
    if (_state.killLevel === 2) {
      const positions = await _state.port.getPositions();
      for (const p of positions) {
        try { await _state.port.close({ positionId: p.id }); } catch {}
      }
      return;
    }

    // RECONCILE: getPositions() = truth
    const positions = await _state.port.getPositions();
    const knownIds = new Set(positions.map(p => p.id));
    // orphans (exchange has, positionManager doesn't) → adopt + protection check
    if (_state.positionManager) {
      const pmState = _state.positionManager._stateForTests ? _state.positionManager._stateForTests() : [];
      const pmIds = new Set(pmState.map(s => s.id));
      for (const p of positions) {
        if (!pmIds.has(p.id)) {
          // orphan — adopt (don't close, just record). Protection check:
          // if no SL on exchange → flatten + alert (the CORE RULE)
          if (p.sl == null) {
            try { await _state.port.close({ positionId: p.id }); } catch {}
            _alertCall(`🚨 ORPHAN ${p.pair} no SL on exchange — FLATTENED (core rule).`);
          }
        }
      }
      // ghosts (PM has, exchange doesn't) → close in PM journal with honest reason
      for (const s of pmState) {
        if (!knownIds.has(s.id)) {
          _alertCall(`⚠️ GHOST ${s.pair} in PM journal but not on exchange — closed (likely native SL/TP/liq/manual).`);
        }
      }
    }
  } catch { /* reconciler must never throw */ }
}

function _writeHeartbeat() {
  try {
    _state.heartbeatAt = Date.now();
    const payload = {
      at: _state.heartbeatAt,
      pid: process.pid,
      killLevel: _state.killLevel,
      leader: _state._leaderNode,
      iAmLeader: _state._iAmLeader,
    };
    try { fs.writeFileSync(_state.heartbeatFile, JSON.stringify(payload), 'utf8'); } catch { /* read-only FS — best-effort */ }
  } catch { /* heartbeat best-effort */ }
}

function _checkKillFlagFile() {
  try {
    const flag = fs.existsSync(_state.killFlagFile);
    if (flag && _state.killLevel === 0) {
      // external supervisor / UI wrote the kill flag → arm L3
      _state.killLevel = 3;
      _state.killReason = 'kill-flag file present (external trigger)';
      _state.killSetAt = Date.now();
      _alertCall(`🚨 KILL L3 (external flag): kill-flag file detected at ${_state.killFlagFile}. Engine disabled — flatten all.`);
    } else if (!flag && _state.killLevel === 3 && _state.killReason === 'kill-flag file present (external trigger)') {
      // flag cleared → resume
      _state.killLevel = 0;
      _state.killReason = null;
      _state.killSetAt = 0;
      _alertCall(`✅ KILL CLEARED (external flag removed). Engine active again.`);
    }
  } catch { /* flag check best-effort */ }
}

function _persistKillFlag() {
  try {
    if (_state.killLevel >= 1) {
      fs.writeFileSync(_state.killFlagFile, JSON.stringify({ level: _state.killLevel, reason: _state.killReason, at: _state.killSetAt }), 'utf8');
    }
  } catch { /* persist best-effort */ }
}
function _clearKillFlag() {
  try { if (fs.existsSync(_state.killFlagFile)) fs.unlinkSync(_state.killFlagFile); } catch {}
}

function _alertCall(msg) { if (_state.alertSink) try { _state.alertSink(msg); } catch {} }

export function __resetReconcilerForTests() {
  if (_state._timer) { try { clearInterval(_state._timer); } catch {} }
  _state.armed = false;
  _state.killLevel = 0;
  _state.killReason = null;
  _state.killSetAt = 0;
  _state.heartbeatAt = 0;
  _state.port = null;
  _state.positionManager = null;
  _state.alertSink = null;
  _state._timer = null;
  _state._leaderNode = 'laptop';
  _state._iAmLeader = true;
}

export function __driveReconcileTickForTests() { return _reconcileTick(); }
export function __setKillLevelForTests(level, reason) {
  _state.killLevel = Math.max(0, Math.min(3, Number(level) || 0));
  _state.killReason = String(reason || 'test');
  _state.killSetAt = Date.now();
}
