// ============================================================
//  SUPERINTELLIGENCE ADVANCE AI PRO TRADER AUTO — BROWSER AGENT
//  v18.6 — CDP (Chrome DevTools Protocol) driver for the user's
//  already-open, logged-in browser tabs (CoinDCX + Dhan).
//
//  ZERO new npm deps: node:http + ws (already installed).
//
//  Design:
//   * User runs Start-AutoBrowser.bat once -> Chrome/Edge starts
//     with --remote-debugging-port=9222 and stays logged in to
//     coindcx.com / dhan.co (same profile, same session).
//   * This module discovers tabs via http://127.0.0.1:9222/json,
//     attaches a WebSocket CDP session per tab, and drives the
//     page DOM via Runtime.evaluate (React-safe input setter).
//   * Every action is journaled by the caller (proTraderAuto.js);
//     every placement attempt saves a screenshot to
//     server/data/protrader-shots/ for the user to verify.
//   * Selectors are STRATEGY ARRAYS with fallbacks. Live DOMs
//     change; browserHealth() probes which pieces still match so
//     the panel can tell the user exactly what is broken.
//     Custom overrides: server/data/browser-selectors.json.
// ============================================================

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';
import { loadJSON } from '../lib/store.js';

// v18.6.2: MULTI-PORT CDP discovery. Default pe 9222 (Start-AutoBrowser.bat)
// khulta hai; 9223-9225 fallback hai agar user ne manual alag port lagaya ho.
// PROTRADER_CDP_HOST / PROTRADER_CDP_PORT (single, tests) / PROTRADER_CDP_PORTS
// (comma list) env se override hota hai.
function _cdpPorts() {
  const list = String(process.env.PROTRADER_CDP_PORTS || '')
    .split(',').map((p) => Number(p.trim())).filter((n) => Number.isFinite(n) && n > 0 && n < 65536);
  if (list.length) return list;
  const single = Number(process.env.PROTRADER_CDP_PORT || 0);
  if (single > 0) return [single]; // explicit single port = EXACT (no fallback scan)
  return [9222, 9223, 9224, 9225];
}
const CDP_HOST = process.env.PROTRADER_CDP_HOST || '127.0.0.1';
const CDP_PORTS = _cdpPorts();
const SHOT_DIR = path.join(process.env.SMARTAI_DATA_DIR || path.join(process.cwd(), 'server', 'data'), 'protrader-shots');
const MAX_SHOTS = 12;

// ---------------- state ----------------
const state = {
  browser: null,        // { product, version, connectedAt }
  tabs: {},             // { coindcx: {id,url,title,wsUrl}, dhan: {...} }
  pages: {},            // key -> CdpPage
  host: null,           // v18.6.2: working CDP host
  port: null,           // v18.6.2: working CDP port
  lastError: null,
  lastScanAt: 0,
};

// ---------------- tiny http json helper ----------------
function cdpHttp(host, port, method, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host, port, path: urlPath, method, timeout: 4000 },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(raw || 'null') }); }
          catch { resolve({ status: res.statusCode, body: raw }); }
        });
      }
    );
    req.on('timeout', () => { req.destroy(); reject(new Error('CDP http timeout')); });
    req.on('error', reject);
    req.end();
  });
}

// v18.6.2: CDP connect failures ko HUMAN-readable banao — user ko exact
// fix batana (normal browser tabs count nahi hote, bat chahiye).
function _friendlyCdpError(e) {
  const raw = String(e?.message || e);
  if (/ECONNREFUSED|EHOSTUNREACH|ENOTFOUND|timeout/i.test(raw)) {
    return `connect fail @${CDP_HOST}:${CDP_PORTS.join('/')} (${raw}) — automation browser nahi chal raha. FIX: Start-AutoBrowser.bat chalao (ye SmartAI ka DEDICATED automation window kholta hai; NORMAL Chrome/Edge ke tabs control NAHI hote — Chrome/Edge 136+ default profile pe debug port block karta hai, isliye dedicated profile zaroori hai)`;
  }
  return raw;
}

