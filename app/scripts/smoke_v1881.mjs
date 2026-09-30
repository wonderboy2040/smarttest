#!/usr/bin/env node
// v18.8.1 BRICK-PROOF BOOT smoke test
// Scenario A: TG half-config (TG_TOKEN empty + TG_CHAT_ID set) + valid
//             APP_PIN -> server MUST BOOT (warn + telegram OFF), /health 200,
//             "Refusing to start" NEVER printed.
// Scenario B: APP_PIN missing -> server MUST still exit 1 (auth fatal intact).
import { spawn } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 8099;
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
    const collect = (chunk) => { out += chunk.toString(); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const done = (result) => {
      clearTimeout(killer);
      resolve({ child, out, ...result });
    };
    // Resolve when the port binds OR the process exits early.
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
    child._outRef = { get out() { return out; } };
  });
}

const kill = (child) => new Promise((r) => {
  if (!child || child.exitCode !== null) return r();
  child.on('exit', r);
  child.kill('SIGTERM');
  setTimeout(() => { try { child.kill('SIGKILL'); } catch {} r(); }, 5000).unref?.();
});

// ---------- Scenario A: half TG pair boots ----------
console.log(`\n=== A) TG half-config (TG_TOKEN EMPTY + TG_CHAT_ID set) on :${PORT} ===`);
const a = await bootServer({ APP_PIN: 'SmokePin123456', TG_TOKEN: '', TG_CHAT_ID: '123456789' });
const aOut = a.out;
check('server BOOTED despite half TG pair', a.booted, a.booted ? `exit=${a.code}` : `code=${a.code}`);
check('loud BOTH-set warning printed', aOut.includes('must BOTH be set TOGETHER'));
check('warning names the EMPTY side', aOut.includes('TG_TOKEN=EMPTY') && aOut.includes('TG_CHAT_ID=set'));
check('telegram degraded OFF (not fatal)', aOut.includes('Telegram alerts ab OFF hain'));
check('NO "Refusing to start" ever printed', !aOut.includes('Refusing to start'));
if (a.booted) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(5000) });
    check('/health responds 200', r.status === 200, `status=${r.status}`);
  } catch (e) {
    check('/health responds 200', false, String(e?.message || e));
  }
}
await kill(a.child);

// ---------- Scenario B: APP_PIN missing still refuses ----------
console.log('\n=== B) APP_PIN missing (auth fatal must stay) ===');
const b = await bootServer({ APP_PIN: '', TG_TOKEN: '', TG_CHAT_ID: '' });
check('server REFUSED to start (exit code 1)', b.code === 1, `code=${b.code}`);
check('APP_PIN error printed', b.out.includes('APP_PIN is not set'));
check('"Refusing to start" fatal intact', b.out.includes('Refusing to start due to configuration errors'));

console.log(`\n${failures === 0 ? 'ALL SMOKE CHECKS PASS' : failures + ' SMOKE CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
