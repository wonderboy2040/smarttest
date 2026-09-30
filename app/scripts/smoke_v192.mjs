// ============================================================
// SmartAI v19.2 ANTI-FREEZE SUPERVISOR — END-TO-END SMOKE
// ------------------------------------------------------------
// Proves, against REAL processes (no fakes):
//   S1  Real server boots UNDER the supervisor; /api/ping
//       answers; /health reports supervised:true + consoleguard.
//   S2  FREEZE-RECOVERY: a real child whose event loop locks up
//       (while(true)) gets detected (probe timeouts) ->
//       force-killed -> journaled 'freeze' -> restarted ->
//       ping OK again. THE v19.2 gap, closed end-to-end.
//   S3  CRASH-RECOVERY: child exit(7) -> journaled -> backoff
//       restart -> second run alive.
//   S4  Clean stop: SIGINT -> supervisor exits 0, child gone
//       (no orphans), journal 'watchdog-clean-shutdown'.
//   S5  Log relay: child stdout lands in the rotated file log.
// Run: node scripts/smoke_v192.mjs
// ============================================================
import { spawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = path.join(ROOT, '.tmp-smoke-v192');
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

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
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

// ============================================================
async function main() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  console.log('=== v19.2 ANTI-FREEZE SUPERVISOR SMOKE ===');

  // ---------------- S1 + S4: real server under supervisor ----------------
  console.log('\n[S1] Real server under supervisor (supervised boot + ping + health)...');
  const P1 = await freePort();
  const J1 = path.join(TMP, 'journal-real.log');
  const L1 = path.join(TMP, 'server-real.log');
  const h1 = startSupervisor({
    PORT: String(P1), WATCHDOG_PORT: String(P1),
    WATCHDOG_PROBE_MS: '3000', WATCHDOG_FAILS: '2', WATCHDOG_TIMEOUT_MS: '4000',
    WATCHDOG_GRACE_MS: '90000',
    WATCHDOG_LOG_FILE: L1, WATCHDOG_JOURNAL: J1,
    APP_PIN: '987654321',
    TG_TOKEN: '', OLLAMA_URL: '', ALLOWED_ORIGINS: `http://localhost:${P1}`,
  });
  let childPid = null;
  try {
    const pong = await waitFor(() => httpGetJson(P1, '/api/ping', 3000), 60000, 'ping');
    if (pong && pong.status === 200 && pong.json && pong.json.pong === true) {
      childPid = pong.json.pid;
      ok(`/api/ping 200 {pong:true} (pid ${childPid}, up ${pong.json.up}s)`);
    } else bad('/api/ping answered', JSON.stringify(pong));

    const health = await waitFor(() => httpGetJson(P1, '/health', 5000), 20000, 'health');
    if (health && health.json) {
      if (health.json.supervised === true) ok('/health supervised:true (env marker flowed through)');
      else bad('/health supervised flag', String(health.json.supervised));
      if (health.json.consoleguard && typeof health.json.consoleguard === 'object') ok(`/health consoleguard block (${health.json.consoleguard.reason})`);
      else bad('/health consoleguard missing');
      if (health.json.selfheal && health.json.selfheal.armed) ok('/health selfheal.armed:true (v19.1 layer intact under supervisor)');
      else bad('/health selfheal.armed', JSON.stringify(health.json.selfheal).slice(0, 80));
    } else bad('/health payload');

    const supervisedLine = h1.lines.find((l) => l.includes('running under EXTERNAL SUPERVISOR'));
    if (supervisedLine) ok('child relayed "[selfheal] running under EXTERNAL SUPERVISOR"');
    else bad('supervised-mode log line not relayed');

    // ---------------- S4: clean stop ----------------
    console.log('\n[S4] Clean stop (SIGINT -> exit 0, no orphans)...');
    const code = await stopSupervisor(h1, 25000);
    if (code === 0) ok('supervisor exited 0 on SIGINT');
    else bad('supervisor exit code', String(code));
    if (childPid && !pidAlive(childPid)) ok(`child pid ${childPid} gone (no orphan)`);
    else bad('child still alive after stop', String(childPid));
    const j1 = readJournalLines(J1);
    if (j1.some((e) => e.ev === 'watchdog-boot' && e.reason === 'child-start')) ok('journal watchdog-boot recorded');
    else bad('journal watchdog-boot missing');
    if (j1.some((e) => e.ev === 'watchdog-clean-shutdown')) ok('journal watchdog-clean-shutdown recorded');
    else bad('journal clean-shutdown missing');
  } finally {
    await stopSupervisor(h1, 5000);
  }

  // ---------------- S2: FREEZE recovery (THE core proof) ----------------
  console.log('\n[S2] FREEZE recovery (real while(true) event-loop lockup)...');
  const P2 = await freePort();
  const J2 = path.join(TMP, 'journal-frozen.log');
  const L2 = path.join(TMP, 'server-frozen.log');
  const h2 = startSupervisor({
    PORT: String(P2), WATCHDOG_PORT: String(P2),
    WATCHDOG_CHILD: path.join(ROOT, 'scripts', 'fixtures', 'frozenServer.mjs'),
    WATCHDOG_PROBE_MS: '3000', WATCHDOG_FAILS: '2', WATCHDOG_TIMEOUT_MS: '2000',
    WATCHDOG_GRACE_MS: '5000', WATCHDOG_BACKOFF_BASE_MS: '3000',
    WATCHDOG_LOG_FILE: L2, WATCHDOG_JOURNAL: J2,
    FIXTURE_PORT: String(P2), FIXTURE_OK_PINGS: '4',
  });
  try {
    const first = await waitFor(() => httpGetJson(P2, '/api/ping', 2500), 15000, 'first ping');
    if (first && first.status === 200) ok('frozen-fixture booted, ping OK (pre-freeze)');
    else bad('fixture first ping', JSON.stringify(first));

    // fixture freezes after 2 served pings; supervisor needs 2 consecutive
    // probe timeouts -> verdict. Timeline ~ probe4/5 (12-15s).
    const freezeEntry = await waitFor(() => {
      const e = readJournalLines(J2).find((x) => x.ev === 'watchdog-restart' && x.reason === 'freeze');
      return e || null;
    }, 60000, 'freeze verdict');
    if (freezeEntry) ok(`journal 'freeze' verdict: ${freezeEntry.detail} (pid ${freezeEntry.childPid})`);
    else bad('freeze verdict never journaled');

    // Recovery proof (race-free): the restarted fixture prints a SECOND
    // FIXTURE_READY line through the supervisor relay + a 2nd boot journal.
    const secondBoot = await waitFor(() =>
      (readJournalLines(J2).filter((x) => x.ev === 'watchdog-boot').length >= 2)
      && h2.lines.filter((l) => l.includes('FIXTURE_READY')).length >= 2 ? true : null, 30000, 'second boot');
    if (secondBoot) ok('RECOVERED: force-kill ke baad fresh child boot (2nd FIXTURE_READY + 2nd watchdog-boot)');
    else bad('no second boot after freeze recovery');

    const recovered = await waitFor(async () => {
      const r = await httpGetJsonSync(P2);
      return (r && r.status === 200 && r.json && r.json.pong === true) ? r : null;
    }, 9000, 'post-restart ping');
    if (recovered) ok('post-restart /api/ping 200 (recovered child serving)');
    else bad('no ping after freeze recovery (fixture may have re-frozen — boot proof above is authoritative)');
  } finally {
    await stopSupervisor(h2, 8000);
  }

  // ---------------- S3: CRASH recovery ----------------
  console.log('\n[S3] CRASH recovery (exit code 7 -> backoff restart)...');
  const P3 = await freePort();
  const J3 = path.join(TMP, 'journal-crash.log');
  const h3 = startSupervisor({
    PORT: String(P3), WATCHDOG_PORT: String(P3),
    WATCHDOG_CHILD: path.join(ROOT, 'scripts', 'fixtures', 'crashServer.mjs'),
    WATCHDOG_PROBE_MS: '3000', WATCHDOG_FAILS: '3', WATCHDOG_TIMEOUT_MS: '2000',
    WATCHDOG_GRACE_MS: '5000', WATCHDOG_BACKOFF_BASE_MS: '3000',
    WATCHDOG_LOG_FILE: 'off', WATCHDOG_JOURNAL: J3,
    FIXTURE_PORT: String(P3), FIXTURE_MARKER: path.join(TMP, 'crash-marker'),
  });
  try {
    const crashEntry = await waitFor(() => {
      const e = readJournalLines(J3).find((x) => x.ev === 'watchdog-restart' && String(x.reason).startsWith('exit('));
      return e || null;
    }, 30000, 'exit journal');
    if (crashEntry && String(crashEntry.reason).includes('7')) ok(`journal crash exit(7) recorded (uptime ${crashEntry.uptimeSec}s)`);
    else bad('exit(7) never journaled', JSON.stringify(crashEntry));

    const run2 = await waitFor(async () => {
      const r = await httpGetJsonSync(P3);
      return (r && r.json && r.json.run === 2) ? r : null;
    }, 30000, 'run-2 ping');
    if (run2) ok('restart landed: fixture run=2 alive (backoff worked)');
    else bad('no run=2 after crash restart');
  } finally {
    await stopSupervisor(h3, 8000);
  }

  // ---------------- S5: log relay file ----------------
  console.log('\n[S5] Log relay file content...');
  try {
    const l2 = fs.readFileSync(L2, 'utf8');
    if (l2.includes('FIXTURE_READY')) ok('child stdout relayed into server-frozen.log');
    else bad('relay log missing FIXTURE_READY');
    if (l2.includes('[watchdog]')) ok('supervisor status lines in file log');
    else bad('file log missing watchdog lines');
  } catch (err) {
    bad('relay log read', String(err));
  }

  console.log('\n=== SMOKE RESULT ===');
  console.log(`PASS: ${passCount}  FAIL: ${failCount}`);
  if (failures.length) console.log('FAILED:', failures.join(' | '));
  process.exit(failCount === 0 ? 0 : 1);
}

// sync variant for waitFor polls (tiny + bounded)
function httpGetJsonSync(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/ping', timeout: 2500 }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(body) }); } catch { resolve({ status: res.statusCode, json: null }); } });
    });
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve(null); });
    req.on('error', () => resolve(null));
  });
}

main().catch((err) => {
  console.error('[smoke] FATAL:', err);
  process.exit(1);
});
