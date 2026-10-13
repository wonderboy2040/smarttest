import '@testing-library/jest-dom';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync } from 'node:fs';

// ============================================================
// v20.3 TEST-INFRA HYGIENE: one hermetic data dir for EVERY suite.
// ------------------------------------------------------------
// 8 test files (futures, mandateFreeze, trailing, v70-pro-trader,
// aiSecrets, agent, indiaAgent, clearClosedPositions) imported the
// real store WITHOUT an override — running the suite ERASED the
// developer's live server/data journal/config on every run (and that
// polluted state then shipped inside the v20.2 zip). store.js honors
// SMARTAI_DATA_DIR; setting it HERE (before any test imports a server
// module) makes every suite hermetic by default. Per-file overrides
// (the 28 that already set their own) keep winning — they set the env
// before THEY import the store.
// ============================================================
if (!process.env.SMARTAI_DATA_DIR) {
  try {
    process.env.SMARTAI_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'smartai-test-data-'));
  } catch { /* best-effort: fall back to default resolution */ }
}

// ============================================================
// v21.11 TEST-STABILITY PIN: Superintelligence accuracy suite ab
// PRODUCTION DEFAULT ON hai (AI_ENABLE_V2_MODELS / MESH / MTF —
// models.js + meshModels.js). Saare legacy suites (202 files) in
// flags ke unset-default-off assumption pe likhe gaye the — unhe
// yahan explicit 'false' pin karke byte-identical behaviour milta
// hai. Naya default `test/v2111SuperIntelUpgrade.test.ts` me
// subprocess-spawn se test hota hai (env sanitize karke).
// Files jo khud flag set/delete karti hain (v116MeshModels,
// v2Models, mtfAB, intradayMtfConfluence, v118FullCommittee) apne
// value ke saath jeetti hain — ??= sirf unset case pe lagta hai.
// ============================================================
process.env.AI_ENABLE_V2_MODELS ??= 'false';
process.env.AI_ENABLE_MESH_MODELS ??= 'false';
process.env.AI_ENABLE_MTF_CONFLUENCE ??= 'false';

// ============================================================
// v21.11 TEST-LEAK CLEANUP (permanent) — 34 suites app/ root me
// `.test-data-*` dirs chhod jaati thi (user ke box pe 15 dirs / 260KB
// junk jam gaya tha). vitest 4 me globalTeardown option nahi hai, isliye
// setup-file ka afterAll use hota hai — har test FILE ke baad LIFO me
// chalta hai (file ke apne afterAll pehle, ye cleanup sabse aakhri me).
// fileParallelism:false hai — koi concurrent file apna dir use nahi kar
// raha hota cleanup ke waqt.
// ============================================================
import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

afterAll(() => {
  try {
    for (const name of readdirSync(process.cwd())) {
      if (name.startsWith('.test-data-')) {
        try {
          rmSync(path.join(process.cwd(), name), { recursive: true, force: true });
        } catch { /* never fail the suite on cleanup */ }
      }
    }
  } catch { /* cwd unreadable — skip */ }
});
