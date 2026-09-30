#!/usr/bin/env node
// ============================================================
// smoke_v191.mjs — v19.1 NEVER-DOWN GUARD boot smoke
//  1. boot server → /health.selfheal shape (armed, memory, lag,
//     counts, logGovernor, previousRun)
//  2. console carries [selfheal] previous-run verdict
//  3. exit journal boot entry on disk
//  4. REAL uncaughtException in a child process → STAYS ALIVE
//     (the v18.1 behaviour would have exited non-zero)
//  5. SIGTERM → journal clean-shutdown line
//  6. /health 200 throughout
// ============================================================
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const APP = '/home/z/my-project/smartai1';
const JOURNAL = path.join(APP, 'server', 'data', 'exit-reasons.log');
let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); };

const srv = spawn(process.execPath, ['server/index.js'], {
  cwd: APP, env: { ...process.env, PORT: '8081', APP_PIN: '987654321' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let srvOut = '';
srv.stdout.on('data', d => { srvOut += d.toString(); });
srv.stderr.on('data', d => { srvOut += d.toString(); });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const BASE = 'http://127.0.0.1:8081';
async function jf(p, ms = 6000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(BASE + p, { signal: ac.signal }); } finally { clearTimeout(t); }
}

try {
  // 1. boot
  let health = null;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    try { const r = await jf('/health', 3000); if (r.ok) { health = await r.json(); break; } } catch { /* boot */ }
  }
  ok('boot: /health 200 within 60s', !!health);

  const sh = health?.selfheal;
  ok('health.selfheal present', !!sh);
  ok('selfheal.armed=true', sh?.armed === true);
  ok('selfheal.exitOnFatal=false (stay-alive default)', sh?.exitOnFatal === false);
  ok('selfheal.memory.rssMB > 0', Number(sh?.memory?.rssMB) > 0);
  ok('selfheal.memory.limitsMB.rss=1400', sh?.memory?.limitsMB?.rss === 1400);
  ok('selfheal.loopLagMs.max30s is a number', typeof sh?.loopLagMs?.max30s === 'number');
  ok('selfheal.counts block present', !!sh?.counts?.unhandledRejections === true || 'counts' in (sh || {}));
  ok('selfheal.logGovernor.armed=true (governor wrapped console)', sh?.logGovernor?.armed === true);
  ok('selfheal.previousRun reported', !!sh?.previousRun);

  // 2. console verdict line
  await sleep(1500);
  ok('console has [selfheal] previous run line', /\[selfheal\] previous run:/.test(srvOut));
  ok('console has [selfheal] never-down arm or journal line', /selfheal/.test(srvOut));

  // 3. journal boot entry
  await sleep(500);
  const jl = fs.existsSync(JOURNAL) ? fs.readFileSync(JOURNAL, 'utf8').trim().split('\n').filter(Boolean) : [];
  const lastJ = jl.length ? JSON.parse(jl[jl.length - 1]) : null;
  ok(`exit-reasons.log exists with boot entry (${jl.length} lines)`, lastJ?.ev === 'boot');

  // 6. health still 200
  const h2 = await jf('/health'); ok('health still 200 after checks', h2.ok);

  // 5. SIGTERM → clean-shutdown journal
  srv.kill('SIGTERM');
  await sleep(1500);
  const jl2 = fs.readFileSync(JOURNAL, 'utf8').trim().split('\n').filter(Boolean);
  const last2 = JSON.parse(jl2[jl2.length - 1]);
  ok(`SIGTERM journaled as clean-shutdown (${last2.reason})`, last2.ev === 'exit' && String(last2.reason).startsWith('clean-shutdown'));
} catch (e) {
  ok(`smoke crashed: ${e.message}`, false);
} finally {
  try { srv.kill('SIGKILL'); } catch { /* already dead */ }
}

// 4. REAL uncaughtException stay-alive (separate child)
const stayAlive = await new Promise((resolve) => {
  const child = spawn(process.execPath, ['-e', `
    import('${APP}/server/ai/selfHeal.js').then((m) => {
      m.initSelfHeal({ env: {}, getFlushers: () => [], log: () => {} });
      setTimeout(() => { console.log('STILL_ALIVE_AFTER_UNCAUGHT'); process.exit(0); }, 1000);
      setTimeout(() => { throw new Error('synthetic v19.1 crash'); }, 100);
    });
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', d => { out += d.toString(); });
  const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve(false); }, 8000);
  child.on('exit', (code) => {
    clearTimeout(t);
    resolve(code === 0 && out.includes('STILL_ALIVE_AFTER_UNCAUGHT'));
  });
});
ok('REAL uncaughtException → process STAYED ALIVE (exit 0 after)', stayAlive);

console.log(`\n=== smoke v19.1: ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
