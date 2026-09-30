#!/usr/bin/env node
// v19.0 SELF-IMPROVEMENT ENGINE boot smoke
// A) Server boots with the new scheduler wiring (top-level await import
//    block) — [selfimprove] arm line present, /health 200, app never
//    bricks. ML service dead at 127.0.0.1:1 (retrain bridge honest-down).
// B) /api/ai/self/status responds with the full phase shape (data /
//    drift / learning / lessons / evolution / governance + stage).
// C) /api/ai/self/harvest works (0 rows honest) + /api/ai/self/repair
//    ladder completes without killing the server.
// D) Kill-switch: SELFIMPROVE_ENABLED=false → disabled arm line, server
//    still boots, /api/ai/self/status still serves (monitoring path).
// E) Agent scope: /api/ai/trading/state → desks.spot === false (v19.0
//    user spec) with futures + global ON.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 8096;
let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

function bootServer(extraEnv, { timeoutMs = 50000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['server/index.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: 'production',
        ML_SERVICE_URL: 'http://127.0.0.1:1',
        APP_PIN: 'SmokePin123456',
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const collect = (chunk) => { out += chunk.toString(); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const done = (result) => {
      clearInterval(watch);
      clearTimeout(killer);
      resolve({ child, out, ...result });
    };
    const watch = setInterval(() => {
      if (out.includes(`server on :${PORT}`)) done({ booted: true, code: null });
    }, 200);
    child.on('exit', (code) => done({ booted: false, code }));
    const killer = setTimeout(() => {
      child.kill('SIGKILL');
      done({ booted: false, code: 'timeout' });
    }, timeoutMs);
    killer.unref?.();
  });
}

const kill = (child) => new Promise((r) => {
  if (!child || child.exitCode !== null) return r();
  child.on('exit', r);
  try { child.kill('SIGKILL'); } catch { /* gone */ }
  setTimeout(() => r(), 3000).unref?.(); // hard reap bound
});

/** wait until the port is actually free (previous child reaped) */
const waitPortFree = async (port, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const ok = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) }).then(() => false).catch(() => true);
    if (ok) return true;
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
};

let _cookie = '';
async function login() {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: 'SmokePin123456' }),
  });
  _cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  return r.ok;
}

async function api(pathname, { method = 'GET' } = {}) {
  const r = await fetch(`http://127.0.0.1:${PORT}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(_cookie ? { cookie: _cookie } : {}) },
    body: method === 'POST' ? '{}' : undefined,
    signal: AbortSignal.timeout(30000),
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

const tmp = mkdtempSync(path.join(tmpdir(), 'smoke-v19-'));

// ---- A/B/C/E: default arm ----
{
  const child = await bootServer({ SMARTAI_DATA_DIR: tmp });
  check('A) server boots with self-improve scheduler (no brick)', child.booted, child.booted ? '' : `code=${child.code}`);
  await new Promise(r => setTimeout(r, 2500)); // let the post-listen arm block land
  check('A2) [selfimprove] arm line logged', child.out.includes('[selfimprove]'), child.out.split('\n').filter(l => l.includes('selfimprove')).slice(0, 2).join(' | ') || 'no line');
  const health = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  check('A3) /health 200', !!health && health.ok);
  await login();
  const st = await api('/api/ai/self/status');
  check('B) /api/ai/self/status 200 + engine v19', st.status === 200 && String(st.json?.engine || '').includes('v19'), `status ${st.status}`);
  const ph = st.json?.phases || {};
  check('B2) all six phases present', !!(ph.data && ph.drift && ph.learning && ph.lessons && ph.evolution && ph.governance));
  check('B3) stage ladder present', st.json?.stage?.name != null, `stage ${JSON.stringify(st.json?.stage || {}).slice(0, 80)}`);
  const h = await api('/api/ai/self/harvest', { method: 'POST' });
  check('C) harvest endpoint honest (0 fresh rows ok)', h.status === 200 && h.json?.ok === true && Number.isInteger(h.json?.total), `total ${h.json?.total}`);
  const rep = await api('/api/ai/self/repair', { method: 'POST' });
  check('C2) self-repair ladder completes (server alive)', rep.status === 200 && Array.isArray(rep.json?.actions) && rep.json.actions.length >= 3, `${(rep.json?.actions || []).length} steps`);
  const health2 = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  check('C3) /health 200 AFTER repair (no suicide)', !!health2 && health2.ok);
  const tr = await api('/api/ai/agent');
  const desks = tr.json?.config?.desks;
  check('E) v19.0 desk scope — spot OFF, futures+global ON (/api/ai/agent)', !!desks && desks.spot === false && desks.futures === true && desks.global === true, JSON.stringify(desks));
  const gov = await api('/api/ai/self/proposals');
  check('B4) proposals governance surface', gov.status === 200 && gov.json?.killSwitch != null);
  await kill(child.child);
  await waitPortFree(PORT);
}

// ---- D: kill-switch arm ----
{
  const tmp2 = mkdtempSync(path.join(tmpdir(), 'smoke-v19-ks-'));
  const child = await bootServer({ SMARTAI_DATA_DIR: tmp2, SELFIMPROVE_ENABLED: 'false' });
  check('D) kill-switch boot (SELFIMPROVE_ENABLED=false, no brick)', child.booted, child.booted ? `pid=${child.child?.pid}` : `code=${child.code} :: ${child.out.split('\n').slice(-6).join(' | ').slice(0, 400)}`);
  await new Promise(r => setTimeout(r, 2000));
  check('D2) disabled arm line logged', child.out.includes('SELF-IMPROVEMENT ENGINE DISABLED'));
  await login(); // fresh session — the new boot signs its own cookies
  const st = await api('/api/ai/self/status');
  check('D3) status still serves in disabled mode (monitoring path)', st.status === 200 && st.json?.ok === true);
  const ks = await api('/api/ai/self/proposals');
  check('D4) kill-switch visible in governance', ks.json?.killSwitch?.enabled === false);
  await kill(child.child);
  await waitPortFree(PORT);
  rmSync(tmp2, { recursive: true, force: true });
}

rmSync(tmp, { recursive: true, force: true });
console.log(failures === 0 ? '\nSMOKE v19.0: ALL PASS' : `\nSMOKE v19.0: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
