#!/usr/bin/env node
// ============================================================
// server/layaSidecar.js — v21.4.0 LAYA SIDECAR (watchdog-managed
//                                                local AI)
// ------------------------------------------------------------
// MAQSAD: Start-SmartAI-Watchdog.bat double-click karte hi site
// + Laya (local open-weight AI) DONO up hon, aur Laya ko bhi site
// jaisa protection mile: auto-restart, hang detect, clean shutdown.
//
// KYA NAHI hai (safety ground-rules, dual-provider plan §3.1):
//   * Site kabhi Laya ka intezaar NAHI karti — sidecar pure
//     parallel chalta hai; Laya band = AI layer kam, trading
//     untouched (Bot Lab `laya` arm WAIT, `auto` arm Jev failover,
//     board AI-confirm NEUTRAL — kabhi "AI ke bina approve" nahi).
//   * Sidecar ka koi failure supervisor ko kabhi nahi maarta —
//     har path try/catch me hai (v19.2 supervisor ground-rule).
//   * Autostart SIRF loopback (127.0.0.1) base URL par — ek remote
//     LAYA_BASE_URL par spawn/adopt karna security anti-pattern hai.
//
// BEHAVIOUR (plan §3.1, supervisor jaisa):
//   1. ADOPT, double nahi — start par /health 200 de raha ho to
//      spawn nahi (owned=false); haath se chalayi window bhi chalegi.
//      stop() adopted process ko KABHI nahi maarta.
//   2. SPAWN — laya-serve exe env ke saath (windowsHide), stdout/stderr
//      line-relay `[laya] ...` prefix se. API key logs me KABHI nahi
//      (har relay line mask hoti hai).
//   3. READY POLL — /health; pehli baar lamba timeout (weights
//      download), baad me chhota. Ready hone par `laya-ready {ms}`.
//   4. HANG — ready ke baad 3 consecutive /health fail (3s timeout,
//      LAYA_PROBE_MS interval) → tree-kill + restart.
//   5. CRASH — exit par backoff restart 5s → 60s cap; 10 restarts/
//      hour ke baad 10 min budget pause (supervisor jaisa).
//   6. KILL — win32 `taskkill /F /T /PID`, POSIX negative-PID group
//      kill (supervisor ka forceKill pattern).
//   7. GIVE-UP — exe na mile to ek saaf message + `laya-giveup`
//      journal, crash-loop NAHI.
//
// SUPERVISOR SUP khud .env load NAHI karta (dotenv-free boot
// ground-rule) — isliye LAYA_* keys ek chhote parser se app/.env me
// se alag padhe jaate hain (comments/quotes/CRLF/BOM handle). Real
// process-env hamesha jeet-ta hai (dotenv parity: child bhi
// dotenv/config se yehi precedence dekhta hai).
//
// env knobs (defaults):
//   LAYA_AUTOSTART=1        — supervisor-managed on (default off)
//   LAYA_ENABLED=1          — site flag (zaroori)
//   LAYA_API_KEY=…          — zaroori (server + serve dono same)
//   LAYA_BASE_URL=http://127.0.0.1:8000
//   LAYA_HOME=C:\laya-env   — venv; exe = Scripts\laya-serve.exe
//                             (POSIX: bin/laya-serve)
//   LAYA_SERVE_CMD=         — full exe path override (optional)
//   LAYA_MODELS=english     LAYA_DEFAULT_MODEL=english
//   LAYA_DEVICE=cpu         LAYA_PRELOAD=1
//   LAYA_THREADS=           — auto = physical cores − 2 (min 1)
//   LAYA_READY_TIMEOUT_MS=900000 (first) / 180000 (later)
//   LAYA_PROBE_MS=30000     LAYA_PROBE_TIMEOUT_MS=3000
//   LAYA_BACKOFF_BASE_MS=5000  LAYA_BACKOFF_MAX_MS=60000
//   LAYA_MAX_RESTARTS_HOUR=10  LAYA_BUDGET_PAUSE_MS=600000
// ============================================================
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function _int(val, def, min, max) {
  // supervisor _int() ki hi semantics — out-of-range = garbage, not
  // silently-clamped dangerous value.
  const n = parseInt(val, 10);
  if (!Number.isFinite(n) || n < min || n > max) return def;
  return n;
}

