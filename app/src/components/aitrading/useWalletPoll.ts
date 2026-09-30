// ============================================================
// useWalletPoll — v20.2 SINGLETON wallet store
// ------------------------------------------------------------
// PROBLEM: WalletCard (CoinDcxTab), WalletStrip (OrderConsole) and
// PortfolioHeat (OrderConsole) each ran their OWN 60s poll of
// /api/ai/wallet → 3 concurrent pollers = 3 signed CoinDCX wallet
// calls per minute from ONE browser (rate-limit + key-abuse
// surface, and the audit counted them as independent timers).
//
// FIX: one module-level store, one 60s interval, N subscribers.
// React's useSyncExternalStore keeps every component consistent
// with the SAME snapshot (a wallet refresh lands everywhere at
// once). The timer only runs while ≥1 subscriber is mounted and
// the tab is visible; the last unmount parks it completely.
// Late subscribers (mount >45s after the last fetch) trigger a
// fresh poll instead of showing stale data.
// ============================================================
import { useSyncExternalStore } from 'react';
import { fetchWallet } from './useAITrading';
import type { WalletView } from './types';

export interface WalletSnapshot {
  wallet: WalletView | null;
  failed: boolean;
  fetchedAt: number;
}

let snap: WalletSnapshot = { wallet: null, failed: false, fetchedAt: 0 };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let inflight = false;
let lastFetchAt = 0;

const emit = () => { for (const l of listeners) { try { l(); } catch { /* dead listener */ } } };

async function poll(force = false): Promise<void> {
  if (inflight) return;
  const now = Date.now();
  // Shared-cache guard: a burst of mounts (or a refresh + timer race)
  // must not fan out into parallel wallet calls.
  if (!force && snap.wallet && now - lastFetchAt < 30_000) return;
  inflight = true;
  lastFetchAt = now;
  try {
    const w = await fetchWallet();
    snap = { wallet: w || null, failed: !w, fetchedAt: Date.now() };
  } catch {
    snap = { wallet: null, failed: true, fetchedAt: Date.now() };
  } finally {
    inflight = false;
    emit();
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (listeners.size === 1) {
    // First subscriber boots the shared cycle.
    void poll();
    if (timer == null) {
      timer = setInterval(() => {
        if (document.hidden || listeners.size === 0) return;
        void poll(true);
      }, 60_000);
    }
  } else if (Date.now() - lastFetchAt > 45_000) {
    // Late subscriber + stale cache → refresh soon (throttled by the
    // in-flight guard; the 30s guard does not apply because there is
    // no wallet to show yet from this component's perspective).
    void poll(true);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer != null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getSnapshot = () => snap;

export function useWalletPoll(): WalletSnapshot & { refresh: () => void } {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { ...s, refresh: () => { void poll(true); } };
}

// test hooks
export function __resetWalletStoreForTests() {
  listeners.clear();
  if (timer != null) { clearInterval(timer); timer = null; }
  snap = { wallet: null, failed: false, fetchedAt: 0 };
  inflight = false;
  lastFetchAt = 0;
}
export function __walletStoreInternalsForTests() {
  return { listeners: listeners.size, timerRunning: timer != null, inflight, lastFetchAt };
}
