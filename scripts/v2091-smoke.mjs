// v20.9.1 boot smoke — full-site deep-recheck release gate.
// Boots the real server on a free port, then probes the live surfaces
// this release touched: ping/version 20.9.1, login, protrader gates,
// ml/signals honest 410, wallet, bots status, SPA, pre-auth 401.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP = process.env.SMARTTEST_APP_DIR || new URL('../app/', import.meta.url).pathname;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), `v2091-smoke-${Date.now()}-`));
const PORT = 18000 + (process.pid % 2000);
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const server = spawn('node', ['server/index.js'], {
  cwd: APP,
  env: { ...process.env, PORT: String(PORT), SMARTAI_DATA_DIR: DATA, APP_PIN: 'smoke-pin-2091' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logBuf = '';
server.stdout.on('data', (d) => { logBuf += d; });
server.stderr.on('data', (d) => { logBuf += d; });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(path, opts = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${BASE}${path}`, { ...opts, signal: ctrl.signal });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, j };
  } finally { clearTimeout(t); }
}

try {
  // wait for boot
  let up = false;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try {
      const r = await fetch(`${BASE}/api/ping`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) { up = true; break; }
    } catch { /* booting */ }
  }
  check('server boot', up);

  const ping = await api('/api/ping');
  check('ping 200 + version 20.9.1', ping.status === 200 && ping.j?.v === '20.9.1', `v=${ping.j?.v}`);

  // login (httpOnly cookie + Bearer token)
  const login = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: 'smoke-pin-2091' }),
  });
  const token = login.j?.token || login.j?.sessionToken || null;
  check('login OK (token)', login.status === 200 && !!token, `status=${login.status}`);
  const auth = token ? { Authorization: `Bearer ${token}` } : {};

  // health
  const health = await api('/health');
  check('health version 20.9.1', health.j?.version === '20.9.1', `v=${health.j?.version}`);

  // v20.9.1 [H2]: ml/signals retired honestly — 410 with guidance
  const mlSig = await api('/api/ml/signals', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{}' });
  check('ml/signals honest 410 (hardcoded HOLD-30 gone)', mlSig.status === 410, `status=${mlSig.status}`);

  // ml predict still REAL (public)
  const mlP = await api('/api/ml/predict', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol: 'TEST', market: 'IN', price: 100, change: 5, rsi: 55 }),
  });
  check('ml/predict still live 200 + heuristic-v1 label', mlP.status === 200 && String(mlP.j?.model || '').includes('heuristic-v1'), `status=${mlP.status}`);

  // protrader status — TP gates + hard-gate caps exposure
  const pta = await api('/api/ai/protrader-auto', { headers: auth });
  check('protrader status 200', pta.status === 200, `status=${pta.status}`);
  check('protrader TP gates exposed', !!pta.j?.gates?.tpExits && pta.j.gates.tpExits.enabled === true && Number(pta.j.gates.tpExits.tp1ClosePct) === 50, JSON.stringify(pta.j?.gates?.tpExits || null));
  check('protrader verified gate 70', Number(pta.j?.gates?.minVerifiedScore) === 70, `=${pta.j?.gates?.minVerifiedScore}`);
  check('protrader hardGate caps exposed', !!pta.j?.gates?.hardGate && Number(pta.j.gates.hardGate.maxDailyLossINR) === 1500 && Number(pta.j.gates.hardGate.maxConsecutiveLosses) === 3, JSON.stringify(pta.j?.gates?.hardGate || null));

  // protrader start (paper) → alreadyRunning semantics
  const st = await api('/api/ai/protrader-auto/start', {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'paper' }),
  });
  check('protrader paper start ok', st.j?.ok === true, JSON.stringify(st.j).slice(0, 80));
  const st2 = await api('/api/ai/protrader-auto/start', {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'paper' }),
  });
  check('alreadyRunning honest (2nd start)', st2.j?.ok === true && st2.j?.alreadyRunning === true, JSON.stringify({ ok: st2.j?.ok, alreadyRunning: st2.j?.alreadyRunning }));
  const sp = await api('/api/ai/protrader-auto/stop', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{}' });
  check('protrader stop ok', sp.j?.ok === true);

  // wallet route — mini-cache + never-throws shape
  const w1 = await api('/api/ai/wallet', { headers: auth });
  check('wallet snapshot 200 + ok:true', w1.status === 200 && w1.j?.ok === true, `status=${w1.status}`);
  const w2 = await api('/api/ai/wallet', { headers: auth });
  check('wallet cached pass (same fetchedAt within 10s)', w2.j?.fetchedAt === w1.j?.fetchedAt, `t1=${w1.j?.fetchedAt} t2=${w2.j?.fetchedAt}`);

  // bots status (auth) — telegram wiring is compile-time; runtime 200 proves the route boots
  const bots = await api('/api/bots/status', { headers: auth });
  check('bots status 200', bots.status === 200, `status=${bots.status}`);

  // bots events (auth) — flat-layout events endpoint alive
  const ev = await api('/api/bots/events?limit=5', { headers: auth });
  check('bots events 200 (flat-layout journal readable)', ev.status === 200, `status=${ev.status}`);

  // SPA serve
  const spa = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(5000) });
  const html = await spa.text();
  check('SPA serve', spa.status === 200 && html.includes('root'), `status=${spa.status}`);

  // pre-auth 401 still enforced
  const noAuth = await fetch(`${BASE}/api/ai/protrader-auto`, { signal: AbortSignal.timeout(5000) });
  check('pre-auth 401', noAuth.status === 401, `status=${noAuth.status}`);
} finally {
  server.kill('SIGTERM');
  await sleep(800);
  try { server.kill('SIGKILL'); } catch {}
  fs.rmSync(DATA, { recursive: true, force: true });
}

const pass = results.filter((r) => r.ok).length;
console.log(`\n=== v20.9.1 BOOT SMOKE: ${pass}/${results.length} ===`);
if (pass !== results.length) {
  console.log('--- server log tail ---');
  console.log(logBuf.slice(-2000));
  process.exit(1);
}
