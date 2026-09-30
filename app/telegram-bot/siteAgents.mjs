// ============================================================
// SITE AGENTS BRIDGE — ONE SOURCE OF TRUTH (bot v18.2 / site v10.9)
// ============================================================
// The legacy bot used to compute its OWN signals (analysis.mjs /
// market.mjs / algo.mjs) — so the bot and the website could answer
// the same question DIFFERENTLY ("bot says BUY, site says HOLD").
// This module migrates the bot's analysis commands onto the SAME
// site backend routes the website tabs + the webhook bot use:
//
//   GET  /api/ai/deep/:symbol        — deep single-symbol ticket
//   GET  /api/ai/signals?market=     — the 14-model ensemble board
//   POST /api/crypto-agent           — CoinDCX desk agent (9+ tools)
//   POST /api/intraday-agent         — NSE intraday desk agent
//   POST /api/ai/weekly-review       — weekly trade-performance digest
//   GET  /api/ai/insta-push/status   — instant-push pipeline health
//
// All calls go over the 127.0.0.1 loopback with the server-only
// API_TOKEN service credential (the siteSync.mjs pattern — the bot
// is forked from the same server and shares its env). When the
// site is unreachable, callers fall back to the legacy local
// paths — the bot never goes dark, it just goes local.
// ============================================================
import { siteApiConfigured } from './siteSync.mjs';

const SITE_PORT = process.env.PORT || 8080;
const SITE_BASE = `http://127.0.0.1:${SITE_PORT}`;
const SERVICE_TOKEN = process.env.API_TOKEN || '';

