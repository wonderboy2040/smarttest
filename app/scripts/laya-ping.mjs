#!/usr/bin/env node
// ============================================================
// scripts/laya-ping.mjs — v21.9.0 Laya connectivity self-check
// ------------------------------------------------------------
// MISSING-FILE RESTORE: ye script .env.example (Laya section) aur
// server/bots/smoke.js dono me referenced thi par repo me kabhi
// commit hi nahi hui thi — "node scripts/laya-ping.mjs se T1-T5
// test karo" hint ek dead path tha. Ab ye exist karti hai:
//
//   1. /health probe — laya-serve zinda hai?
//   2. Auto-link status — site ne key detect ki ya nahi
//      (stateDir/laya_autolink.json)
//   3. REAL /v1/systemone ping — T1-T5 contract (auth, latency,
//      choice shape, probabilities) layaPing() se
//
// Usage: node scripts/laya-ping.mjs
// Exit:  0 = PASS · 1 = FAIL/SKIPPED (CI-safe)
// ============================================================
import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { providerConfig } from '../server/bots/jevEngine.js';
import { layaPing } from '../server/bots/aiProviders.js';
import { readLayaAutoLink } from '../server/bots/layaAutoLink.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const stateDir = process.env.BOT_STATE_DIR
  ? path.resolve(process.env.BOT_STATE_DIR)
  : path.join(appRoot, 'data', 'bots');

const baseUrl = String(process.env.LAYA_BASE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const bar = '─'.repeat(56);
console.log(bar);
console.log('Laya ping — local laya-serve connectivity check');
console.log(bar);
console.log(`base url : ${baseUrl}`);
console.log(`stateDir : ${stateDir}`);

// ---- T0: /health probe ----
let health = 'DOWN';
try {
  const r = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
  health = r.status < 500 ? `UP (HTTP ${r.status})` : `BAD (HTTP ${r.status})`;
} catch (e) {
  health = `DOWN (${String(e?.message || e).slice(0, 60)})`;
}
console.log(`health   : ${health}`);

// ---- T0.5: auto-link record ----
const auto = readLayaAutoLink(stateDir);
console.log(`autolink : ${auto ? `key ${auto.key.slice(0, 3)}… (${auto.source ?? 'persisted'}, ${new Date(auto.at).toISOString()})` : 'no persisted record'}`);

// ---- T1-T5: the real ping ----
const cfg = providerConfig('laya', process.env);
console.log(`endpoint : ${cfg.url}`);
console.log(`key      : ${process.env.LAYA_API_KEY ? `${process.env.LAYA_API_KEY.slice(0, 3)}… (${process.env.LAYA_API_KEY.length}ch)` : '(empty — LAYA_API_KEY set nahi)'}`);
const res = await layaPing({ env: process.env });
console.log(bar);
console.log(JSON.stringify(res, null, 2));
console.log(bar);

if (res.status === 'PASS') {
  console.log(`VERDICT: PASS — choice=${res.choice} · ${res.latencyMs}ms${res.probabilities ? ' · probabilities mile' : ' · probabilities ABSENT (T4 shape check karo)'}`);
  process.exit(0);
}
if (res.status === 'SKIPPED') {
  console.log('VERDICT: SKIPPED — LAYA_ENABLED=1 + LAYA_API_KEY .env me daalo (ya layaAutoLink khud detect karega jab laya-serve chalega).');
  process.exit(1);
}
console.log(`VERDICT: FAIL — ${res.error || `HTTP ${res.http}`}`);
if (String(res.http) === '401' || /401|403/.test(String(res.error))) {
  console.log('hint: server zinda hai par key reject hui — .env ki LAYA_API_KEY = wahi key jisse laya-serve chala hai.');
}
if (health.startsWith('DOWN')) {
  console.log('hint: /health bhi down hai — laya-serve chalu hai? (start-laya.cmd ya Start-SmartAI-Watchdog.bat)');
  try {
    const exe = process.env.LAYA_SERVE_CMD || (process.platform === 'win32'
      ? path.join(process.env.LAYA_HOME || 'C:\\laya-env', 'Scripts', 'laya-serve.exe')
      : path.join(process.env.LAYA_HOME || '/opt/laya-env', 'bin', 'laya-serve'));
    console.log(`hint: expected exe: ${exe} (exists: ${fs.existsSync(exe)})`);
  } catch { /* best-effort */ }
}
process.exit(1);
