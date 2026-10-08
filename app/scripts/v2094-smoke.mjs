// ============================================================
// scripts/v2094-smoke.mjs — v20.9.4 BOOT SMOKE (live, in-process)
// ------------------------------------------------------------
// Proves the v20.9.4 auto-trade/bots/signals recheck changes boot
// and behave at the HTTP surface:
//   1. supervisor boot (reconciler cold leader-default must not
//      break boot)
//   2. /api/ping + /api/health report 20.9.4
//   3. login → session cookie
//   4. bots status 200 (tgEnv injection path constructs fine)
//   5. signals board 200 (meta-ensemble wiring constructs fine)
//   6. exec/status 200 (leader-lease + journal-caps code paths load)
//   7. SPA serves + pre-auth 401
// Run: node scripts/v2094-smoke.mjs
// ============================================================
import { spawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let passCount = 0, failCount = 0;
const failures = [];
const ok = (l) => { passCount++; console.log(`  [PASS] ${l}`); };
const bad = (l, d = '') => { failCount++; failures.push(l); console.log(`  [FAIL] ${l}${d ? ` — ${d}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
    srv.on('error', reject);
  });
}

function req(port, urlPath, { method = 'GET', cookie = null, body = null, timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: '127.0.0.1', port, path: urlPath, method, timeout: timeoutMs,
      headers: {
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
        ...(cookie ? { cookie } : {}),
      },
    }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => {
        let j = null; try { j = JSON.parse(b); } catch { /* spa html */ }
        resolve({ status: res.statusCode, json: j, text: b, headers: res.headers });
      });
    });
    r.on('timeout', () => { try { r.destroy(); } catch {} resolve(null); });
    r.on('error', () => resolve(null));
    if (payload) r.write(payload);
    r.end();
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

const PORT = await freePort();
console.log(`\n[v20.9.4 boot smoke] port ${PORT}`);
const child = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), APP_PIN: '2094', SMARTAI_SMOKE: '1' }, stdio: 'ignore',
});
try {
  const ping = await waitFor(async () => {
    const r = await req(PORT, '/api/ping');
    return r && r.status === 200 ? r : null;
  }, 30000, 'boot');
  if (ping) ok('server booted, /api/ping 200'); else bad('server boot', 'no ping within 30s');

  const health = await req(PORT, '/health');
  if (health?.status === 200 && String(health.json?.version || '') === '20.9.4') ok('/health version 20.9.4');
  else bad('/health version', JSON.stringify(health?.json?.version));

  const preAuth = await req(PORT, '/api/bots/status');
  if (preAuth?.status === 401) ok('pre-auth bots/status correctly 401');
  else bad('pre-auth 401', `got ${preAuth?.status}`);

  const login = await req(PORT, '/api/auth/login', { method: 'POST', body: { pin: '2094' } });
  const cookie = login?.headers?.['set-cookie']?.[0]?.split(';')[0] || null;
  if (login?.status === 200 && cookie) ok('login → session cookie');
  else bad('login', `status=${login?.status}`);

  if (cookie) {
    const bots = await req(PORT, '/api/bots/status', { cookie });
    if (bots?.status === 200) ok('bots/status 200 (tgEnv wiring constructs)');
    else bad('bots/status', `status=${bots?.status}`);

    const board = await req(PORT, '/api/ai/signals?market=CRYPTO', { cookie, timeoutMs: 20000 });
    if (board?.status === 200) ok('signals board 200 (meta-ensemble wiring constructs)');
    else bad('signals board', `status=${board?.status}`);

    const exec = await req(PORT, '/api/exec/status', { cookie });
    if (exec?.status === 200) ok('exec/status 200 (leader-lease + caps paths load)');
    else bad('exec/status', `status=${exec?.status}`);

    const agent = await req(PORT, '/api/ai/agent', { cookie, timeoutMs: 15000 });
    if (agent?.status === 200) ok('agent status 200 (leader gate reads fine)');
    else bad('agent status', `status=${agent?.status}`);
  }

  const spa = await req(PORT, '/');
  if (spa?.status === 200 && /<html/i.test(spa?.text || '')) ok('SPA serves');
  else bad('SPA', `status=${spa?.status}`);
} finally {
  try { child.kill('SIGTERM'); } catch {}
  await sleep(600);
  try { child.kill('SIGKILL'); } catch {}
}

console.log(`\n[v20.9.4 boot smoke] ${passCount} pass / ${failCount} fail`);
if (failures.length) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
process.exit(0);
