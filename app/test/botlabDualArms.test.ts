// ============================================================
// test/botlabDualArms.test.ts — v21.2.0 (dual-provider plan Steps 4+5)
// ------------------------------------------------------------
// BotRunner availability-resolve + routes contract:
//   • arm=laya + Laya instance absent → arm_fallback event + gated
//   • arm=consensus + ek absent → arm_note event, arm stays (onDown policy
//     per-decision); dono absent → gated
//   • arm=auto + dono absent → gated
//   • status().ai shape {jev, laya} + purana `jev` field compat
//   • settle events me `arm` stamp (position meta se)
//   • POST /api/bots/arm: valid arms, unavailable → 409, unknown → 400
//   • GET /api/bots/ai/health shape
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BotRunner } from '../server/bots/botRunner.js';
import { saveBotState, readEvents } from '../server/bots/botState.js';
import { createJev } from '../server/bots/jevEngine.js';

let dir = '';
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dualarm-')); });

const ENV = { BOTS_MODE: 'PAPER', BOTS_ENABLED: 'orb_crypto_utc' };
const mkJev = () => createJev({ apiKey: 'k', cachePath: path.join(dir, 'jev_cache.jsonl') });
const mkLaya = () => createJev({ apiKey: 'lk', name: 'laya', model: '', url: 'http://127.0.0.1:8000/v1/systemone', cachePath: path.join(dir, 'laya_cache.jsonl') });

describe('v21.2.0 BotRunner — availability-resolve (hamesha event-file me record)', () => {
  it('arm=laya + no Laya instance → arm_fallback {from:laya,to:gated} + gated decider chalta hai', async () => {
    saveBotState(dir, 'orb_crypto_utc', { arm: 'laya' });
    const r = new BotRunner({ stateDir: dir, env: { ...ENV }, ai: { jev: null, laya: null } });
    await r.tick('orb_crypto_utc');
    const evs = readEvents(dir, 'orb_crypto_utc', 50);
    const fb = evs.find((e) => e.kind === 'arm_fallback');
    expect(fb).toBeTruthy();
    expect(fb.from).toBe('laya');
    expect(fb.to).toBe('gated');
    expect(fb.reason).toBe('no_laya_instance');
  });

  it('arm=consensus + sirf jev → arm_note (per-decision onDown policy), arm_fallback NAHI', async () => {
    saveBotState(dir, 'orb_crypto_utc', { arm: 'consensus' });
    const r = new BotRunner({ stateDir: dir, env: { ...ENV }, ai: { jev: mkJev(), laya: null } });
    await r.tick('orb_crypto_utc');
    const evs = readEvents(dir, 'orb_crypto_utc', 50);
    const note = evs.find((e) => e.kind === 'arm_note');
    expect(note).toBeTruthy();
    expect(note.note).toContain('laya provider absent');
    expect(evs.find((e) => e.kind === 'arm_fallback')).toBeFalsy();
  });

  it('arm=consensus + dono absent → gated fallback', async () => {
    saveBotState(dir, 'orb_crypto_utc', { arm: 'consensus' });
    const r = new BotRunner({ stateDir: dir, env: { ...ENV }, ai: { jev: null, laya: null } });
    await r.tick('orb_crypto_utc');
    const fb = readEvents(dir, 'orb_crypto_utc', 50).find((e) => e.kind === 'arm_fallback');
    expect(fb).toBeTruthy();
    expect(fb.from).toBe('consensus');
    expect(fb.to).toBe('gated');
    expect(fb.reason).toBe('no_ai_providers');
  });

  it('arm=auto + dono absent → gated; primary absent (ek hai) → arm_note only', async () => {
    saveBotState(dir, 'orb_crypto_utc', { arm: 'auto' });
    const r1 = new BotRunner({ stateDir: dir, env: { ...ENV }, ai: { jev: null, laya: null } });
    await r1.tick('orb_crypto_utc');
    const fb = readEvents(dir, 'orb_crypto_utc', 50).find((e) => e.kind === 'arm_fallback');
    expect(fb.from).toBe('auto');
    expect(fb.to).toBe('gated');

    // primary=laya (default) absent, jev present → arm_note, arm stays auto
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'dualarm2-'));
    saveBotState(dir2, 'orb_crypto_utc', { arm: 'auto' });
    const r2 = new BotRunner({ stateDir: dir2, env: { ...ENV }, ai: { jev: mkJev(), laya: null } });
    await r2.tick('orb_crypto_utc');
    const note = readEvents(dir2, 'orb_crypto_utc', 50).find((e) => e.kind === 'arm_note');
    expect(note).toBeTruthy();
    expect(note.note).toContain('failover to jev');
  });

  it('status().ai = {jev, laya} per-provider stats; purana `jev` field back-compat', () => {
    const r = new BotRunner({ stateDir: dir, env: { ...ENV }, ai: { jev: mkJev(), laya: mkLaya() } });
    const st = r.status();
    expect(st.ai).toBeTruthy();
    expect(st.ai.jev.name).toBe('jev');
    expect(st.ai.jev.hasKey).toBe(true);
    expect(st.ai.laya.name).toBe('laya');
    expect(st.ai.laya.url).toBe('127.0.0.1:8000');
    // legacy compat field (UI purane consumers)
    expect(st.jev.name).toBe('jev');
    // aiMode defaults surface
    expect(st.aiMode).toEqual({ primary: 'laya', shadow: 'off', onDown: 'wait' });
  });

  it('purana `jev` ctor param ab bhi kaam karta hai (ai.jev pe map)', () => {
    const j = mkJev();
    const r = new BotRunner({ stateDir: dir, env: { ...ENV }, jev: j });
    expect(r.jev).toBe(j);
    expect(r.ai.jev).toBe(j);
    expect(r.ai.laya).toBeNull();
    expect(r.status().ai.jev.hasKey).toBe(true);
  });
});

