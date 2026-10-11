#!/usr/bin/env node
// ============================================================
// app/scripts/laya-ping.mjs — v21.2.0 (dual-provider plan §6)
// ------------------------------------------------------------
// Laya (local open-weight) ka standalone diagnostic — ek REAL call,
// full response print. Compat tests T1-T5 isi se shuru hote hain:
//
//   node scripts/laya-ping.mjs
//   LAYA_BASE_URL=http://127.0.0.1:8000 LAYA_API_KEY=xxx node scripts/laya-ping.mjs
//
// VERDICT line: PASS (choice + probabilities mila) / FAIL / SKIPPED
// (LAYA_ENABLED/LAYA_API_KEY nahi). Exit 1 on FAIL.
//
// Laya install (laptop, PowerShell — README § Laya):
//   python -m venv laya-env ; .\laya-env\Scripts\Activate.ps1
//   python -m pip install "laya[serve]==<pinned>"
//   $env:LAYA_DEVICE="cpu"; $env:LAYA_PRELOAD="1"; $env:LAYA_MODELS="english"
//   $env:LAYA_HOST="127.0.0.1"; $env:LAYA_PORT="8000"
//   $env:LAYA_API_KEY="<32+ char random>"
//   laya-serve
// ============================================================
import 'dotenv/config';

const env = process.env;
const BASE = env.LAYA_BASE_URL || 'http://127.0.0.1:8000';
const KEY = env.LAYA_API_KEY || '';
const URL = String(BASE).replace(/\/+$/, '').endsWith('/v1/systemone')
  ? String(BASE).replace(/\/+$/, '')
  : `${String(BASE).replace(/\/+$/, '')}/v1/systemone`;

const hdr = (s) => `\x1b[${s}m`;
const C = { dim: (t) => `${hdr('2')}${t}${hdr('0')}`, green: (t) => `${hdr('32')}${t}${hdr('0')}`, red: (t) => `${hdr('31')}${t}${hdr('0')}`, amber: (t) => `${hdr('33')}${t}${hdr('0')}`, cyan: (t) => `${hdr('36')}${t}${hdr('0')}` };

console.log(C.cyan('=== Laya ping (local provider) ==='));
console.log(`endpoint : ${URL}`);
console.log(`key      : ${KEY ? 'configured' : C.red('ABSENT')}`);
console.log(`LAYA_ENABLED: ${env.LAYA_ENABLED || '(unset)'}`);

if (!KEY || String(env.LAYA_ENABLED) !== '1') {
  console.log(`\n${C.amber('VERDICT: SKIPPED')} — LAYA_ENABLED=1 + LAYA_API_KEY .env me chahiye (local laya-serve off hai?)`);
  process.exit(0);
}

const t0 = Date.now();
try {
  const r = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    // NOTE: `model` field OMIT (T2 compat) — LAYA_MODEL set hai to wahi
    // bhejte hain (T1: model:"jev-latest" behaviour bhi isi se test hota hai).
    body: JSON.stringify({
      ...(env.LAYA_MODEL ? { model: env.LAYA_MODEL } : {}),
      state: 'Test: NIFTY broke above the 15-minute opening range with volume 1.4x average. ATR range 0.9. Trend up.',
      questions: {
        action: {
          type: 'choice',
          instructions: 'Should the breakout long be taken?',
          criteria: { enter_long: 'Take the long breakout', wait: 'Stand aside' },
        },
      },
    }),
    signal: AbortSignal.timeout(8000),
  });
  const latencyMs = Date.now() - t0;
  const j = await r.json().catch(() => null);
  const a = j?.answers?.action;

  console.log(`\nhttp     : ${r.status} ${r.ok ? C.green('OK') : C.red('ERR')}`);
  console.log(`latency  : ${latencyMs} ms  ${latencyMs < 1000 ? C.green('(CPU-acceptable p95<1s)') : latencyMs > 3000 ? C.red('(SLOW — GPU ya preload check karo)') : C.amber('(borderline)')}`);
  console.log(`choice   : ${a?.choice ?? C.red('null')}`);
  console.log(`probs    : ${a?.probabilities ? JSON.stringify(a.probabilities) : C.red('null')}`);
  console.log(`confidence: ${a?.confidence ?? '—'}`);
  console.log(`usage    : ${j?.usage ? JSON.stringify(j.usage) : '—'}`);

  if (!r.ok) {
    console.log(`\n${C.red('VERDICT: FAIL')} — HTTP ${r.status}. 422 = payload contract mismatch (T3 score criteria array? model name?); 401/403 = LAYA_API_KEY galat; connection refused niche ayega.`);
    process.exit(1);
  }
  if (!a?.choice || !a?.probabilities?.[a.choice]) {
    console.log(`\n${C.red('VERDICT: FAIL')} — 200 mila par answers.action.{choice,probabilities} shape nahi mila. Contract drift — T1-T5 compat tests chalao.`);
    process.exit(1);
  }
  console.log(`\n${C.green('VERDICT: PASS')} — Laya reachable + contract parse OK. Bot Lab me LAYA arm ab available hai (arm dropdown / consensus).`);
  process.exit(0);
} catch (e) {
  const msg = String(e?.message || e);
  const kind = /ECONNREFUSED|fetch failed/i.test(msg) ? 'CONNECTION REFUSED — laya-serve chalu hai? (Laya install steps README § Laya)' : /timeout/i.test(msg) ? 'TIMEOUT — model load ho raha hai (LAYA_PRELOAD=1 + pehli call slow hoti hai)' : 'ERROR';
  console.log(`\n${C.red('VERDICT: FAIL')} — ${kind}`);
  console.log(C.dim(msg));
  process.exit(1);
}
