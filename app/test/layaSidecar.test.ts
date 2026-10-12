// ============================================================
// test/layaSidecar.test.ts — v21.4.0 LAYA SIDECAR (v21.5.0 me laya-fast
// warmup/device knobs + version-contract update)
// ------------------------------------------------------------
// Locks the full sidecar contract (plan §4 test table):
//   1. AUTOSTART off  -> koi spawn nahi, status 'disabled'
//   2. ADOPT          -> /health 200 par spawn nahi; stop par kill nahi
//   3. SPAWN contract -> exe/args/env (HOST/PORT/MODELS/DEFAULT_MODEL/
//                        DEVICE/PRELOAD/THREADS/API_KEY), windowsHide,
//                        stdio, API key logs me MASKED
//   4. READY POLL     -> healthy hone par 'laya-ready {ms}' journal
//                        (direct handler + _tick-driven health dono)
//   5. HANG           -> ready ke baad 3 consecutive probe fail =
//                        tree-kill + restart ('laya-hang-restart')
//   6. CRASH          -> exit par backoff delays 5s, 10s, 20s, ... <=60s
//   7. BUDGET         -> N restarts/hour ke baad pause + resume
//   8. EXE MISSING   -> 'laya-giveup' + NO crash-loop (zero restarts)
//   9. NON-LOOPBACK   -> autostart REFUSED (security)
//  10. STOP           -> owned = tree-kill; adopted = chhod do
//  11. .ENV PARSER    -> comments, quotes, CRLF, BOM, blank values,
//                        env-over-dotenv precedence
//  12. INTEGRATION    -> supervisor start()/stop() sidecar ko never-
//                        fatally drive karta hai + source contracts
// Hermetic: fake children (EventEmitter), fake httpGet, mutable
// clock, injectable fs + timers (supervisorGuard pattern).
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { EventEmitter } from 'node:events';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(__dirname, '..');
const SERVER_SRC = readFileSync(path.join(APP_ROOT, 'server', 'layaSidecar.js'), 'utf8');
const SUPERVISOR_SRC = readFileSync(path.join(APP_ROOT, 'server', 'supervisor.js'), 'utf8');
const BAT_SRC = readFileSync(path.join(APP_ROOT, 'Start-SmartAI-Watchdog.bat'), 'utf8');

import { createLayaSidecar, parseDotEnvKeys, parseBaseUrl } from '../server/layaSidecar.js';
import { createSupervisor } from '../server/supervisor.js';

// ---------- scaffolding ----------
const API_KEY = 'test-secret-key-32chars-xxxxxxxx';

function fakeChild(pid = 7777) {
  const c: any = new EventEmitter();
  c.pid = pid;
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.exitCode = null;
  c.signalCode = null;
  c.killCalls = [] as string[];
  c.kill = (sig?: string) => { c.killCalls.push(sig || 'default'); return true; };
  return c;
}

let tNow: number;
let entries: any[];
let logs: string[];
let spawnCalls: any[];
let currentChild: any;
let httpSeq: Array<number | null>;
let dotEnvFixture: string | null;
let exeExists: boolean;
let platform: string;

// fake httpGet — statusSeq se deterministic responses; null = refused.
function mkHttp() {
  let i = 0;
  return (_opts: any, cb: any) => {
    const req: any = new EventEmitter();
    req.destroy = () => {};
    const code = httpSeq[Math.min(i++, httpSeq.length - 1)];
    if (code === null) {
      queueMicrotask(() => req.emit('error', Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })));
    } else {
      queueMicrotask(() => {
        const res: any = new EventEmitter();
        res.statusCode = code;
        res.resume = () => {};
        cb(res);
        res.emit('end');
      });
    }
    return req;
  };
}

