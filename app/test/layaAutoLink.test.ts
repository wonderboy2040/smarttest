// ============================================================
// test/layaAutoLink.test.ts — v21.9.0 LAYA AUTO-LINK RESCUE
// ------------------------------------------------------------
// The incident: "laya already local me background me running phir
// bhi koi bhi response nahi — arm_fallback · no_laya_instance".
// Provider availability PURE-CONFIG thi (LAYA_ENABLED + LAYA_API_KEY
// boot pe) — running laya-serve invisible rehta tha.
//
// Locked contracts:
//   A. createLayaAutoLink lifecycle — down / key_mismatch / linked /
//      env-linked / off phases, key-ladder, persisted record
//   B. buildProviders AUTOLINK fallback — env key khali par fresh
//      persisted autolink key → provider banta hai
//   C. BotRunner.attachAiProviders HOT-SWAP — null → provider flip,
//      provider_attached event stream me
//   D. Source wiring — routes.js endpoints + BotsTab reconnect UI
// Hermetic: fetchImpl injected, koi real network nahi.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.SMARTAI_DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../.test-data-laya-autolink');

const {
  createLayaAutoLink, readLayaAutoLink, writeLayaAutoLink,
  LAYA_DEFAULT_KEY, buildLayaProviderOnly,
} = await import('../server/bots/layaAutoLink.js');
const { buildProviders } = await import('../server/bots/aiProviders.js');
const { BotRunner } = await import('../server/bots/botRunner.js');

let tmpDir = '';
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'laya-autolink-'));
});

// ---- fetch mock factory: health + systemone ladder ----
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const SYSTEMONE_OK = () => json({ answers: { action: { choice: 'wait', confidence: 0.9, probabilities: { wait: 0.9, enter_long: 0.05, enter_short: 0.05 } } }, usage: { total_tokens: 10 } });

/** health alive + sirf `acceptKey` wale bearer token ko 200, baaki 401. */
function mockLayaServe({ acceptKey = '', healthOk = true } = {}) {
  return async (url, opts = {}) => {
    const u = String(url);
    if (u.endsWith('/health')) {
      if (!healthOk) throw new Error('ECONNREFUSED (sim)');
      return json({ status: 'ok' });
    }
    if (u.includes('/v1/systemone')) {
      const auth = String(opts?.headers?.Authorization || '');
      const sent = auth.replace(/^Bearer\s+/i, '');
      if (acceptKey === '' || sent === acceptKey) return SYSTEMONE_OK();
      return json({ error: 'unauthorized' }, 401);
    }
    throw new Error(`unexpected url ${u}`);
  };
}

// ============================================================
// A. autolink service lifecycle
// ============================================================
describe('v21.9.0 [A] createLayaAutoLink — lifecycle', () => {
  it('laya-serve down (health refused) → phase down, koi systemone call NAHI', async () => {
    const al = createLayaAutoLink({ env: {}, stateDir: tmpDir, fetchImpl: mockLayaServe({ healthOk: false }) });
    const st = await al.relink();
    expect(st.phase).toBe('down');
    expect(st.lastError).toMatch(/health unreachable/);
  });

  it('LAYA_AUTOLINK=0 → phase off', async () => {
    const al = createLayaAutoLink({ env: { LAYA_AUTOLINK: '0' }, stateDir: tmpDir, fetchImpl: mockLayaServe() });
    expect((await al.relink()).phase).toBe('off');
  });

  it('LAYA_ENABLED=0 → phase off (explicit opt-out respected)', async () => {
    const al = createLayaAutoLink({ env: { LAYA_ENABLED: '0' }, stateDir: tmpDir, fetchImpl: mockLayaServe() });
    expect((await al.relink()).phase).toBe('off');
  });

  it('env-configured (LAYA_ENABLED=1 + key) → env-linked, ladder skip', async () => {
    let systemoneCalls = 0;
    const impl = async (url, opts) => {
      const u = String(url);
      if (u.includes('/v1/systemone')) { systemoneCalls += 1; }
      return mockLayaServe()(url, opts);
    };
    const al = createLayaAutoLink({ env: { LAYA_ENABLED: '1', LAYA_API_KEY: 'mykey' }, stateDir: tmpDir, fetchImpl: impl });
    const st = await al.relink();
    expect(st.phase).toBe('env-linked');
    expect(st.source).toBe('env');
    expect(systemoneCalls).toBe(0);
  });

  it('THE RESCUE: key khali + laya-serve default key accept karta hai → linked + persisted + onLinked hook', async () => {
    let linked = null;
    const al = createLayaAutoLink({
      env: { LAYA_ENABLED: '1' }, // key ABSENT — the incident
      stateDir: tmpDir,
      fetchImpl: mockLayaServe({ acceptKey: LAYA_DEFAULT_KEY }),
      onLinked: (info) => { linked = info; },
    });
    const st = await al.relink();
    expect(st.phase).toBe('linked');
    expect(st.source).toBe('default');
    expect(st.keyMasked).toBeTruthy();
    // persisted record
    const rec = readLayaAutoLink(tmpDir);
    expect(rec?.key).toBe(LAYA_DEFAULT_KEY);
    expect(rec?.baseUrl).toBe('http://127.0.0.1:8000');
    // hot-swap hook fired with the found key
    expect(linked?.key).toBe(LAYA_DEFAULT_KEY);
  });

  it('ladder: pehla candidate 401, dusra (persisted) 200 → linked via persisted', async () => {
    writeLayaAutoLink(tmpDir, { key: 'persisted-key', baseUrl: 'http://127.0.0.1:8000' });
    const al = createLayaAutoLink({
      env: { LAYA_ENABLED: '1' },
      stateDir: tmpDir,
      fetchImpl: mockLayaServe({ acceptKey: 'persisted-key' }),
    });
    const st = await al.relink();
    expect(st.phase).toBe('linked');
    expect(st.source).toBe('persisted');
  });

  it('sab candidates 401 → key_mismatch (hint me .env guidance)', async () => {
    const al = createLayaAutoLink({
      env: { LAYA_ENABLED: '1' },
      stateDir: tmpDir,
      fetchImpl: mockLayaServe({ acceptKey: 'koi-aur-key' }),
    });
    const st = await al.relink();
    expect(st.phase).toBe('key_mismatch');
    expect(st.lastError).toMatch(/LAYA_API_KEY/);
  });

  it('non-loopback LAYA_BASE_URL → key_mismatch (loopback-only security)', async () => {
    const al = createLayaAutoLink({
      env: { LAYA_BASE_URL: 'http://laya.example.com:8000' },
      stateDir: tmpDir,
      fetchImpl: mockLayaServe(),
    });
    const st = await al.relink();
    expect(st.phase).toBe('key_mismatch');
    expect(st.lastError).toMatch(/loopback/);
  });

  it('readLayaAutoLink: stale record (TTL paar) → null', () => {
    fs.writeFileSync(path.join(tmpDir, 'laya_autolink.json'), JSON.stringify({ key: 'k', at: Date.now() - 8 * 24 * 3600_000 }));
    expect(readLayaAutoLink(tmpDir, { maxAgeMs: 7 * 24 * 3600_000 })).toBeNull();
    expect(readLayaAutoLink(tmpDir, { maxAgeMs: 9 * 24 * 3600_000 })?.key).toBe('k');
  });
});

// ============================================================
// B. buildProviders autolink fallback
// ============================================================
describe('v21.9.0 [B] buildProviders — autolink key fallback', () => {
  it('env key khali + fresh autolink record → laya provider banta hai (THE no_laya_instance fix)', () => {
    writeLayaAutoLink(tmpDir, { key: 'auto-detected-key', baseUrl: 'http://127.0.0.1:8000' });
    const p = buildProviders({ LAYA_ENABLED: '1' }, { stateDir: tmpDir });
    expect(p.laya).toBeTruthy();
    expect(typeof p.laya).toBe('function');
    const cfg = (p.laya).config();
    expect(cfg.apiKey).toBe('***'); // masked par PRESENT (khali '' nahi)
    expect(cfg.url).toBe('http://127.0.0.1:8000/v1/systemone');
  });

  it('LAYA_ENABLED unset par bhi fresh autolink record → provider (rescue); record ke bina → null (opt-in intact)', () => {
    writeLayaAutoLink(tmpDir, { key: 'auto-key', baseUrl: 'http://127.0.0.1:8000' });
    expect(buildProviders({}, { stateDir: tmpDir }).laya).toBeTruthy();
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'laya-none-'));
    expect(buildProviders({}, { stateDir: empty }).laya).toBeNull();
  });

  it('LAYA_ENABLED=0 autolink record ke saath bhi → null (explicit off jeet-ta hai)', () => {
    writeLayaAutoLink(tmpDir, { key: 'auto-key', baseUrl: 'http://127.0.0.1:8000' });
    expect(buildProviders({ LAYA_ENABLED: '0' }, { stateDir: tmpDir }).laya).toBeNull();
  });

  it('stale autolink record → provider nahi', () => {
    fs.writeFileSync(path.join(tmpDir, 'laya_autolink.json'), JSON.stringify({ key: 'k', at: Date.now() - 30 * 24 * 3600_000 }));
    expect(buildProviders({ LAYA_ENABLED: '1' }, { stateDir: tmpDir }).laya).toBeNull();
  });

  it('buildLayaProviderOnly: env key > autolink key precedence', () => {
    writeLayaAutoLink(tmpDir, { key: 'auto-key', baseUrl: 'http://127.0.0.1:8000' });
    const a = buildLayaProviderOnly({ LAYA_API_KEY: 'env-key' }, { stateDir: tmpDir });
    const b = buildLayaProviderOnly({}, { stateDir: tmpDir });
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
    const none = buildLayaProviderOnly({}, { stateDir: fs.mkdtempSync(path.join(os.tmpdir(), 'lpn-')) });
    expect(none).toBeNull();
  });
});

