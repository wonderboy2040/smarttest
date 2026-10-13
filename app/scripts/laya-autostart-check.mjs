#!/usr/bin/env node
// ============================================================
// scripts/laya-autostart-check.mjs — v21.10 WATCHDOG WAR-GUARD
// ------------------------------------------------------------
// EXIT CODES (Start-SmartAI-Watchdog.bat inko puchta hai):
//   0 = supervisor sidecar Laya ko manage karega — bat ka Laya
//       fallback block SKIP ho jayega (single-owner, war impossible)
//   1 = bat fallback allowed (LAYA_AUTOSTART off / config adhi /
//       .env gayab) — bat apna purana health-check + start-laya.cmd
//       fallback chala sakta hai
//
// LIVE BUG (v21.6-v21.9) jise ye roka: watchdog bat ka Laya block
// UNCONDITIONALLY chalta tha — LAYA_AUTOSTART=1 hone par SUPERVISOR
// SIDECAR bhi laya-serve spawn karta tha. Bat ka 2s curl-probe
// booting-laya ko pakad nahi paata (~8-10s lagta hai) → DONO spawn →
// port 8000 pe [Errno 10048] bind-war → exit(3) crash-loop
// (5s→10s→20s→40s backoff) + CPU churn + event-loop freeze warnings.
//
// YE SCRIPT sidecar ke EXACT parser/conditions use karti hai
// (parseDotEnvKeys: BOM/CRLF/quotes/comments; loopback gate) — dono
// layers kabhi disagree nahi kar sakte. Real process-env hamesha
// .env jeet-ta hai (dotenv parity).
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDotEnvKeys, parseBaseUrl } from '../server/layaSidecar.js';

const appRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let dotEnv = {};
try {
  dotEnv = parseDotEnvKeys(fs.readFileSync(path.join(appRoot, '.env'), 'utf8'));
} catch { /* .env optional hai — env-only config bhi valid */ }

const val = (key) => (Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : dotEnv[key]);
const flag = (v) => String(v ?? '').trim() === '1';

// Sidecar ke "armed" hone ka EXACT condition mirror (layaSidecar.js
// _startCore): autostart + enabled + apiKey + loopback. Koi bhi condition
// fail = sidecar spawn nahi karega = bat fallback hi akela owner.
const armed = flag(val('LAYA_AUTOSTART'))
  && flag(val('LAYA_ENABLED'))
  && String(val('LAYA_API_KEY') || '').trim() !== ''
  && parseBaseUrl(String(val('LAYA_BASE_URL') || 'http://127.0.0.1:8000')).loopback;

process.exit(armed ? 0 : 1);
