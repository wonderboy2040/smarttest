// ============================================================
// server/healthMonitor.js — v21.1.0 (Phase-3)
// ------------------------------------------------------------
// EK jagah se poore terminal ka operational health:
//   • FEEDS: har source ka last-tick age seconds me (liveFeed.feedAges
//     + CoinDCX futures WS + Binance futures WS + CoinDCX spot WS)
//   • KILLS: teeno layers — AI-desk config killSwitch, exec
//     reconciler L1/L2/L3, Bot Lab per-bot/global STOP files
//   • BOTS: Bot Lab status snapshot (mode, globalPause, heartbeats)
//   • PERSIST: exec heartbeat age + server/data writability probe
//   • ALERTING: 60s loop — koi bhi armed feed >90s stale ho, ya
//     kill arm ho, ya heartbeat >30s stale ho → Telegram push
//     (15-min per-key throttle, dedup).
//
// Design notes:
//   * /health (existing, deep liveness) aur /api/ping (zero-work
//     supervisor probe) ko TOUCH nahi kiya — ye unka ADDITION hai.
//   * Sab imports LAZY/dynamic hain: module load order + test
//     isolation safe (index.js boot pe initHealthMonitor() chalega).
//   * Fail-open READS: koi bhi sub-system unreachable ho to uska
//     status "unknown" aata hai — poora endpoint kabhi nahi girta.
// ============================================================

// v21.1.0 (Phase-3): import.meta.url-based app root — process.cwd() launch
// dir pe depend nahi karta (npm start / supervisor / tests sab se same).
// NOTE: __dirname ESM me defined NAHI hai (vitest shim chhupata hai, real
// node me ReferenceError aata tha) — fileURLToPath hi theek tareeka hai.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const _APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const _alertLastAt = {};   // alertKey -> epoch (15-min throttle)
const _state = { timer: null, inited: false };

const ALERT_THROTTLE_MS = 15 * 60_000;
export const FEED_STALE_ALERT_SEC = 90;   // armed feed itna stale → alert
export const HEARTBEAT_STALE_SEC = 30;   // exec heartbeat stale window

async function _sendTelegram(text) {
  try {
    const { sendTelegramMessage, telegramConfig } = await import('./ai/secrets.js');
    const tg = typeof telegramConfig === 'function' ? (telegramConfig() || {}) : {};
    const r = await sendTelegramMessage(text, { token: tg.token || process.env.TG_TOKEN || '', chatId: tg.chatId || process.env.TG_CHAT_ID || '' });
    return r?.ok === true;
  } catch { return false; }
}

function _throttledAlert(key, text) {
  const now = Date.now();
  if (now - (_alertLastAt[key] || 0) < ALERT_THROTTLE_MS) return false;
  _alertLastAt[key] = now;
  _sendTelegram(text).catch(() => { /* alert send best-effort */ });
  return true;
}