const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const clip = (s, n) => {
  const t = String(s ?? '').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export function siteBridgeReady() {
  return siteApiConfigured();
}

/** Loopback fetch with a per-call timeout (chat UX needs tighter
 *  bounds than siteSync's 150s full-sync window). */
async function siteFetch(pathname, { method = 'GET', body, timeoutMs = 60_000 } = {}) {
  if (!siteBridgeReady()) {
    return { ok: false, status: 0, error: 'API_TOKEN not configured — site bridge disabled' };
  }
  try {
    const res = await fetch(`${SITE_BASE}${pathname}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SERVICE_TOKEN}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // honest endpoints answer 400 with {ok:false, error:'human reason'} —
      // keep that string instead of losing it to `HTTP 400`.
      const reason = typeof data?.error === 'string' ? data.error
        : data?.error?.message || `HTTP ${res.status}`;
      return { ok: false, status: res.status, error: reason, data };
    }
    return { ok: true, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, error: e?.name === 'TimeoutError' ? 'site timeout' : (e?.message || 'network error') };
  }
}

// ------------------------------------------------------------
// Desk session memory (voice + /consensus routing) — mirrors
// webhook.js's 30-min chat-keyed session, so a voice note follows
// the desk the user last talked to (default crypto, 24/7 desk).
// ------------------------------------------------------------
const SESSION_TTL_MS = 30 * 60 * 1000;
const _deskSessions = new Map(); // chatId → { desk, at }

export function deskSessionFor(chatId) {
  const s = _deskSessions.get(String(chatId));
  if (s && Date.now() - s.at < SESSION_TTL_MS) return s.desk;
  _deskSessions.delete(String(chatId));
  return null;
}

export function rememberDesk(chatId, desk) {
  _deskSessions.set(String(chatId), { desk: desk === 'intraday' ? 'intraday' : 'crypto', at: Date.now() });
}

const CRYPTO_WORDS = /\b(btc|bitcoin|eth|ethereum|sol|solana|bnb|xrp|doge|ada|avax|dot|link|uni|shib|crypto|coindcx|perp|perpetual|funding|altcoin|usdt|usdc|memecoin|b-)\b/i;
const INDIA_WORDS = /\b(nifty|sensex|banknifty|nse|bse|reliance|tcs|infy|infosys|hdfc|icici|sbi|itc|axis|kotak|adani|tata|bajaj|maruti|intraday|share\s?market|indian\s?market)\b/i;

/** Best-effort desk inference for free text (null = caller's default). */
export function inferDeskFromText(text) {
  const t = String(text || '');
  if (CRYPTO_WORDS.test(t)) return 'crypto';
  if (INDIA_WORDS.test(t)) return 'intraday';
  return null;
}

// ------------------------------------------------------------
// Agent calls — the SAME desk agents the website tabs use
// ------------------------------------------------------------
export async function siteAgentQuery(text, desk, { timeoutMs = 90_000 } = {}) {
  const target = desk === 'intraday' ? 'intraday' : 'crypto';
  const r = await siteFetch(target === 'intraday' ? '/api/intraday-agent' : '/api/crypto-agent', {
    method: 'POST',
    body: { messages: [{ role: 'user', content: String(text || '').slice(0, 6000) }] },
    timeoutMs,
  });
  if (!r.ok) return { ok: false, error: r.error || 'site agent unavailable' };
  const d = r.data || {};
  if (!d.ok) return { ok: false, error: d.error || 'site agent failed' };
  return { ok: true, text: d.text || '', engine: d.engine || null, tools: d.toolsUsed || [] };
}

// ------------------------------------------------------------
// Deep scan — the SAME deep ticket the site's "Deep" button makes
// ------------------------------------------------------------
const CRYPTO_BASES = new Set(['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'DOT', 'MATIC', 'LINK', 'UNI', 'SHIB', 'TRX', 'LTC', 'BCH', 'NEAR', 'ATOM', 'APT', 'ARB', 'OP', 'SUI', 'PEPE', 'WIF', 'FIL', 'ETC', 'XLM', 'HBAR', 'INJ', 'TIA', 'SEI', 'RNDR', 'FET', 'AGLD', 'GALA', 'SAND', 'MANA', 'AXS', 'AAVE', 'MKR', 'CRV', 'LDO', 'DYDX', 'JUP', 'PYTH', 'ENA', 'W', 'TON', 'NOT', 'BONK', 'FLOKI', 'JASMY', 'ANKR', 'CELR', 'DENT', 'KEY', 'DGB', 'SNX', 'COMP', 'GRT', 'MASK', 'ROSE', 'ONE', 'ZIL', 'IOTA', 'ALGO', 'VET', 'THETA', 'CHZ', 'ENJ', 'AUDIO', 'COTI', 'SKL', 'STORJ', 'WOO', 'ZRX']);
const US_BASES = new Set(['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'SPY', 'QQQ', 'AMD', 'NFLX', 'CRM', 'AVGO', 'COIN', 'UBER', 'PLTR', 'SMH', 'VOOG', 'VGT', 'IWM', 'VEA', 'SPX', 'NDX', 'MU', 'SPACEX']);

export function inferMarketForSymbol(sym) {
  const s = String(sym || '').toUpperCase().replace(/\.NS$/, '').replace(/\.BO$/, '').replace(/-USD$/, '');
  if (s.startsWith('B-') || s.endsWith('_USDT') || s.endsWith('USDT')) return 'CRYPTO';
  if (s.endsWith('INR')) return 'CRYPTO';
  if (CRYPTO_BASES.has(s)) return 'CRYPTO';
  if (US_BASES.has(s)) return 'GLOBALFUTURES';
  return 'INDIA'; // NSE default — /api/ai/deep normMarket default
}

/** Deep ticket from the site (market inferred, one fallback retry). */
export async function siteDeepScan(symbol, { timeoutMs = 60_000 } = {}) {
  const sym = String(symbol || '').toUpperCase().replace(/\.NS$/, '').replace(/\.BO$/, '').replace(/-USD$/, '');
  const first = inferMarketForSymbol(sym);
  const order = first === 'INDIA'
    ? ['INDIA', 'CRYPTO', 'GLOBALFUTURES']
    : first === 'CRYPTO' ? ['CRYPTO', 'GLOBALFUTURES', 'INDIA'] : ['GLOBALFUTURES', 'INDIA', 'CRYPTO'];
  for (const market of order) {
    const r = await siteFetch(`/api/ai/deep/${encodeURIComponent(sym)}?market=${market}`, { timeoutMs });
    if (r.ok && r.data?.ok && r.data?.signal) {
      return { ok: true, market, deep: r.data };
    }
  }
  return { ok: false, error: 'site deep scan unavailable for this symbol' };
}

const SIDE_EMOJI = { LONG: '🟢', SHORT: '🔴', FLAT: '⚪' };
const GRADE_TONE = { STRONG: '🚀', ACTION: '⚡', WATCH: '👀', NONE: '⚪' };

function fmtPrice(v, market) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (market === 'GLOBALFUTURES') return `USDC ${n.toLocaleString('en-US', { maximumFractionDigits: 4 })}`;
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: Math.abs(n) < 1 ? 6 : 2 })}`;
}

/** Format the site's deep payload as a Telegram HTML ticket. */
export function formatDeepTicket({ deep, market, symbol }) {
  const s = deep.signal || {};
  const plan = s.plan || {};
  const ai = s.superIntel || {};
  const lines = [];
  lines.push(`${GRADE_TONE[s.grade] || '⚪'} <b>DEEP SCAN — ${esc(symbol)}</b> <i>(${esc(market)} desk)</i>`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━');
  const side = SIDE_EMOJI[s.side] || '⚪';
  lines.push(`${side} <b>${esc(s.side)}</b> · grade <b>${esc(s.grade)}</b> · conf <b>${Math.round(s.confidence ?? 0)}%</b>`
    + `${ai.aiScore != null ? ` · 🧠 AI Score <b>${Math.round(ai.aiScore)}</b>` : ''}`);
  if (s.ltp != null) lines.push(`LTP <b>${fmtPrice(s.ltp, market)}</b>${s.changePct != null ? ` (${s.changePct >= 0 ? '+' : ''}${r2(s.changePct)}%)` : ''}`);
  if (plan.entry) {
    lines.push('');
    lines.push(`🎯 Entry <b>${fmtPrice(plan.entry, market)}</b> · 🛑 SL <b>${fmtPrice(plan.stopLoss, market)}</b>`);
    lines.push(`🏆 T1 ${fmtPrice(plan.target1, market)} · T2 <b>${fmtPrice(plan.target2, market)}</b>${plan.rewardRisk != null ? ` · R:R 1:${r2(plan.rewardRisk)}` : ''}`);
    if (plan.riskPct != null) lines.push(`⚠️ Risk @ SL ${r2(plan.riskPct)}%`);
  }
  lines.push('');
  lines.push(`🗳️ Committee: ${s.participating ?? '?'}/${s.totalModels ?? '?'} models · agreement ${Math.round((s.agreement || 0) * 100)}%${s.voters != null ? ` · ${s.voters} voters` : ''}`);
  const note = s.aiNote || {};
  if (note.verdict) lines.push(`🧠 Council: <b>${esc(clip(note.verdict, 90))}</b>`);
  if (note.debate) {
    const bull = clip(note.debate.bull, 140);
    const bear = clip(note.debate.bear, 140);
    if (bull) lines.push(`🐂 Bull: ${esc(bull)}`);
    if (bear) lines.push(`🐻 Bear: ${esc(bear)}`);
  }
  if (deep.edge && deep.edge.trades > 0) {
    lines.push('');
    lines.push(`🧪 Walk-forward: ${deep.edge.trades} trades · win ${deep.edge.winRate ?? '?'}% · avg ${deep.edge.avgR ?? '?'}R (${esc(deep.edge.timeframe || '')})`);
  }
  if (deep.ltf) {
    lines.push(`📈 ${esc(deep.ltf.label)}: RSI ${r2(deep.ltf.rsi) ?? '—'} · ATR ${r2(deep.ltf.atr) ?? '—'}`);
  }
  if (deep.narrative) lines.push(`\n📖 ${esc(clip(deep.narrative, 420))}`);
  lines.push('');
  lines.push(`ℹ️ <i>Same 14-model engine jo website dikhati hai · source: ${esc(deep.priceSource || 'site')}</i>`);
  return lines.join('\n');
}

// ------------------------------------------------------------
// Boards — the SAME signal board the site tabs render
// ------------------------------------------------------------
export async function siteBoard(market, { limit = 6, timeoutMs = 60_000 } = {}) {
  const r = await siteFetch(`/api/ai/signals?market=${encodeURIComponent(market)}&limit=${limit}`, { timeoutMs });
  if (!r.ok || !r.data?.ok) return null;
  return r.data;
}

export function formatBoardLines(board, { label, max = 6 } = {}) {
  if (!board?.signals?.length) return null;
  const reg = board.regime || {};
  const head = [`📡 <b>${label}</b>`];
  if (reg.niftyChange != null) head.push(`NIFTY ${reg.niftyChange >= 0 ? '+' : ''}${r2(reg.niftyChange)}% · VIX ${r2(reg.indiaVix) ?? '—'} · ${esc(reg.niftyTrend || '—')}`);
  if (reg.btcChange != null) head.push(`BTC ${reg.btcChange >= 0 ? '+' : ''}${r2(reg.btcChange)}% · ${esc(reg.btcTrend || '—')}`);
  const meta = board.superIntelMeta;
  if (meta) head.push(`🧠 ${meta.scored ?? 0} scored · ${meta.strongCount ?? 0} strong (80+) · ${meta.eliteCount ?? 0} elite (85+)`);
  const rows = board.signals.slice(0, max).map((s) => {
    const ai = s.superIntel?.aiScore;
    const plan = s.plan || {};
    const px = plan.entry ? ` · entry ${fmtPrice(plan.entry, board.market)}` : '';
    return `${GRADE_TONE[s.grade] || '⚪'} <b>${esc(s.symbol)}</b> ${SIDE_EMOJI[s.side] || '⚪'} ${esc(s.side)} · <b>${esc(s.grade)}</b> · conf ${Math.round(s.confidence ?? 0)}%${ai != null ? ` · AI ${Math.round(ai)}` : ''}${px}`;
  });
  return [...head, '━━━━━━━━━━━━━━━━━━━━━━━', ...rows].join('\n');
}

/** The site's own regime read (boards carry it) — the bot must SHOW
 *  the site's view, not re-derive a second opinion. */
export async function siteRegimeView({ timeoutMs = 60_000 } = {}) {
  const [india, crypto] = await Promise.all([
    siteBoard('INDIA', { limit: 3, timeoutMs }),
    siteBoard('CRYPTO', { limit: 3, timeoutMs }),
  ]);
  if (!india && !crypto) return { ok: false, error: 'site boards unavailable' };
  const parts = [];
  if (india) {
    const b = formatBoardLines(india, { label: '🇮🇳 NSE BOARD (site engine)', max: 3 });
    if (b) parts.push(b);
  }
  if (crypto) {
    const b = formatBoardLines(crypto, { label: '₿ CRYPTO BOARD (site engine)', max: 3 });
    if (b) parts.push(b);
  }
  if (parts.length === 0) return { ok: false, error: 'site boards empty' };
  parts.push('ℹ️ <i>Regime board se aaya hai — website ka SAME read. /crypto ya /intraday se poora desk agent pucho.</i>');
  return { ok: true, text: parts.join('\n\n') };
}

// ------------------------------------------------------------
// Weekly review + instant-push health (for the bot's commands)
// ------------------------------------------------------------
export async function siteWeeklyReview({ timeoutMs = 90_000 } = {}) {
  const r = await siteFetch('/api/ai/weekly-review', { method: 'POST', body: {}, timeoutMs });
  if (r.ok && r.data?.ok) return { ok: true, data: r.data };
  // honest 400s carry their own reason ("no settled trades this week")
  const reason = r.data?.error || r.error || 'weekly review unavailable';
  return { ok: false, error: reason };
}

export async function siteInstaPushStatus({ timeoutMs = 8_000 } = {}) {
  const r = await siteFetch('/api/ai/insta-push/status', { timeoutMs });
  if (!r.ok) return { ok: false, error: r.error || 'insta-push status unavailable' };
  return { ok: true, status: r.data };
}
