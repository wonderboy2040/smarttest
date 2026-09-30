#!/usr/bin/env node
// v18.10 ULTRA-FAST + ENV-CONNECT boot smoke
// A) NO env CoinDCX keys -> server boots, honest "[coindcx-env] no
//    COINDCX_API_KEY" line, /health 200.
// B) ENV keys set + no saved creds -> the bootstrap fires (connector
//    attempt logged as INVALID against the dead network endpoint) and
//    the server STILL boots (never a brick — the Telegram lesson).
// C) /api/feed-status carries the spotWs tier shape (badge honesty).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 8097;
let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

function bootServer(extraEnv, { timeoutMs = 45000 } = {}) {
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
      clearTimeout(killer);
      resolve({ child, out, ...result });
    };
    const watch = setInterval(() => {
      if (out.includes(`server on :${PORT}`)) {
        clearInterval(watch);
        done({ booted: true, code: null });
      }
    }, 200);
    child.on('exit', (code) => {
      clearInterval(watch);
      done({ booted: false, code });
    });
    const killer = setTimeout(() => {
      clearInterval(watch);
      child.kill('SIGKILL');
      done({ booted: false, code: 'timeout' });
    }, timeoutMs);
    killer.unref?.();
  });
}

const kill = (child) => new Promise((r) => {
  if (!child || child.exitCode !== null) return r();
  child.on('exit', r);
  child.kill('SIGTERM');
  setTimeout(() => { try { child.kill('SIGKILL'); } catch {} r(); }, 5000).unref?.();
});

const login = async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin: 'SmokePin123456' }),
    signal: AbortSignal.timeout(8000),
  });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  return { ok: r.ok, cookie };
};

// isolated data dir so the smoke never touches real creds
const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'smartai-smoke-v1810-'));
process.env.SMARTAI_DATA_DIR = DATA_DIR;

console.log(`\n=== A) no env CoinDCX keys (honest no-creds line) on :${PORT} ===`);
const a = await bootServer({ COINDCX_API_KEY: '', COINDCX_SECRET: '' });
check('server BOOTED', a.booted, a.booted ? '' : `code=${a.code}`);
await new Promise(r => setTimeout(r, 1500)); // let the bootstrap line land
const aOut = a.out;
check('[coindcx-env] no-creds line printed', aOut.includes('[coindcx-env] no COINDCX_API_KEY'));
check('no bootstrap CRASH line', !aOut.includes('[coindcx-env] bootstrap failed'));
if (a.booted) {
  const r = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(5000) });
  check('/health responds 200', r.status === 200, `status=${r.status}`);
}
await kill(a.child);

console.log('\n=== B) env keys set (bad pair, dead endpoint) — attempt + NO brick ===');
const b = await bootServer({ COINDCX_API_KEY: 'smoke-bad-key', COINDCX_SECRET: 'smoke-bad-secret' });
check('server BOOTED despite invalid env pair', b.booted, b.booted ? '' : `code=${b.code}`);
await new Promise(r => setTimeout(r, 6000)); // the signed balances call must resolve first
const bOut = b.out;
check('env CONNECT ATTEMPT logged', bOut.includes('[coindcx-env] .env COINDCX keys'));
check('never a brick (no process exit on invalid keys)', bOut.includes('Refusing to start') === false);
if (b.booted) {
  const r = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(5000) });
  check('/health responds 200 after invalid env pair', r.status === 200, `status=${r.status}`);
}
await kill(b.child);

console.log('\n=== C) /api/feed-status carries the spotWs tier ===');
const c = await bootServer({ COINDCX_API_KEY: '', COINDCX_SECRET: '' });
if (c.booted) {
  const lg = await login();
  check('login ok', lg.ok);
  const r = await fetch(`http://127.0.0.1:${PORT}/api/feed-status`, {
    headers: { cookie: lg.cookie },
    signal: AbortSignal.timeout(8000),
  });
  const j = await r.json().catch(() => null);
  check('feed-status 200 + cxRt.spotWs shape', !!j?.cxRt?.spotWs
    && typeof j.cxRt.spotWs.servable === 'boolean'
    && typeof j.cxRt.spotWs.connected === 'boolean',
    JSON.stringify(j?.cxRt?.spotWs || null));
}
await kill(c.child);

try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }

console.log(`\n${failures === 0 ? 'ALL SMOKE CHECKS PASS' : failures + ' SMOKE CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
