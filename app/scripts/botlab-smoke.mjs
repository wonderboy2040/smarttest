#!/usr/bin/env node
// ============================================================
// app/scripts/botlab-smoke.mjs — Jev Bot Lab Phase 0 (plan §4)
// ------------------------------------------------------------
// Usage:
//   node scripts/botlab-smoke.mjs
//   DHAN_FROM=2026-08-01 DHAN_TO=2026-09-30 node scripts/botlab-smoke.mjs
// Runs the three smoke tests and prints the §4.4 decision matrix.
// Honest by design: SKIPPED for missing creds, never a fake pass.
// ============================================================
import 'dotenv/config';
import { smokeAll } from '../server/bots/smoke.js';

const pad = (s, n) => String(s).padEnd(n);

console.log('=== Jev Bot Lab — Phase 0 smoke tests ===\n');
// v20.8.1 FIX (H2): the documented DHAN_FROM/DHAN_TO env range was dead —
// a typo (TO_DAN) AND an inverted ternary that passed null either way.
const dhanRange = (process.env.DHAN_FROM && process.env.DHAN_TO)
  ? { fromDate: process.env.DHAN_FROM, toDate: process.env.DHAN_TO }
  : undefined;
const { results, verdict } = await smokeAll({ dhanRange });

for (const r of results) {
  console.log(`[${r.status}] ${r.name}`);
  for (const [k, v] of Object.entries(r)) {
    if (['name', 'status'].includes(k)) continue;
    console.log(`   ${pad(k, 14)} ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  }
  console.log('');
}

console.log('--- Decision matrix (plan §4.4) ---');
console.log(`India desk : ${verdict.indiaDesk}`);
console.log(`Jev arm    : ${verdict.jevArm}`);
console.log(`Crypto desk: ${verdict.cryptoDesk}`);

const failed = results.filter(r => r.status === 'FAIL').length;
const skipped = results.filter(r => r.status === 'SKIPPED').length;
console.log(`\nSummary: ${results.filter(r => r.status === 'PASS').length} PASS, ${results.filter(r => r.status === 'PARTIAL').length} PARTIAL, ${failed} FAIL, ${skipped} SKIPPED`);
process.exit(failed > 0 ? 1 : 0);
