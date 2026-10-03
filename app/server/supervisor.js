#!/usr/bin/env node
// ============================================================
// SmartAI v20.0.1 — supervisor.js (ANTI-FREEZE SUPERVISOR)
//            v19.2 engine + v20.0.1 DEPS AUTO-INSTALL
// ------------------------------------------------------------
// v20.0.1 FIX (live bug, D:\SmartAI26 fresh install): v20 full zip
// me node_modules NAHI hota (user-data rule) — naye folder pe boot
// "ERR_MODULE_NOT_FOUND: dotenv" crash-loop me girta tha (aur
// purana message GALAT "port conflict" bolta tha). Ab:
//   * boot se PEHLE package.json deps vs node_modules audit —
//     missing ho to npm install KHUD chalta hai (internet chahiye,
//     15 min max, output [npm] lines me relay hota hai).
//   * child crash pe stderr se ERR_MODULE_NOT_FOUND sniff hota hai
//     -> journal reason 'deps-missing' + honest Hindi message +
//     ek auto-install retry (max 2 per supervisor run).
//   * install ke dauran restart-tick/startChild blocked rehte hain
//     (race-free); fail hone pe bhi loop honest rehta hai (budget
//     pause pehle se hi tha).
// THE EXTERNAL WATCHDOG THAT v19.1 WAS MISSING.
//
// v19.1 made the server crash-resilient (stay-alive, log
// governor, exit journal). But one failure class stayed
// UNRECOVERABLE: the HANG. Process zinda hai, event loop
// FROZEN (Windows QuickEdit console select, blocked stdout
// pipe, sync stall, runaway loop) — /health timeout, site
// "atak jaati hai", aur process kabhi exit nahi karta, so
// koi restart trigger nahi fire hota. The v19.1 watchdog bat
// only restarted on EXIT — a hung child never exits.
//
// THIS file closes that loop with an INDEPENDENT probe:
//   * spawns server/index.js as a child (env marker
//     SMARTAI_SUPERVISED=1) and RELIABLY consumes its stdout
//     (a pipe that is always drained can never fill and
//     freeze the child) — lines go to console + a rotated
//     file log (server/data/logs/server.log, 5MB x 2).
//   * every WATCHDOG_PROBE_MS it GETs /api/ping from its OWN
//     event loop. The ping route is zero-work — response time
//     IS the child's event-loop heartbeat.
//   * WATCHDOG_FAILS consecutive timeouts AFTER the boot grace
//     window = FREEZE VERDICT -> force-kill (taskkill /F /T on
//     Windows so grandchildren die too) -> journal -> restart.
//     A boot that never comes up hits the same verdict via
//     fails+3 (reason boot-hang).
//   * child EXIT (crash / OOM / V8 fatal) -> journal + restart
//     with exponential backoff (3s..60s, reset after 10 min
//     stable) and an hourly restart budget (default 20) that
//     pauses 10 min instead of crash-looping CPU burn.
//   * Ctrl+C -> graceful: child gets the console ctrl event on
//     Windows (shared console) and runs its own v19.1 graceful
//     shutdown; supervisor waits up to 8s, then force-kills,
//     journals watchdog-clean-shutdown, exits 0.
//   * supervisor itself NEVER exits on internal errors
//     (own uncaughtException/unhandledRejection stay-alive).
//
// Usage:  node server\supervisor.js     (Start-SmartAI-Watchdog.bat
//         does exactly this from the app root)
// Knobs (all optional, env): WATCHDOG_PORT | PORT, WATCHDOG_PROBE_MS
// (20s), WATCHDOG_TIMEOUT_MS (9s), WATCHDOG_FAILS (3),
// WATCHDOG_GRACE_MS (45s), WATCHDOG_MAX_RESTARTS_HOUR (20),
// WATCHDOG_BUDGET_PAUSE_MS (10m), WATCHDOG_LOG_FILE (path | off),
// WATCHDOG_JOURNAL (path), WATCHDOG_DISABLE (probes off ->
// restart-on-exit only), WATCHDOG_AUTO_INSTALL (default on — deps
// missing = auto npm install), WATCHDOG_INSTALL_TIMEOUT_MS (15m),
// WATCHDOG_APP_ROOT (deps-root override, rare).
// ============================================================

