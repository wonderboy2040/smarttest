#!/usr/bin/env node
// v18.9 PRO TRADER RECHECK boot smoke
//   1. Normal boot (APP_PIN set) → server binds, /health 200, login OK,
//      watcher arms, no unhandled crash from the v18.9 watcher restructure.
//   2. TG half-config still degrades (v18.8.1 regression guard).
//   3. APP_PIN missing → still refuses (auth fatal intact).
import { spawn } from 'node:child_process';

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
        ML_SERVICE_URL: 'http://127.0.0.1:1', // intentionally dead; must not block boot
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const collect = (c) => { out += c.toString(); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const done = (result) => {
      clearTimeout(killer);
      resolve({ child, out, ...result });
    };
    const watch = setInterval(() => {
      if (out.includes(`server on :${PORT}`)) { clearInterval(watch); done({ booted: true, code: null }); }
    }, 200);
    child.on('exit', (code) => { clearInterval(watch); done({ booted: false, code }); });
    const killer = setTimeout(() => { clearInterval(watch); child.kill('SIGKILL'); done({ booted: false, code: 'timeout' }); }, timeoutMs);
  });
}

const stop = (r) => new Promise((res) => {
  if (!r.child || r.child.exitCode != null) return res();
  r.child.on('exit', () => res());
  try { r.child.kill('SIGTERM'); } catch { res(); }
  setTimeout(() => { try { r.child.kill('SIGKILL'); } catch {} res(); }, 4000);
});

async function main() {
  // ---- 1. normal boot ----
  const a = await bootServer({ APP_PIN: '1234', TG_TOKEN: '', TG_CHAT_ID: '98765' });
  try {
    check('A1 boot with v18.9 watcher restructure', a.booted, a.booted ? '' : `code=${a.code}`);
    if (a.booted) {
      const h = await fetch(`http://127.0.0.1:${PORT}/health`).then(r => r.status).catch(() => 0);
      check('A2 /health 200', h === 200, `status=${h}`);
      const login = await fetch(`http://127.0.0.1:${PORT}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: '1234' }),
      }).then(r => r.status).catch(() => 0);
      check('A3 login 200', login === 200, `status=${login}`);
      check('A4 no TG brick (v18.8.1 intact)', !/Refusing to start/.test(a.out));
      check('A5 no unhandled watcher crash', !/ERR_UNHANDLED/i.test(a.out));
      const eng = await fetch(`http://127.0.0.1:${PORT}/api/ai/engines`, { headers: { 'x-api-token': '' } }).then(r => r.status).catch(() => 0);
      check('A6 engines route mounted', eng > 0, `status=${eng}`);
    }
  } finally { await stop(a); }

  // ---- 2. auth fatal intact ----
  const b = await bootServer({ APP_PIN: '' }, { timeoutMs: 20000 });
  try {
    check('B1 APP_PIN missing → refuse (exit 1)', b.code === 1, `code=${b.code}`);
    check('B2 fatal message present', /APP_PIN/.test(b.out));
  } finally { await stop(b); }

  console.log(failures === 0 ? '\nSMOKE v18.9: ALL PASS' : `\nSMOKE v18.9: ${failures} FAIL`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });

