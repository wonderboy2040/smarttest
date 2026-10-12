// ============================================================
// test/layaFast.test.ts — v21.5.0 LAYA FAST UPGRADE
// ------------------------------------------------------------
// Locks the four speed layers:
//   1. FIFO concurrency gate (jevEngine) — bursts queue hoti hain,
//      har wire call ko queue ke BAAD pura timeout budget milta
//      hai; cache-hits bypass; queueWaits telemetry.
//   2. retryOnTimeout policy — laya default OFF (queue
//      amplification nahi), jev default ON (purana behaviour);
//      honest `timeout` note + auto-arm failover.
//   3. boardAiConfirm SWRV — memo expire hone par bhi instant
//      stale verdict + background refresh; 2×TTL cap ke baad
//      blocking wire; AI_CONFIRM_SWRV=0 kill-switch.
//   4. Sidecar warmup (ready/adopted pe ek real inference) +
//      LAYA_DEVICE=auto nvidia-smi GPU probe.
// Hermetic: fake fetch (deferred-resolvable), fake children.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createJev, providerConfig } from '../server/bots/jevEngine.js';
import {
  confirmBoardSignals,
  __resetBoardAiConfirmForTests,
  __setProvidersForTests,
  __setMemoTtlForTests,
  __memoPeekForTests,
} from '../server/ai/boardAiConfirm.js';
import { aiDecider } from '../server/bots/deciders.js';
import { createLayaSidecar } from '../server/layaSidecar.js';

const TMP = path.join(os.tmpdir(), `laya-fast-${process.pid}-${Date.now()}`);
const mkCfg = (over = {}) => ({ apiKey: 'k', cachePath: path.join(TMP, 'c.jsonl'), ...over });

// ---------- helpers: deferred fake fetch (abort-signal aware) ----------
function mkDeferredFetch() {
  const pending: any[] = [];
  let total = 0;
  const fetchImpl = (url: any, init: any) => new Promise((resolve, reject) => {
    total++;
    const slot: any = { url, init, resolve, reject, done: false };
    const settle = (fn: any, val: any) => {
      if (slot.done) return;
      slot.done = true;
      const i = pending.indexOf(slot);
      if (i >= 0) pending.splice(i, 1);
      try { fn(val); } catch { /* double-settle guard */ }
    };
    slot.settle = settle;
    pending.push(slot);
    // v21.5.0 contract: real fetch AbortSignal.timeout pe reject hota hai
    try {
      init?.signal?.addEventListener?.('abort', () => settle(reject, init.signal?.reason ?? TimeoutErr()));
    } catch { /* signal-less init */ }
  });
  const started = () => total;
  const resolveOne = (choice: string, p = { [choice]: 0.9, wait: 0.1 }) => {
    const s = pending.shift();
    if (!s) throw new Error('no pending fetch');
    s.resolve({
      ok: true, status: 200,
      json: async () => ({ answers: { action: { choice, probabilities: p, confidence: 0.9 } }, usage: null }),
    });
  };
  const rejectOne = (err: any) => {
    const s = pending.shift();
    if (!s) throw new Error('no pending fetch');
    s.reject(err);
  };
  return { fetchImpl, started, resolveOne, rejectOne, pending };
}

const flushN = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

const TimeoutErr = () => {
  const e: any = new Error('The operation was aborted due to timeout');
  e.name = 'TimeoutError';
  return e;
};

const SNAP = (i: number) => ({
  proposed: 'enter_long',
  contextLines: [`ctx-${i}`],
  features: {},
});
const PROMPT = {
  instructions: 'test',
  criteria: { enter_long: 'L', enter_short: 'S', wait: 'W' },
};

beforeEach(() => {
  __resetBoardAiConfirmForTests();
});

