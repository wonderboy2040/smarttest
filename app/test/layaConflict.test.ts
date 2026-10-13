// ============================================================
// test/layaConflict.test.ts — v21.10 LAYA BIND-WAR FIX
// ------------------------------------------------------------
// Live bug lock (user log): watchdog start → bat-block + supervisor
// sidecar DONO laya-serve spawn → port 8000 [Errno 10048] → exit(3)
// → restart #1 5s → #2 10s → #3 20s → #4 40s … infinite crash-loop,
// misleading "[laya] READY (8.1s)" (probe PURANE healthy instance se
// OK), CPU churn → event-loop freeze 5.9s.
//
// Locks the v21.10 conflict resolver:
//   1. ADOPT-WINDOW   — occupied+booting port pe blind spawn NAHI;
//                       healthy hone par ADOPT (war avoided)
//   2. WINDOW→ZOMBIE  — window expiry + hung laya-serve squatter →
//                       taskkill + fresh spawn
//   3. WINDOW→FOREIGN — foreign app port pe → give-up, KABHI kill nahi
//   4. EXIT-RECONCILE→ADOPT — spawn exit + healthy port → restart
//                       CANCEL + ADOPT + backoff reset (war khatam)
//   5. EXIT-RECONCILE→ZOMBIE — quick conflict exit + occupied port →
//                       zombie kill + fast respawn (1.5s)
//   6. EXIT-RECONCILE→REFUSED — port free → normal backoff INTACT
//                       (purana 21.4 contract regression-lock)
//   7. READY-CHILD EXIT — ready hua child mara → zombie hunt NAHI
//   8. PARSERS — netstat/tasklist/lsof parse unit locks
//   9. WAR-GUARD SCRIPT — scripts/laya-autostart-check.mjs real exit
//                       codes (env-armed=0 / adha=1 / kuch nahi=1)
//  10. SOURCE CONTRACTS — bat war-guard + start-laya.cmd hardening
//
// Hermetic notes: fake httpGet (behavior steps + fake-clock advance),
// fake children (stdout/exit emit karne wale command captures), real
// setTimeout sirf chhote knob gaps (200-600ms) — injectable fake
// timers kabhi fire nahi hote isliye _sleep real hai (documented).
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { EventEmitter } from 'node:events';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(__dirname, '..');
const SERVER_SRC = readFileSync(path.join(APP_ROOT, 'server', 'layaSidecar.js'), 'utf8');
const BAT_SRC = readFileSync(path.join(APP_ROOT, 'Start-SmartAI-Watchdog.bat'), 'utf8');
const CMD_SRC = readFileSync(path.join(APP_ROOT, 'start-laya.cmd'), 'utf8');
const CHECK_SRC = readFileSync(path.join(APP_ROOT, 'scripts', 'laya-autostart-check.mjs'), 'utf8');

import {
  createLayaSidecar,
  parseNetstatListeningPids,
  parseTasklistImage,
  parseLsofPids,
} from '../server/layaSidecar.js';

const API_KEY = 'test-secret-key-32chars-xxxxxxxx';

// ---------- scaffolding ----------
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

// http behavior step: {code:200} | {timeout:true} | {refused:true}
type Step = { code: number } | { timeout: true } | { refused: true };

let tNow: number;
let entries: any[];
let logs: string[];
let spawnCalls: any[];
let currentChild: any;
let steps: Step[];
let stepDefault: Step;
let cmdOutputs: Record<string, { out: string; code?: number }>;

// fake httpGet — steps se deterministic + har call fake clock ko aage
// badhaati hai (adopt-window ka now()-math test ke liye)
function mkHttp() {
  return (_opts: any, cb: any) => {
    const req: any = new EventEmitter();
    req.destroy = () => {};
    tNow += 300; // fake clock advance — window/reconcile ke liye time chalte hain
    const s = steps.length ? steps.shift()! : stepDefault;
    queueMicrotask(() => {
      if ((s as any).refused) {
        req.emit('error', Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }));
      } else if ((s as any).timeout) {
        req.emit('timeout');
      } else {
        const res: any = new EventEmitter();
        res.statusCode = (s as any).code;
        res.resume = () => {};
        cb(res);
        res.emit('end');
      }
    });
    return req;
  };
}

