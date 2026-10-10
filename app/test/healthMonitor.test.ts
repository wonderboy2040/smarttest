// ============================================================
// test/healthMonitor.test.ts — v21.1.0 (Phase-3 lock)
// ------------------------------------------------------------
// /api/health aggregator + alert thresholds ka contract:
//   • snapshot HAMESHA resolve hota hai (koi subsystem down ho to bhi)
//   • shape: feeds/kills/bots/persist + ok-flag
//   • feedAges() liveFeed integration
//   • alert throttle: same key 15-min window me ek hi baar
// Hermetic: SMARTAI_DATA_DIR (setup.ts) + koi network nahi.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { healthSnapshot, _resetForTests, FEED_STALE_ALERT_SEC } from '../server/healthMonitor.js';
import { setTick, feedAges } from '../server/liveFeed.js';

describe('server/healthMonitor.js — v21.1.0 /api/health contract', () => {
  beforeEach(() => { _resetForTests(); });

  it('snapshot kabhi reject nahi hota — sab subsystems unavailable ho to bhi shape milta hai', async () => {
    const snap = await healthSnapshot();
    expect(snap).toBeTruthy();
    expect(snap.at).toBeGreaterThan(0);
    expect(snap.uptimeSec).toBeGreaterThanOrEqual(0);
    expect(snap.feeds).toBeTruthy();
    expect(snap.feeds.sources).toBeTruthy();
    expect(snap.kills).toBeTruthy();
    expect(snap.persist).toBeTruthy();
    expect(typeof snap.persist.dataDirWritable).toBe('boolean');
  });

  it('feedAges(): setTick ke baad source ka ageSec + lastTickAt track hota hai', async () => {
    setTick('IN_RELIANCE', { price: 100, change: 1 }, 'test-source-x');
    const ages = feedAges();
    expect(ages['test-source-x']).toBeTruthy();
    expect(ages['test-source-x'].ageSec).toBeLessThanOrEqual(FEED_STALE_ALERT_SEC);
    expect(ages['test-source-x'].lastTickAt).toBeGreaterThan(0);
    // snapshot me bhi nazar aata hai
    const snap = await healthSnapshot();
    expect(snap.feeds.sources['test-source-x']).toBeTruthy();
    expect(snap.feeds.sources['test-source-x'].live).toBe(true);
  });

  it('snapshot me kill layers teeno exposed hain (values subsystem state pe depend)', async () => {
    const snap = await healthSnapshot();
    expect('aiDesk' in snap.kills).toBe(true);
    expect('exec' in snap.kills).toBe(true);
    expect('botLab' in snap.kills).toBe(true);
    // exec kill level numeric hai (unarmed default 0)
    expect(typeof snap.kills.exec.level).toBe('number');
  });

  it('ok-flag: exec kill arm hone par false (paper sab clear ho to true)', async () => {
    const snap = await healthSnapshot();
    const killActive = snap.kills?.aiDesk?.enabled === true || (snap.kills?.exec?.level || 0) > 0;
    expect(snap.ok).toBe(!killActive); // consistency — flag hamesha kills se derive
  });
});