function mkSidecar(env: any = {}, extraDeps: any = {}) {
  return createLayaSidecar({
    env: {
      LAYA_ENABLED: '1',
      LAYA_API_KEY: API_KEY,
      LAYA_HOME: '/laya',
      ...env,
    },
    appRoot: '/app',
    log: (line: string) => { logs.push(String(line).replace(/\n$/, '')); },
    journal: (e: any) => { entries.push(e); },
    deps: {
      spawnFn: (cmd: string, args: string[], opts: any) => {
        spawnCalls.push({ cmd, args, opts });
        currentChild = fakeChild();
        return currentChild;
      },
      httpGetFn: mkHttp(),
      fsMod: {
        existsSync: (p: any) => exeExists && !String(p).includes('nonexistent'),
        readFileSync: (p: any) => {
          if (String(p).endsWith('.env')) {
            if (dotEnvFixture == null) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
            return dotEnvFixture;
          }
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        },
      },
      platformFn: () => platform,
      nowFn: () => tNow,
      osMod: { cpus: () => new Array(8).fill(0) },
      // v21.5.0: default fake warmup fetch — tests real network ko kabhi
      // nahi chhoote (adopt path ab warmup fire karta hai).
      fetchImpl: async () => ({ status: 200, resume() {} }),
      // injectable timers — real intervals kabhi leak nahi karte
      setIntervalFn: () => 999,
      clearIntervalFn: () => {},
      setTimeoutFn: () => 555,
      clearTimeoutFn: () => {},
      ...extraDeps,
    },
  });
}

const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  tNow = 1_700_000_000_000;
  entries = [];
  logs = [];
  spawnCalls = [];
  currentChild = null;
  httpSeq = [null];
  dotEnvFixture = null;
  exeExists = true;
  platform = 'linux';
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================
// 1-2. autostart gating + adopt
// ============================================================
describe('layaSidecar — AUTOSTART gating + ADOPT', () => {
  it('AUTOSTART off: koi spawn nahi, status disabled, timer nahi', async () => {
    const sc = mkSidecar({ LAYA_AUTOSTART: '0' });
    const r = await sc.start();
    expect(r).toBeNull();
    expect(sc.status().phase).toBe('disabled');
    expect(sc.status().autostart).toBe(false);
    expect(spawnCalls).toHaveLength(0);
    expect(logs.some((l) => l.includes('sidecar off'))).toBe(true);
    await sc.stop();
    expect(spawnCalls).toHaveLength(0);
  });

  it('AUTOSTART on par LAYA_ENABLED/API_KEY nahi: phase off, spawn nahi', async () => {
    const sc = mkSidecar({ LAYA_AUTOSTART: '1', LAYA_API_KEY: '' });
    await sc.start();
    expect(sc.status().phase).toBe('off');
    expect(spawnCalls).toHaveLength(0);
    expect(logs.some((l) => l.includes('LAYA_ENABLED=1 + LAYA_API_KEY'))).toBe(true);
  });

  it('ADOPT: /health pehle se 200 -> spawn nahi; stop par kill nahi', async () => {
    httpSeq = [200];
    const sc = mkSidecar({ LAYA_AUTOSTART: '1' });
    await sc.start();
    expect(sc.status().phase).toBe('adopted');
    expect(sc.status().owned).toBe(false);
    expect(spawnCalls).toHaveLength(0);
    expect(entries.some((e) => e.ev === 'laya-adopted')).toBe(true);
    expect(logs.some((l) => l.includes('ADOPT kiya'))).toBe(true);
    // stop: adopted process ko KABHI nahi maarte
    await sc.stop();
    expect(spawnCalls).toHaveLength(0);
    expect(logs.some((l) => l.includes('adopted process chhod diya'))).toBe(true);
  });

  it('non-loopback LAYA_BASE_URL: autostart REFUSED (security)', async () => {
    const sc = mkSidecar({ LAYA_AUTOSTART: '1', LAYA_BASE_URL: 'http://192.168.1.5:8000' });
    const r = await sc.start();
    expect(r).toBeNull();
    expect(sc.status().phase).toBe('refused');
    expect(spawnCalls).toHaveLength(0);
    const g = entries.find((e) => e.ev === 'laya-giveup');
    expect(g).toBeTruthy();
    expect(g.reason).toBe('non-loopback-base-url');
    expect(logs.some((l) => l.includes('REFUSED'))).toBe(true);
  });
});