// spawnFn — laya-serve fake child; diagnostic commands (lsof/ps/kill/
// netstat/tasklist/taskkill) apna output + exit turant emit karte hain
function mkSpawn() {
  return (cmd: string, args: string[], opts: any) => {
    spawnCalls.push({ cmd, args, opts });
    const c = fakeChild(1000 + spawnCalls.length);
    const key = String(cmd);
    if (Object.prototype.hasOwnProperty.call(cmdOutputs, key)) {
      const fx = cmdOutputs[key];
      queueMicrotask(() => {
        try { c.stdout.emit('data', Buffer.from(fx.out)); } catch { /* noop */ }
        c.emit('exit', fx.code ?? 0, null);
        c.emit('close', fx.code ?? 0, null);
      });
    } else {
      currentChild = c; // laya-serve (ya unknown) — test isse drive karega
    }
    return c;
  };
}

function mkSidecar(env: any = {}) {
  return createLayaSidecar({
    env: {
      LAYA_ENABLED: '1',
      LAYA_API_KEY: API_KEY,
      LAYA_HOME: '/laya',
      LAYA_DEVICE: 'cpu',
      // v21.10 knobs — chhote values taaki real sleeps negligible rahein
      LAYA_ADOPT_WINDOW_MS: '600',
      LAYA_ADOPT_POLL_MS: '200',
      ...env,
    },
    appRoot: '/app',
    log: (line: string) => { logs.push(String(line).replace(/\n$/, '')); },
    journal: (e: any) => { entries.push(e); },
    deps: {
      spawnFn: mkSpawn(),
      httpGetFn: mkHttp(),
      fsMod: {
        existsSync: () => true,
        readFileSync: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
      },
      platformFn: () => 'linux',
      nowFn: () => tNow,
      osMod: { cpus: () => new Array(8).fill(0) },
      fetchImpl: async () => ({ status: 200, resume() {} }),
      setIntervalFn: () => 999,
      clearIntervalFn: () => {},
      setTimeoutFn: () => 555,
      clearTimeoutFn: () => {},
    },
  });
}

const flushN = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

const layaSpawns = () => spawnCalls.filter((s) => String(s.cmd).includes('laya-serve'));
const hasCmd = (name: string) => spawnCalls.some((s) => s.cmd === name);

beforeEach(() => {
  tNow = 1_700_000_000_000;
  entries = [];
  logs = [];
  spawnCalls = [];
  currentChild = null;
  steps = [];
  stepDefault = { refused: true };
  cmdOutputs = {};
});