// ---------------- CDP page session ----------------
class CdpPage {
  constructor(key, wsUrl) {
    this.key = key;
    this.wsUrl = wsUrl;
    this.ws = null;
    this._id = 0;
    this._pending = new Map();
    this._alive = false;
  }
  async connect() {
    if (this._alive && this.ws) return true;
    await new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl, { perMessageDeflate: false, handshakeTimeout: 5000 });
      const to = setTimeout(() => { try { this.ws.terminate(); } catch {} reject(new Error('CDP ws handshake timeout')); }, 6000);
      this.ws.on('open', () => { clearTimeout(to); this._alive = true; resolve(true); });
      this.ws.on('message', (raw) => this._onMessage(String(raw)));
      this.ws.on('error', (e) => { if (!this._alive) { clearTimeout(to); reject(e); } });
      this.ws.on('close', () => {
        this._alive = false;
        for (const [, p] of this._pending) p.reject(new Error('CDP ws closed'));
        this._pending.clear();
      });
    });
    try { await this.send('Runtime.enable'); await this.send('Page.enable'); } catch { /* best-effort */ }
    return true;
  }
  _onMessage(str) {
    let msg; try { msg = JSON.parse(str); } catch { return; }
    if (msg.id && this._pending.has(msg.id)) {
      const p = this._pending.get(msg.id);
      this._pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`CDP ${msg.error.message || 'error'}`));
      else p.resolve(msg.result);
    }
  }
  send(method, params = {}) {
    if (!this._alive || !this.ws) return Promise.reject(new Error(`CDP page ${this.key} not connected`));
    const id = ++this._id;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (e) { this._pending.delete(id); reject(e); }
      setTimeout(() => {
        if (this._pending.has(id)) { this._pending.delete(id); reject(new Error(`CDP ${method} timeout`)); }
      }, 15000).unref();
    });
  }
  // Evaluate an async in-page expression. Returns parsed JSON value.
  async evaluate(asyncExpr, { timeoutMs = 15000 } = {}) {
    const wrapped = `(async () => { ${asyncExpr} })()`;
    const res = await this.send('Runtime.evaluate', {
      expression: wrapped,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
      timeout: timeoutMs,
    });
    if (res?.exceptionDetails) {
      const d = res.exceptionDetails;
      throw new Error(`page error: ${d?.exception?.description || d?.text || 'unknown'}`);
    }
    const v = res?.result?.value;
    if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } }
    return v;
  }
  async navigate(url) {
    await this.send('Page.navigate', { url });
    await new Promise((r) => setTimeout(r, 2500));
  }
  async screenshot(name) {
    try {
      const res = await this.send('Page.captureScreenshot', { format: 'jpeg', quality: 60 });
      if (!res?.data) return null;
      return saveShot(name, res.data);
    } catch { return null; }
  }
}

function saveShot(name, b64) {
  try {
    if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });
    const file = path.join(SHOT_DIR, `${Date.now()}-${String(name).replace(/[^a-z0-9_-]/gi, '_')}.jpg`);
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    const all = fs.readdirSync(SHOT_DIR).filter((f) => f.endsWith('.jpg')).sort();
    while (all.length > MAX_SHOTS) { try { fs.unlinkSync(path.join(SHOT_DIR, all.shift())); } catch {} }
    return path.basename(file);
  } catch { return null; }
}

// ---------------- tab discovery ----------------
const TAB_MATCH = {
  coindcx: /coindcx\.com/i,
  dhan: /dhan\.co/i,
};

async function discoverTabs({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - state.lastScanAt < 30_000 && state.browser) return state.tabs;
  state.lastScanAt = now;
  state.lastError = null;
  // v18.6.2: har known port try karo jo pehla jude wahi yaad rakho.
  let version = null; let lastErr = null;
  for (const p of CDP_PORTS) {
    try { version = await cdpHttp(CDP_HOST, p, 'GET', '/json/version'); state.host = CDP_HOST; state.port = p; break; }
    catch (e) { lastErr = e; }
  }
  if (!version) {
    state.browser = null; state.tabs = {}; state.host = null; state.port = null;
    state.lastError = _friendlyCdpError(lastErr);
    return state.tabs;
  }
  if (!version?.body?.webSocketDebuggerUrl) { state.browser = null; state.lastError = 'browser found but no debugger url (Chrome ko --remote-debugging-port ke saath dedicated --user-data-dir se chalao)'; return {}; }
  state.browser = { product: version.body.Browser || 'Chrome', version: version.body.Browser || '', connectedAt: now };
  let list;
  try { list = await cdpHttp(CDP_HOST, state.port, 'GET', '/json/list'); } catch (e) { state.lastError = String(e?.message || e); return {}; }
  const pages = Array.isArray(list.body) ? list.body.filter((t) => t.type === 'page') : [];
  state.tabs = {};
  for (const [key, re] of Object.entries(TAB_MATCH)) {
    const hit = pages.find((t) => re.test(t.url || '')) || null;
    if (hit) state.tabs[key] = { id: hit.id, url: hit.url, title: hit.title || '', wsUrl: hit.webSocketDebuggerUrl || null };
  }
  return state.tabs;
}

// v18.6.2: connected hai par tab missing — user ko batao KAUNSA tab kahan kholna hai.
function _tabsHint() {
  if (!state.browser) return null;
  const missing = [];
  if (!state.tabs.coindcx) missing.push('coindcx.com/trade');
  if (!state.tabs.dhan) missing.push('web.dhan.co');
  if (missing.length === 0) return null;
  return `Automation browser mila (${state.browser.product}) par tab missing — AUTOMATION window me kholo: ${missing.join(' + ')} (normal browser me khule tabs count nahi hote)`;
}

async function pageFor(key, { createUrl = null } = {}) {
  await discoverTabs({});
  let tab = state.tabs[key];
  if (!tab && createUrl) {
    try {
      const created = await cdpHttp(CDP_HOST, state.port, 'PUT', `/json/new?${encodeURIComponent(createUrl)}`)
        .catch(() => cdpHttp(CDP_HOST, state.port, 'GET', `/json/new?${encodeURIComponent(createUrl)}`));
      const t = created?.body;
      if (t && (t.id || t?.targetId)) {
        tab = { id: t.id || t.targetId, url: t.url || createUrl, title: '', wsUrl: t.webSocketDebuggerUrl || null };
        state.tabs[key] = tab;
      }
    } catch { /* older chrome disabled /json/new — user opens tab manually */ }
  }
  if (!tab) throw new Error(`${key} tab not found in browser (kholo: ${createUrl || key})`);
  if (!tab.wsUrl) throw new Error(`${key} tab found but no websocket debugger url (tab needs focus once)`);
  let page = state.pages[key];
  if (!page || page.wsUrl !== tab.wsUrl) {
    page = new CdpPage(key, tab.wsUrl);
    await page.connect();
    state.pages[key] = page;
  } else {
    await page.connect().catch(() => { throw new Error(`${key} CDP reconnect failed`); });
  }
  return page;
}

// ---------------- in-page DOM helper library (injected) ----------------
// React-safe input setter + text-based element finder + waiter.
const DOM_HELPERS = `
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const vis = (el) => { try { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; } catch { return false; } };
  const byText = (sel, re, { root } = {}) => $$('button, div[role="button"], a, span, li, div', root)
    .filter((el) => vis(el) && re.test((el.textContent || '').trim()) && (el.textContent || '').trim().length < 40)
    .sort((a, b) => (a.textContent || '').length - (b.textContent || '').length)[0] || null;
  const bySelOrText = (sels, re) => { for (const s of sels) { const el = $(s); if (el && vis(el)) return el; } return re ? byText('button', re) : null; };
  const setVal = (el, value) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const clickEl = (el) => {
    if (!el) return false;
    const opts = { bubbles: true, cancelable: true, view: window };
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1 }));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1 }));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
    } catch { el.click(); }
    return true;
  };
  const waitFor = async (fn, { timeout = 8000, poll = 300, label = '' } = {}) => {
    const t0 = Date.now();
    for (;;) {
      let v = null; try { v = fn(); } catch {}
      if (v) return v;
      if (Date.now() - t0 > timeout) throw new Error('wait timeout: ' + label);
      await new Promise((r) => setTimeout(r, poll));
    }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
`;

// ---------------- CoinDCX in-page operations ----------------
const CX_OPEN_URL = 'https://coindcx.com/trade';
const CX_STYLES = {
  searchBox: ['input[data-testid*="search" i]', 'input[placeholder*="search" i]', '[class*="Search"] input', '[class*="search"] input'],
  pairItem: null, // text matched
  limitBtn: null, // text "Limit"
  priceInput: ['input[name="price"]', 'input[placeholder*="price" i]', '[class*="order"] input[type="text"]', '[class*="Price"] input'],
  qtyInput: ['input[name="quantity"]', 'input[placeholder*="quantity" i]', 'input[placeholder*="amount" i]', 'input[placeholder*="total" i]'],
  marginTab: null, // text "Margin"
  buyBtn: null, sellBtn: null,
};

function selOverride(key, field) {
  const ov = _loadOverrides();
  const arr = ov?.[key]?.[field];
  return Array.isArray(arr) && arr.length ? arr : null;
}

let _ovCache = null; let _ovAt = 0;
function _loadOverrides() {
  if (_ovCache && Date.now() - _ovAt < 30_000) return _ovCache;
  _ovCache = loadJSON('browser-selectors.json', null); _ovAt = Date.now();
  return _ovCache;
}

