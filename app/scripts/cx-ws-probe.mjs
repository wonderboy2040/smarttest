#!/usr/bin/env node
// ============================================================
// scripts/cx-ws-probe.mjs — v21.1.2 (report Section-2 diagnosis)
// ------------------------------------------------------------
// CoinDCX futures WebSocket ka STANDALONE stage-wise diagnostic.
// Jo host pe chalta hai wahi sach bolta hai — sandbox se reachable
// nahi tha isliye ye script "WS Down" ki EXACT wajah SAME host
// (Render Shell / VPS) se confirm karti hai.
//
// PROTOCOL (server/ai/cxSocketIo.js ka verbatim mirror — EIO=4):
//   server→client : '0{sid}' open · '2' ping · '40{sid}' ns-ack ·
//                   '42["event",data]' event
//   client→server : '40' ns-connect · '3' pong ·
//                   '42["join",{channelName}]' · app-ping @25s
//   ⚠ client KABHI apna '2' nahi bhejta — CoinDCX ise protocol
//     violation maan kar ~200ms me socket drop kar deta hai
//     (live-verified 2026-09-17, cxSocketIo.js header).
//
// STAGES:
//   [0] HTTP  — Engine.IO polling endpoint GET (geo/WAF reject pakde)
//   [1] WS    — wss handshake, '0' open frame
//   [2] NS    — '40' bhejo, '40' ns-connect ACK aana chahiye
//   [3] JOIN  — 42["join", currentPrices@futures@rt]
//   [4] TICKS — 30s events ginna (book channel = har USDT perp)
//
// RUN (same host jahan server chalta hai):
//   cd app && node scripts/cx-ws-probe.mjs
//   SPOT bhi probe karna ho: node scripts/cx-ws-probe.mjs --spot
// Exit code: 0 = WS healthy · 1 = problem (CI/Render shell friendly)
// Total runtime ~45s.
// ============================================================
import WebSocket from 'ws';

const FUT_URL = 'wss://stream.coindcx.com/socket.io/?EIO=4&transport=websocket';
const SPOT_URL = 'wss://stream-spot.coindcx.com/socket.io/?EIO=4&transport=websocket';
const FUT_CHANNEL = 'currentPrices@futures@rt';
const SPOT_CHANNEL = 'currentPrices@spot@1s';

const args = process.argv.slice(2);
const wantSpot = args.includes('--spot') || args.includes('-s');
const WS_URL = wantSpot ? SPOT_URL : FUT_URL;
const CHANNEL = wantSpot ? SPOT_CHANNEL : FUT_CHANNEL;
const HTTP_URL = (wantSpot ? 'https://stream-spot.coindcx.com' : 'https://stream.coindcx.com') + '/socket.io/?EIO=4&transport=polling';
const TICK_WINDOW_MS = 30_000;
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(5) + 's';

const ok = (m) => console.log(`[${el()}] ✅ ${m}`);
const bad = (m) => console.log(`[${el()}] ❌ ${m}`);
const info = (m) => console.log(`[${el()}] ℹ️  ${m}`);

const verdict = (status, why, action) => {
  console.log('\n────────── VERDICT ──────────');
  console.log(`STATUS : ${status}`);
  console.log(`WHY    : ${why}`);
  if (action) console.log(`ACTION : ${action}`);
  console.log('──────────────────────────────');
  process.exit(status === 'HEALTHY' ? 0 : 1);
};

console.log(`cx-ws-probe — CoinDCX ${wantSpot ? 'SPOT' : 'FUTURES'} WebSocket diagnostic (v21.1.2)`);
console.log(`WS     : ${WS_URL}`);
console.log(`Channel: ${CHANNEL}\n`);