// ============================================================
// 1-3. INIT ADOPT-WINDOW (occupied port pe blind spawn NAHI)
// ============================================================
describe('layaConflict — ADOPT-WINDOW (init)', () => {
  it('occupied+booting port: window me healthy hote hi ADOPT — blind spawn nahi (war avoided)', async () => {
    // probe1: occupied-timeout (bat ka laya booting) → window; probe2:
    // timeout; probe3: 200 (bind ho gaya) → ADOPT
    steps = [{ timeout: true }, { timeout: true }, { code: 200 }];
    const sc = mkSidecar({ LAYA_AUTOSTART: '1' });
    await sc.start();
    await sleepMs(50); // window ka ~200ms poll-gap absorb
    expect(sc.status().phase).toBe('adopted');
    expect(sc.status().owned).toBe(false);
    expect(layaSpawns()).toHaveLength(0); // WAR NHI HUI — kabhi spawn nahi
    const ad = entries.find((e) => e.ev === 'laya-adopted');
    expect(ad.reason).toBe('adopt-window-healthy');
    expect(logs.some((l) => l.includes('adopt-window me :8000 healthy'))).toBe(true);
    expect(logs.some((l) => l.includes('occupied hai par /health abhi nahi'))).toBe(true);
  });

  it('window me booting wala mar jaye (refused) → port free → ab spawn safe', async () => {
    steps = [{ timeout: true }, { refused: true }];
    const sc = mkSidecar({ LAYA_AUTOSTART: '1' });
    await sc.start();
    expect(sc.status().phase).toBe('starting');
    expect(layaSpawns()).toHaveLength(1); // port free hua — ek hi spawn
  });

  it('window expiry + hung laya-serve zombie → taskkill + fresh spawn', async () => {
    steps = [{ timeout: true }]; // sab timeout — hung squatter
    stepDefault = { timeout: true };
    cmdOutputs = {
      lsof: { out: '4712\n' },
      ps: { out: 'laya-serve\n' },
      kill: { out: '', code: 0 },
    };
    const sc = mkSidecar({ LAYA_AUTOSTART: '1' });
    await sc.start();
    await sleepMs(400); // window 600ms + poll gaps
    const zk = entries.find((e) => e.ev === 'laya-zombie-kill');
    expect(zk).toBeTruthy();
    expect(zk.pid).toBe(4712);
    expect(zk.image).toBe('laya-serve');
    const killCall = spawnCalls.find((s) => s.cmd === 'kill');
    expect(killCall).toBeTruthy();
    expect(killCall.args).toEqual(['-9', '4712']);
    expect(layaSpawns()).toHaveLength(1); // zombie ke baad fresh spawn
    expect(sc.status().phase).toBe('starting');
    expect(sc.status().conflicts).toBe(1);
  });

  it('window expiry + FOREIGN app → give-up, KABHI kill nahi + actionable log', async () => {
    steps = [{ timeout: true }];
    stepDefault = { timeout: true };
    cmdOutputs = {
      lsof: { out: '4712\n' },
      ps: { out: 'someapp\n' },
    };
    const sc = mkSidecar({ LAYA_AUTOSTART: '1' });
    await sc.start();
    await sleepMs(400);
    expect(sc.status().phase).toBe('gave-up');
    const g = entries.find((e) => e.ev === 'laya-giveup');
    expect(g.reason).toBe('port-occupied-foreign');
    expect(g.image).toBe('someapp');
    expect(hasCmd('kill')).toBe(false); // foreign app ko kabhi kill NAHI
    expect(layaSpawns()).toHaveLength(0); // war nahi — spawn hi nahi
    expect(logs.some((l) => l.includes('LAYA_BASE_URL'))).toBe(true);
  });
});