/** Aggregated snapshot — /api/health response body builder. */
export async function healthSnapshot() {
  const now = Date.now();
  const out = {
    ok: true,
    at: now,
    uptimeSec: Math.round(process.uptime()),
    pid: process.pid,
    memoryMB: Math.round((process.memoryUsage?.()?.rss || 0) / 1048576),
    feeds: { sources: {}, ws: {} },
    kills: {},
    bots: null,
    persist: {},
  };

  // ---- FEEDS: liveFeed source ages ----
  try {
    const { feedAges, feedStatus } = await import('./liveFeed.js');
    const ages = feedAges();
    const booleans = feedStatus();
    let staleArmed = [];
    for (const [src, a] of Object.entries(ages)) {
      out.feeds.sources[src] = { ...a, live: booleans[src] === true };
      if (a.ageSec > FEED_STALE_ALERT_SEC) staleArmed.push(src);
    }
    out.feeds.staleSources = staleArmed;
  } catch { out.feeds.sources = { error: 'liveFeed unavailable' }; }

  // ---- FEEDS: dedicated WS health (futures/spot/binance) ----
  try {
    const { cxRtWsStatus } = await import('./ai/cxRtStream.js');
    const cx = cxRtWsStatus();
    out.feeds.ws.coindcxFutures = {
      healthy: cx?.healthy === true,
      lastTickAt: cx?.lastTickAt ?? null,
      ageSec: cx?.lastTickAt ? Math.max(0, Math.round((now - cx.lastTickAt) / 1000)) : null,
    };
    if (cx?.spotWs) {
      out.feeds.ws.coindcxSpot = {
        healthy: cx.spotWs.healthy === true,
        lastUpdateAt: cx.spotWs.lastUpdateAt ?? null,
        ageMs: cx.spotWs.ageMs ?? null,
      };
    }
  } catch { /* cxRtStream not armed */ }
  try {
    const { binanceFutStatus } = await import('./ai/binanceFutWs.js');
    const b = binanceFutStatus();
    out.feeds.ws.binanceFutures = {
      healthy: b?.healthy === true,
      lastTickAt: b?.lastTickAt ?? null,
      ageSec: b?.lastTickAt ? Math.max(0, Math.round((now - b.lastTickAt) / 1000)) : null,
    };
  } catch { /* binanceFutWs not armed */ }

  // ---- KILLS: 3 layers ----
  try {
    const { loadConfig } = await import('./ai/coindcxOrders.js');
    out.kills.aiDesk = { enabled: loadConfig()?.killSwitch === true };
  } catch { out.kills.aiDesk = { error: 'unavailable' }; }
  try {
    const { killLevel, killReason, isKilled } = await import('./exec/reconciler.js');
    out.kills.exec = { level: killLevel(), reason: killReason(), isKilled: isKilled() };
  } catch { out.kills.exec = { error: 'unavailable' }; }
  try {
    const { activeKillSwitches, globalPauseActive } = await import('./bots/botState.js');
    out.kills.botLab = { bots: activeKillSwitches(), globalPause: globalPauseActive() };
  } catch { out.kills.botLab = { error: 'unavailable' }; }

  // ---- BOTS: Bot Lab snapshot (PEEK ONLY — runner create kabhi nahi karta;
  // getBotRunner() singleton null-provider wiring se corrupt ho sakta tha) ----
  try {
    const mod = await import('./bots/routes.js');
    const runner = typeof mod.peekBotRunner === 'function' ? mod.peekBotRunner() : null;
    if (runner && typeof runner.status === 'function') {
      const st = runner.status();
      out.bots = {
        mode: st?.mode ?? null,
        globalPause: st?.globalPause === true,
        scheduler: st?.scheduler ?? null,
        bots: (st?.bots || []).map(b => ({
          bot: b.bot, mode: b.mode, arm: b.arm,
          killSwitch: b.killSwitch === true,
          heartbeatAgeSec: b.heartbeat?.at ? Math.max(0, Math.round((now - b.heartbeat.at) / 1000)) : null,
        })),
      };
    }
  } catch { /* bot lab not armed */ }

  // ---- PERSIST: exec heartbeat (file-based dead-man switch) + data-dir writability ----
  try {
    const fs = await import('node:fs');
    const hbFile = path.join(_APP_ROOT, 'data', 'execution-heartbeat.json');
    let hbAt = null;
    try {
      const hb = JSON.parse(fs.readFileSync(hbFile, 'utf8'));
      hbAt = Number(hb?.at) || null;
    } catch { /* file nahi hai = reconciler not armed — ageSec null (honest) */ }
    out.persist.execHeartbeat = { at: hbAt, ageSec: hbAt ? Math.max(0, Math.round((now - hbAt) / 1000)) : null };
  } catch { /* heartbeat read best-effort */ }
  try {
    const fs = await import('node:fs');
    // Dono persist dirs: lib/store.js ka DATA_DIR (env-respecting —
    // SMARTAI_DATA_DIR override bhi cover) aur app/data (bot lab + exec
    // heartbeat — reconciler). ReadOnly mount ya disk-full pe pehla write
    // hi fail hota hai.
    out.persist.dataDirs = {};
    let storeDir = path.join(_APP_ROOT, 'server', 'data');
    try {
      const { DATA_DIR } = await import('./lib/store.js');
      if (DATA_DIR) storeDir = DATA_DIR;
    } catch { /* default path */ }
    for (const dir of [storeDir, path.join(_APP_ROOT, 'data')]) {
      const label = path.basename(path.dirname(dir)) === 'app' ? 'app/data' : `server-data(${path.basename(dir)})`;
      const probe = path.join(dir, `.health-probe-${process.pid}`);
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(probe, String(now));
        fs.unlinkSync(probe);
        out.persist.dataDirs[label] = true;
      } catch { out.persist.dataDirs[label] = false; }
    }
    out.persist.dataDirWritable = Object.values(out.persist.dataDirs).every(Boolean) === true;
  } catch { out.persist.dataDirWritable = false; out.persist.dataDirs = { error: 'probe failed' }; }

  // ---- overall ok ----
  const killActive = out.kills?.aiDesk?.enabled === true || (out.kills?.exec?.level || 0) > 0;
  out.ok = !killActive;
  return out;
}