// ============================================================
// 3. spawn contract
// ============================================================
describe('layaSidecar — SPAWN contract', () => {
  it('win32: exe path, env vars (HOST/PORT/MODELS/DEFAULT_MODEL/DEVICE/PRELOAD/THREADS/KEY), windowsHide, stdio', async () => {
    platform = 'win32';
    const sc = mkSidecar({ LAYA_AUTOSTART: '1', LAYA_HOME: 'C:\\laya-env', LAYA_THREADS: '3' });
    await sc.start();
    expect(spawnCalls.length).toBeGreaterThanOrEqual(1);
    const sp = spawnCalls[0];
    // win32 branch: <home>\Scripts\laya-serve.exe (path.sep — sandbox linux
    // par / aata hai, real Windows pe \; segments exact lock hote hain)
    expect(sp.cmd).toBe(['C:\\laya-env', 'Scripts', 'laya-serve.exe'].join(path.sep));
    expect(sp.args).toEqual([]);
    expect(sp.opts.windowsHide).toBe(true);
    expect(sp.opts.stdio).toEqual(['ignore', 'pipe', 'pipe']);
    expect(sp.opts.env.LAYA_HOST).toBe('127.0.0.1');
    expect(sp.opts.env.LAYA_PORT).toBe('8000');
    expect(sp.opts.env.LAYA_MODELS).toBe('english');
    expect(sp.opts.env.LAYA_DEFAULT_MODEL).toBe('english');
    expect(sp.opts.env.LAYA_DEVICE).toBe('cpu');
    expect(sp.opts.env.LAYA_PRELOAD).toBe('1');
    expect(sp.opts.env.LAYA_THREADS).toBe('3');
    expect(sp.opts.env.LAYA_API_KEY).toBe(API_KEY);
    expect(sc.status().phase).toBe('starting');
    expect(sc.status().owned).toBe(true);
    expect(entries.some((e) => e.ev === 'laya-start')).toBe(true);
  });

  it('LAYA_THREADS empty = auto (physical cores − 2 heuristic, min 1)', async () => {
    const sc = mkSidecar({ LAYA_AUTOSTART: '1' }); // osMod 8 logical -> 8/2-2 = 2
    await sc.start();
    expect(spawnCalls[0].opts.env.LAYA_THREADS).toBe('2');
  });

  it('API key kabhi log me nahi — stdout relay MASKED', async () => {
    const sc = mkSidecar({ LAYA_AUTOSTART: '1' });
    await sc.start();
    expect(currentChild).toBeTruthy();
    currentChild.stdout.emit('data', Buffer.from(`boot with ${API_KEY} inside a line\n`));
    const masked = logs.filter((l) => l.includes('***MASKED***'));
    expect(masked.length).toBeGreaterThanOrEqual(1);
    expect(logs.some((l) => l.includes(API_KEY))).toBe(false);
    expect(logs.some((l) => l.startsWith('[laya] ') && l.includes('inside a line'))).toBe(true);
  });

  it('LAYA_SERVE_CMD full exe path override', async () => {
    const sc = mkSidecar({ LAYA_AUTOSTART: '1', LAYA_SERVE_CMD: '/opt/laya/serve.exe' });
    await sc.start();
    expect(spawnCalls[0].cmd).toBe('/opt/laya/serve.exe');
  });
});