// ============================================================
// 4-7. EXIT-RECONCILIATION (spawn ke baad crash-loop killer)
// ============================================================
describe('layaConflict — EXIT-RECONCILE', () => {
  it('exit(3) + port healthy (purana/bat laya) → restart CANCEL + ADOPT + backoff reset', async () => {
    // probe1 refused → spawn; phir conflict: naya child 10048 pe mara,
    // par port pe bat-wala healthy laya — reconcile use ADOPT karega
    steps = [{ refused: true }, { code: 200 }];
    const sc = mkSidecar({ LAYA_AUTOSTART: '1' });
    await sc.start();
    const c = currentChild;
    expect(sc.status().phase).toBe('starting');
    tNow += 5000; // spawn ke 5s baad exit (quick, kabhi ready nahi)
    const t0 = tNow; // exit ke baad reconcile ka pehla probe tNow aage badha deta hai
    c.emit('exit', 3, null);
    // sync contract: restart schedule ho gaya (abhi cancel hone wala hai)
    expect(sc._i.st.restarts).toBe(1);
    expect(sc._i.st.nextRestartAt).toBe(t0 + 5000);
    await flushN(12); // reconcile: probe → healthy → adopt
    expect(sc.status().phase).toBe('adopted');
    expect(sc.status().owned).toBe(false);
    expect(sc.status().conflicts).toBe(1);
    expect(sc._i.st.nextRestartAt).toBe(0); // pending restart CANCELLED
    expect(sc._i.st.backoffDelayMs).toBe(5000); // war counters reset
    const ad = entries.find((e) => e.ev === 'laya-adopted');
    expect(ad.reason).toBe('conflict-exit(3)-healthy-port');
    expect(logs.some((l) => l.includes('crash-loop CANCEL'))).toBe(true);
    // tick ke baad bhi koi naya spawn NAHI (war khatam)
    tNow += 120000;
    sc._i._tick();
    expect(layaSpawns()).toHaveLength(1);
  });

  it('quick exit(3) + occupied-unhealthy (hung zombie) → zombie kill + 1.5s fast respawn', async () => {
    steps = [{ refused: true }];
    stepDefault = { timeout: true }; // reconcile probes: occupied-silent
    cmdOutputs = {
      lsof: { out: '4712\n' },
      ps: { out: 'laya-serve\n' },
      kill: { out: '', code: 0 },
    };
    const sc = mkSidecar({ LAYA_AUTOSTART: '1' });
    await sc.start();
    const c = currentChild;
    tNow += 8000;
    c.emit('exit', 3, null);
    await sleepMs(600); // 3 probes × ~200ms gap + squatter capture
    await flushN(8);
    const zk = entries.find((e) => e.ev === 'laya-zombie-kill');
    expect(zk).toBeTruthy();
    expect(zk.phase).toBe('exit-reconcile');
    expect(spawnCalls.find((s) => s.cmd === 'kill')).toBeTruthy();
    expect(sc._i.st.phase).toBe('restarting');
    expect(sc._i.st.backoffDelayMs).toBe(5000); // reset
    // 1.5s respawn window ke baad tick fresh spawn deta hai
    tNow += 2000;
    sc._i._tick();
    expect(layaSpawns()).toHaveLength(2); // pehla + zombie-ke-baad fresh
    expect(sc.status().conflicts).toBe(1);
  });

  it('quick exit + FOREIGN squatter → give-up (pending restart cancel, no kill)', async () => {
    steps = [{ refused: true }];
    stepDefault = { timeout: true };
    cmdOutputs = {
      lsof: { out: '4712\n' },
      ps: { out: 'someapp\n' },
    };
    const sc = mkSidecar({ LAYA_AUTOSTART: '1' });
    await sc.start();
    const c = currentChild;
    tNow += 8000;
    c.emit('exit', 3, null);
    await sleepMs(600);
    await flushN(8);
    expect(sc.status().phase).toBe('gave-up');
    expect(sc._i.st.nextRestartAt).toBe(0); // war cancel
    expect(hasCmd('kill')).toBe(false);
    const g = entries.find((e) => e.ev === 'laya-giveup');
    expect(g.reason).toBe('port-occupied-foreign');
    expect(g.phase).toBe('exit-reconcile');
  });

  it('exit + port FREE (refused) → normal backoff intact (21.4 contract regression-lock)', async () => {
    steps = [{ refused: true }];
    stepDefault = { refused: true };
    const sc = mkSidecar({ LAYA_AUTOSTART: '1' });
    await sc.start();
    const c = currentChild;
    tNow += 4000;
    const t0 = tNow; // reconcile probe tNow badhata hai — pehle capture
    c.emit('exit', 1, null);
    const expectedAt = t0 + 5000;
    expect(sc._i.st.nextRestartAt).toBe(expectedAt);
    await flushN(12); // reconcile: refused — kuch nahi badlega
    expect(sc._i.st.phase).toBe('restarting');
    expect(sc._i.st.nextRestartAt).toBe(expectedAt);
    expect(hasCmd('lsof')).toBe(false); // port free — squatter hunt hi nahi
    expect(sc.status().conflicts).toBe(0);
  });

  it('READY hua child exit ho to zombie-hunt NAHI (sirf normal backoff)', async () => {
    steps = [{ refused: true }];
    stepDefault = { timeout: true };
    const sc = mkSidecar({ LAYA_AUTOSTART: '1' });
    await sc.start();
    const c = currentChild;
    tNow += 4200;
    sc._i.onHealthResult({ ok: true, why: 'status-200' }); // ready
    expect(sc.status().phase).toBe('ready');
    tNow += 60000;
    c.emit('exit', 1, null); // ready tha — quick nahi
    await sleepMs(300);
    await flushN(8);
    expect(sc._i.st.phase).toBe('restarting');
    expect(hasCmd('lsof')).toBe(false); // ready child — zombie hunt skip
    expect(sc.status().conflicts).toBe(0);
  });

  it('stale-guard: reconcile ke dauran naya spawn ho gaya to adopt NO-OP', async () => {
    steps = [{ refused: true }, { code: 200 }];
    const sc = mkSidecar({ LAYA_AUTOSTART: '1' });
    await sc.start();
    const c = currentChild;
    tNow += 5000;
    c.emit('exit', 3, null); // reconcile in-flight (probe microtask me)
    // reconcile ke probes resolve hone se PEHLE tick restart spawn kar deta
    tNow = Math.max(tNow, sc._i.st.nextRestartAt);
    sc._i._tick(); // naya child + epoch++
    await flushN(12);
    expect(sc.status().phase).toBe('starting'); // adopt nahi hua — stale
    expect(sc.status().owned).toBe(true);
    expect(sc.status().conflicts).toBe(0);
  });
});