// Health probe: which building blocks exist on the CURRENT page.
function cxHealthScript() {
  return `
    ${DOM_HELPERS}
    try {
      const search = bySelOrText(${JSON.stringify(selOverride('coindcx', 'searchBox') || CX_STYLES.searchBox)}, null);
      const limitBtn = byText('button', /limit/i);
      const marketBtn = byText('button', /market/i);
      const marginTab = byText('button, div[role="button"], div, span', /^\\s*margin\\b|margin\\s*trad/i);
      const priceInput = $$('input').find((el) => vis(el) && /price|entry/i.test(el.placeholder || el.name || el.getAttribute('aria-label') || ''));
      const qtyInput = $$('input').find((el) => vis(el) && /qty|quantity|amount|total/i.test(el.placeholder || el.name || el.getAttribute('aria-label') || ''));
      const buyBtn = $$('button, div[role="button"]').filter((el) => vis(el) && /^(buy|long)\\b/i.test((el.textContent || '').trim()))[0] || null;
      const sellBtn = $$('button, div[role="button"]').filter((el) => vis(el) && /^(sell|short)\\b/i.test((el.textContent || '').trim()))[0] || null;
      const posTable = $$('table, [class*="position"], [class*="Position"]').filter((el) => vis(el) && (el.textContent || '').toLowerCase().includes('position'))[0] || null;
      return JSON.stringify({
        ok: true, url: location.href,
        found: {
          searchBox: !!search, limitBtn: !!limitBtn, marketBtn: !!marketBtn, marginTab: !!marginTab,
          priceInput: !!priceInput, qtyInput: !!qtyInput, buyBtn: !!buyBtn, sellBtn: !!sellBtn,
          positions: !!posTable,
        },
      });
    } catch (e) { return JSON.stringify({ ok: false, error: String(e && e.message || e) }); }
  `;
}

// Search a pair and select it in the pair picker.
function cxSelectPairScript(pair) {
  return `
    ${DOM_HELPERS}
    try {
      const box = bySelOrText(${JSON.stringify(selOverride('coindcx', 'searchBox') || CX_STYLES.searchBox)}, null);
      if (!box) throw new Error('search box nahi mila');
      clickEl(box); await sleep(400); box.focus();
      setVal(box, ${JSON.stringify(pair)});
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
      await sleep(700);
      const want = ${JSON.stringify(pair.toUpperCase())};
      const item = await waitFor(() => {
        const cands = $$('[class*="dropdown"] [class*="item"], [class*="result"], [role="option"], [class*="pair"], [class*="symbol"], [class*="suggestion"] li, [class*="suggestion"] div')
          .filter((el) => vis(el));
        return cands.find((el) => (el.textContent || '').toUpperCase().replace(/[^A-Z0-9]/g, '').includes(want.replace(/[^A-Z0-9]/g, ''))) || null;
      }, { timeout: 6000, label: 'pair dropdown' });
      clickEl(item); await sleep(1800);
      return JSON.stringify({ ok: true, pair: want, picked: (item.textContent || '').trim().slice(0, 60) });
    } catch (e) { return JSON.stringify({ ok: false, error: String(e && e.message || e) }); }
  `;
}