// ============================================================
// 4-5. ready poll + hang detect
// ============================================================
describe('layaSidecar — READY poll + HANG detect', () => {
  it('healthy hone par laya-ready journal (ms ke saath)', async () => {
    const sc = mkSidecar({ LAYA_AUTOSTART: '1' });
    await sc.start(); // refused -> spawned
    tNow += 4200;
    sc._i.onHealthResult({ ok: true, why: 'status-200' });
    expect(sc.status().phase).toBe('ready');
    const r = entries.find((e) => e.ev === 'laya-ready');
    expect(r).toBeTruthy();
    expect(r.ms).toBe(4200);
    expect(logs.some((l) => l.includes('[laya] READY'))).toBe(true);
  });

  it('_tick se health probe chalta hai aur ready hota hai (async path)', async () => {
    httpSeq = [null, 200]; // adopt-check refused, phir tick probe 200
    const sc = mkSidecar({ LAYA_AUTOSTART: '1', LAYA_PROBE_MS: '30000' });
    await sc.start();
    expect(sc.status().phase).toBe('starting');
    tNow += 31000;
    sc._i._tick();
    await flush();
    await flush();
    expect(sc.status().phase).toBe('ready');
    expect(entries.some((e) => e.ev === 'laya-ready')).toBe(true);
  });

  it('ready ke baad 3 consecutive fail = tree-kill + laya-hang-restart + backoff restart', async () => {
    const sc = mkSidecar({ LAYA_AUTOSTART: '1' });
    await sc.start();
    tNow += 4000;
    sc._i.onHealthResult({ ok: true, why: 'status-200' });
    const c = currentChild;
    tNow += 60000;
    sc._i.onHealthResult({ ok: false, why: 'timeout' });
    sc._i.onHealthResult({ ok: false, why: 'timeout' });
    expect(c.killCalls).toHaveLength(0); // 2 fail — abhi nahi
    expect(sc.status().phase).toBe('ready');
    sc._i.onHealthResult({ ok: false, why: 'timeout' }); // 3rd = hang verdict
    expect(c.killCalls).toContain('SIGKILL');
    const h = entries.find((e) => e.ev === 'laya-hang-restart');
    expect(h).toBeTruthy();
    expect(h.reason).toBe('freeze');
    // exit event aane par restart schedule hota hai (5s base backoff)
    c.emit('exit', null, 'SIGKILL');
    expect(sc._i.st.restarts).toBe(1);
    expect(sc._i.st.nextRestartAt).toBe(tNow + 5000);
    expect(sc._i.st.phase).toBe('restarting');
  });

  it('probe OK wapas aane par fail-streak reset', async () => {
    const sc = mkSidecar({ LAYA_AUTOSTART: '1' });
    await sc.start();
    tNow += 4000;
    sc._i.onHealthResult({ ok: true, why: 'status-200' });
    sc._i.onHealthResult({ ok: false, why: 'timeout' });
    sc._i.onHealthResult({ ok: false, why: 'timeout' });
    sc._i.onHealthResult({ ok: true, why: 'status-200' });
    expect(sc._i.st.failStreak).toBe(0);
    expect(currentChild.killCalls).toHaveLength(0);
    expect(logs.some((l) => l.includes('probe OK wapas'))).toBe(true);
  });
});

// ============================================================
// 6-7. crash backoff + budget
// ============================================================
describe('layaSidecar — CRASH backoff + BUDGET pause', () => {
  it('exit par backoff 5s, 10s, 20s ... 60s cap', async () => {
    const sc = mkSidecar({ LAYA_AUTOSTART: '1' });
    await sc.start();
    const delays: number[] = [];
    // 7 crash cycles
    for (let i = 0; i < 7; i++) {
      const c = currentChild;
      c.emit('exit', 1, null);
      delays.push(sc._i.st.nextRestartAt - tNow);
      const ex = entries.filter((e) => e.ev === 'laya-crash').pop();
      expect(ex.reason).toBe('exit(1)');
      expect(sc._i.st.child).toBeNull();
      tNow = Math.max(tNow, sc._i.st.nextRestartAt);
      sc._i._tick(); // restarting -> _spawn()
      expect(currentChild).not.toBe(c);
    }
    expect(delays).toEqual([5000, 10000, 20000, 40000, 60000, 60000, 60000]);
    expect(sc._i.st.restarts).toBe(7);
  });

  it('hourly budget: N restarts ke baad pause + phir resume', async () => {
    const sc = mkSidecar({ LAYA_AUTOSTART: '1', LAYA_MAX_RESTARTS_HOUR: '3', LAYA_BUDGET_PAUSE_MS: '600000' });
    await sc.start();
    // 4 crashes -> 4th par budget (history check push se PEHLE hota hai)
    for (let i = 0; i < 4; i++) {
      currentChild.emit('exit', 1, null);
      tNow = Math.max(tNow, sc._i.st.nextRestartAt);
      sc._i._tick();
    }
    expect(sc._i.st.phase).toBe('paused');
    expect(entries.some((e) => e.ev === 'laya-budget-pause')).toBe(true);
    expect(logs.some((l) => l.includes('RESTART BUDGET khatam'))).toBe(true);
    // pause ke dauran koi spawn nahi
    const spawnsSoFar = spawnCalls.length;
    tNow += 1000;
    sc._i._tick();
    expect(spawnCalls.length).toBe(spawnsSoFar);
    // pause khatam -> resume
    tNow += 600000;
    sc._i._tick();
    expect(spawnCalls.length).toBe(spawnsSoFar + 1);
    expect(sc._i.st.phase).toBe('starting');
  });
});

