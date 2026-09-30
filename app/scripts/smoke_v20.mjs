// ============================================================
// smoke_v20.mjs — v20.0 FULL-STACK BOOT SMOKE
// Boots the REAL server (real index.js) with the NEW v20 build:
//   V1  /api/ping liveness
//   V2  / serves the v20 index.html (SmartAI Pro v20 title)
//   V3  /api/auth/login server-side PIN works
//   V4  /health supervised + selfheal + consoleguard blocks
//   V5  /api/stream SSE endpoint alive (desk data path)
//   V6  login page served + hashed asset referenced exists in dist
// Run: node scripts/smoke_v20.mjs
// ============================================================
import { spawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs';
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

function req(port, urlPath, { method = 'GET', body = null, timeoutMs = 6000 } = {}) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: '127.0.0.1', port, path: urlPath, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: timeoutMs,
    }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => {
        let j = null; try { j = JSON.parse(b); } catch { /* html */ }
        resolve({ status: res.statusCode, body: b, json: j });
      });
    });
    r.on('timeout', () => { try { r.destroy(); } catch {} resolve(null); });
    r.on('error', () => resolve(null));
    if (payload) r.write(payload);
    r.end();
  });
}

async function waitFor(fn, ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const r = await fn();
    if (r) return r;
    await sleep(400);
  }
  return null;
}

async function main() {
  console.log('=== v20.0 FULL-STACK BOOT SMOKE (real server + new build) ===');
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    bad('dist/index.html exists (pehle npm run build chalao)');
    process.exit(1);
  }

  const PORT = await freePort();
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), APP_PIN: '987654321', TG_TOKEN: '', OLLAMA_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = [];
  child.stdout.on('data', (d) => { const t = String(d); out.push(...t.split('\n').filter(Boolean)); });
  child.stderr.on('data', (d) => out.push('[err] ' + String(d).trim()));

  try {
    // V1 ping
    const pong = await waitFor(() => req(PORT, '/api/ping', { timeoutMs: 3000 }), 60000);
    if (pong && pong.status === 200 && pong.json?.pong === true) ok(`/api/ping 200 (pid ${pong.json.pid})`);
    else bad('/api/ping', JSON.stringify(pong)?.slice(0, 120));

    // V2 index.html = v20 shell
    const idx = await req(PORT, '/');
    if (idx && idx.status === 200 && /SmartAI Pro v20/.test(idx.body)) ok('/ serves SmartAI Pro v20 shell');
    else bad('/ serves v20 shell', String(idx?.status));

    // V6 referenced hashed asset exists
    const m = idx && idx.body.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/);
    if (m && fs.existsSync(path.join(ROOT, 'dist', 'assets', m[1]))) ok(`hashed shell chunk ${m[1]} on disk`);
    else bad('hashed shell chunk', m ? m[1] : 'not referenced');

    // V3 auth login
    const login = await req(PORT, '/api/auth/login', { method: 'POST', body: { pin: '987654321' } });
    if (login && login.status === 200 && login.json?.sessionToken) ok('/api/auth/login PIN -> sessionToken');
    else bad('/api/auth/login', String(login?.status));

    // V4 health blocks
    const health = await req(PORT, '/health');
    if (health && health.json) {
      if (health.json.selfheal?.armed) ok('/health selfheal.armed:true');
      else bad('/health selfheal.armed');
      if (health.json.consoleguard) ok('/health consoleguard present');
      else bad('/health consoleguard');
    } else bad('/health payload');

    // V5 SSE stream head (auth'd) — SSE connections stay open forever, so
    // read status + content-type headers then destroy the socket (a full
    // body read would hang: 'end' never fires on an event-stream).
    const stream = await new Promise((resolve) => {
      const r = http.get({
        host: '127.0.0.1', port: PORT,
        path: `/api/stream?cx=1&session=${encodeURIComponent(login?.json?.sessionToken || '')}`,
        timeout: 5000,
      }, (res) => {
        const ct = String(res.headers['content-type'] || '');
        resolve({ status: res.statusCode, ct });
        r.destroy(); // done — status line is all we assert
      });
      r.on('timeout', () => { try { r.destroy(); } catch {} resolve(null); });
      r.on('error', () => resolve(null));
    });
    if (stream && stream.status === 200 && /event-stream/i.test(stream.ct)) ok('/api/stream SSE route alive (200, text/event-stream)');
    else bad('/api/stream route', JSON.stringify(stream));

    // v20 boot banner in logs
    // v20.1: banner check is version-prefix tolerant (v20.x)
    const v20line = out.find((l) => /v20\.[0-9]+ TWO-DESK TERMINAL/.test(l));
    if (v20line) ok(`server logged ${v20line.trim().split('] ')[1] || 'v20.x'} banner`);
    else bad('v20.x boot banner in logs');
  } finally {
    child.kill('SIGKILL');
    try { process.kill(child.pid, 0); await sleep(300); } catch { /* gone */ }
  }

  console.log('\n=== SMOKE RESULT ===');
  console.log(`PASS: ${passCount}  FAIL: ${failCount}`);
  if (failures.length) console.log('FAILED:', failures.join(' | '));
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((e) => { console.error('[smoke] FATAL:', e); process.exit(1); });
