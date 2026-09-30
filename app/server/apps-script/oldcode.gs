/**
 * ============================================================
 * Wealth AI Pro — Google Apps Script Cloud Sync backend
 * ------------------------------------------------------------
 * Deploy this as a Web App (Deploy → New deployment → Web app):
 *   - Execute as:        Me
 *   - Who has access:    Anyone
 * Copy the resulting /exec URL into the app's VITE_API_URL (build env)
 * or the server's API_URL env var.
 *
 * The frontend talks to this script with CORS-"simple" requests
 * (Content-Type: text/plain, no custom headers) so the browser does
 * NOT send a preflight OPTIONS request — Apps Script cannot answer
 * preflight, which is why the old application/json + X-Auth-Token
 * approach silently failed. The auth token now travels in the body.
 * ============================================================
 */

// Must match the frontend's VITE_API_TOKEN (defaults to 'WEALTH_AI_SYNC').
var AUTH_TOKEN = 'WEALTH_AI_SYNC';

// Sheet/tab used as a tiny key→value store.
var SHEET_NAME = 'WealthAISync';
var PORTFOLIO_KEY = 'portfolio';
var GROQ_KEY = 'groqKey';

function _store_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange('A1:B1').setValues([['key', 'value']]);
  }
  return sh;
}

function _set_(key, value) {
  var sh = _store_();
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sh.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sh.appendRow([key, value]);
}

function _get_(key) {
  var sh = _store_();
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) return data[i][1];
  }
  return '';
}

function _json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------- POST (primary path) ----------------
function doPost(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }
    if (body.authToken && body.authToken !== AUTH_TOKEN) {
      return _json_({ ok: false, error: 'unauthorized' });
    }
    return _handle_(body);
  } catch (err) {
    return _json_({ ok: false, error: String(err) });
  }
}

// ---------------- GET (load + no-cors fallback) ----------------
function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    if (p.authToken && p.authToken !== AUTH_TOKEN) {
      return _json_({ ok: false, error: 'unauthorized' });
    }
    // no-cors POST fallback arrives as ?action=update&data=<json>
    if (p.action === 'update' && p.data) {
      var parsed = JSON.parse(p.data);
      return _handle_({ action: 'update', portfolio: parsed.portfolio, usdInr: parsed.usdInr });
    }
    return _handle_(p);
  } catch (err) {
    return _json_({ ok: false, error: String(err) });
  }
}

// ---------------- shared action router ----------------
function _handle_(req) {
  var action = req.action || 'load';

  if (action === 'update') {
    _set_(PORTFOLIO_KEY, JSON.stringify({
      portfolio: req.portfolio || [],
      usdInr: req.usdInr || 0,
      timestamp: req.timestamp || Date.now()
    }));
    return _json_({ ok: true, saved: (req.portfolio || []).length });
  }

  if (action === 'saveKey') {
    _set_(GROQ_KEY, req.groqKey || '');
    return _json_({ ok: true });
  }

  if (action === 'loadKey') {
    return _json_({ groqKey: _get_(GROQ_KEY) || '' });
  }

  // default: load
  var raw = _get_(PORTFOLIO_KEY);
  if (!raw) return _json_({ portfolio: [] });
  try {
    return _json_(JSON.parse(raw));
  } catch (err) {
    return _json_({ portfolio: [] });
  }
}