// ============================================================
// 8. exe missing
// ============================================================
describe('layaSidecar — EXE missing (give-up)', () => {
  it('laya-serve nahi mila -> laya-giveup, zero restarts (no crash-loop)', async () => {
    exeExists = false;
    const sc = mkSidecar({ LAYA_AUTOSTART: '1' });
    await sc.start();
    expect(sc.status().phase).toBe('gave-up');
    expect(spawnCalls).toHaveLength(0);
    expect(sc._i.st.restarts).toBe(0);
    expect(sc._i.st.nextRestartAt).toBe(0);
    const g = entries.find((e) => e.ev === 'laya-giveup');
    expect(g).toBeTruthy();
    expect(g.reason).toBe('exe-not-found');
    expect(logs.some((l) => l.includes('laya-serve nahi mila'))).toBe(true);
    // ticks ke baad bhi kuch nahi hota
    tNow += 120000;
    sc._i._tick();
    sc._i._tick();
    expect(spawnCalls).toHaveLength(0);
    expect(sc.status().phase).toBe('gave-up');
  });
});

// ============================================================
// 10. stop semantics
// ============================================================
describe('layaSidecar — STOP (owned kill / adopted spare)', () => {
  it('owned process: tree-kill + clean journal (orphan nahi bachta)', async () => {
    const sc = mkSidecar({ LAYA_AUTOSTART: '1' });
    await sc.start();
    const c = currentChild;
    const p = sc.stop();
    c.emit('exit', 0, null); // kill ke baad exit event
    await p;
    expect(c.killCalls).toContain('SIGKILL');
    expect(entries.some((e) => e.ev === 'laya-stop')).toBe(true);
    expect(logs.some((l) => l.includes('clean shutdown'))).toBe(true);
    expect(sc._i.st.child).toBeNull();
  });

  it('win32 owned stop: taskkill /F /T /PID tree-kill', async () => {
    platform = 'win32';
    const sc = mkSidecar({ LAYA_AUTOSTART: '1' });
    await sc.start();
    const c = currentChild;
    const p = sc.stop();
    c.emit('exit', 1, null);
    await p;
    const tk = spawnCalls.find((s) => s.cmd === 'taskkill');
    expect(tk).toBeTruthy();
    expect(tk.args).toEqual(['/F', '/T', '/PID', String(c.pid)]);
  });

  it('kabhi start nahi hua sidecar ka stop no-op hai (spawn nahi)', async () => {
    const sc = mkSidecar({ LAYA_AUTOSTART: '1' });
    await sc.stop();
    expect(spawnCalls).toHaveLength(0);
    expect(entries.filter((e) => String(e.ev).startsWith('laya'))).toHaveLength(0);
  });
});