import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { disableQuickEditMode } from './ai/consoleGuard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(__dirname, '..');
const SERVER_ENTRY = path.join(__dirname, 'index.js');
// v20.4.1 ISOLATION FIX: same contract as lib/store.js + ai/selfHeal.js —
// SMARTAI_DATA_DIR (dev/test isolation) wins over the module-relative
// server/data default (production). The watchdog journal + logs now
// stay inside the sandboxed data root when the override is set.
const DATA_DIR = process.env.SMARTAI_DATA_DIR
  ? path.resolve(process.env.SMARTAI_DATA_DIR)
  : path.join(__dirname, 'data');

const LOG_ROTATE_BYTES = 5 * 1024 * 1024; // 5MB
const JOURNAL_MAX_LINES = 60; // same cap as selfHeal journal

function _int(val, def, min, max) {
  // Out-of-range = garbage, NOT a silently clamped dangerous value
  // (e.g. WATCHDOG_FAILS=-4 must mean "default 3", not clamp-to-1).
  const n = parseInt(val, 10);
  if (!Number.isFinite(n) || n < min || n > max) return def;
  return n;
}

function _appendJournalEntry(file, entry) {
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ pid: process.pid, ...entry }) + '\n');
    try {
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
      if (lines.length > JOURNAL_MAX_LINES) {
        fs.writeFileSync(file, lines.slice(-JOURNAL_MAX_LINES).join('\n') + '\n');
      }
    } catch { /* cap best-effort */ }
  } catch { /* journal is diagnostics, never fatal */ }
}

/**
 * Factory (injectable deps for tests). Returns
 * { start, stop, _i } — _i exposes internals for unit tests.
 */
