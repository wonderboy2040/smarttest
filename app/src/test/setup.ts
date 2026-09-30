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