// ============================================================
// 8. PARSERS (netstat/tasklist/lsof)
// ============================================================
describe('layaConflict — squatter parsers', () => {
  it('parseNetstatListeningPids: IPv4 + IPv6 + dup + non-LISTENING + port-mismatch', () => {
    const text = [
      '  TCP    127.0.0.1:8000    0.0.0.0:0    LISTENING    4712',
      '  TCP    [::1]:8000        [::]:0       LISTENING    4712',   // dup pid
      '  TCP    127.0.0.1:8000    0.0.0.0:0    ESTABLISHED  9999',   // state galat
      '  TCP    127.0.0.1:8001    0.0.0.0:0    LISTENING    8888',   // port galat
      '  TCP    0.0.0.0:8000      0.0.0.0:0    LISTENING    5150',
      '',
      'garbage line',
    ].join('\r\n');
    expect(parseNetstatListeningPids(text, 8000)).toEqual([4712, 5150]);
    expect(parseNetstatListeningPids('', 8000)).toEqual([]);
    expect(parseNetstatListeningPids(text, 8001)).toEqual([8888]);
  });

  it('parseTasklistImage: CSV quoted + INFO line + empty', () => {
    expect(parseTasklistImage('"laya-serve.exe","4712","Console","1","5,840 K"\r\n')).toBe('laya-serve.exe');
    expect(parseTasklistImage('INFO: No tasks are running which match the specified criteria.')).toBe('');
    expect(parseTasklistImage('')).toBe('');
    expect(parseTasklistImage('"python.exe","5150","Services","0"')).toBe('python.exe');
  });

  it('parseLsofPids: numbers + junk + dedupe', () => {
    expect(parseLsofPids('4712\n5150\n4712\nnotapid\n\n')).toEqual([4712, 5150]);
    expect(parseLsofPids('')).toEqual([]);
  });

  it('server source: parsers exported + zombie guard strings', () => {
    expect(SERVER_SRC).toContain('export function parseNetstatListeningPids');
    expect(SERVER_SRC).toContain('export function parseTasklistImage');
    expect(SERVER_SRC).toContain('export function parseLsofPids');
    expect(SERVER_SRC).toContain('port-occupied-foreign');
    expect(SERVER_SRC).toContain('LAYA_ADOPT_WINDOW_MS');
    expect(SERVER_SRC).toContain('LAYA_CONFLICT_ZOMBIE_KILL');
    expect(SERVER_SRC).toContain('war-guard ON');
  });
});