// ============================================================
// 11. .env parser + precedence
// ============================================================
describe('layaSidecar — .env mini-parser (BOM/CRLF/quotes/comments/blank)', () => {
  it('parseDotEnvKeys: comments, quotes, inline comments, CRLF, BOM, blank, non-LAYA excluded', () => {
    const fixture = '\uFEFF# header comment\r\n'
      + 'LAYA_API_KEY="abc#123"\r\n'
      + "LAYA_HOME='C:\\laya-env'\r\n"
      + 'LAYA_MODELS=english # trailing comment\r\n'
      + 'LAYA_ENABLED=\r\n'
      + '\r\n'
      + 'OTHER_KEY=skipme\r\n'
      + 'NOEQSIGN\r\n'
      + 'LAYA_RETRIES=2\r\n';
    const out = parseDotEnvKeys(fixture);
    expect(out).toEqual({
      LAYA_API_KEY: 'abc#123',
      LAYA_HOME: 'C:\\laya-env',
      LAYA_MODELS: 'english',
      LAYA_ENABLED: '',
      LAYA_RETRIES: '2',
    });
  });

  it('parseBaseUrl: loopback vs non-loopback + port', () => {
    expect(parseBaseUrl('http://127.0.0.1:8000')).toMatchObject({ host: '127.0.0.1', port: 8000, loopback: true });
    expect(parseBaseUrl('http://localhost:9000')).toMatchObject({ host: 'localhost', port: 9000, loopback: true });
    expect(parseBaseUrl('http://192.168.1.5:8000').loopback).toBe(false);
    expect(parseBaseUrl('garbage').loopback).toBe(true); // honest fallback loopback
  });

  it('app/.env se LAYA_* padhta hai (supervisor dotenv-free), env jeet-ta hai', async () => {
    dotEnvFixture = 'LAYA_AUTOSTART=1\r\nLAYA_API_KEY=from-dotenv-file\r\nLAYA_THREADS=5\r\n';
    // env me sirf ENABLED/HOME (mkSidecar base) — AUTOSTART+KEY .env se aaye
    const sc = mkSidecar({ LAYA_THREADS: '2' }); // env wala jeetna chahiye
    await sc.start();
    expect(sc.status().phase).toBe('starting');
    expect(spawnCalls[0].opts.env.LAYA_API_KEY).toBe(API_KEY); // env key wins
    expect(spawnCalls[0].opts.env.LAYA_THREADS).toBe('2');    // env threads wins over .env 5
  });

  it('.env hi LAYA_AUTOSTART de to bhi spawn hota hai (env absent case)', async () => {
    dotEnvFixture = 'LAYA_AUTOSTART=1\r\nLAYA_API_KEY=from-dotenv-file\r\n';
    const sc = createLayaSidecar({
      env: { LAYA_ENABLED: '1' }, // AUTOSTART + KEY dono .env se
      appRoot: '/app',
      log: (l: string) => { logs.push(String(l)); },
      journal: (e: any) => { entries.push(e); },
      deps: {
        spawnFn: (cmd: string, args: string[], opts: any) => { spawnCalls.push({ cmd, args, opts }); currentChild = fakeChild(); return currentChild; },
        httpGetFn: mkHttp(),
        fsMod: {
          existsSync: () => true,
          readFileSync: (p: any) => {
            if (String(p).endsWith('.env')) return dotEnvFixture as string;
            throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
          },
        },
        platformFn: () => 'linux',
        nowFn: () => tNow,
        osMod: { cpus: () => new Array(4).fill(0) },
        setIntervalFn: () => 1, clearIntervalFn: () => {}, setTimeoutFn: () => 1, clearTimeoutFn: () => {},
      },
    });
    await sc.start();
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].opts.env.LAYA_API_KEY).toBe('from-dotenv-file');
    expect(spawnCalls[0].opts.env.LAYA_THREADS).toBe('1'); // 4 logical -> max(1, 2-2)
  });
});