// Place an order. side LONG|SHORT; price = limit entry; totalINR stake; leverage (margin, best-effort).
function cxPlaceOrderScript({ side, price, totalINR, leverage, useMargin }) {
  return `
    ${DOM_HELPERS}
    try {
      const steps = [];
      if (${JSON.stringify(Boolean(useMargin))}) {
        const m = byText('button, div[role="button"], div, span', /^\\s*margin\\b|margin\\s*trad/i);
        if (m) { clickEl(m); steps.push('margin-tab'); await sleep(800); }
        else steps.push('margin-tab:skip');
      }
      const limitBtn = byText('button', /limit/i);
      if (limitBtn) { clickEl(limitBtn); steps.push('limit-order'); await sleep(500); }
      else steps.push('limit-order:skip(market)');
      const priceInput = await waitFor(() => $$('input').find((el) => vis(el) && /price|entry/i.test(el.placeholder || el.name || el.getAttribute('aria-label') || '')), { timeout: 5000, label: 'price input' });
      setVal(priceInput, ${JSON.stringify(String(price))}); steps.push('price=' + ${JSON.stringify(String(price))});
      const qtyInput = $$('input').find((el) => vis(el) && /qty|quantity|amount|total/i.test(el.placeholder || el.name || el.getAttribute('aria-label') || ''));
      if (qtyInput) { setVal(qtyInput, String(${Number(totalINR)} / Number(${Number(price)}) || 0)); steps.push('qty-set'); }
      ${Number(leverage) > 1 ? `
      const levControl = $$('[class*="lever"], [class*="Lever"], input[type="range"], [role="slider"]').filter(vis)[0] || null;
      if (levControl) {
        try {
          const target = Math.min(${Number(leverage)}, 10);
          if (levControl.tagName === 'INPUT') {
            const min = Number(levControl.min || 2), max = Number(levControl.max || 10);
            const ratio = (target - min) / Math.max(1, max - min);
            levControl.focus();
            for (let i = 0; i < Math.ceil(ratio * 40); i++) levControl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
            steps.push('leverage~' + target);
          } else { steps.push('leverage:manual'); }
        } catch { steps.push('leverage:skip'); }
      } else steps.push('leverage:skip');` : ''}
      const want = ${JSON.stringify(side === 'LONG' ? 'buy' : 'sell')};
      const btn = await waitFor(() => $$('button, div[role="button"]')
        .filter((el) => vis(el) && new RegExp('^(' + want + '|long|short)\\\\b', 'i').test((el.textContent || '').trim()))[0] || null,
        { timeout: 5000, label: want + ' button' });
      clickEl(btn); steps.push('clicked:' + want);
      await sleep(900);
      const confirm = byText('button', /confirm|place\\\\s*order|submit|proceed/i);
      if (confirm) { clickEl(confirm); steps.push('confirm-modal'); await sleep(1200); }
      else steps.push('confirm:skip');
      const err = $$('[class*="error"], [class*="Error"], [role="alert"]').filter(vis).map((el) => (el.textContent || '').trim()).filter(Boolean)[0] || null;
      return JSON.stringify({ ok: !err, steps, pageError: err || null, url: location.href });
    } catch (e) { return JSON.stringify({ ok: false, steps: [], error: String(e && e.message || e), url: location.href }); }
  `;
}

// Read open positions (reconciliation). Returns raw rows — conservative.
function cxReadPositionsScript() {
  return `
    ${DOM_HELPERS}
    try {
      const containers = $$('table, [class*="position" i]').filter((el) => vis(el) && /position/i.test(el.textContent || ''));
      const table = containers[0] || null;
      if (!table) return JSON.stringify({ ok: true, positions: [], note: 'positions container nahi mila' });
      const rows = $$('tr, [class*="row"]', table).filter((el) => {
        const t = (el.textContent || '').trim();
        return t.length > 20 && /\\d/.test(t) && !/pair|symbol|side|qty/i.test(t.slice(0, 12));
      }).slice(0, 30);
      const positions = rows.map((row) => {
        const cells = $$('td, [class*="cell"]', row).map((c) => (c.textContent || '').trim()).filter(Boolean);
        const text = (row.textContent || '').replace(/\\s+/g, ' ').trim();
        const nums = (text.match(/[+-]?\\d+(?:\\.\\d+)?/g) || []).map(Number);
        return { cells: cells.slice(0, 14), text: text.slice(0, 220), nums: nums.slice(0, 12) };
      }).filter((p) => p.text.length > 20);
      return JSON.stringify({ ok: true, positions });
    } catch (e) { return JSON.stringify({ ok: false, error: String(e && e.message || e) }); }
  `;
}

// Close a position from the positions panel (best-effort: find row with
// pair text, click its exit/close button, confirm).
function cxClosePositionScript(pair, side) {
  return `
    ${DOM_HELPERS}
    try {
      const want = ${JSON.stringify(String(pair).toUpperCase())};
      const containers = $$('table, [class*="position" i]').filter((el) => vis(el) && /position/i.test(el.textContent || ''));
      const steps = [];
      let row = null;
      for (const c of containers) {
        row = $$('tr, [class*="row"]', c).find((el) => (el.textContent || '').toUpperCase().includes(want));
        if (row) break;
      }
      if (!row) return JSON.stringify({ ok: false, error: 'position row nahi mila: ' + want, steps });
      steps.push('row-found');
      const exitBtn = $$('button, [role="button"], a, span', row).filter(vis).find((el) => /exit|close|square\\\\s*off/i.test((el.textContent || '').trim())) || null;
      if (exitBtn) { clickEl(exitBtn); steps.push('exit-click'); }
      else {
        const menuBtn = $$('button, [role="button"], [class*="menu"], [class*="action"]', row).filter(vis).slice(-1)[0] || null;
        if (!menuBtn) return JSON.stringify({ ok: false, error: 'exit button nahi mila', steps });
        clickEl(menuBtn); await sleep(700); steps.push('menu-open');
        const exitAll = byText('button, li, span, div', /exit|close\\\\s*all|square\\\\s*off/i);
        if (!exitAll) return JSON.stringify({ ok: false, error: 'menu me exit option nahi mila', steps });
        clickEl(exitAll); steps.push('menu-exit');
      }
      await sleep(800);
      const confirm = byText('button', /confirm|yes|proceed|close/i);
      if (confirm) { clickEl(confirm); steps.push('confirm'); }
      await sleep(1000);
      return JSON.stringify({ ok: true, steps, closed: want });
    } catch (e) { return JSON.stringify({ ok: false, error: String(e && e.message || e) }); }
  `;
}

