// ============================================================
// OpsHealthStrip — v21.1.0 (Phase-3)
// ------------------------------------------------------------
// /api/health ka compact frontend view: per-feed last-tick ages,
// WS health, teeno kill layers, Bot Lab snapshot, exec heartbeat
// (dead-man) + data-dir writability. EngineHealthStrip (AI engines)
// ke SIDE me baith-ta hai — terminal ka OPERATIONS panel.
// Poll: 30s visibility-gated (D16 pattern). Fail: strip chupchap
// hide ho jaata hai (auxiliary UI — kabhi terminal nahi todta).
// ============================================================
import { memo, useCallback, useEffect, useState } from 'react';
import { HeartPulse } from 'lucide-react';
import { apiFetch } from '../../utils/api';

interface HealthSnap {
  ok?: boolean;
  uptimeSec?: number;
  feeds?: {
    sources?: Record<string, { ageSec: number; live?: boolean }>;
    staleSources?: string[];
    ws?: Record<string, { healthy?: boolean; ageSec?: number | null }>;
  };
  kills?: {
    aiDesk?: { enabled?: boolean };
    exec?: { level?: number; reason?: string | null };
    botLab?: { globalPause?: boolean; bots?: string[] };
  };
  bots?: { mode?: string | null; globalPause?: boolean };
  persist?: { execHeartbeat?: { ageSec?: number | null }; dataDirWritable?: boolean };
}

const chip = (tone: 'ok' | 'warn' | 'bad' | 'dim', text: string, title: string, key?: string) => (
  <span
    key={key}
    title={title}
    className={`px-1.5 py-0.5 rounded-md text-[9px] font-mono font-bold border ${
      tone === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
      : tone === 'warn' ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
      : tone === 'bad' ? 'bg-red-500/15 text-red-300 border-red-500/40'
      : 'bg-slate-600/20 text-slate-500 border-slate-600/30'
    }`}
  >
    {text}
  </span>
);

export const OpsHealthStrip = memo(function OpsHealthStrip() {
  const [snap, setSnap] = useState<HealthSnap | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/health', { signal: AbortSignal.timeout(8000) });
      if (!res.ok) { setSnap(null); return; }
      const d = (await res.json().catch(() => null)) as HealthSnap | null;
      setSnap(d && typeof d === 'object' ? d : null);
    } catch { setSnap(null); /* silent — auxiliary strip */ }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (!snap) return null;

  // ---- feeds ----
  const sources = Object.entries(snap.feeds?.sources || {});
  const liveCount = sources.filter(([, v]) => v?.live).length;
  const stale = snap.feeds?.staleSources || [];
  const worstAge = sources.reduce((m, [, v]) => Math.max(m, v?.ageSec || 0), 0);
  const wsEntries = Object.entries(snap.feeds?.ws || {});
  const wsDown = wsEntries.filter(([, v]) => v?.healthy === false);

  // ---- kills ----
  const execLvl = snap.kills?.exec?.level || 0;
  const aiKill = snap.kills?.aiDesk?.enabled === true;
  const botPause = snap.kills?.botLab?.globalPause === true || snap.bots?.globalPause === true;
  const anyKill = aiKill || execLvl > 0 || botPause;

  // ---- persist ----
  const hbAge = snap.persist?.execHeartbeat?.ageSec ?? null;
  const dirsOk = snap.persist?.dataDirWritable !== false; // undefined (unarmed) bhi dim-OK

  const feedTone = stale.length > 0 ? 'bad' : liveCount > 0 ? 'ok' : 'dim';
  const feedTitle = sources.length === 0
    ? 'Koi feed source abhi armed nahi (market closed / streams idle)'
    : `${liveCount}/${sources.length} sources LIVE (60s window)${stale.length ? ` — STALE >90s: ${stale.join(', ')}` : ''}`;

  return (
    <div className="flex items-center gap-1.5 px-3 pb-2 flex-wrap">
      <span className="flex items-center gap-1 text-[9px] font-black font-mono text-slate-500" title="Operational health — v21.1.0 /api/health: feed last-tick ages, kill layers, exec heartbeat, data-dirs. 30s poll.">
        <HeartPulse size={10} /> OPS
      </span>
      {chip(feedTone, `FEEDS ${liveCount}/${sources.length}${worstAge > 0 ? ` · ${worstAge}s` : ''}`, feedTitle, 'feeds')}
      {wsEntries.length > 0 && chip(
        wsDown.length === 0 ? 'ok' : 'bad',
        `WS ${wsEntries.length - wsDown.length}/${wsEntries.length}`,
        wsDown.length === 0 ? 'All market WebSockets healthy' : `WS DOWN: ${wsDown.map(([k]) => k).join(', ')}`,
        'ws',
      )}
      {chip(anyKill ? 'bad' : 'ok',
        anyKill ? (execLvl > 0 ? `⛔ EXEC KILL L${execLvl}` : aiKill ? '⛔ KILL ON' : '⛔ BOTS PAUSED') : 'KILLS CLEAR',
        anyKill
          ? `Kill active — AI desk: ${aiKill ? 'ON' : 'off'} · Exec: L${execLvl} (${snap.kills?.exec?.reason || 'no reason'}) · BotLab global pause: ${botPause ? 'ON' : 'off'} — live entries blocked`
          : 'Teeno kill layers clear (AI desk / exec / Bot Lab)',
        'kills')}
      {snap.bots?.mode && chip(snap.bots.globalPause ? 'warn' : 'dim', `BOTS ${String(snap.bots.mode).toUpperCase()}`, `Bot Lab mode: ${snap.bots.mode}${snap.bots.globalPause ? ' · GLOBAL PAUSE' : ''}`, 'bots')}
      {chip(hbAge != null && hbAge > 30 ? 'bad' : dirsOk ? 'ok' : 'bad',
        hbAge != null ? `HB ${hbAge}s` : (dirsOk ? 'DISK OK' : 'DISK FAIL'),
        hbAge != null && hbAge > 30
          ? `Exec heartbeat ${hbAge}s STALE (>30s) — reconcile loop atka hua hai, check karo`
          : dirsOk
            ? 'Exec heartbeat fresh + data-dirs writable (journal/ledger persist OK)'
            : 'DATA-DIR WRITE FAIL — journal/ledger persist nahi ho rahe! Disk full ya read-only mount.',
        'persist')}
      {chip('dim', `UP ${Math.floor((snap.uptimeSec || 0) / 60)}m`, `Server uptime: ${Math.floor((snap.uptimeSec || 0) / 3600)}h ${Math.floor(((snap.uptimeSec || 0) % 3600) / 60)}m`, 'up')}
    </div>
  );
});