// ============================================================
// 9. WAR-GUARD SCRIPT — real exit codes
// ============================================================
describe('layaConflict — scripts/laya-autostart-check.mjs (bat single-owner guard)', () => {
  const runCheck = (env: Record<string, string>) => spawnSync(
    process.execPath,
    [path.join(APP_ROOT, 'scripts', 'laya-autostart-check.mjs')],
    { env: { ...env }, encoding: 'utf8', timeout: 20000 },
  );

  it('env-armed (AUTOSTART+ENABLED+KEY+loopback) → exit 0 = bat fallback SKIP', () => {
    const r = runCheck({
      LAYA_AUTOSTART: '1',
      LAYA_ENABLED: '1',
      LAYA_API_KEY: 'smartai-laya-local',
      LAYA_BASE_URL: 'http://127.0.0.1:8000',
    });
    expect(r.status).toBe(0);
  });

  it('adha config (AUTOSTART=1 par ENABLED missing) → exit 1 = bat fallback allowed', () => {
    const r = runCheck({ LAYA_AUTOSTART: '1', LAYA_API_KEY: 'k' });
    expect(r.status).toBe(1);
  });

  it('kuch nahi set → exit 1 (app/.env repo me commit nahi hoti — deterministic)', () => {
    const r = runCheck({});
    expect(r.status).toBe(1);
  });

  it('non-loopback base → exit 1 (sidecar REFUSED karta — bat hi owner)', () => {
    const r = runCheck({
      LAYA_AUTOSTART: '1',
      LAYA_ENABLED: '1',
      LAYA_API_KEY: 'k',
      LAYA_BASE_URL: 'http://192.168.1.5:8000',
    });
    expect(r.status).toBe(1);
  });

  it('source: sidecar ke hi parser + armed-conditions use karta hai', () => {
    expect(CHECK_SRC).toContain("from '../server/layaSidecar.js'");
    expect(CHECK_SRC).toContain('parseDotEnvKeys');
    expect(CHECK_SRC).toContain('parseBaseUrl');
    expect(CHECK_SRC).toContain('LAYA_AUTOSTART');
    expect(CHECK_SRC).toContain('process.exit(armed ? 0 : 1)');
  });
});

// ============================================================
// 10. SOURCE CONTRACTS — bat war-guard + start-laya.cmd hardening
// ============================================================
describe('layaConflict — launcher source contracts', () => {
  it('bat: node-check guard pehle, fallback block baad me (order lock)', () => {
    const guardIdx = BAT_SRC.indexOf('laya-autostart-check.mjs');
    const fallbackIdx = BAT_SRC.indexOf('curl.exe -s -m 2 http://127.0.0.1:8000/health');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(fallbackIdx).toBeGreaterThan(guardIdx); // guard pehle — war impossible
    expect(BAT_SRC).toContain('if not errorlevel 1 set "LAYA_BAT_FALLBACK=0"');
  });

  it('start-laya.cmd: pre-flight health check + bind-error pause', () => {
    expect(CMD_SRC).toContain('curl.exe -s -m 2 http://127.0.0.1:8000/health');
    expect(CMD_SRC).toContain('pehle se chal raha hai');
    expect(CMD_SRC).toContain('10048'); // bind-conflict hint
    expect(CMD_SRC).toContain('netstat -ano'); // actionable diagnostic
  });

  it('status(): conflicts field surface hota hai', () => {
    expect(SERVER_SRC).toContain('conflicts: st.conflicts');
  });
});