export function createSupervisor(opts = {}) {
  const env = opts.env || process.env;

  const knobs = {
    port: _int(env.WATCHDOG_PORT || env.PORT, 8080, 1, 65535),
    probeMs: _int(env.WATCHDOG_PROBE_MS, 20000, 3000, 600000),
    timeoutMs: _int(env.WATCHDOG_TIMEOUT_MS, 9000, 1000, 120000),
    fails: _int(env.WATCHDOG_FAILS, 3, 1, 20),
    graceMs: _int(env.WATCHDOG_GRACE_MS, 45000, 5000, 600000),
    backoffBaseMs: _int(env.WATCHDOG_BACKOFF_BASE_MS, 3000, 1000, 600000),
    backoffMaxMs: _int(env.WATCHDOG_BACKOFF_MAX_MS, 60000, 4000, 900000),
    stableResetMs: _int(env.WATCHDOG_STABLE_RESET_MS, 600000, 60000, 86400000),
    maxRestartsHour: _int(env.WATCHDOG_MAX_RESTARTS_HOUR, 20, 3, 1000),
    budgetPauseMs: _int(env.WATCHDOG_BUDGET_PAUSE_MS, 600000, 10000, 86400000),
    probesOn: env.WATCHDOG_DISABLE !== '1',
    // v20.0.1: fresh-install deps self-heal (see header).
    autoInstall: env.WATCHDOG_AUTO_INSTALL !== '0',
    installTimeoutMs: _int(env.WATCHDOG_INSTALL_TIMEOUT_MS, 900000, 30000, 3600000),
    // child entry override (tests / custom boot chains); default = the real server
    childEntry: env.WATCHDOG_CHILD || opts.serverEntry || SERVER_ENTRY,
    logFilePath: env.WATCHDOG_LOG_FILE === 'off' ? null
      : (env.WATCHDOG_LOG_FILE || path.join(DATA_DIR, 'logs', 'server.log')),
    journalFile: env.WATCHDOG_JOURNAL || path.join(DATA_DIR, 'exit-reasons.log'),
  };

  const deps = {
    spawnFn: opts.spawnFn || spawn,
    httpGetFn: opts.httpGetFn || ((...a) => http.get(...a)),
    nowFn: opts.nowFn || (() => Date.now()),
    logFn: opts.logFn || ((line) => { try { process.stdout.write(line); } catch { /* frozen console never kills us */ } }),
    journalAppendFn: opts.journalAppendFn || ((entry) => _appendJournalEntry(knobs.journalFile, entry)),
    platformFn: opts.platformFn || (() => process.platform),
    nodeExe: opts.nodeExe || process.execPath,
    appRoot: env.WATCHDOG_APP_ROOT || opts.appRoot || APP_ROOT,
    fsMod: opts.fsMod || fs,
  };

  const state = {
    started: false,
    shuttingDown: false,
    child: null,
    childStartedAt: 0,
    failsStreak: 0,
    restarts: 0,
    restartHistory: [],
    backoffDelayMs: knobs.backoffBaseMs,
    nextRestartAt: 0,
    pendingReason: null,
    budgetPausedUntil: 0,
    budgetBannerShown: false,
    depsInstallTries: 0,
    installingDeps: false,
    childModuleErr: false,
    upAnnounced: false,
    probeTimer: null,
    tickTimer: null,
  };

  const now = () => deps.nowFn();

  function journal(entry) {
    try { deps.journalAppendFn({ at: now(), supervisorPid: process.pid, ...entry }); } catch { /* never fatal */ }
  }

  function log(line) {
    // Single funnel: console + (optional) file log. The FILE must carry
    // supervisor lines too — the console may be lost (QuickEdit/closed
    // window) but the file is the diagnostic record.
    const text = String(line).replace(/\n$/, '');
    try { deps.logFn(text + '\n'); } catch { /* never fatal */ }
    if (knobs.logFilePath) _appendLog(text + '\n');
  }

  // ---------------- child stdout relay + file log ----------------
  function _appendLog(line) {
    const f = knobs.logFilePath;
    if (!f) return;
    try {
      const dir = path.dirname(f);
      if (!deps.fsMod.existsSync(dir)) deps.fsMod.mkdirSync(dir, { recursive: true });
      deps.fsMod.appendFileSync(f, line);
      try {
        const st = deps.fsMod.statSync(f);
        if (st.size > LOG_ROTATE_BYTES) {
          try { deps.fsMod.rmSync(f + '.2', { force: true }); } catch { /* best-effort */ }
          try { deps.fsMod.renameSync(f + '.1', f + '.2'); } catch { /* first rotation */ }
          try { deps.fsMod.renameSync(f, f + '.1'); } catch { /* best-effort */ }
        }
      } catch { /* stat/rotate best-effort */ }
    } catch { /* log file never fatal */ }
  }

  function _emitLine(line, isErr) {
    log((isErr ? '[srv:err] ' : '') + line);
    // v20.0.1: crash ki ASLI wajah pakdo — ERR_MODULE_NOT_FOUND =
    // node_modules adha/gayab. Is signal ke bina restart loop galat
    // "port conflict" hint de deta tha (live bug D:\SmartAI26).
    if (isErr && typeof line === 'string' && line.includes('ERR_MODULE_NOT_FOUND')) {
      state.childModuleErr = true;
    }
  }

  function _relayChild(child) {
    const mk = (isErr) => {
      let buf = '';
      const handler = (d) => {
        try {
          buf += String(d || '');
          let idx;
          while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx).replace(/\r$/, '');
            buf = buf.slice(idx + 1);
            if (line.trim()) _emitLine(line, isErr);
          }
        } catch { /* relay never fatal */ }
      };
      // v20.0.1: exit pe adhi (bina newline wali) line bhi flush —
      // ERR_MODULE_NOT_FOUND aksri aadhi line me mila tha (live bug:
      // sniff miss ho gaya tha kyunki line buffer me atki rahi).
      handler.flush = () => {
        try {
          if (buf.trim()) _emitLine(buf.replace(/\r$/, ''), isErr);
          buf = '';
        } catch { /* never fatal */ }
      };
      return handler;
    };
    const outH = mk(false);
    const errH = mk(true);
    try {
      child.stdout.on('data', outH);
      child.stderr.on('data', errH);
      child.on('exit', () => { try { outH.flush(); errH.flush(); } catch { /* noop */ } });
    } catch { /* relay never fatal */ }
  }

  // ---------------- process control ----------------
  function forceKill(child) {
    try {
      if (!child) return;
      if (deps.platformFn() === 'win32' && child.pid) {
        // /T = tree kill: telegram-bot / ml children bhi (agar hon)
        deps.spawnFn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
      } else {
        // v20.7.8 [M5]: POSIX tree-kill. The child is spawned detached
        // (= own process group leader), so a negative-PID signal kills
        // the WHOLE tree — the forked telegram-bot survives a plain
        // child.kill('SIGKILL') (SIGKILL can't be caught, so the child's
        // own shutdown handler never runs). Direct kill follows as
        // belt-and-braces (also keeps the fake-child kill log honest).
        if (child.pid) {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { /* not a leader / already gone */ }
        }
        child.kill('SIGKILL');
      }
    } catch { /* already dead — exit event will fire */ }
  }

  function startChild() {
    if (state.shuttingDown || state.child || state.installingDeps) return null;
    journal({ ev: 'watchdog-boot', reason: 'child-start', restart: state.restarts });
    log('[watchdog] server start ho raha hai...');
    let child;
    try {
      child = deps.spawnFn(deps.nodeExe, [knobs.childEntry], {
        cwd: deps.appRoot,
        env: { ...env, SMARTAI_SUPERVISED: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        // v20.7.8 [M5]: own process group on POSIX — lets forceKill()
        // tree-kill via negative-PID signal. (Windows: taskkill /T owns
        // the tree; detached there changes console semantics, so off.)
        detached: deps.platformFn() !== 'win32',
      });
    } catch (err) {
      journal({ ev: 'watchdog-crash', reason: 'spawn-fail', detail: String(err && err.message || err).slice(0, 120) });
      log(`[watchdog] child spawn FAIL: ${String(err && err.message || err).slice(0, 120)}`);
      _scheduleRestart('spawn-fail');
      return null;
    }
    state.child = child;
    state.childStartedAt = now();
    state.failsStreak = 0;
    state.pendingReason = null;
    state.upAnnounced = false;
    state.childModuleErr = false;
    // v20.0.1: spawn hone pe "UP" nahi bolte — crash pe jhootha lagta
    // tha. UP tab bolte hain jab pehla /api/ping OK ho (onProbeResult).
    log(`[watchdog] server START (pid ${child.pid}) — pehla /api/ping OK milte hi UP kahenge`);
    _relayChild(child);
    try {
      child.on('error', (err) => {
        if (state.shuttingDown) return;
        journal({ ev: 'watchdog-crash', reason: 'spawn-error', detail: String(err && err.code || err).slice(0, 80) });
        state.child = null;
        _scheduleRestart('spawn-error');
      });
      child.on('exit', (code, signal) => _onChildExit(code, signal));
    } catch { /* wiring never fatal */ }
    return child;
  }

  function _onChildExit(code, signal) {
    if (state.shuttingDown) return; // stop() owns the journal
    const uptimeMs = now() - state.childStartedAt;
    if (uptimeMs >= knobs.stableResetMs) {
      state.backoffDelayMs = knobs.backoffBaseMs; // stable run — reset backoff
    }
    // verdict: 'freeze' | 'boot-hang' (journal already written before the
    // kill) | null = plain crash exit (journal HERE).
    const verdict = state.pendingReason;
    const wasModuleErr = state.childModuleErr && !verdict;
    if (!verdict) {
      journal({
        ev: 'watchdog-restart',
        reason: wasModuleErr ? `deps-missing(exit(${signal || code}))` : `exit(${signal || code})`,
        code, signal, uptimeSec: Math.round(uptimeMs / 1000),
      });
    }
    log(`[watchdog] server band hua (${signal || `code ${code}`}) — uptime ${Math.round(uptimeMs / 1000)}s`);
    if (wasModuleErr) {
      // v20.0.1 HONEST diagnosis: dependency missing thi (node_modules
      // adha ya gayab — fresh install bina npm install). "port conflict"
      // hint is case me galat tha.
      state.childModuleErr = false;
      if (knobs.autoInstall && state.depsInstallTries < 2) {
        log('[watchdog] reason pakda gaya: DEPENDENCY MISSING (node_modules me package nahi mila) — npm install auto chal raha hai...');
        _depsRecoveryRestart();
      } else {
        log('[watchdog] reason pakda gaya: DEPENDENCY MISSING. Auto-install off/limit — khud chalao: app folder me "npm install --omit=dev" phir watchdog dobara chalao.');
        _scheduleRestart('deps-missing', 60000);
      }
    } else {
      if (!verdict && uptimeMs < 10000) {
        log('[watchdog] boot ke 10s ke andar crash — port conflict (kya 8080 pe dusra instance?) ya config issue. Console output upar dekho.');
      }
      _scheduleRestart(verdict || `exit(${signal || code})`);
    }
    state.child = null;
    state.pendingReason = null;
    state.failsStreak = 0;
  }

  // v20.0.1: module-err crash ke baad — deps install karo, PHIR restart
  // schedule karo (install ke dauran tick/startChild blocked = race-free).
  async function _depsRecoveryRestart() {
    try {
      await ensureDeps();
    } catch { /* never fatal */ }
    if (state.shuttingDown) return;
    _scheduleRestart('deps-missing');
  }

  function _scheduleRestart(reason, delayOverride) {
    if (state.shuttingDown) return;
    const t = now();
    const hourAgo = t - 3600000;
    state.restartHistory = state.restartHistory.filter((x) => x > hourAgo);
    if (state.restartHistory.length >= knobs.maxRestartsHour) {
      if (state.budgetPausedUntil <= t) {
        state.budgetPausedUntil = t + knobs.budgetPauseMs;
        state.budgetBannerShown = false;
        journal({ ev: 'watchdog-budget-pause', reason: 'restart-budget', restarts: state.restarts });
        log(`[watchdog] RESTART BUDGET khatam (${knobs.maxRestartsHour}/hour) — ${Math.round(knobs.budgetPauseMs / 60000)} min ruk kar wapas khud start hoga.`);
      }
    }
    const delay = delayOverride != null ? delayOverride : state.backoffDelayMs;
    if (delayOverride == null) state.backoffDelayMs = Math.min(state.backoffDelayMs * 2, knobs.backoffMaxMs);
    state.nextRestartAt = t + delay;
    state.restartHistory.push(t);
    state.restarts++;
    log(`[watchdog] restart #${state.restarts} ${Math.round(delay / 1000)}s baad (${reason})`);
  }

  function _restartTick() {
    if (state.shuttingDown || !state.started) return;
    if (state.child || state.installingDeps) return;
    const t = now();
    if (state.budgetPausedUntil > t) {
      if (!state.budgetBannerShown) {
        state.budgetBannerShown = true;
        log(`[watchdog] budget pause active — ${Math.round((state.budgetPausedUntil - t) / 1000)}s baad resume.`);
      }
      return;
    }
    if (state.nextRestartAt && t >= state.nextRestartAt) {
      state.nextRestartAt = 0;
      startChild();
    }
  }

  // ---------------- liveness probe ----------------
  function probeOnce() {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok, why) => { if (!settled) { settled = true; resolve({ ok, why }); } };
      let req;
      try {
        req = deps.httpGetFn({
          host: '127.0.0.1', port: knobs.port, path: '/api/ping',
          timeout: knobs.timeoutMs, agent: false,
        }, (res) => {
          try { res.resume(); } catch { /* noop */ }
          const onDone = () => finish(
            res.statusCode >= 200 && res.statusCode < 500,
            `status-${res.statusCode}`,
          );
          res.on('end', onDone);
          res.on('error', () => finish(false, 'res-error'));
        });
      } catch (err) {
        finish(false, `throw-${String(err && err.code || err).slice(0, 40)}`);
        return;
      }
      if (!req || typeof req.on !== 'function') { finish(false, 'no-request'); return; }
      req.on('timeout', () => { try { req.destroy(); } catch { /* noop */ } finish(false, 'timeout'); });
      req.on('error', (err) => finish(false, String(err && err.code || 'error').slice(0, 40)));
    });
  }

  function onProbeResult(result) {
    const t = now();
    if (!state.child) { state.failsStreak = 0; return; } // restart gap — nothing to judge
    if (result.ok) {
      if (!state.upAnnounced && state.child && state.child.pid) {
        state.upAnnounced = true;
        log(`[watchdog] server UP (pid ${state.child.pid}) — /api/ping OK, aage har ${Math.round(knobs.probeMs / 1000)}s probe`);
      }
      if (state.failsStreak > 0) {
        log(`[watchdog] probe OK wapas (fail-streak ${state.failsStreak} khatam)`);
      }
      state.failsStreak = 0;
      return;
    }
    state.failsStreak++;
    const uptimeMs = t - state.childStartedAt;
    const inGrace = uptimeMs < knobs.graceMs;
    if (state.failsStreak === 1) {
      log(`[watchdog] probe FAIL #1 (${result.why}) — dekh rahe hain`);
    }
    const hangLimit = knobs.fails + 3;
    if (state.failsStreak >= hangLimit && inGrace) {
      // boot grace ke bhi andar itne fails = child kabhi UP hi nahi hua
      journal({
        ev: 'watchdog-restart', reason: 'boot-hang',
        detail: `${state.failsStreak} probe fail boot grace ke andar (server kabhi UP nahi hua)`,
        childPid: state.child.pid, uptimeSec: Math.round(uptimeMs / 1000),
      });
      log('[watchdog] BOOT HANG detected — force restart');
      state.pendingReason = 'boot-hang';
      forceKill(state.child);
      return;
    }
    if (state.failsStreak >= knobs.fails && !inGrace) {
      journal({
        ev: 'watchdog-restart', reason: 'freeze',
        detail: `${state.failsStreak} consecutive probe fail (event-loop unresponsive)`,
        childPid: state.child.pid, uptimeSec: Math.round(uptimeMs / 1000),
      });
      log('[watchdog] SERVER HANG (FREEZE) detected — force-kill + restart kar rahe hain');
      state.pendingReason = 'freeze';
      forceKill(state.child);
    }
  }

  // ---------------- v20.0.1 dependency self-heal ----------------
  // v20.0.1: ye 5 dependencies SIRF frontend BUILD time pe chahiye
  // (dist/ pehle se built + shipped hai) — runtime pe server inhe
  // kabhi import nahi karta. Offline node_modules bundle me ye nahi
  // hote (zip ~4x chhota), isliye audit inhe skip karta hai. Naya/
  // unknown package.json dep -> hamesha check hoga (fail-safe).
  const FRONTEND_BUILD_ONLY = new Set([
    'react', 'react-dom', 'lucide-react', 'motion', 'lightweight-charts',
  ]);

  function _missingDeps() {
    try {
      const pkgFile = deps.fsMod.readFileSync(path.join(deps.appRoot, 'package.json'), 'utf8');
      const depsList = Object.keys(JSON.parse(pkgFile).dependencies || {})
        .filter((name) => !FRONTEND_BUILD_ONLY.has(name));
      const missing = [];
      for (const name of depsList) {
        const dir = path.join(deps.appRoot, 'node_modules', ...name.split('/'));
        if (!deps.fsMod.existsSync(dir)) missing.push(name);
      }
      return missing;
    } catch {
      return []; // package.json na mile = fixture/legacy layout — audit skip
    }
  }

  function _runNpmInstall() {
    return new Promise((resolve) => {
      const isWin = deps.platformFn() === 'win32';
      const npmCmd = isWin ? 'npm.cmd' : 'npm';
      const args = ['install', '--omit=dev', '--omit=optional', '--no-audit', '--no-fund', '--loglevel=error'];
      let child;
      try {
        child = deps.spawnFn(npmCmd, args, {
          cwd: deps.appRoot,
          env: { ...env, npm_config_loglevel: 'error' },
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: isWin, // win32 pe npm.cmd shell se hi resolve hota hai
        });
      } catch (err) {
        resolve({ ok: false, code: `spawn-fail:${String(err && err.code || err).slice(0, 60)}` });
        return;
      }
      if (!child || typeof child.on !== 'function') {
        resolve({ ok: false, code: 'no-child' });
        return;
      }
      const relay = (isErr) => {
        let buf = '';
        return (d) => {
          try {
            buf += String(d || '');
            let idx;
            while ((idx = buf.indexOf('\n')) >= 0) {
              const line = buf.slice(0, idx).replace(/\r$/, '').trim();
              buf = buf.slice(idx + 1);
              if (line) log(`[npm] ${isErr ? 'ERR ' : ''}${line}`);
            }
          } catch { /* never fatal */ }
        };
      };
      try {
        if (child.stdout && child.stdout.on) child.stdout.on('data', relay(false));
        if (child.stderr && child.stderr.on) child.stderr.on('data', relay(true));
      } catch { /* never fatal */ }
      let settled = false;
      const t = setTimeout(() => {
        try { child.kill(); } catch { /* noop */ }
        if (isWin && child.pid) {
          try { deps.spawnFn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' }); } catch { /* noop */ }
        }
        finish({ ok: false, code: 'timeout' });
      }, knobs.installTimeoutMs);
      const finish = (r) => { if (!settled) { settled = true; clearTimeout(t); resolve(r); } };
      try {
        child.on('error', (err) => finish({ ok: false, code: `npm-spawn-error:${String(err && err.code || err).slice(0, 40)}` }));
        child.on('exit', (code2) => finish({ ok: code2 === 0, code: String(code2) }));
      } catch { finish({ ok: false, code: 'wire-fail' }); }
    });
  }

  async function ensureDeps() {
    if (!knobs.autoInstall) return { ok: true, skipped: 'auto-install-off' };
    const missing = _missingDeps();
    if (!missing.length) return { ok: true, missing: [] };
    if (state.depsInstallTries >= 2) {
      log(`[watchdog] deps phir missing hain (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ` +${missing.length - 3}` : ''}) — auto-install limit (2) hit. Khud chalao: "npm install" (${deps.appRoot} me), phir watchdog restart.`);
      return { ok: false, missing, gaveUp: true };
    }
    state.depsInstallTries++;
    state.installingDeps = true;
    journal({ ev: 'watchdog-deps-install', reason: 'missing-node-modules', missing: missing.slice(0, 8) });
    log(`[watchdog] node_modules missing hai (${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ` +${missing.length - 4} aur` : ''}) — npm install chal raha hai (internet chahiye, 1-3 min, max ${Math.round(knobs.installTimeoutMs / 60000)} min)...`);
    const r = await _runNpmInstall();
    state.installingDeps = false;
    if (r.ok) {
      const still = _missingDeps();
      if (still.length) {
        log(`[watchdog] npm install ke BAAD bhi missing: ${still.join(', ')} — package.json / Node version check karo (Node >= 20 chahiye).`);
        return { ok: false, missing: still };
      }
      log('[watchdog] npm install complete — saari dependencies ready. Server start ho raha hai...');
      return { ok: true, missing: [] };
    }
    log(`[watchdog] npm install FAIL (${r.code}) — internet/proxy check karo. Bina deps ke try kar rahe hain (crash ka honest reason upar aayega).`);
    return { ok: false, code: r.code, missing };
  }

  // ---------------- lifecycle ----------------
  function start() {
    if (state.started || state.shuttingDown) return;
    state.started = true;
    log('============================================================');
    log(' SMARTAI v20.0.1 ANTI-FREEZE SUPERVISOR (v19.2 engine)');
    log(`  child : ${deps.nodeExe} server${path.sep}index.js (SMARTAI_SUPERVISED=1)`);
    log(`  probe : /api/ping har ${Math.round(knobs.probeMs / 1000)}s (timeout ${Math.round(knobs.timeoutMs / 1000)}s, fails ${knobs.fails}, grace ${Math.round(knobs.graceMs / 1000)}s)`);
    log('  hang  : FREEZE = force-kill + restart | crash = backoff restart');
    log(`  budget: ${knobs.maxRestartsHour}/hour (phir ${Math.round(knobs.budgetPauseMs / 60000)} min pause)`);
    log(`  log   : ${knobs.logFilePath || 'off (console only)'} | journal: ${knobs.journalFile}`);
    log(knobs.autoInstall
      ? '  deps  : AUTO npm-install ON (node_modules missing ho to khud lagayega)'
      : '  deps  : auto npm-install OFF (WATCHDOG_AUTO_INSTALL=0)');
    log('  ye window khuli rakho (minimize OK). Ctrl+C = clean band.');
    log('============================================================');
    _boot();
    if (knobs.probesOn) {
      state.probeTimer = setInterval(() => {
        probeOnce().then((r) => { try { onProbeResult(r); } catch { /* never fatal */ } }).catch(() => { /* probe never fatal */ });
      }, knobs.probeMs);
    }
    state.tickTimer = setInterval(_restartTick, 1000);
    // v19.2 CRITICAL: these timers must keep the event loop REF'd. A
    // watchdog that dies when its child dies is no watchdog — with
    // unref'd timers the loop empties the moment the child's stdio pipes
    // close, the process silently exits, and the scheduled restart NEVER
    // fires (found live in smoke: "restart #1 3s baad" logged, then the
    // process was gone). Only exit paths are SIGINT/SIGTERM -> stop().
  }

  // v20.0.1: boot = deps audit (+ auto npm install) THEN child. Install
  // ke dauran tick/startChild blocked hain, isliye koi race nahi.
  async function _boot() {
    try {
      await ensureDeps();
    } catch { /* never fatal */ }
    if (state.shuttingDown) return;
    startChild();
  }

  async function stop() {
    if (state.shuttingDown) return;
    state.shuttingDown = true;
    try { clearInterval(state.probeTimer); } catch { /* noop */ }
    try { clearInterval(state.tickTimer); } catch { /* noop */ }
    const child = state.child;
    if (child) {
      log('[watchdog] clean shutdown — child ko graceful window (8s)...');
      if (deps.platformFn() !== 'win32') {
        // Windows: shared console ctrl event pehle hi child ko SIGINT de
        // chuka hoga — hard-kill race se bachne ke liye forward skip.
        try { child.kill('SIGTERM'); } catch { /* noop */ }
      }
      await new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode) return resolve();
        const t = setTimeout(() => { forceKill(child); resolve(); }, 8000);
        child.on('exit', () => { clearTimeout(t); resolve(); });
      });
      state.child = null;
    }
    journal({ ev: 'watchdog-clean-shutdown', reason: 'supervisor-stop' });
    log('[watchdog] supervisor band. Site wapas laane ke liye Start-SmartAI-Watchdog.bat dobara chalao.');
  }

  return {
    start,
    stop,
    _i: {
      state, knobs, deps,
      probeOnce, onProbeResult, startChild, _restartTick,
      _scheduleRestart, _onChildExit, forceKill, journal,
      _emitLine, _appendLog,
      ensureDeps, _missingDeps, _runNpmInstall,
    },
  };
}