// ---------------- Dhan in-page operations ----------------
const DHAN_OPEN_URL = 'https://web.dhan.co';

function dhanHealthScript() {
  return `
    ${DOM_HELPERS}
    try {
      const search = $$('input').find((el) => vis(el) && /search|scrip|stock|symbol/i.test(el.placeholder || el.getAttribute('aria-label') || ''));
      const buyBtn = $$('button, div[role="button"]').filter((el) => vis(el) && /^buy\\b/i.test((el.textContent || '').trim()))[0] || null;
      const sellBtn = $$('button, div[role="button"]').filter((el) => vis(el) && /^sell\\b/i.test((el.textContent || '').trim()))[0] || null;
      const product = byText('button, div[role="button"], div', /intraday|mtf|delivery/i);
      const qtyInput = $$('input').find((el) => vis(el) && /qty|quantity/i.test(el.placeholder || el.getAttribute('aria-label') || ''));
      const priceInput = $$('input').find((el) => vis(el) && /price|limit/i.test(el.placeholder || el.getAttribute('aria-label') || ''));
      return JSON.stringify({ ok: true, url: location.href, found: {
        searchBox: !!search, buyBtn: !!buyBtn, sellBtn: !!sellBtn, productSelect: !!product, qtyInput: !!qtyInput, priceInput: !!priceInput,
      }});
    } catch (e) { return JSON.stringify({ ok: false, error: String(e && e.message || e) }); }
  `;
}

function dhanSelectScripScript(symbol) {
  return `
    ${DOM_HELPERS}
    try {
      const box = $$('input').find((el) => vis(el) && /search|scrip|stock|symbol/i.test(el.placeholder || el.getAttribute('aria-label') || ''));
      if (!box) throw new Error('dhan search box nahi mila');
      clickEl(box); await sleep(400); box.focus();
      setVal(box, ${JSON.stringify(symbol)});
      await sleep(900);
      const want = ${JSON.stringify(String(symbol).toUpperCase())};
      const item = await waitFor(() => {
        const cands = $$('[class*="result"], [class*="dropdown"] [class*="item"], [role="option"], [class*="suggestion"] li, [class*="suggestion"] div, [class*="search"] [class*="item"]').filter(vis);
        return cands.find((el) => (el.textContent || '').toUpperCase().includes(want)) || null;
      }, { timeout: 6000, label: 'dhan scrip dropdown' });
      clickEl(item); await sleep(2000);
      return JSON.stringify({ ok: true, picked: (item.textContent || '').trim().slice(0, 80) });
    } catch (e) { return JSON.stringify({ ok: false, error: String(e && e.message || e) }); }
  `;
}