// ============================================================
// 12. supervisor integration + source contracts
// ============================================================
describe('layaSidecar — SUPERVISOR integration', () => {
  function mkFakeSidecar() {
    return {
      start: vi.fn(() => { }),
      stop: vi.fn(async () => { }),
    };
  }

  function mkSupWithSidecar(sidecar: any) {
    return createSupervisor({
      env: { WATCHDOG_PROBE_MS: '20000', WATCHDOG_DISABLE: '1', WATCHDOG_LOG_FILE: 'off' },
      spawnFn: (cmd: string, args: string[], opts: any) => {
        spawnCalls.push({ cmd, args, opts });
        currentChild = fakeChild(4242);
        return currentChild;
      },
      httpGetFn: (_o: any, _cb: any) => new EventEmitter() as any,
      nowFn: () => tNow,
      logFn: (line: string) => { logs.push(String(line).replace(/\n$/, '')); },
      journalAppendFn: (e: any) => { entries.push(e); },
      platformFn: () => 'linux',
      nodeExe: 'node',
      serverEntry: '/app/server/index.js',
      appRoot: '/app',
      fsMod: {
        existsSync: (p: any) => String(p).endsWith(path.join('dist', 'index.html')),
        readFileSync: (p: any) => {
          if (String(p).endsWith('package.json')) return '{"version":"21.4.1"}';
          if (String(p).endsWith('.build-version')) return '21.4.1';
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        },
      },
      layaSidecar: sidecar,
    });
  }

  it('start() sidecar.start ko never-fatal drive karta hai; _i.sidecar exposed; stop() sidecar.stop', async () => {
    const fake = mkFakeSidecar();
    const sup = mkSupWithSidecar(fake);
    expect(sup._i.sidecar).toBe(fake);
    sup.start();
    await flush();
    await flush();
    expect(fake.start).toHaveBeenCalledTimes(1);
    expect(sup._i.state.child).toBeTruthy(); // server child spawn hua
    const p = sup.stop();
    currentChild?.emit('exit', 0, null);
    await p;
    expect(fake.stop).toHaveBeenCalledTimes(1);
  });

  it('sidecar throwing kabhi supervisor ko nahi maarta (both paths)', async () => {
    const bad = { start: vi.fn(() => { throw new Error('boom'); }), stop: vi.fn(async () => { throw new Error('boom2'); }) };
    const sup = mkSupWithSidecar(bad);
    expect(() => sup.start()).not.toThrow();
    await flush();
    const p = sup.stop();
    currentChild?.emit('exit', 0, null);
    await expect(p).resolves.toBeUndefined();
    expect(bad.stop).toHaveBeenCalledTimes(1);
  });

  it('inject kiye bina supervisor real sidecar banata hai (disabled default, zero spawn)', async () => {
    const sup = mkSupWithSidecar(undefined);
    expect(sup._i.sidecar).toBeTruthy();
    expect(typeof sup._i.sidecar.start).toBe('function');
    await sup.stop(); // no-op path — spawn nahi hua
    expect(spawnCalls).toHaveLength(0);
  });
});

describe('layaSidecar — SOURCE contracts (plan §3)', () => {
  it('supervisor.js: sidecar wired (import, start, stop, _i)', () => {
    expect(SUPERVISOR_SRC).toContain("from './layaSidecar.js'");
    expect(SUPERVISOR_SRC).toContain('sidecar.start()');
    expect(SUPERVISOR_SRC).toContain('await sidecar.stop()');
    expect(SUPERVISOR_SRC).toContain('state, knobs, deps, sidecar');
    // never-fatal wrappers
    expect(SUPERVISOR_SRC).toContain('Promise.resolve(sidecar.start())');
  });

  it('layaSidecar.js: saare journal events + safety rules', () => {
    for (const ev of ['laya-start', 'laya-ready', 'laya-adopted', 'laya-crash', 'laya-hang-restart', 'laya-giveup', 'laya-stop', 'laya-budget-pause']) {
      expect(SERVER_SRC).toContain(`'${ev}'`);
    }
    expect(SERVER_SRC).toContain('taskkill');
    expect(SERVER_SRC).toContain('windowsHide: true');
    expect(SERVER_SRC).toContain('***MASKED***');
    expect(SERVER_SRC).toContain('LOOPBACK_HOSTS');
  });

  it('Watchdog bat: Laya block (health-check + start-laya.cmd) + v21.6.0', () => {
    expect(BAT_SRC).toContain('v21.6.0');
    expect(BAT_SRC).toContain('start-laya.cmd');
    expect(BAT_SRC).toContain('curl.exe -s -m 2 http://127.0.0.1:8000/health');
    expect(BAT_SRC).toContain('start "Laya AI" /min cmd /c "%~dp0start-laya.cmd"');
    expect(BAT_SRC).toContain('pehle se chal raha hai');
  });

  it('bat + start-laya.cmd pure CRLF hain (v21.1.0 lesson)', () => {
    for (const f of ['Start-SmartAI-Watchdog.bat', 'start-laya.cmd']) {
      const raw = readFileSync(path.join(APP_ROOT, f));
      const stripped = Buffer.from(raw.toString('binary').replace(/\r\n/g, ''));
      expect(stripped.toString('binary')).not.toMatch(/[\r\n]/);
    }
  });
});