// ---------------- [0] HTTP reachability ----------------
let httpCode = null;
try {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), 6000);
  const r = await fetch(`${HTTP_URL}&t=${Date.now()}`, { signal: ac.signal, headers: { 'User-Agent': 'cx-ws-probe/21.1.2' } });
  clearTimeout(to);
  httpCode = r.status;
  const body = (await r.text().catch(() => '')).slice(0, 120);
  if (r.status === 403 || r.status === 451) {
    bad(`HTTP ${r.status} — WAF/geo-block reject (body: ${body || '<empty>'})`);
    verdict('BLOCKED',
      `Host IP / region ko CoinDCX edge (Cloudflare/WAF) reject kar raha hai (HTTP ${r.status}).`,
      'Server region badlo — Render pe Singapore ya Oracle Mumbai VPS try karo; IP allowlist CoinDCX support se.');
  }
  ok(`HTTP ${r.status} reachable (body: ${body.replace(/\s+/g, ' ').slice(0, 80) || '<empty>'})`);
} catch (e) {
  const m = String(e?.cause?.code || e?.code || e?.name || e?.message || e);
  bad(`HTTP stage FAIL: ${m}`);
  if (/ENOTFOUND|EAI_AGAIN/.test(m)) {
    verdict('DNS-FAIL', `DNS resolve nahi hua (${m}).`, 'wss://stream.coindcx.com:443 (aur *.coindcx.com) firewall/DNS se allow karo; container ka /etc/resolv.conf check karo.');
  }
  if (/abort|Abort|timeout|TIMEOUT/i.test(m)) {
    verdict('TIMEOUT', 'HTTP request 6s me koi jawab nahi — TCP hi nahi khul raha.', 'Outbound 443 blocked? VPS security-group / Render outbound rules / local firewall check karo.');
  }
  verdict('HTTP-ERROR', `HTTP stage error: ${m}`, 'Network/egress problem — proxy/NAT config check karo.');
}