// ============================================================
// 1. FIFO concurrency gate
// ============================================================
describe('layaFast — jevEngine FIFO concurrency gate', () => {
  it('concurrency=2: 3 parallel wire calls me se sirf 2 fetch start; 3rd queue me', async () => {
    const f = mkDeferredFetch();
    const jev = createJev(mkCfg({ concurrency: 2, retries: 0, fetchImpl: f.fetchImpl }));
    const p = [0, 1, 2].map((i) => jev(SNAP(i), PROMPT));
    await flushN();
    expect(f.started()).toBe(2);           // gate hold kar raha hai
    expect(jev.stats().queueWaits).toBe(1); // teesra request queue me
    f.resolveOne('enter_long');
    await flushN();
    expect(f.started()).toBe(3);            // slot free -> next start
    f.resolveOne('enter_long');
    f.resolveOne('enter_long');
    const v = await Promise.all(p);
    expect(v.every((x) => x.action === 'enter_long')).toBe(true);
  });

  it('concurrency=0 (cloud default): sab turant start — gate nahi', async () => {
    const f = mkDeferredFetch();
    const jev = createJev(mkCfg({ concurrency: 0, retries: 0, fetchImpl: f.fetchImpl }));
    const p = [0, 1, 2].map((i) => jev(SNAP(i), PROMPT));
    await flushN();
    expect(f.started()).toBe(3);
    f.resolveOne('enter_long'); f.resolveOne('enter_long'); f.resolveOne('enter_long');
    await Promise.all(p);
  });

  it('cache-hit semaphore ko bypass karta hai (koi naya fetch nahi)', async () => {
    const f = mkDeferredFetch();
    const jev = createJev(mkCfg({ concurrency: 1, retries: 0, fetchImpl: f.fetchImpl }));
    const first = jev(SNAP(0), PROMPT);
    await flushN();
    f.resolveOne('enter_long');
    await first;
    const calls = jev.stats().calls;
    const wireTotal = f.started();
    const again = await jev(SNAP(0), PROMPT); // same payload -> cache
    expect(again.cached).toBe(true);
    expect(jev.stats().calls).toBe(calls);    // wire call nahi hua
    expect(f.started()).toBe(wireTotal);     // koi naya fetch start nahi hua
    expect(jev.stats().cacheHits).toBe(1);
  });

  it('stats(): queueWaits + concurrency expose hote hain', async () => {
    const f = mkDeferredFetch();
    const jev = createJev(mkCfg({ concurrency: 2, retries: 0, fetchImpl: f.fetchImpl }));
    const s0 = jev.stats();
    expect(s0.queueWaits).toBe(0);
    expect(s0.concurrency).toBe(2);
    const p = [0, 1, 2].map((i) => jev(SNAP(i), PROMPT));
    await flushN();
    f.resolveOne('enter_long');
    await flushN(); // slot release -> teesra start
    f.resolveOne('enter_long');
    f.resolveOne('enter_long');
    await Promise.all(p);
    expect(jev.stats().queueWaits).toBe(1); // teesra queue me tha
  });
});

// ============================================================
// 2. retryOnTimeout policy + timeout note
// ============================================================
describe('layaFast — retryOnTimeout + honest timeout note', () => {
  it('laya default: timeout pe retry NAHI — 1 hi fetch, note "timeout"', async () => {
    const f = mkDeferredFetch();
    const laya = createJev(mkCfg({ name: 'laya', concurrency: 2, retryOnTimeout: false, retries: 1, timeoutMs: 50, fetchImpl: f.fetchImpl }));
    const v = await laya(SNAP(0), PROMPT);
    expect(v.action).toBe('wait');
    expect(v.note).toBe('timeout');
    expect(f.started()).toBe(1); // retry nahi hua (queue amplification ban)
    expect(laya.stats().errors).toBe(1);
  });

  it('jev default (retryOnTimeout=true): timeout bhi retry karta hai', async () => {
    const f = mkDeferredFetch();
    const jev = createJev(mkCfg({ retries: 1, retryOnTimeout: true, fetchImpl: f.fetchImpl }));
    const v = jev(SNAP(0), PROMPT);
    await flushN();
    expect(f.started()).toBe(1);
    f.rejectOne(TimeoutErr()); // first attempt timeout
    // retry backoff 300ms (real) — cloud path ka purana behaviour
    await new Promise((r) => setTimeout(r, 420));
    expect(f.started()).toBe(2); // retry hua (cloud behaviour unchanged)
    f.resolveOne('enter_long');
    const out = await v;
    expect(out.action).toBe('enter_long');
  });

  it('providerConfig: laya concurrency=2 + retryOnTimeout=false defaults; env override', () => {
    const d = providerConfig('laya', {});
    expect(d.concurrency).toBe(2);
    expect(d.retryOnTimeout).toBe(false);
    const o = providerConfig('laya', { LAYA_CONCURRENCY: '4', LAYA_RETRY_ON_TIMEOUT: '1' });
    expect(o.concurrency).toBe(4);
    expect(o.retryOnTimeout).toBe(true);
    const j = providerConfig('jev', {});
    expect(j.concurrency).toBe(0);
    expect(j.retryOnTimeout).toBe(true); // cloud purana behaviour
  });

  it('aiDecider auto-arm: laya `timeout` note pe Jev failover hota hai', async () => {
    const laya = vi.fn(async () => ({ action: 'wait', note: 'timeout', probs: null, confidence: null, cached: false, latencyMs: 50 }));
    const jevCall = vi.fn(async () => ({ action: 'enter_long', probs: { enter_long: 0.9 }, confidence: 0.9, cached: false, latencyMs: 80 }));
    const decide = aiDecider({
      providers: { laya, jev: jevCall },
      mode: 'auto', primary: 'laya',
      strategy: {
        jevPrompt: () => PROMPT,
        snapshot: () => ({ proposed: 'enter_long', contextLines: ['t'], features: {} }),
      },
    } as any);
    const verdict = await decide({ symbol: 'BTCUSDT' } as any, {} as any);
    expect(laya).toHaveBeenCalledTimes(1);
    expect(jevCall).toHaveBeenCalledTimes(1);  // failover fired
    expect(verdict.action).toBe('take');
    expect(String(verdict.reason)).toContain('failover(laya->jev)');
  });
});