function dhanPlaceOrderScript({ side, price, quantity, product }) {
  return `
    ${DOM_HELPERS}
    try {
      const steps = [];
      if (${JSON.stringify(String(product))} !== 'MARKET') {
        const limitBtn = byText('button, div[role="button"], div', /limit/i);
        if (limitBtn) { clickEl(limitBtn); steps.push('limit'); await sleep(400); }
        else steps.push('limit:skip');
      }
      const priceInput = $$('input').find((el) => vis(el) && /price|limit/i.test(el.placeholder || el.getAttribute('aria-label') || ''));
      if (priceInput && ${Number(price)} > 0) { setVal(priceInput, ${JSON.stringify(String(price))}); steps.push('price'); }
      const qtyInput = await waitFor(() => $$('input').find((el) => vis(el) && /qty|quantity/i.test(el.placeholder || el.getAttribute('aria-label') || '')), { timeout: 5000, label: 'qty input' });
      setVal(qtyInput, ${JSON.stringify(String(Math.max(1, Math.floor(Number(quantity) || 1))))}); steps.push('qty');
      const prodSel = byText('button, div[role="button"], div', /intraday|mtf|delivery/i);
      if (prodSel) { clickEl(prodSel); await sleep(500); steps.push('product-menu');
        const want = byText('li, [role="option"], span, div', new RegExp(${JSON.stringify(String(product))}, 'i'));
        if (want) { clickEl(want); steps.push('product=' + ${JSON.stringify(String(product))}); await sleep(400); }
      } else steps.push('product:skip');
      const want = ${JSON.stringify(side === 'LONG' ? 'buy' : 'sell')};
      const btn = await waitFor(() => $$('button, div[role="button"]').filter((el) => vis(el) && new RegExp('^' + want, 'i').test((el.textContent || '').trim()))[0] || null, { timeout: 5000, label: want + ' button' });
      clickEl(btn); steps.push('clicked:' + want);
      await sleep(800);
      const confirm = byText('button', /confirm|place|submit|proceed/i);
      if (confirm) { clickEl(confirm); steps.push('confirm'); await sleep(1000); }
      const err = $$('[class*="error"], [role="alert"]').filter(vis).map((el) => (el.textContent || '').trim()).filter(Boolean)[0] || null;
      return JSON.stringify({ ok: !err, steps, pageError: err || null, url: location.href });
    } catch (e) { return JSON.stringify({ ok: false, steps: [], error: String(e && e.message || e) }); }
  `;
}

// v18.6.4: Dhan side CLOSE (best-effort DOM) — the EOD-squareoff /
// reversal exit path for India positions. Hunts any visible positions
// panel row mentioning the scrip, clicks its exit/close/square-off
// control, confirms. Honest failure (row nahi mila / panel closed)
// returns ok:false — the engine then keeps the trade in CLOSE_UNKNOWN
// and re-attempts (never journals a close that did not happen).
function dhanClosePositionScript(symbol, side) {
  return `
    ${DOM_HELPERS}
    try {
      const want = ${JSON.stringify(String(symbol).toUpperCase())};
      const steps = [];
      // positions panel: Dhan web exposes a positions/holdings table
      // (bottom panel or the positions page). Hunt any visible row.
      const containers = $$('table, [class*="position" i], [class*="holding" i]').filter((el) => vis(el));
      let row = null;
      for (const c of containers) {
        row = $$('tr, [class*="row"]', c).find((el) => {
          const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
          return t.toUpperCase().includes(want) && /\d/.test(t) && t.length > 20;
        }) || null;
        if (row) break;
      }
      if (!row) return JSON.stringify({ ok: false, error: 'dhan position row nahi mila: ' + want, steps });
      steps.push('row-found');
      const exitBtn = $$('button, [role="button"], a, span', row).filter(vis).find((el) => /exit|close|square\\s*off/i.test((el.textContent || '').trim())) || null;
      if (exitBtn) { clickEl(exitBtn); steps.push('exit-click'); }
      else {
        const menuBtn = $$('button, [role="button"], [class*="menu"], [class*="action"], [class*="icon"]', row).filter(vis).slice(-1)[0] || null;
        if (!menuBtn) return JSON.stringify({ ok: false, error: 'exit button nahi mila', steps });
        clickEl(menuBtn); await sleep(700); steps.push('menu-open');
        const exitAll = byText('button, li, span, div', /exit|close|square\\s*off/i);
        if (!exitAll) return JSON.stringify({ ok: false, error: 'menu me exit option nahi mila', steps });
        clickEl(exitAll); steps.push('menu-exit');
      }
      await sleep(800);
      const confirm = byText('button', /confirm|yes|proceed|close|sell|buy/i);
      if (confirm) { clickEl(confirm); steps.push('confirm'); }
      await sleep(1000);
      const err = $$('[class*="error"], [role="alert"]').filter(vis).map((el) => (el.textContent || '').trim()).filter(Boolean)[0] || null;
      return JSON.stringify({ ok: !err, steps, closed: want, pageError: err || null, url: location.href });
    } catch (e) { return JSON.stringify({ ok: false, error: String(e && e.message || e) }); }
  `;
}