// ---------------- [1][2][3][4] WS stages ----------------
await new Promise((resolve) => {
  let ws;
  let openedAt = 0;
  let nsAckAt = null;
  let joinedAt = null;
  let tickCount = 0;
  let eventNames = new Set();
  let sampleTick = '';
  let serverPings = 0;
  let appPingTimer = null;
  let hardStop = null;
  let done = false;

  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(hardStop);
    clearInterval(appPingTimer);
    try { ws && ws.terminate(); } catch { /* noop */ }

    if (!openedAt) {
      // connect() hi nahi chala — error handler ne reason de diya hoga
      return; // (verdict error handler se aata hai)
    }
    if (!nsAckAt) {
      verdict('NO-NS-ACK',
        `WS TCP+TLS handshake ${((Date.now() - openedAt) / 1000).toFixed(1)}s me khula, par Engine.IO '0' open frame ke baad namespace-connect ACK ('40') kabhi nahi aaya (8s+ wait).`,
        'Protocol/upstream degraded — CoinDCX status page + sockets docs recheck karo; WAF kuch frames drop kar raha ho sakta hai.');
    }
    if (tickCount === 0) {
      verdict('SILENT-CHANNEL',
        `Joined '${CHANNEL}' par ${TICK_WINDOW_MS / 1000}s me ZERO tick events. Namespace ACK aaya tha — socket zinda hai, channel data nahi de raha.`,
        `Channel name docs se verify karo; GLOB (USDC equity perps) off-hours quiet ho sakta hai — 'B-<PAIR>@prices-futures' per-pair channel bhi try karo. Crypto (USDT perp) 24/7 chalta hai isliye book-channel ka zero-tick abnormal hai.`);
    }
    verdict('HEALTHY',
      `Handshake + ns-ACK + join + ${tickCount} tick(s) in ${TICK_WINDOW_MS / 1000}s sab pass. Channel events: ${[...eventNames].slice(0, 5).join(', ') || '<unnamed>'}.`,
      `Is host se CoinDCX WS bilkul theek hai — "WS Down" UI-side false-positive tha (v21.1.2 ka OpsHealthStrip idle-fix hi solution hai). Sample: ${sampleTick}`);
  };

  try {
    ws = new WebSocket(WS_URL, { handshakeTimeout: 8000 });
  } catch (e) {
    bad(`WS constructor fail: ${e?.message || e}`);
    verdict('WS-ERROR', `WebSocket create nahi hua: ${e?.message || e}`, 'TLS/proxy config check karo.');
    return;
  }

  hardStop = setTimeout(finish, 10_000 + TICK_WINDOW_MS + 5_000);
  if (hardStop.unref) hardStop.unref();

  ws.on('unexpected-response', (_req, res) => {
    bad(`WS upgrade reject: HTTP ${res?.statusCode}`);
    verdict('BLOCKED', `WebSocket upgrade HTTP ${res?.statusCode} se reject hua (WAF/geo).`, 'Server region badlo (Render: Singapore / Oracle Mumbai); support se IP allowlist.');
  });

  ws.on('error', (e) => {
    if (done) return;
    const m = String(e?.message || e);
    bad(`WS error: ${m}`);
    if (!openedAt) {
      verdict('CONNECT-FAIL', `WS connect fail: ${m}`, 'DNS/firewall/TLS — wss://stream.coindcx.com:443 outbound allow karo.');
    } else if (!nsAckAt) {
      verdict('NO-NS-ACK', `Open ke baad error: ${m}`, 'Upstream/WAF drop — CoinDCX status check.');
    }
    finish();
  });

  ws.on('open', () => {
    openedAt = Date.now();
    ok(`[1] WS handshake OPEN (${wantSpot ? 'spot' : 'futures'} domain) — TLS+TCP theek`);
    // '40' ns-connect server ke '0' handshake frame KE BAAD jata hai (cxSocketIo protocol order)
  });

  ws.on('message', (raw) => {
    if (done) return;
    const s = typeof raw === 'string' ? raw : raw.toString();
    if (s.startsWith('0')) { ok(`[1] Engine.IO OPEN frame mila (sid: ${(s.match(/"sid":"?([^",}]+)/) || [])[1] || '…'})`); ws.send('40'); info("[2] '40' namespace-connect bheja — ACK ka wait"); return; }
    if (s === '2') { serverPings++; ws.send('3'); return; } // EIO keepalive — pong hi bhejna hai
    if (s.startsWith('40')) {
      nsAckAt = Date.now();
      ok(`[2] Namespace-connect ACK mila (${((nsAckAt - openedAt) / 1000).toFixed(1)}s me)`);
      ws.send(`42["join",${JSON.stringify({ channelName: CHANNEL })}]`);
      joinedAt = Date.now();
      ok(`[3] JOIN bheja: ${CHANNEL}`);
      info(`[4] ${TICK_WINDOW_MS / 1000}s tick window shuru — server '2' pings ka jawab '3' chal raha hai`);
      // app-level keepalive (25s — CoinDCX-documented, silent socket drop hota hai warna)
      appPingTimer = setInterval(() => { try { ws.send('42["ping",{"data":"Ping message"}]'); } catch { /* noop */ } }, 25_000);
      if (appPingTimer.unref) appPingTimer.unref();
      setTimeout(() => { info(`[4] window adhura-tek: server-pings=${serverPings}, ab tak ${tickCount} ticks`); }, 15_000).unref?.();
      return;
    }
    if (s.startsWith('41')) { bad("Namespace DISCONNECT ('41') server se aaya"); finish(); return; }
    if (s.startsWith('42')) {
      tickCount++;
      try {
        const arr = JSON.parse(s.slice(2));
        if (Array.isArray(arr) && typeof arr[0] === 'string') {
          eventNames.add(arr[0]);
          if (!sampleTick) {
            const dataStr = typeof arr[1]?.data === 'string' ? arr[1].data : JSON.stringify(arr[1]);
            sampleTick = String(dataStr || '').replace(/\s+/g, ' ').slice(0, 140);
            ok(`[4] FIRST TICK (${((Date.now() - joinedAt) / 1000).toFixed(1)}s join ke baad) — event '${arr[0]}'`);
            info(`    payload: ${sampleTick}`);
          }
          if (tickCount === 5) info('    …ticks aa rahe hain (5+) — window bharne ka wait, sab normal');
        }
      } catch { /* malformed frame — count to hua */ }
      return;
    }
    // '1' engine-close etc.
    if (s === '1') { bad("Engine.IO CLOSE ('1')"); finish(); }
  });

  ws.on('close', () => {
    if (done) return;
    if (!openedAt) {
      verdict('CONNECT-FAIL', 'WS handshake ke pehle hi close (timeout/TLS/WAF).', 'Outbound 443 + wss://stream.coindcx.com allow karo; 8s handshake timeout kaafi tha.');
    } else if (!nsAckAt) {
      verdict('NO-NS-ACK', "Socket khula tha par namespace ACK se pehle band ho gaya (server-side drop).", 'EIO version / WAF behavior — CoinDCX docs + status page check.');
    } else if (tickCount > 0) {
      info(`Socket closed AFTER ${tickCount} ticks — reconnect-normal behavior (WAF blip).`);
      verdict('HEALTHY', `Ticks prove ho chuke the (${tickCount} events) — socket baad me band hua jo production reconnect loop handle karta hai.`, null);
    } else {
      verdict('SILENT-CHANNEL', 'Socket band ho gaya bina kisi tick ke.', 'Channel/off-hours — docs se channel verify karo.');
    }
    finish();
  });

  // tick window end
  setTimeout(() => finish(), 10_000 + TICK_WINDOW_MS).unref?.();
});