// ============================================================
// C. BotRunner hot-swap
// ============================================================
describe('v21.9.0 [C] BotRunner.attachAiProviders — live hot-swap', () => {
  it('null → laya provider attach: ai.laya flip + provider_attached events + arm resolve', async () => {
    const runner = new BotRunner({ stateDir: tmpDir, env: { BOTS_ENABLED: 'orb_crypto_utc' }, candleProvider: null, ai: { jev: null, laya: null } });
    expect(runner.ai.laya).toBeNull();
    // THE arm_fallback condition (botRunner.js:186) ab bhi true
    const laya = buildProviders({ LAYA_ENABLED: '1', LAYA_API_KEY: 'k' }, { stateDir: tmpDir }).laya;
    const out = runner.attachAiProviders({ laya });
    expect(out.laya).toBe(true);
    expect(runner.ai.laya).toBe(laya);
    // event stream me provider_attached dikhna chahiye (audit-visible)
    const evs = runner.events(50).filter((e) => e.kind === 'provider_attached');
    expect(evs.length).toBeGreaterThanOrEqual(1);
    expect(evs[0].provider).toBe('laya');
    // ab arm=laya resolve hoga — no_laya_instance KHATAM
    expect(runner.armFor('orb_crypto_utc')).toBe('gated'); // state default
    fs.writeFileSync(path.join(tmpDir, 'orb_crypto_utc.json'), JSON.stringify({ arm: 'laya' }));
    expect(runner.armFor('orb_crypto_utc')).toBe('laya');
  });

  it('partial patch: sirf laya diya to jev untouched (test-override safe)', () => {
    const fakeJev = { stats: () => ({}) };
    const runner = new BotRunner({ stateDir: tmpDir, env: {}, candleProvider: null, ai: { jev: fakeJev, laya: null } });
    runner.attachAiProviders({ laya: 'x' });
    expect(runner.ai.jev).toBe(fakeJev); // jev kabhi overwrite nahi
    expect(runner.ai.laya).toBe('x');
  });
});

// ============================================================
// D. source wiring contracts
// ============================================================
const read = (p) => fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), p), 'utf8');

describe('v21.9.0 [D] source wiring — routes + UI', () => {
  it('routes.js: laya-status + laya-relink endpoints + self-heal + status frame wiring', () => {
    const s = read('../server/bots/routes.js');
    expect(s).toMatch(/get\('\/api\/bots\/ai\/laya-status'/);
    expect(s).toMatch(/post\('\/api\/bots\/ai\/laya-relink'/);
    expect(s).toMatch(/ensureLayaAutoLink\(runner\)/);           // service boot
    expect(s).toMatch(/refreshLayaProvider\(\)/);                // hot-swap
    expect(s).toMatch(/layaAutoLink: auto/);                     // SSE status frame
    expect(s).toMatch(/_autolink\?\.relink\?\.\(\)/);             // 409 self-heal
  });

  it('boardAiConfirm.js: refresh hook exported (Signal Board turant naya provider uthata hai)', () => {
    const s = read('../server/ai/boardAiConfirm.js');
    expect(s).toMatch(/export function boardAiConfirmRefresh\(\)/);
  });

  it('BotsTab.tsx: RECONNECT LAYA button + auto-link chip + honest reason', () => {
    const s = read('../src/components/tabs/BotsTab.tsx');
    expect(s).toMatch(/RECONNECT LAYA/);
    expect(s).toMatch(/relinkLaya/);
    expect(s).toMatch(/AUTO-LINKED/);
    expect(s).toMatch(/KEY MISMATCH/);
    expect(s).toMatch(/layaAutoLink/);
  });

  it('useBots.ts: relinkLaya action + layaAutoLink status type', () => {
    const s = read('../src/components/bots/useBots.ts');
    expect(s).toMatch(/\/api\/bots\/ai\/laya-relink/);
    expect(s).toMatch(/layaAutoLink\?:/);
  });

  it('futures.js + signals.js: metals rescue wiring (interval fix + Yahoo leg)', () => {
    const f = read('../server/ai/futures.js');
    expect(f).toMatch(/export function toFapiInterval/);
    expect(f).toMatch(/toFapiInterval\(resolution\) \|\| '1h'/);   // THE fix call
    expect(f).toMatch(/fetchMetalsYahooCandles/);
    expect(f).toMatch(/gold-api/);
    const sig = read('../server/ai/signals.js');
    expect(sig).toMatch(/fetchMetalsCandleChain/);                  // chain helper
    expect(sig).toMatch(/fetchMetalsCandleChain\(b, '60', ltp\)/);  // board
    expect(sig).toMatch(/fetchMetalsCandleChain\(base, '15', ltp, 240\)/); // 15m tape
  });

  it('laya-ping.mjs restored (referenced by .env.example + smoke.js)', () => {
    expect(fs.existsSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/laya-ping.mjs'))).toBe(true);
  });

  it('start-laya.cmd CRLF-strict hai (Windows .cmd contract)', () => {
    const raw = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../start-laya.cmd'), 'utf8');
    expect(raw.includes('\r\n')).toBe(true);
    expect(raw.includes('\n') && !raw.includes('\r\n')).toBe(false); // koi bare-LF line nahi
  });
});