// ---------------- public API ----------------
export async function browserConnect({ probe = false } = {}) {
  await discoverTabs({ force: true });
  const out = {
    connected: !!state.browser, browser: state.browser,
    host: state.host || CDP_HOST, port: state.port || CDP_PORTS[0], portsTried: CDP_PORTS,
    tabs: {}, lastError: state.lastError,
  };
  for (const key of Object.keys(TAB_MATCH)) {
    const t = state.tabs[key];
    out.tabs[key] = t
      ? { found: true, url: t.url, title: t.title }
      : { found: false, hint: state.browser ? `AUTOMATION window me ${key === 'coindcx' ? 'coindcx.com/trade' : 'web.dhan.co'} tab kholo (normal browser ka tab count nahi hota)` : null };
  }
  if (probe) {
    for (const key of ['coindcx', 'dhan']) {
      if (!out.tabs[key]?.found) continue;
      try {
        const page = await pageFor(key);
        const script = key === 'coindcx' ? cxHealthScript() : dhanHealthScript();
        const r = await page.evaluate(script, { timeoutMs: 12000 });
        out.tabs[key].health = r;
      } catch (e) { out.tabs[key].health = { ok: false, error: String(e?.message || e) }; }
    }
  }
  return out;
}

export function browserStatus() {
  // v18.6.2: tabs ko SAFE projection ke saath do — frontend ko hint bhi
  // dikhe (connected hai par tab missing case me kya kholna hai).
  const tabs = {};
  for (const key of Object.keys(TAB_MATCH)) {
    const t = state.tabs[key];
    tabs[key] = t
      ? { found: true, url: t.url, title: t.title }
      : { found: false, hint: state.browser ? `AUTOMATION window me ${key === 'coindcx' ? 'coindcx.com/trade' : 'web.dhan.co'} tab kholo (normal browser ka tab count nahi hota)` : null };
  }
  return {
    connected: !!state.browser, browser: state.browser,
    host: state.host || CDP_HOST, port: state.port || CDP_PORTS[0], portsTried: CDP_PORTS,
    tabs, lastError: state.lastError,
    hint: state.browser ? _tabsHint() : 'Start-AutoBrowser.bat chalao — ye SmartAI ka DEDICATED automation window kholta hai (9222 debug port). NORMAL browser me khuli CoinDCX/Dhan tabs count NAHI hoti; Chrome/Edge 136+ default profile pe debug port block karta hai, isliye bat wala dedicated profile + ek baar login zaroori hai',
  };
}

export async function cxEnsureTradePage(pairUrlHint) {
  const page = await pageFor('coindcx', { createUrl: pairUrlHint || CX_OPEN_URL });
  return page;
}

export async function cxSelectPair(page, pair) {
  return page.evaluate(cxSelectPairScript(pair), { timeoutMs: 20000 });
}

export async function cxPlaceOrder(page, opts) {
  const r = await page.evaluate(cxPlaceOrderScript(opts), { timeoutMs: 30000 });
  r.shot = await page.screenshot(`cx-${opts.side}-${Date.now() % 100000}`);
  return r;
}

export async function cxReadPositions() {
  const page = await pageFor('coindcx').catch(() => null);
  if (!page) return { ok: false, error: 'coindcx tab not available' };
  return page.evaluate(cxReadPositionsScript(), { timeoutMs: 15000 });
}

export async function cxClosePosition(pair, side) {
  const page = await pageFor('coindcx');
  const r = await page.evaluate(cxClosePositionScript(pair, side), { timeoutMs: 25000 });
  r.shot = await page.screenshot(`cx-close-${pair}`);
  return r;
}

export async function dhanEnsurePage() {
  return pageFor('dhan', { createUrl: DHAN_OPEN_URL });
}

export async function dhanSelectScrip(page, symbol) {
  return page.evaluate(dhanSelectScripScript(symbol), { timeoutMs: 20000 });
}

export async function dhanPlaceOrder(page, opts) {
  const r = await page.evaluate(dhanPlaceOrderScript(opts), { timeoutMs: 30000 });
  r.shot = await page.screenshot(`dhan-${opts.side}-${Date.now() % 100000}`);
  return r;
}

// v18.6.4: close an India position in the user's logged-in Dhan tab.
export async function dhanClosePosition(symbol, side) {
  const page = await dhanEnsurePage();
  const r = await page.evaluate(dhanClosePositionScript(symbol, side), { timeoutMs: 25000 });
  try { r.shot = await page.screenshot(`dhan-close-${String(symbol).slice(0, 10)}-${Date.now() % 100000}`); } catch { /* shot optional */ }
  return r;
}

// v18.6.4: read Dhan's visible positions panel (reconciliation probe).
export async function dhanReadPositions() {
  const page = await pageFor('dhan').catch(() => null);
  if (!page) return { ok: false, error: 'dhan tab not available' };
  return page.evaluate(cxReadPositionsScript(), { timeoutMs: 15000 });
}

export function shotDir() { return SHOT_DIR; }