// ---------------- CLI entry ----------------
export async function run(opts = {}) {
  const sup = createSupervisor(opts);

  // QuickEdit guard: supervisor apne console pe bhi fire karta hai —
  // child + supervisor dono isi shared console me likhte hain, ek hi
  // call dono ko freeze-vector se bachati hai. Best-effort, silent-fail.
  try {
    const r = await disableQuickEditMode({ env: process.env });
    if (r.attempted) {
      process.stdout.write(`[watchdog] QuickEdit console guard: ${r.disabled ? 'ON' : 'SKIPPED'} (${r.reason})\n`);
    }
  } catch { /* never fatal */ }

  // Supervisor ko KABHI internal error pe mat maro — watchdog marta
  // hai to poora protection khatam.
  process.on('uncaughtException', (err) => {
    try { process.stdout.write(`[watchdog] internal error (ZINDA RAHE HAIN): ${String(err && err.message || err).slice(0, 160)}\n`); } catch { /* noop */ }
  });
  process.on('unhandledRejection', (reason) => {
    try { process.stdout.write(`[watchdog] unhandled rejection (ignored): ${String(reason).slice(0, 160)}\n`); } catch { /* noop */ }
  });

  let _stopping = false;
  const stop2 = async () => {
    if (_stopping) return;
    _stopping = true;
    try { await sup.stop(); } catch { /* noop */ }
    process.exit(0);
  };
  process.on('SIGINT', () => { stop2(); });
  process.on('SIGTERM', () => { stop2(); });

  sup.start();
  return sup;
}

const __isMain = (() => {
  try {
    return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch { return false; }
})();

if (__isMain) {
  run().catch((err) => {
    try { process.stderr.write(`[watchdog] FATAL boot: ${String(err && err.stack || err).slice(0, 400)}\n`); } catch { /* noop */ }
    process.exit(1);
  });
}
