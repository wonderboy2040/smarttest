// ============================================================
// IndexedDB High-Capacity Storage Engine — Wealth AI v18
// ------------------------------------------------------------
// Replaces 5-10MB localStorage limits with structured, indexed
// storage for transactions, price history, AI chat memory,
// offline queues, and user preferences.
// ============================================================

import { Transaction, Position, PriceData } from '../types';

const DB_NAME = 'wealthai_idb_v18';
const DB_VERSION = 1;

export interface DBPriceRecord {
  id: string; // `${symbol}_${timestamp}`
  symbol: string;
  market: string;
  price: number;
  change: number;
  rsi?: number;
  timestamp: number;
}

export interface DBChatMessage {
  id: string;
  role: 'user' | 'model' | 'system';
  text: string;
  timestamp: number;
  model?: string;
  latencyMs?: number;
  confidence?: number;
  sentiment?: string;
}

export interface DBPortfolioSnapshot {
  id?: string;
  date: string; // YYYY-MM-DD
  timestamp: number;
  totalValue?: number;
  totalInvested?: number;
  totalProfit?: number;
  profitPercent?: number;
  holdingsCount?: number;
  totalValueINR?: number;
  totalInvestedINR?: number;
  totalPLINR?: number;
  positions?: Position[];
}

export type PortfolioSnapshot = DBPortfolioSnapshot;

export interface OfflineAction {
  id: string;
  type: 'ADD_POSITION' | 'EDIT_POSITION' | 'DELETE_POSITION' | 'ADD_TRANSACTION';
  payload: any;
  timestamp: number;
}

class IndexedDBStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private isAvailable: boolean = typeof window !== 'undefined' && 'indexedDB' in window;

  private async getDB(): Promise<IDBDatabase> {
    if (!this.isAvailable) {
      throw new Error('IndexedDB not available in current environment');
    }

    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve, reject) => {
      try {
        const request = window.indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;

          // Transactions store
          if (!db.objectStoreNames.contains('transactions')) {
            const txStore = db.createObjectStore('transactions', { keyPath: 'id' });
            txStore.createIndex('date', 'date', { unique: false });
            txStore.createIndex('symbol', 'symbol', { unique: false });
          }

          // Price history store
          if (!db.objectStoreNames.contains('priceHistory')) {
            const priceStore = db.createObjectStore('priceHistory', { keyPath: 'id' });
            priceStore.createIndex('symbol', 'symbol', { unique: false });
            priceStore.createIndex('timestamp', 'timestamp', { unique: false });
          }

          // AI Chat history store
          if (!db.objectStoreNames.contains('aiChatHistory')) {
            const chatStore = db.createObjectStore('aiChatHistory', { keyPath: 'id' });
            chatStore.createIndex('timestamp', 'timestamp', { unique: false });
          }

          // User preferences & profile
          if (!db.objectStoreNames.contains('userPreferences')) {
            db.createObjectStore('userPreferences', { keyPath: 'key' });
          }

          // Portfolio daily snapshots
          if (!db.objectStoreNames.contains('portfolioSnapshots')) {
            db.createObjectStore('portfolioSnapshots', { keyPath: 'date' });
          }

          // Offline queue store
          if (!db.objectStoreNames.contains('offlineQueue')) {
            const offStore = db.createObjectStore('offlineQueue', { keyPath: 'id' });
            offStore.createIndex('timestamp', 'timestamp', { unique: false });
          }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          // v10.13 (deep-recheck M7): reset the cached promise on failure —
          // a transient open failure (private mode, blocked upgrade, quota)
          // used to leave the REJECTED promise cached forever, so every call
          // this session took the localStorage fallback even after IndexedDB
          // recovered.
          this.dbPromise = null;
          reject(request.error);
        };
        request.onblocked = () => {
          console.warn('[IndexedDB] Database upgrade blocked');
          this.dbPromise = null; // v10.13: allow a retry once the blocker clears
        };
      } catch (err) {
        reject(err);
      }
    });

    return this.dbPromise;
  }

  // --- Transactions ---
  async saveTransaction(txn: Transaction): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('transactions', 'readwrite');
        const store = tx.objectStore('transactions');
        const req = store.put(txn);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      // Fallback to localStorage
      try {
        const list = JSON.parse(localStorage.getItem('txn_history') || '[]');
        const idx = list.findIndex((t: Transaction) => t.id === txn.id);
        if (idx >= 0) list[idx] = txn; else list.push(txn);
        localStorage.setItem('txn_history', JSON.stringify(list));
      } catch {}
    }
  }

  async getAllTransactions(): Promise<Transaction[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('transactions', 'readonly');
        const store = tx.objectStore('transactions');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch {
      try {
        return JSON.parse(localStorage.getItem('txn_history') || '[]');
      } catch {
        return [];
      }
    }
  }

  async deleteTransaction(id: string): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('transactions', 'readwrite');
        const store = tx.objectStore('transactions');
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      try {
        const list = JSON.parse(localStorage.getItem('txn_history') || '[]');
        localStorage.setItem('txn_history', JSON.stringify(list.filter((t: Transaction) => t.id !== id)));
      } catch {}
    }
  }

  // --- AI Chat History ---
  async saveChatMessage(msg: DBChatMessage): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('aiChatHistory', 'readwrite');
        const store = tx.objectStore('aiChatHistory');
        const req = store.put(msg);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      try {
        const list = JSON.parse(localStorage.getItem('neural_chat_v5') || '[]');
        list.push(msg);
        localStorage.setItem('neural_chat_v5', JSON.stringify(list.slice(-50)));
      } catch {}
    }
  }

  async getChatHistory(limit = 100): Promise<DBChatMessage[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('aiChatHistory', 'readonly');
        const store = tx.objectStore('aiChatHistory');
        const req = store.getAll();
        req.onsuccess = () => {
          const results = (req.result || []) as DBChatMessage[];
          results.sort((a, b) => a.timestamp - b.timestamp);
          resolve(results.slice(-limit));
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      try {
        return JSON.parse(localStorage.getItem('neural_chat_v5') || '[]');
      } catch {
        return [];
      }
    }
  }

  async clearChatHistory(): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('aiChatHistory', 'readwrite');
        const store = tx.objectStore('aiChatHistory');
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      try {
        localStorage.removeItem('neural_chat_v5');
      } catch {}
    }
  }

  // --- Price History Snapshots ---
  async recordPriceSnapshot(symbol: string, market: string, priceData: PriceData): Promise<void> {
    try {
      const db = await this.getDB();
      const id = `${market}_${symbol}_${Date.now()}`;
      const record: DBPriceRecord = {
        id,
        symbol,
        market,
        price: priceData.price,
        change: priceData.change,
        rsi: priceData.rsi,
        timestamp: Date.now(),
      };
      return new Promise((resolve, reject) => {
        const tx = db.transaction('priceHistory', 'readwrite');
        const store = tx.objectStore('priceHistory');
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {}
  }

  // --- User Preferences & Profile Learning ---
  async setUserPreference<T>(key: string, value: T): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('userPreferences', 'readwrite');
        const store = tx.objectStore('userPreferences');
        const req = store.put({ key, value, updatedAt: Date.now() });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      try {
        localStorage.setItem(`pref_${key}`, JSON.stringify(value));
      } catch {}
    }
  }

  async getUserPreference<T>(key: string, defaultValue: T): Promise<T> {
    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('userPreferences', 'readonly');
        const store = tx.objectStore('userPreferences');
        const req = store.get(key);
        req.onsuccess = () => {
          if (req.result && req.result.value !== undefined) {
            resolve(req.result.value as T);
          } else {
            resolve(defaultValue);
          }
        };
        req.onerror = () => resolve(defaultValue);
      });
    } catch {
      try {
        const item = localStorage.getItem(`pref_${key}`);
        return item ? JSON.parse(item) : defaultValue;
      } catch {
        return defaultValue;
      }
    }
  }

  // --- Portfolio Snapshots ---
  async savePortfolioSnapshot(snapshot: PortfolioSnapshot): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('portfolioSnapshots', 'readwrite');
        const store = tx.objectStore('portfolioSnapshots');
        const req = store.put(snapshot);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      try {
        const snaps = JSON.parse(localStorage.getItem('portfolio_snapshots') || '[]');
        snaps.push(snapshot);
        localStorage.setItem('portfolio_snapshots', JSON.stringify(snaps.slice(-30)));
      } catch {}
    }
  }

  async getPortfolioSnapshots(limit = 30): Promise<PortfolioSnapshot[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('portfolioSnapshots', 'readonly');
        const store = tx.objectStore('portfolioSnapshots');
        const req = store.getAll();
        req.onsuccess = () => {
          const list = (req.result || []) as PortfolioSnapshot[];
          list.sort((a, b) => a.timestamp - b.timestamp);
          resolve(list.slice(-limit));
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      try {
        return JSON.parse(localStorage.getItem('portfolio_snapshots') || '[]');
      } catch {
        return [];
      }
    }
  }

  // --- Offline Action Queue ---
  async enqueueOfflineAction(type: OfflineAction['type'], payload: any): Promise<void> {
    const action: OfflineAction = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type,
      payload,
      timestamp: Date.now()
    };
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('offlineQueue', 'readwrite');
        const store = tx.objectStore('offlineQueue');
        const req = store.put(action);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      try {
        const q = JSON.parse(localStorage.getItem('offline_queue') || '[]');
        q.push(action);
        localStorage.setItem('offline_queue', JSON.stringify(q));
      } catch {}
    }
  }

  async getOfflineQueue(): Promise<OfflineAction[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('offlineQueue', 'readonly');
        const store = tx.objectStore('offlineQueue');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch {
      try {
        return JSON.parse(localStorage.getItem('offline_queue') || '[]');
      } catch {
        return [];
      }
    }
  }

  async clearOfflineQueue(): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('offlineQueue', 'readwrite');
        const store = tx.objectStore('offlineQueue');
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      try {
        localStorage.removeItem('offline_queue');
      } catch {}
    }
  }
}

export const appDB = new IndexedDBStorage();
