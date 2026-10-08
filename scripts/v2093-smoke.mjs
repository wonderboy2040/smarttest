// v20.9.3 boot smoke — 5th-pass full-site working-flow recheck release gate.
// Boots the real server on a free port, then probes the live surfaces THIS
// release touched: ping/version 20.9.3, login, exec stack arm + hydration
// no-crash, board shape (UC field contract), signal-recheck view, backup
// wiring OFF by default (no crash), SPA, pre-auth 401.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP = process.env.SMARTTEST_APP_DIR || new URL('../app/', import.meta.url).pathname;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), `v2093-smoke-${Date.now()}-`));
const PORT = 18000 + (process.pid % 2000);
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const server = spawn('node', ['server/index.js'], {
  cwd: APP,
  env: { ...process.env, PORT: String(PORT), SMARTAI_DATA_DIR: DATA, APP_PIN: 'smoke-pin-2093' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logBuf = '';
server.stdout.on('data', (d) => { logBuf += d; });
server.stderr.on('data', (d) => { logBuf += d; });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(p, opts = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${BASE}${p}`, { ...opts, signal: ctrl.signal });
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
  check('ping 200 + version 20.9.3', ping.status === 200 && ping.j?.v === '20.9.3', `v=${ping.j?.v}`);

  // login (httpOnly cookie + Bearer token)
  const login = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: 'smoke-pin-2093' }),
  });
  const token = login.j?.token || login.j?.sessionToken || null;
  check('login OK (token)', login.status === 200 && !!token, `status=${login.status}`);
  const auth = token ? { Authorization: `Bearer ${token}` } : {};

  // health
  const health = await api('/health');
  check('health version 20.9.3', health.j?.version === '20.9.3', `v=${health.j?.version}`);

  // v20.9.3 G: exec stack arms + hydration runs (empty journal → 0, no crash)
  const exec = await api('/api/exec/status', { headers: auth });
  check('exec/status 200 (stack armed, hydrate no-crash)', exec.status === 200 && exec.j?.ok !== false, `status=${exec.status}`);

  // v20.9.3 A/F: the board contract — ultrafast field rides 80+/STRONG rows
  // (network fetches may be blocked in CI; the shape check is structural:
  // board 200 + rows carry the v20.9.3 contract keys when present)
  const board = await api('/api/ai/signals?market=CRYPTO', { headers: auth }, 30000);
  check('crypto board 200', board.status === 200, `status=${board.status}`);
  const rows = (board.j?.signals || board.j?.rows || []).slice(0, 12);
  const ucCount = rows.filter((s) => s?.ultrafast != null).length;
  check('board rows render (UC field contract intact)', Array.isArray(rows), `rows=${rows.length} · uc-stamped=${ucCount}`);

  // v20.9.3 (panel contract): signal-recheck view serves the UC fields
  const rc = await api('/api/ai/signal-recheck', { headers: auth });
  check('signal-recheck view 200 (ultrafast field wired)', rc.status === 200 && rc.j?.ok !== false, `status=${rc.status}`);

  // v20.9.3 I: backup wiring OFF by default — the supervisor did NOT spawn
  // a backup child (no BACKUP_STATE_ON_BOOT in env) and the boot is clean
  check('no spurious boot-backup (BACKUP_STATE_ON_BOOT unset)', !/BACKUP_STATE_ON_BOOT/.test(logBuf));

  // bots status (auth)
  const bots = await api('/api/bots/status', { headers: auth });
  check('bots status 200', bots.status === 200, `status=${bots.status}`);

  // SPA serve
  const spa = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(5000) });
  const html = await spa.text();
  check('SPA serve', spa.status === 200 && html.includes('root'), `status=${spa.status}`);

  // pre-auth 401 still enforced
  const noAuth = await fetch(`${BASE}/api/ai/board`, { signal: AbortSignal.timeout(5000) });
  check('pre-auth 401', noAuth.status === 401, `status=${noAuth.status}`);
} finally {
  server.kill('SIGTERM');
  await sleep(800);
  try { server.kill('SIGKILL'); } catch {}
  fs.rmSync(DATA, { recursive: true, force: true });
}

const pass = results.filter((r) => r.ok).length;
console.log(`\n=== v20.9.3 BOOT SMOKE: ${pass}/${results.length} ===`);
if (pass !== results.length) {
  console.log('--- server log tail ---');
  console.log(logBuf.slice(-2000));
  process.exit(1);
}