// ============================================================
// 3. boardAiConfirm SWRV
// ============================================================
describe('layaFast — boardAiConfirm SWRV (stale-while-revalidate)', () => {
  const mkSig = (sym: string, score = 88) => ({
    symbol: sym, side: 'LONG', score, grade: 'STRONG', superIntel: { aiScore: score }, ltp: 100,
  });

  it('fresh memo: wire call ek baar, CONFIRMED stamp, stale=false', async () => {
    const call = vi.fn(async () => ({ action: 'enter_long', probs: { enter_long: 0.9 }, confidence: 0.9 }));
    __setProvidersForTests({ jev: call, laya: call });
    const s = mkSig('BTC');
    const meta = await confirmBoardSignals([s], 'CRYPTO');
    expect(meta.stamped).toBe(1);
    expect(meta.confirmed).toBe(1);
    expect(s.aiConfirm.verdict).toBe('CONFIRMED');
    expect(s.aiConfirm.stale).toBe(false);
    expect(call).toHaveBeenCalledTimes(2); // jev + laya
  });

  it('memo expire par SWRV: instant stale verdict + background refresh', async () => {
    let flavour = 0;
    const call = vi.fn(async () => {
      flavour++;
      return { action: flavour > 2 ? 'wait' : 'enter_long', probs: { enter_long: 0.9 }, confidence: 0.9 };
    });
    __setProvidersForTests({ jev: call, laya: call });
    __setMemoTtlForTests(30); // 30ms TTL
    const s1 = mkSig('BTC');
    const m1 = await confirmBoardSignals([s1], 'CRYPTO');
    expect(m1.stale).toBe(0);
    expect(call).toHaveBeenCalledTimes(2);

    await new Promise((r) => setTimeout(r, 60)); // memo expire, stale-cap (max(60, 1030)=1030ms) ke andar
    const s2 = mkSig('BTC');
    const t0 = Date.now();
    const m2 = await confirmBoardSignals([s2], 'CRYPTO');
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(25);          // instant serve — provider wait nahi
    expect(m2.stale).toBe(1);
    expect(s2.aiConfirm.verdict).toBe('CONFIRMED'); // stale copy turant
    expect(s2.aiConfirm.stale).toBe(true);
    // background refresh chal raha hai (wire calls badh gaye)
    await new Promise((r) => setTimeout(r, 30));
    expect(call.mock.calls.length).toBeGreaterThan(2);
  });

  it('stale-cap (2×TTL) ke baad: SWRV nahi — blocking fresh wire', async () => {
    const call = vi.fn(async () => ({ action: 'enter_long', probs: { enter_long: 0.9 }, confidence: 0.9 }));
    __setProvidersForTests({ jev: call, laya: call });
    __setMemoTtlForTests(40); // stale cap = max(80, 1040) = 1040ms
    const s1 = mkSig('ETH');
    await confirmBoardSignals([s1], 'CRYPTO');
    expect(call).toHaveBeenCalledTimes(2);

    await new Promise((r) => setTimeout(r, 1200)); // stale cap paar
    const before = call.mock.calls.length;
    const s2 = mkSig('ETH');
    const m2 = await confirmBoardSignals([s2], 'CRYPTO');
    expect(m2.stale).toBe(0);                    // stale serve NAHI hua
    expect(call.mock.calls.length).toBeGreaterThan(before); // fresh wire hua
  });

  it('memo fresh: doosra cycle wire call hi nahi karta', async () => {
    const call = vi.fn(async () => ({ action: 'enter_long', probs: { enter_long: 0.9 }, confidence: 0.9 }));
    __setProvidersForTests({ jev: call, laya: call });
    __setMemoTtlForTests(60_000);
    await confirmBoardSignals([mkSig('SOL')], 'CRYPTO');
    const before = call.mock.calls.length;
    const m2 = await confirmBoardSignals([mkSig('SOL')], 'CRYPTO');
    expect(call.mock.calls.length).toBe(before); // memo hit — zero wire
    expect(m2.stamped).toBe(1);
    expect(m2.stale).toBe(0);
    expect(__memoPeekForTests().size).toBe(1);
  });
});