function _flag(val) {
  return String(val ?? '').trim() === '1';
}

/**
 * v21.4.0 mini .env parser — sirf supervisor-layer LAYA_* keys ke
 * liye. Comments (#), quoted values ("v"/'v'), CRLF aur BOM handle
 * karta hai; blank values honestly '' rehti hain. dotenv ki precedence
 * mirror: real env jeet-ta hai, .env gaps bharta hai.
 */
export function parseDotEnvKeys(text, prefix = 'LAYA_') {
  const out = {};
  if (!text) return out;
  let t = String(text);
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1); // BOM strip
  for (const raw of t.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key.startsWith(prefix)) continue;
    let val = line.slice(eq + 1).trim();
    // inline comment strip — sirf unquoted values me (quoted value ke
    // andar # legal hai)
    const q = val[0];
    if (q !== '"' && q !== "'") {
      const hash = val.indexOf(' #');
      if (hash >= 0) val = val.slice(0, hash).trim();
    }
    if ((q === '"' || q === "'") && val.endsWith(q) && val.length >= 2) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/** LAYA_BASE_URL → { host, port, loopback } (URL class, honest fallback). */
export function parseBaseUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return { host: '127.0.0.1', port: 8000, loopback: true }; }
  const host = u.hostname || '127.0.0.1';
  const port = parseInt(u.port || '8000', 10) || 8000;
  return { host, port, loopback: LOOPBACK_HOSTS.has(host) };
}

/**
 * Factory (injectable deps for tests — supervisorGuard pattern).
 * Returns { start, stop, status, _i } — _i internals expose karta hai.
 *
 * @param {object} opts { env, appRoot, log, journal, deps }
 *   deps: { spawnFn, httpGetFn, fsMod, platformFn, nowFn, osMod }
 */