/** 60s alert loop — feeds stale / kills armed / heartbeat stale → Telegram. */
async function _healthAlertTick() {
  const snap = await healthSnapshot();

  // (1) stale armed feeds
  const stale = snap.feeds?.staleSources || [];
  if (stale.length > 0) {
    _throttledAlert('feeds_stale', `🩺 HEALTH: ${stale.length} feed source(s) STALE >${FEED_STALE_ALERT_SEC}s — ${stale.slice(0, 6).join(', ')}${stale.length > 6 ? ' …' : ''}. UI prices in sources ke liye trusted nahi — /api/feed-status check karo.`);
  }

  // (2) WS health (futures perp feed is the live-trading critical one)
  const wsStale = [];
  for (const [k, v] of Object.entries(snap.feeds?.ws || {})) {
    if (v?.healthy === false && (v.ageSec == null || v.ageSec > FEED_STALE_ALERT_SEC)) wsStale.push(k);
  }
  if (wsStale.length > 0) {
    _throttledAlert('ws_stale', `🩺 HEALTH: WebSocket down — ${wsStale.join(', ')}. Futures desk live-tick gap me honest degrade hoga.`);
  }

  // (3) kill switches armed
  if (snap.kills?.aiDesk?.enabled === true) _throttledAlert('kill_ai', '🩺 HEALTH: AI-desk KILL SWITCH ON hai — koi bhi auto/live entry fire nahi hogi.');
  const lvl = snap.kills?.exec?.level || 0;
  if (lvl > 0) _throttledAlert('kill_exec', `🩺 HEALTH: EXEC KILL L${lvl} ACTIVE (${snap.kills?.exec?.reason || 'no reason'}) — live entries blocked${lvl >= 2 ? ', flatten/reduce mode' : ''}.`);
  if (snap.kills?.botLab?.globalPause === true) _throttledAlert('kill_bots_global', '🩺 HEALTH: Bot Lab GLOBAL PAUSE (STOP_ALL) active hai.');

  // (4) exec heartbeat stale (dead-man switch)
  const hbAge = snap.persist?.execHeartbeat?.ageSec;
  if (hbAge != null && hbAge > HEARTBEAT_STALE_SEC) {
    _throttledAlert('hb_stale', `🩺 HEALTH: exec heartbeat ${hbAge}s STALE (> ${HEARTBEAT_STALE_SEC}s) — reconcile loop atka hua lag raha hai. /api/exec/status check karo.`);
  }

  // (5) data dir read-only (Render disk full / ephemeral mount gone)
  if (snap.persist?.dataDirWritable === false) {
    _throttledAlert('disk_ro', '🩺 HEALTH: server/data write FAIL — journal/ledger persist nahi ho rahe! Render disk full ya read-only mount check karo.');
  }
}

export function initHealthMonitor() {
  if (_state.inited) return true;
  _state.inited = true;
  try {
    _state.timer = setInterval(() => { _healthAlertTick().catch(() => { /* never fatal */ }); }, 60_000);
    if (typeof _state.timer.unref === 'function') _state.timer.unref();
  } catch { /* timer best-effort */ }
  return true;
}

/** Tests ke liye — throttle map reset. */
export function _resetForTests() {
  for (const k of Object.keys(_alertLastAt)) delete _alertLastAt[k];
}
