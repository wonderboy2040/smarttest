// ============================================
// CLOUD SYNC — Google Apps Script Integration
// Advance Pro v16.0 — Groq Super Intelligence
// ============================================

import {
  API_URL,
  setGroqKey, setTavilyKey,
  GROQ_KEY, TAVILY_API_KEY
} from './config.mjs';

// SECURITY (audit H-2 fix): Cloud sync auth token MUST come from the
// server-side API_TOKEN env var. The VITE_* fallback (browser-exposed at
// build time) and the weak public default 'WEALTH_AI_SYNC' are removed —
// both previously authorized anyone to read/overwrite the synced state.
const AUTH_TOKEN = process.env.API_TOKEN || '';

function isCloudSyncConfigured() {
  return AUTH_TOKEN.length >= 12;
}

export async function loadPortfolioFromCloud() {
  if (!API_URL) return null;
  if (!isCloudSyncConfigured()) {
    console.warn('[cloud] API_TOKEN not set — cloud sync disabled.');
    return null;
  }

  try {
    const res = await fetch(`${API_URL}?action=load&authToken=${encodeURIComponent(AUTH_TOKEN)}&t=${Date.now()}`, {
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return null;

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*?\}/);
      if (!match || match[0] === '{}') return null;
      try { data = JSON.parse(match[0]); } catch { return null; }
    }
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch { return null; }
    }

    if (data && data.portfolio && Array.isArray(data.portfolio)) {
      console.log(`☁️ Cloud Sync: Loaded ${data.portfolio.length} positions`);
      return data.portfolio;
    }
  } catch (e) {
    console.warn('☁️ Cloud load failed:', e.message);
  }

  return null;
}

export async function loadGroqKeyFromCloud() {
  if (!API_URL) return null;

  try {
    const res = await fetch(`${API_URL}?action=loadKey&authToken=${encodeURIComponent(AUTH_TOKEN)}&t=${Date.now()}`, {
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*?\}/);
      if (!match) return null;
      try { data = JSON.parse(match[0]); } catch { return null; }
    }
    const key = data.groqKey;
    if (key && typeof key === 'string') {
      if (key.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(key);
          if (parsed.groqKey) setGroqKey(parsed.groqKey);
          if (parsed.tavilyKey) setTavilyKey(parsed.tavilyKey);
          console.log('🔑 Groq API key loaded from cloud (JSON)');
          return parsed.groqKey || "";
        } catch (err) {
          console.warn('⚠️ Cloud keys JSON parse failed:', err);
        }
      }

      if (key.startsWith('gsk_') && key.length > 20) {
        console.log('🔑 Groq API Key loaded from cloud (Legacy string)');
        setGroqKey(key);
        return key;
      }
    }
  } catch (e) {
    console.warn('🔑 Groq key cloud load failed:', e.message);
  }

  return null;
}

export async function saveAllKeysToCloud() {
  if (!API_URL) return false;
  const payload = {
    groqKey: GROQ_KEY || "",
    tavilyKey: TAVILY_API_KEY || ""
  };
  const serialized = JSON.stringify(payload);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groqKey: serialized, action: 'saveKey', authToken: AUTH_TOKEN, timestamp: Date.now() }),
      signal: AbortSignal.timeout(10000)
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

export async function saveGroqKeyToCloud(key) {
  if (key && typeof key === 'string') {
    if (key.startsWith('{')) {
      try {
        const parsed = JSON.parse(key);
        if (parsed.groqKey) setGroqKey(parsed.groqKey);
        if (parsed.tavilyKey) setTavilyKey(parsed.tavilyKey);
      } catch (err) {}
    } else {
      setGroqKey(key);
    }
  }
  return saveAllKeysToCloud();
}

export async function syncPortfolioToCloud(portfolio, usdInr) {
  if (!API_URL) return false;
  if (!portfolio || portfolio.length === 0) {
    console.warn('☁️ Cloud Sync: Blocking sync because portfolio is empty to prevent accidental deletion.');
    return false;
  }

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', authToken: AUTH_TOKEN, portfolio, timestamp: Date.now(), usdInr }),
      signal: AbortSignal.timeout(10000)
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}
