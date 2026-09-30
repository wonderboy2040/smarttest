// ============================================================
// SmartAI v20.0.1 DEPS AUTO-INSTALL — END-TO-END SMOKE
// ------------------------------------------------------------
// THE live bug this proves fixed (D:\SmartAI26 fresh install):
//   v20 full zip me node_modules nahi hota -> supervisor child
//   "ERR_MODULE_NOT_FOUND: dotenv" pe crash-loop karta tha, GALAT
//   "port conflict" message ke saath.
//
//   D1  FRESH APP (package.json + NO node_modules) + supervisor:
//       preflight audit -> REAL npm install (is-odd) -> fixture
//       child boots -> /api/ping 200. node_modules REAL me bana.
//   D2  RESTART on the SAME app (deps ab present): NO npm line,
//       direct boot (idempotent, spurious install kabhi nahi).
//   D3  WATCHDOG_AUTO_INSTALL=0 + fresh app: child crash ->
//       journal 'deps-missing' + HONEST 'DEPENDENCY MISSING'
//       message + NO node_modules created (offline honest path).
// Run: node scripts/smoke_v201.mjs
// ============================================================
import { spawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = path.join(ROOT, '.tmp-smoke-v201');
let passCount = 0;
let failCount = 0;
const failures = [];

function ok(label) { passCount++; console.log(`  [PASS] ${label}`); }
function bad(label, detail = '') {
  failCount++; failures.push(label);
  console.log(`  [FAIL] ${label}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on('error', reject);
  });
}

function httpGetJson(port, urlPath, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath, timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, json: null }); }
      });
    });
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve(null); });
    req.on('error', () => resolve(null));
  });
}

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await fn();
    if (r) return r;
    await sleep(400);
  }
  return null;
}

function readJournalLines(file) {
  try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); }
  catch { return []; }
}

function startSupervisor(env) {
  const sup = spawn(process.execPath, ['server/supervisor.js'], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines = [];
  sup.stdout.on('data', (d) => {
    const t = String(d);
    lines.push(...t.split('\n').filter(Boolean));
    process.stdout.write('[smoke>sup] ' + t);
  });
  sup.stderr.on('data', (d) => process.stdout.write('[smoke>sup:err] ' + d));
  return { sup, lines };
}

async function stopSupervisor(handle, timeoutMs = 20000) {
  if (!handle || handle.sup.exitCode !== null) return handle ? handle.sup.exitCode : -1;
  return new Promise((resolve) => {
    const t = setTimeout(() => { try { handle.sup.kill('SIGKILL'); } catch {} resolve(-9); }, timeoutMs);
    handle.sup.on('exit', (code) => { clearTimeout(t); resolve(code); });
    try { handle.sup.kill('SIGINT'); } catch { /* already gone */ }
  });
}

// ---- fresh app scaffold: package.json (1 tiny dep) + server fixture, NO node_modules ----
function mkFreshApp(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'server'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'smoke-fresh-app', version: '20.0.1', private: true, type: 'module',
    dependencies: { 'is-odd': '^3.0.1' },
  }, null, 2) + '\n');
  // fixture = mini "server/index.js" jo package.json wala dep import karta hai —
  // deps na ho to exactly wahi ERR_MODULE_NOT_FOUND crash hota hai jo live mila tha
  fs.writeFileSync(path.join(dir, 'server', 'depsFixtureServer.mjs'), `import http from 'node:http';
import isOdd from 'is-odd';
const PORT = Number(process.env.FIXTURE_PORT || 8099);
const srv = http.createServer((req, res) => {
  if (req.url === '/api/ping') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ pong: true, isOdd3: isOdd(3), pid: process.pid }));
    return;
  }
  res.writeHead(404); res.end('{}');
});
srv.listen(PORT, '127.0.0.1', () => console.log('FX_READY pid=' + process.pid + ' isOdd(3)=' + isOdd(3)));
`);
  return path.join(dir, 'server', 'depsFixtureServer.mjs');
}

// ============================================================
async function main() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  console.log('=== v20.0.1 DEPS AUTO-INSTALL SMOKE ===');

  // ---------------- D1: fresh app -> auto npm install -> boot ----------------
  console.log('\n[D1] Fresh install (no node_modules) -> preflight npm install -> boot...');
  const APP1 = path.join(TMP, 'fresh-app');
  const FX1 = mkFreshApp(APP1);
  const P1 = await freePort();
  const J1 = path.join(TMP, 'journal-d1.log');
  const h1 = startSupervisor({
    WATCHDOG_APP_ROOT: APP1,
    WATCHDOG_CHILD: FX1,
    WATCHDOG_PORT: String(P1),
    WATCHDOG_PROBE_MS: '3000', WATCHDOG_FAILS: '2', WATCHDOG_TIMEOUT_MS: '4000',
    WATCHDOG_GRACE_MS: '90000',
    WATCHDOG_INSTALL_TIMEOUT_MS: '240000',
    WATCHDOG_LOG_FILE: 'off', WATCHDOG_JOURNAL: J1,
    FIXTURE_PORT: String(P1),
  });
  try {
    const installLine = await waitFor(() => h1.lines.find((l) => l.includes('node_modules missing hai')) || null, 15000, 'audit line');
    if (installLine) ok(`preflight audit fired: "${installLine.slice(0, 90)}..."`);
    else bad('preflight audit line missing');

    const pong = await waitFor(() => httpGetJson(P1, '/api/ping', 3000), 180000, 'ping');
    if (pong && pong.status === 200 && pong.json && pong.json.pong === true && pong.json.isOdd3 === true) {
      ok(`/api/ping 200 (auto-install ke BAAD boot; isOdd(3)=${pong.json.isOdd3}, pid ${pong.json.pid})`);
    } else bad('post-install ping', JSON.stringify(pong));

    if (fs.existsSync(path.join(APP1, 'node_modules', 'is-odd'))) ok('node_modules/is-odd REAL me install hua');
    else bad('node_modules/is-odd missing — npm install fake hua?');

    if (h1.lines.some((l) => l.includes('npm install complete'))) ok('"npm install complete" relayed');
    else bad('npm install complete line missing');

    const upLine = await waitFor(() => h1.lines.find((l) => l.includes('server UP') && l.includes('/api/ping OK')) || null, 12000, 'UP line');
    if (upLine) ok('honest "server UP" (pehle ping OK pe, spawn pe nahi)');
    else bad('server UP announcement missing');

    const j1 = readJournalLines(J1);
    if (j1.some((e) => e.ev === 'watchdog-deps-install' && e.reason === 'missing-node-modules')) ok('journal watchdog-deps-install recorded');
    else bad('journal watchdog-deps-install missing');

    const code = await stopSupervisor(h1, 25000);
    if (code === 0) ok('supervisor clean exit 0 (SIGINT)');
    else bad('supervisor exit code', String(code));
  } finally {
    await stopSupervisor(h1, 5000);
  }

  // ---------------- D2: same app restart -> NO npm, direct boot ----------------
  console.log('\n[D2] Same app dobara (deps present) -> NO npm line, direct boot...');
  const P2 = await freePort();
  const J2 = path.join(TMP, 'journal-d2.log');
  const h2 = startSupervisor({
    WATCHDOG_APP_ROOT: APP1,
    WATCHDOG_CHILD: FX1,
    WATCHDOG_PORT: String(P2),
    WATCHDOG_PROBE_MS: '3000', WATCHDOG_FAILS: '2', WATCHDOG_TIMEOUT_MS: '4000',
    WATCHDOG_GRACE_MS: '90000',
    WATCHDOG_LOG_FILE: 'off', WATCHDOG_JOURNAL: J2,
    FIXTURE_PORT: String(P2),
  });
  try {
    const pong = await waitFor(() => httpGetJson(P2, '/api/ping', 3000), 30000, 'ping');
    if (pong && pong.status === 200 && pong.json && pong.json.pong === true) ok('deps-present boot: ping 200 direct');
    else bad('deps-present boot ping', JSON.stringify(pong));
    if (!h2.lines.some((l) => l.includes('npm install'))) ok('koi npm line NAHI (spurious install nahi)');
    else bad('spurious npm install chala');
  } finally {
    await stopSupervisor(h2, 8000);
  }

  // ---------------- D3: auto-install OFF -> honest crash, no node_modules ----------------
  console.log('\n[D3] WATCHDOG_AUTO_INSTALL=0 -> honest deps-missing crash (offline path)...');
  const APP3 = path.join(TMP, 'fresh-app-noauto');
  const FX3 = mkFreshApp(APP3);
  const P3 = await freePort();
  const J3 = path.join(TMP, 'journal-d3.log');
  const h3 = startSupervisor({
    WATCHDOG_APP_ROOT: APP3,
    WATCHDOG_CHILD: FX3,
    WATCHDOG_PORT: String(P3),
    WATCHDOG_AUTO_INSTALL: '0',
    WATCHDOG_PROBE_MS: '3000', WATCHDOG_FAILS: '2', WATCHDOG_TIMEOUT_MS: '3000',
    WATCHDOG_GRACE_MS: '15000',
    WATCHDOG_BACKOFF_BASE_MS: '1000', WATCHDOG_BACKOFF_MAX_MS: '2000',
    WATCHDOG_MAX_RESTARTS_HOUR: '4', WATCHDOG_BUDGET_PAUSE_MS: '10000',
    WATCHDOG_LOG_FILE: 'off', WATCHDOG_JOURNAL: J3,
    FIXTURE_PORT: String(P3),
  });
  try {
    const honest = await waitFor(() => h3.lines.find((l) => l.includes('DEPENDENCY MISSING')) || null, 30000, 'honest line');
    if (honest) ok(`honest message: "${honest.slice(0, 80)}..."`);
    else bad('honest DEPENDENCY MISSING line missing');

    if (h3.lines.some((l) => l.includes('port conflict'))) bad('GALAT port-conflict hint aaya');
    else ok('koi galat "port conflict" hint nahi');

    const dep = await waitFor(() =>
      readJournalLines(J3).find((e) => String(e.reason || '').includes('deps-missing')) || null, 30000, 'journal');
    if (dep) ok(`journal deps-missing recorded (reason=${dep.reason})`);
    else bad('journal deps-missing missing');

    if (!fs.existsSync(path.join(APP3, 'node_modules'))) ok('auto-install OFF me node_modules nahi bana (honest)');
    else bad('node_modules ban gaya jabki auto-install off tha');

    const rx = await waitFor(() => h3.lines.find((l) => l.includes('restart #')) || null, 20000, 'restart line');
    if (rx) ok(`restart accounting chalu (budget guard active): "${rx.slice(0, 60)}..."`);
    else bad('no restart line');
  } finally {
    await stopSupervisor(h3, 8000);
  }

  console.log('\n=== SMOKE RESULT ===');
  console.log(`PASS: ${passCount}  FAIL: ${failCount}`);
  if (failures.length) console.log('FAILED:', failures.join(' | '));
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[smoke] FATAL:', err);
  process.exit(1);
});