// ============================================================
// 4. Sidecar warmup + GPU auto-detect
// ============================================================
describe('layaFast — sidecar warmup + LAYA_DEVICE=auto', () => {
  const API_KEY = 'warmup-secret-key-32chars-xxxx';

  function fakeChild(pid = 4242) {
    const c: any = new EventEmitter();
    c.pid = pid;
    c.stdout = new EventEmitter();
    c.stderr = new EventEmitter();
    c.exitCode = null; c.signalCode = null;
    c.kill = () => true;
    return c;
  }

  function mkSidecar(env: any, extraDeps: any = {}, healthSeq: Array<number | null> = [200]) {
    let tNow = 1_700_000_000_000;
    const entries: any[] = [];
    const logs: string[] = [];
    const spawnCalls: any[] = [];
    let hi = 0;
    const sidecar = createLayaSidecar({
      env: { LAYA_ENABLED: '1', LAYA_API_KEY: API_KEY, LAYA_HOME: '/laya', ...env },
      appRoot: '/app',
      log: (l: string) => logs.push(String(l)),
      journal: (e: any) => entries.push(e),
      deps: {
        spawnFn: (cmd: any, args: any, opts: any) => { const c = fakeChild(); spawnCalls.push({ cmd, args, opts, child: c }); return c; },
        httpGetFn: (_o: any, cb: any) => {
          const req: any = new EventEmitter();
          req.destroy = () => {};
          const code = healthSeq[Math.min(hi++, healthSeq.length - 1)];
          if (code == null) {
            queueMicrotask(() => req.emit('error', Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })));
          } else {
            queueMicrotask(() => {
              const res: any = new EventEmitter();
              res.statusCode = code; res.resume = () => {};
              cb(res); res.emit('end');
            });
          }
          return req;
        },
        fsMod: { existsSync: () => true, readFileSync: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); } },
        platformFn: () => 'linux',
        nowFn: () => tNow,
        osMod: { cpus: () => new Array(8).fill(0) },
        fetchImpl: async () => ({ status: 200, resume() {} }),
        setIntervalFn: () => 999,
        clearIntervalFn: () => {},
        setTimeoutFn: () => 555,
        clearTimeoutFn: () => {},
        ...extraDeps,
      },
    });
    return { sidecar, entries, logs, spawnCalls, tick: () => { tNow += 1000; } };
  }

  const flush = () => new Promise((r) => setImmediate(r));
  const flushAll = async () => { for (let i = 0; i < 6; i++) await flush(); };

  it('ADOPT path: warmup fetch endpoint+auth ke saath + laya-warmup journal', async () => {
    const warmFetch = vi.fn(async () => ({ status: 200, resume() {} }));
    const { sidecar, entries } = mkSidecar({ LAYA_AUTOSTART: '1' }, { fetchImpl: warmFetch });
    sidecar.start();
    await flush(); await flush(); await flush();
    expect(warmFetch).toHaveBeenCalledTimes(1);
    const [url, init] = warmFetch.mock.calls[0];
    expect(String(url)).toBe('http://127.0.0.1:8000/v1/systemone');
    expect(init.method).toBe('POST');
    expect(String(init.headers.Authorization)).toBe(`Bearer ${API_KEY}`);
    const ev = entries.find((e) => e.ev === 'laya-warmup');
    expect(ev).toBeTruthy();
    expect(ev.reason).toBe('adopted');
    await sidecar.stop();
  });

  it('LAYA_WARMUP=0: koi warmup fetch nahi', async () => {
    const warmFetch = vi.fn(async () => ({ status: 200 }));
    const { sidecar } = mkSidecar({ LAYA_AUTOSTART: '1', LAYA_WARMUP: '0' }, { fetchImpl: warmFetch });
    sidecar.start();
    await flush(); await flush(); await flush();
    expect(warmFetch).not.toHaveBeenCalled();
    await sidecar.stop();
  });

  it('warmup fail (rejected fetch) kabhi fatal nahi — laya-warmup-fail journal', async () => {
    const warmFetch = vi.fn(async () => { throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }); });
    const { sidecar, entries } = mkSidecar({ LAYA_AUTOSTART: '1' }, { fetchImpl: warmFetch });
    sidecar.start();
    await flush(); await flush(); await flush(); await flush();
    expect(entries.some((e) => e.ev === 'laya-warmup-fail')).toBe(true);
    expect(sidecar.status().phase).toBe('adopted');
    await sidecar.stop();
  });

  // stop() ke liye helper: fake child pe exit emit karo (real timers
  // inject kiye bina owned-stop await ho jaata hai — existing test file
  // ka pattern: stop() ke BAAD exit emit).
  const stopWith = async (sidecar: any, spawnCalls: any[]) => {
    const serve = spawnCalls.find((c: any) => String(c.cmd).includes('laya-serve'));
    const done = sidecar.stop();
    serve?.child?.emit?.('exit', 0, null);
    await done;
  };

  it('LAYA_DEVICE=auto + nvidia-smi exit 0 -> spawn env LAYA_DEVICE=cuda', async () => {
    const spawnCalls: any[] = [];
    const { sidecar, entries } = mkSidecar(
      { LAYA_AUTOSTART: '1', LAYA_DEVICE: 'auto' },
      {
        spawnFn: (cmd: any, args: any, opts: any) => {
          const c = fakeChild();
          spawnCalls.push({ cmd, args, opts, child: c });
          if (cmd === 'nvidia-smi') queueMicrotask(() => c.emit('exit', 0, null));
          return c;
        },
      },
      [null, 200], // pehle refused (spawn), phir ready
    );
    sidecar.start();
    await flushAll();
    const nvidia = spawnCalls.find((c) => c.cmd === 'nvidia-smi');
    expect(nvidia).toBeTruthy();
    const serve = spawnCalls.find((c) => String(c.cmd).includes('laya-serve'));
    expect(serve).toBeTruthy();
    expect(serve.opts.env.LAYA_DEVICE).toBe('cuda');
    expect(entries.find((e) => e.ev === 'laya-device')?.device).toBe('cuda');
    await stopWith(sidecar, spawnCalls);
  });

  it('LAYA_DEVICE=auto + nvidia-smi fail -> cpu (fallback)', async () => {
    const spawnCalls: any[] = [];
    const { sidecar } = mkSidecar(
      { LAYA_AUTOSTART: '1', LAYA_DEVICE: 'auto' },
      {
        spawnFn: (cmd: any, args: any, opts: any) => {
          const c = fakeChild();
          spawnCalls.push({ cmd, args, opts, child: c });
          if (cmd === 'nvidia-smi') queueMicrotask(() => c.emit('exit', 1, null));
          return c;
        },
      },
      [null, 200],
    );
    sidecar.start();
    await flushAll();
    const serve = spawnCalls.find((c) => String(c.cmd).includes('laya-serve'));
    expect(serve).toBeTruthy();
    expect(serve.opts.env.LAYA_DEVICE).toBe('cpu');
    await stopWith(sidecar, spawnCalls);
  });

  it('default LAYA_DEVICE=cpu: nvidia-smi probe hi nahi hota', async () => {
    const spawnCalls: any[] = [];
    const { sidecar } = mkSidecar(
      { LAYA_AUTOSTART: '1' },
      {
        spawnFn: (cmd: any, args: any, opts: any) => {
          const c = fakeChild();
          spawnCalls.push({ cmd, args, opts, child: c });
          return c;
        },
      },
      [null, 200],
    );
    sidecar.start();
    await flushAll();
    expect(spawnCalls.some((c) => c.cmd === 'nvidia-smi')).toBe(false);
    const serve2 = spawnCalls.find((c) => String(c.cmd).includes('laya-serve'));
    expect(serve2).toBeTruthy();
    expect(serve2.opts.env.LAYA_DEVICE).toBe('cpu');
    await stopWith(sidecar, spawnCalls);
  });

  it('status(): device field expose hota hai', async () => {
    const { sidecar } = mkSidecar({ LAYA_AUTOSTART: '1' });
    sidecar.start();
    await flush(); await flush();
    expect(sidecar.status().device).toBe('cpu');
    await sidecar.stop();
  });
});