describe('v21.2.0 routes — arm route + AI health (REAL HTTP)', () => {
  let server: Server | null = null;
  let base = '';
  afterEach(async () => {
    if (server) { await new Promise<void>((res) => server!.close(() => res())); server = null; }
  });

  async function boot(env: Record<string, string>) {
    // getBotRunner ek MODULE-LEVEL SINGLETON hai (production: boot pe ek
    // hi baar banta hai, env usi waqt freeze hota hai). Har test case
    // fresh registry chahiye isliye module reset + dynamic import —
    // pinAuth.test.ts ka hi pattern.
    vi.resetModules();
    const { registerBotRoutes } = await import('../server/bots/routes.js');
    const app = express();
    app.use(express.json());
    registerBotRoutes(app, { env: { ...ENV, ...env }, stateDir: dir, candleProvider: null });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server!.once('listening', () => r()));
    base = `http://127.0.0.1:${(server!.address() as any).port}`;
  }

  it('unknown arm → 400; valid arm (rules/gated) → 200 + persisted', async () => {
    await boot({});
    const bad = await fetch(`${base}/api/bots/arm/orb_crypto_utc`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ arm: 'psychic' }) });
    expect(bad.status).toBe(400);
    const ok = await fetch(`${base}/api/bots/arm/orb_crypto_utc`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ arm: 'rules' }) });
    expect(ok.status).toBe(200);
    const j = await ok.json();
    expect(j.arm).toBe('rules');
  });

  it('arm=laya without provider → 409 provider_unavailable {provider:laya} + hint', async () => {
    await boot({});
    const r = await fetch(`${base}/api/bots/arm/orb_crypto_utc`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ arm: 'laya' }) });
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.error).toBe('provider_unavailable');
    expect(j.provider).toBe('laya');
    expect(String(j.hint)).toContain('LAYA_ENABLED');
  });

  it('arm=consensus with sirf jev key → 409 (provider:laya); dono keys ke saath → 200', async () => {
    await boot({ TYPESAFE_API_KEY: 'k' }); // jev only
    const r1 = await fetch(`${base}/api/bots/arm/orb_crypto_utc`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ arm: 'consensus' }) });
    expect(r1.status).toBe(409);
    expect((await r1.json()).provider).toBe('laya');

    await boot({ TYPESAFE_API_KEY: 'k', LAYA_ENABLED: '1', LAYA_API_KEY: 'lk' });
    const r2 = await fetch(`${base}/api/bots/arm/orb_crypto_utc`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ arm: 'consensus' }) });
    expect(r2.status).toBe(200);
    expect((await r2.json()).arm).toBe('consensus');
  });

  it('GET /api/bots/ai/health — per-provider block (configured flags honest)', async () => {
    await boot({ TYPESAFE_API_KEY: 'k' });
    const r = await fetch(`${base}/api/bots/ai/health`);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.jev.configured).toBe(true);
    expect(j.jev.reachable).toBe(true);
    expect(j.jev.breakerOpen).toBe(false);
    expect(j.laya.configured).toBe(false);
    expect(typeof j.at).toBe('string');
  });

  it('status endpoint me ai block (SSE/status consumers)', async () => {
    await boot({ TYPESAFE_API_KEY: 'k', LAYA_ENABLED: '1', LAYA_API_KEY: 'lk' });
    const r = await fetch(`${base}/api/bots/status`);
    const j = await r.json();
    expect(j.ai.jev.name).toBe('jev');
    expect(j.ai.laya.name).toBe('laya');
    expect(j.aiMode.primary).toBe('laya');
  });
});
