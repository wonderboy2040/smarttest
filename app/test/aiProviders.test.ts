// ============================================================
// test/aiProviders.test.ts — v21.2.0 (dual-provider plan Step-2)
// ------------------------------------------------------------
// Provider registry contract:
//   • buildProviders: key/enable flags ke hisaab se jev/laya null
//     ya instance; cache path provider-wise (jev_cache vs laya_cache)
//   • aiModeConfig: AI_PRIMARY / AI_SHADOW / AI_CONSENSUS_ON_DOWN
//     (invalid values safe defaults pe girti hain)
//   • providerHealth: instance absent = configured:false; breaker
//     open = reachable:false
//   • layaPing: not enabled = SKIPPED (honest); PASS on good answer
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildProviders, aiModeConfig, providerHealth, layaPing } from '../server/bots/aiProviders.js';

let tmpDir = '';
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiprov-'));
});

describe('v21.2.0 buildProviders — registry rules', () => {
  it('no keys at all → both null (honest emptiness)', () => {
    const p = buildProviders({}, { stateDir: tmpDir });
    expect(p.jev).toBeNull();
    expect(p.laya).toBeNull();
  });

  it('TYPESAFE_API_KEY only → jev instance, laya null', () => {
    const p = buildProviders({ TYPESAFE_API_KEY: 'k' }, { stateDir: tmpDir });
    expect(p.jev).toBeTruthy();
    expect(typeof p.jev).toBe('function');
    expect(p.laya).toBeNull();
  });

  it('LAYA_ENABLED=1 + LAYA_API_KEY → laya instance (url/model from providerConfig)', () => {
    const p = buildProviders({ LAYA_ENABLED: '1', LAYA_API_KEY: 'lk' }, { stateDir: tmpDir });
    expect(p.laya).toBeTruthy();
    const cfg = (p.laya as any).config();
    expect(cfg.url).toBe('http://127.0.0.1:8000/v1/systemone');
    expect(cfg.model).toBe(''); // field-omit default (T2 compat)
    expect(cfg.threshold).toBe(0.30);
    expect(cfg.timeoutMs).toBe(1500);
  });

  it('LAYA_ENABLED unset/0 (ya key absent) → laya null — opt-in only', () => {
    expect(buildProviders({ LAYA_API_KEY: 'lk' }, { stateDir: tmpDir }).laya).toBeNull();
    expect(buildProviders({ LAYA_ENABLED: '0', LAYA_API_KEY: 'lk' }, { stateDir: tmpDir }).laya).toBeNull();
    expect(buildProviders({ LAYA_ENABLED: '1' }, { stateDir: tmpDir }).laya).toBeNull();
  });

  it('cache files are provider-wise: jev_cache.jsonl vs laya_cache.jsonl', () => {
    const p = buildProviders({ TYPESAFE_API_KEY: 'k', LAYA_ENABLED: '1', LAYA_API_KEY: 'lk' }, { stateDir: tmpDir });
    expect((p.jev as any).config().cachePath).toBe(path.join(tmpDir, 'jev_cache.jsonl'));
    expect((p.laya as any).config().cachePath).toBe(path.join(tmpDir, 'laya_cache.jsonl'));
  });

  it('JEV env overrides flow through the registry (JEV_BASE_URL / JEV_MODEL / JEV_THRESHOLD)', () => {
    const p = buildProviders({
      TYPESAFE_API_KEY: 'k',
      JEV_BASE_URL: 'https://jev.example',
      JEV_MODEL: 'jev-v2',
      JEV_THRESHOLD: '0.45',
    }, { stateDir: tmpDir });
    const cfg = (p.jev as any).config();
    expect(cfg.url).toBe('https://jev.example/v1/systemone');
    expect(cfg.model).toBe('jev-v2');
    expect(cfg.threshold).toBe(0.45);
  });
});

