// v20.9.2 boot smoke — ultrafast chart verification agent release gate.
// Boots the real server on a free port, then probes the live surfaces
// this release touched: ping/version 20.9.2, login, the UCV-A1 module
// import chain (board wiring), signal-recheck panel, SPA, pre-auth 401.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP = process.env.SMARTTEST_APP_DIR || new URL('../app/', import.meta.url).pathname;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), `v2092-smoke-${Date.now()}-`));
const PORT = 18000 + (process.pid % 2000);
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const server = spawn('node', ['server/index.js'], {
  cwd: APP,
  env: { ...process.env, PORT: String(PORT), SMARTAI_DATA_DIR: DATA, APP_PIN: 'smoke-pin-2092' },
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
  check('ping 200 + version 20.9.2', ping.status === 200 && ping.j?.v === '20.9.2', `v=${ping.j?.v}`);

  // login (httpOnly cookie + Bearer token)
  const login = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: 'smoke-pin-2092' }),
  });
  const token = login.j?.token || login.j?.sessionToken || null;
  check('login 200 + token', login.status === 200 && !!token, `status=${login.status}`);
  const auth = { Authorization: `Bearer ${token || ''}` };

  // pre-auth 401 stays honest (no regression)
  const pre = await api('/api/ai/signals?market=CRYPTO');
  check('pre-auth boards 401', pre.status === 401);

  // the signal-recheck panel (UC row view rides this surface)
  const recheck = await api('/api/ai/signal-recheck', { headers: auth });
  check('signal-recheck panel 200', recheck.status === 200 && recheck.j?.ok === true,
    `watched=${recheck.j?.watched ?? '?'}`);

  // the crypto board boots (UCV-A1 rides this path; may be empty off-hours)
  const board = await api('/api/ai/signals?market=CRYPTO', { headers: auth, }, 45000);
  check('crypto board 200', board.status === 200 && board.j?.ok !== false,
    `signals=${Array.isArray(board.j?.signals) ? board.j.signals.length : '?'}`);

  // SPA serves
  const spa = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(10000) }).catch(() => null);
  check('SPA 200', !!spa && spa.ok);

  // the UCV-A1 layer must never crash the boot
  check('no ultrafast boot errors', !/UCV-A1|ultrafast/i.test(logBuf.slice(-8000)) || !/Error/i.test(logBuf.match(/[\s\S]*ultrafast[\s\S]*/i)?.[0]?.slice(0, 2000) || ''));
} finally {
  server.kill('SIGTERM');
  await sleep(300);
  server.kill('SIGKILL');
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* tmp */ }
}

const failed = results.filter(r => !r.ok);
console.log(`\n${failed.length === 0 ? 'ALL PASS' : `${failed.length} FAILED`} — ${results.length} checks`);
process.exit(failed.length === 0 ? 0 : 1);