export function createLayaSidecar(opts = {}) {
  const env = opts.env || process.env;
  const appRoot = opts.appRoot || process.cwd();
  const deps = {
    spawnFn: opts.deps?.spawnFn || spawn,
    httpGetFn: opts.deps?.httpGetFn || ((...a) => http.get(...a)),
    fsMod: opts.deps?.fsMod || fs,
    platformFn: opts.deps?.platformFn || (() => process.platform),
    nowFn: opts.deps?.nowFn || (() => Date.now()),
    osMod: opts.deps?.osMod || os,
    // injectable timers — unit tests real intervals leak nahi karte
    setIntervalFn: opts.deps?.setIntervalFn || ((...a) => setInterval(...a)),
    clearIntervalFn: opts.deps?.clearIntervalFn || ((...a) => clearInterval(...a)),
    setTimeoutFn: opts.deps?.setTimeoutFn || ((...a) => setTimeout(...a)),
    clearTimeoutFn: opts.deps?.clearTimeoutFn || ((...a) => clearTimeout(...a)),
  };

  // ---------- config: real env > app/.env (LAYA_* only) ----------
  let dotEnv = {};
  try {
    dotEnv = parseDotEnvKeys(deps.fsMod.readFileSync(path.join(appRoot, '.env'), 'utf8'));
  } catch { /* .env optional hai — env-only config bhi valid */ }
  const val = (key) => (Object.prototype.hasOwnProperty.call(env, key) ? env[key] : dotEnv[key]);

  const baseRaw = String(val('LAYA_BASE_URL') || 'http://127.0.0.1:8000');
  const parsedBase = parseBaseUrl(baseRaw);

  const cfg = {
    autostart: _flag(val('LAYA_AUTOSTART')),
    enabled: _flag(val('LAYA_ENABLED')),
    apiKey: String(val('LAYA_API_KEY') || ''),
    baseUrl: baseRaw,
    host: parsedBase.host,
    port: parsedBase.port,
    loopback: parsedBase.loopback,
    home: String(val('LAYA_HOME') || 'C:\\laya-env'),
    serveCmd: String(val('LAYA_SERVE_CMD') || ''),
    models: String(val('LAYA_MODELS') || 'english'),
    defaultModel: String(val('LAYA_DEFAULT_MODEL') || 'english'),
    device: String(val('LAYA_DEVICE') || 'cpu'),
    preload: String(val('LAYA_PRELOAD') || '1'),
    threads: (() => {
      const t = parseInt(String(val('LAYA_THREADS') || ''), 10);
      if (Number.isFinite(t) && t >= 1) return t;
      // auto = physical cores − 2 (logical/2 heuristic), site ko CPU bacha ke
      try {
        const logical = (deps.osMod.cpus() || []).length || 2;
        return Math.max(1, Math.floor(logical / 2) - 2);
      } catch { return 1; }
    })(),
    readyFirstMs: _int(val('LAYA_READY_TIMEOUT_MS'), 900000, 5000, 86400000),
    readyLaterMs: _int(val('LAYA_READY_LATER_TIMEOUT_MS'), 180000, 5000, 86400000),
    probeMs: _int(val('LAYA_PROBE_MS'), 30000, 3000, 600000),
    probeTimeoutMs: _int(val('LAYA_PROBE_TIMEOUT_MS'), 3000, 500, 30000),
    backoffBaseMs: _int(val('LAYA_BACKOFF_BASE_MS'), 5000, 1000, 600000),
    backoffMaxMs: _int(val('LAYA_BACKOFF_MAX_MS'), 60000, 4000, 900000),
    maxRestartsHour: _int(val('LAYA_MAX_RESTARTS_HOUR'), 10, 2, 1000),
    budgetPauseMs: _int(val('LAYA_BUDGET_PAUSE_MS'), 600000, 10000, 86400000),
  };

  const st = {
    started: false,
    shuttingDown: false,
    // 'idle' = created but not started; start() ke baad hi meaningful
    // phase aati hai (disabled|off|refused|adopted|starting|ready|
    // restarting|paused|gave-up). 'idle' ko 'disabled' se alag rakha
    // hai WARN: dono ka matlab alag hai (idle = start hua hi nahi).
    phase: 'idle',
    owned: false,
    child: null,
    spawnedAt: 0,
    hasEverReady: false,
    readyMs: null,
    restarts: 0,
    restartHistory: [],
    backoffDelayMs: cfg.backoffBaseMs,
    nextRestartAt: 0,
    budgetPausedUntil: 0,
    failStreak: 0,
    lastProbeAt: 0,
    lastProbeResult: null,
    tickTimer: null,
  };

  const now = () => deps.nowFn();

  function log(line) {
    try { (opts.log || ((l) => { try { process.stdout.write(l + '\n'); } catch { /* frozen console */ } }))(String(line)); } catch { /* never fatal */ }
  }

  function journal(entry) {
    try { (opts.journal || (() => { }))(entry); } catch { /* never fatal */ }
  }

  function status() {
    return {
      autostart: cfg.autostart,
      enabled: cfg.enabled,
      configured: Boolean(cfg.enabled && cfg.apiKey),
      phase: st.phase,
      owned: st.owned,
      pid: st.child?.pid || null,
      baseUrl: cfg.baseUrl,
      host: cfg.host,
      port: cfg.port,
      readyMs: st.readyMs,
      restarts: st.restarts,
      failStreak: st.failStreak,
    };
  }

  // ---------- .env read helper for tests ----------
  function _reloadDotEnv() {
    try {
      dotEnv = parseDotEnvKeys(deps.fsMod.readFileSync(path.join(appRoot, '.env'), 'utf8'));
    } catch { dotEnv = {}; }
  }

  // ---------- health probe (supervisor probeOnce pattern) ----------
  function healthCheck(timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok, why) => { if (!settled) { settled = true; resolve({ ok, why }); } };
      let req;
      try {
        req = deps.httpGetFn({
          host: cfg.host, port: cfg.port, path: '/health',
          timeout: timeoutMs, agent: false,
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

  // ---------- kill (supervisor forceKill pattern) ----------
  function forceKill(child) {
    try {
      if (!child) return;
      if (deps.platformFn() === 'win32' && child.pid) {
        deps.spawnFn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
      } else {
        if (child.pid) {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { /* not a leader / already gone */ }
        }
        child.kill('SIGKILL');
      }
    } catch { /* already dead — exit event will fire */ }
  }

  // ---------- stdout/stderr relay — [laya] prefix + key mask ----------
  function _mask(line) {
    const s = String(line);
    if (cfg.apiKey && cfg.apiKey.length >= 8) {
      return s.split(cfg.apiKey).join('***MASKED***');
    }
    return s;
  }

  function _relay(child) {
    const mk = (isErr) => {
      let buf = '';
      const handler = (d) => {
        try {
          buf += String(d || '');
          let idx;
          while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx).replace(/\r$/, '');
            buf = buf.slice(idx + 1);
            if (line.trim()) log(`[laya]${isErr ? ' ERR' : ''} ${_mask(line)}`);
          }
        } catch { /* relay never fatal */ }
      };
      handler.flush = () => {
        try {
          if (buf.trim()) log(`[laya]${isErr ? ' ERR' : ''} ${_mask(buf.replace(/\r$/, ''))}`);
          buf = '';
        } catch { /* never fatal */ }
      };
      return handler;
    };
    const outH = mk(false);
    const errH = mk(true);
    try {
      child.stdout?.on?.('data', outH);
      child.stderr?.on?.('data', errH);
      child.on?.('exit', () => { try { outH.flush(); errH.flush(); } catch { /* noop */ } });
    } catch { /* relay never fatal */ }
  }

  // ---------- exe resolution ----------
  function _exePath() {
    if (cfg.serveCmd) return cfg.serveCmd;
    const home = cfg.home || 'C:\\laya-env';
    return deps.platformFn() === 'win32'
      ? path.join(home, 'Scripts', 'laya-serve.exe')
      : path.join(home, 'bin', 'laya-serve');
  }

  function _exeMissing() {
    try { return !deps.fsMod.existsSync(_exePath()); } catch { return true; }
  }

  // ---------- restart accounting (supervisor pattern) ----------
  function _scheduleRestart(reason) {
    if (st.shuttingDown) return;
    const t = now();
    const hourAgo = t - 3600000;
    st.restartHistory = st.restartHistory.filter((x) => x > hourAgo);
    if (st.restartHistory.length >= cfg.maxRestartsHour) {
      if (st.budgetPausedUntil <= t) {
        st.budgetPausedUntil = t + cfg.budgetPauseMs;
        journal({ ev: 'laya-budget-pause', reason: 'restart-budget', restarts: st.restarts });
        log(`[laya] RESTART BUDGET khatam (${cfg.maxRestartsHour}/hour) — ${Math.round(cfg.budgetPauseMs / 60000)} min pause, phir khud wapas.`);
      }
      st.phase = 'paused';
    }
    const delay = st.backoffDelayMs;
    st.backoffDelayMs = Math.min(st.backoffDelayMs * 2, cfg.backoffMaxMs);
    st.nextRestartAt = t + delay;
    st.restartHistory.push(t);
    st.restarts++;
    if (st.phase !== 'paused') st.phase = 'restarting';
    log(`[laya] restart #${st.restarts} ${Math.round(delay / 1000)}s baad (${reason})`);
  }

  // ---------- spawn ----------
  function _spawn() {
    if (st.shuttingDown || st.child) return null;
    if (_exeMissing()) {
      st.phase = 'gave-up';
      journal({ ev: 'laya-giveup', reason: 'exe-not-found', exe: _exePath() });
      log(`[laya] laya-serve nahi mila (${_exePath()}) — LAYA_HOME check karo (dir C:\\laya-env\\Scripts\\laya-serve.exe hona chahiye) ya LAYA_SERVE_CMD set karo. Sidecar band; site normal chalegi.`);
      return null;
    }
    journal({ ev: 'laya-start', reason: 'spawn', exe: _exePath(), port: cfg.port });
    log(`[laya] start ho raha hai (${_exePath()} :${cfg.port}) — pehli baar weights load me kuch min lag sakte hain.`);
    let child;
    try {
      child = deps.spawnFn(_exePath(), [], {
        cwd: appRoot,
        env: {
          ...env,
          LAYA_HOST: cfg.host,
          LAYA_PORT: String(cfg.port),
          LAYA_MODELS: cfg.models,
          LAYA_DEFAULT_MODEL: cfg.defaultModel,
          LAYA_DEVICE: cfg.device,
          LAYA_PRELOAD: cfg.preload,
          LAYA_THREADS: String(cfg.threads),
          LAYA_API_KEY: cfg.apiKey,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        // POSIX: own process group — forceKill negative-PID tree-kill ke liye
        detached: deps.platformFn() !== 'win32',
      });
    } catch (err) {
      journal({ ev: 'laya-crash', reason: 'spawn-fail', detail: String(err && err.message || err).slice(0, 120) });
      log(`[laya] spawn FAIL: ${String(err && err.message || err).slice(0, 120)}`);
      _scheduleRestart('spawn-fail');
      return null;
    }
    st.child = child;
    st.owned = true;
    st.phase = 'starting';
    st.spawnedAt = now();
    st.failStreak = 0;
    _relay(child);
    try {
      child.on('error', (err) => {
        if (st.shuttingDown) return;
        journal({ ev: 'laya-crash', reason: 'spawn-error', detail: String(err && err.code || err).slice(0, 80) });
        st.child = null;
        _scheduleRestart('spawn-error');
      });
      child.on('exit', (code, signal) => {
        if (st.shuttingDown) return; // stop() owns the shutdown journal
        journal({ ev: 'laya-crash', reason: `exit(${signal || code})`, code, signal });
        log(`[laya] process band hua (${signal || `code ${code}`}) — auto-restart backoff me.`);
        st.child = null;
        _scheduleRestart(`exit(${signal || code})`);
      });
    } catch { /* wiring never fatal */ }
    return child;
  }

  // ---------- probe result handler (supervisor onProbeResult pattern) ----------
  function onHealthResult(result) {
    st.lastProbeResult = result;
    const t = now();
    st.lastProbeAt = t;
    if (st.phase === 'starting' && st.child) {
      if (result.ok) {
        const ms = t - st.spawnedAt;
        st.hasEverReady = true;
        st.readyMs = ms;
        st.phase = 'ready';
        st.failStreak = 0;
        journal({ ev: 'laya-ready', ms: Math.round(ms), pid: st.child.pid });
        log(`[laya] READY (${(ms / 1000).toFixed(1)}s me) — /health OK, ab har ${Math.round(cfg.probeMs / 1000)}s probe.`);
        return;
      }
      // still booting — weights download ke liye lamba ready timeout
      const waitMs = st.hasEverReady ? cfg.readyLaterMs : cfg.readyFirstMs;
      if (t - st.spawnedAt > waitMs) {
        journal({
          ev: 'laya-hang-restart', reason: 'boot-not-ready',
          detail: `ready wait ${Math.round(waitMs / 1000)}s se zyada, /health ${result.why}`,
          pid: st.child.pid,
        });
        log('[laya] boot me /health kabhi OK nahi hua (ready timeout) — force-kill + restart.');
        st.phase = 'restarting';
        forceKill(st.child);
      }
      return;
    }
    if (st.phase === 'ready') {
      if (result.ok) {
        if (st.failStreak > 0) log(`[laya] probe OK wapas (fail-streak ${st.failStreak} khatam)`);
        st.failStreak = 0;
        return;
      }
      st.failStreak++;
      if (st.failStreak === 1) log(`[laya] probe FAIL #1 (${result.why}) — dekh rahe hain`);
      if (st.failStreak >= 3) {
        journal({
          ev: 'laya-hang-restart', reason: 'freeze',
          detail: `${st.failStreak} consecutive probe fail (hung/unhealthy)`,
          pid: st.child?.pid,
        });
        log('[laya] HANG detected (3 probe fail) — force-kill + restart kar rahe hain.');
        st.phase = 'restarting';
        forceKill(st.child);
      }
    }
  }

  // ---------- 1s tick (supervisor _restartTick pattern) ----------
  function _tick() {
    if (st.shuttingDown || !st.started) return;
    const t = now();
    if (st.phase === 'paused') {
      if (t >= st.budgetPausedUntil) {
        st.phase = 'restarting';
        st.nextRestartAt = t;
        log('[laya] budget pause khatam — wapas try kar rahe hain.');
      } else {
        return;
      }
    }
    if (st.phase === 'restarting' && t >= st.nextRestartAt) {
      _spawn();
      return;
    }
    if ((st.phase === 'starting' || st.phase === 'ready') && t - st.lastProbeAt >= cfg.probeMs) {
      st.lastProbeAt = t;
      healthCheck(cfg.probeTimeoutMs)
        .then((r) => { try { onHealthResult(r); } catch { /* never fatal */ } })
        .catch(() => { /* probe never fatal */ });
    }
  }

  // ---------- start: adopt ya spawn (site kabhi block nahi) ----------
  async function _initFlow() {
    if (st.phase === 'disabled' || st.phase === 'off' || st.phase === 'refused') return;
    const r = await healthCheck(2000);
    if (r.ok) {
      st.phase = 'adopted';
      st.owned = false;
      st.hasEverReady = true;
      journal({ ev: 'laya-adopted', reason: 'health-already-200', baseUrl: cfg.baseUrl });
      log('[laya] pehle se chal raha hai (/health OK) — ADOPT kiya (double spawn nahi). Watchdog band hone par ye wala process nahi maarega.');
      return;
    }
    _spawn();
  }

  function start() {
    const r = _startCore();
    // tick timer sirf meaningful phase me (disabled/off/refused/gave-up/
    // adopted pe zero timers — adopted process user ka apna hai, hum usse
    // probe/kill nahi karte; supervisorGuard-style tests me createSupervisor
    // per-test banate hain, unme sidecar ka koi timer nahi bachna chahiye)
    try {
      if (st.started && !st.shuttingDown && !st.tickTimer
        && !['disabled', 'off', 'refused', 'gave-up', 'adopted'].includes(st.phase)) {
        st.tickTimer = deps.setIntervalFn(_tick, 1000);
      }
    } catch { /* timer never fatal */ }
    return r;
  }

  function _startCore() {
    if (st.started || st.shuttingDown) return null;
    st.started = true;
    st.lastProbeAt = now();
    if (!cfg.autostart) {
      st.phase = 'disabled';
      log('[laya] sidecar off (LAYA_AUTOSTART=1 nahi hai) — Laya haath se chalana hai (purana behaviour).');
      return null;
    }
    if (!cfg.enabled || !cfg.apiKey) {
      st.phase = 'off';
      log('[laya] LAYA_AUTOSTART=1 hai par LAYA_ENABLED=1 + LAYA_API_KEY .env me nahi — sidecar idle (site normal).');
      return null;
    }
    if (!cfg.loopback) {
      st.phase = 'refused';
      journal({ ev: 'laya-giveup', reason: 'non-loopback-base-url', baseUrl: cfg.baseUrl });
      log(`[laya] LAYA_BASE_URL non-loopback hai (${cfg.baseUrl}) — autostart REFUSED (security: sirf 127.0.0.1). Site normal chalegi.`);
      return null;
    }
    log(`[laya] sidecar armed — base ${cfg.baseUrl} | probe ${Math.round(cfg.probeMs / 1000)}s | threads ${cfg.threads} | device ${cfg.device}`);
    // Site kabhi Laya ka intezaar nahi karti — init flow fire-and-forget.
    return _initFlow().catch(() => { /* never fatal */ });
  }

  // ---------- stop: owned tree-kill, adopted untouched ----------
  async function stop() {
    if (st.shuttingDown) return;
    st.shuttingDown = true;
    try { deps.clearIntervalFn(st.tickTimer); } catch { /* noop */ }
    st.tickTimer = null;
    if (!st.started) return; // kabhi start nahi hua — kuch kill nahi karna
    if (!st.owned || !st.child) {
      if (st.phase === 'adopted') log('[laya] adopted process chhod diya (haath se chalaya tha) — Task Manager me zinda rahega.');
      return;
    }
    const child = st.child;
    log('[laya] clean shutdown — process tree kill...');
    forceKill(child);
    await new Promise((resolve) => {
      try {
        if (child.exitCode !== null || child.signalCode) return resolve();
        const t = deps.setTimeoutFn(resolve, 5000);
        child.on('exit', () => { try { deps.clearTimeoutFn(t); } catch { /* noop */ } resolve(); });
      } catch { resolve(); /* already dead */ }
    });
    st.child = null;
    journal({ ev: 'laya-stop', reason: 'sidecar-stop' });
    log('[laya] sidecar band — orphan laya-serve nahi bacha.');
  }

  return {
    start,
    stop,
    status,
    _i: {
      st, cfg, deps, dotEnv,
      parseDotEnvKeys, parseBaseUrl,
      healthCheck, onHealthResult, _tick, _spawn, _initFlow,
      forceKill, _exePath, _exeMissing, _reloadDotEnv, _mask, _scheduleRestart,
    },
  };
}