describe('v21.2.0 aiModeConfig — mode flags (safe defaults)', () => {
  it('defaults: primary=laya, shadow=off, onDown=wait', () => {
    const c = aiModeConfig({});
    expect(c).toEqual({ primary: 'laya', shadow: 'off', onDown: 'wait' });
  });

  it('AI_PRIMARY=jev respected; invalid → laya', () => {
    expect(aiModeConfig({ AI_PRIMARY: 'jev' }).primary).toBe('jev');
    expect(aiModeConfig({ AI_PRIMARY: 'gpt' }).primary).toBe('laya');
  });

  it('AI_SHADOW laya|jev respected; anything else → off', () => {
    expect(aiModeConfig({ AI_SHADOW: 'laya' }).shadow).toBe('laya');
    expect(aiModeConfig({ AI_SHADOW: 'jev' }).shadow).toBe('jev');
    expect(aiModeConfig({ AI_SHADOW: 'both' }).shadow).toBe('off');
  });

  it('AI_CONSENSUS_ON_DOWN=single respected; anything else → wait (SAFE default)', () => {
    expect(aiModeConfig({ AI_CONSENSUS_ON_DOWN: 'single' }).onDown).toBe('single');
    expect(aiModeConfig({ AI_CONSENSUS_ON_DOWN: 'yolo' }).onDown).toBe('wait');
  });
});

describe('v21.2.0 providerHealth — honest per-provider block', () => {
  it('absent providers → configured:false, reachable:false', () => {
    const h = providerHealth({ jev: null, laya: null });
    expect(h.jev.configured).toBe(false);
    expect(h.jev.reachable).toBe(false);
    expect(h.laya.configured).toBe(false);
  });

  it('configured provider (breaker closed) → configured+reachable; breaker open → NOT reachable', async () => {
    const { createJev } = await import('../server/bots/jevEngine.js');
    const ok = createJev({ apiKey: 'k', cachePath: path.join(tmpDir, 'ok.jsonl') });
    const h1 = providerHealth({ jev: ok, laya: null });
    expect(h1.jev.configured).toBe(true);
    expect(h1.jev.reachable).toBe(true);
    expect(h1.jev.breakerOpen).toBe(false);
    expect(h1.jev.rejects).toBe(0);

    // force breaker open via test hook
    const down = createJev({ apiKey: 'k', cachePath: path.join(tmpDir, 'down.jsonl') });
    (down as any).__breakerFail();
    (down as any).__breakerFail();
    (down as any).__breakerFail();
    (down as any).__breakerFail(); // 4 consecutive = default threshold
    const h2 = providerHealth({ jev: down, laya: null });
    expect(h2.jev.breakerOpen).toBe(true);
    expect(h2.jev.reachable).toBe(false);
  });
});

describe('v21.2.0 layaPing — smoke honesty', () => {
  it('SKIPPED when LAYA_ENABLED/key absent (never a fake pass)', async () => {
    const r = await layaPing({ env: {} });
    expect(r.status).toBe('SKIPPED');
  });

  it('PASS on a well-formed Laya answer; hits the LAYA_BASE_URL endpoint', async () => {
    const seen = [];
    const r = await layaPing({
      env: { LAYA_ENABLED: '1', LAYA_API_KEY: 'lk', LAYA_BASE_URL: 'http://127.0.0.1:8000' },
      fetchImpl: async (u) => {
        seen.push(String(u));
        return {
          ok: true, status: 200,
          json: async () => ({
            answers: { action: { choice: 'enter_long', confidence: 0.7, probabilities: { enter_long: 0.6, wait: 0.4 } } },
            usage: { input_tokens: 10, output_tokens: 2 },
          }),
        };
      },
    });
    expect(r.status).toBe('PASS');
    expect(r.name).toBe('laya_ping');
    expect(r.choice).toBe('enter_long');
    expect(seen[0]).toBe('http://127.0.0.1:8000/v1/systemone');
  });
});
