'use client';

import React from 'react';
import { Icon } from '@/components/Icon';
import { classifyNet, fmtMbps, measurePing, measureDownload, browserEstimate, type NetLevel } from '@/lib/netSpeed';

// Signal bars in the top bar: green = fast, amber = OK, red = slow. Tap for the
// speed check (download speed + ping to the school server) and what it means.
// Background checks only send a tiny ping every 2 minutes — the download test
// (~0.5 MB) runs only when the pop-up is opened or "Test again" is tapped.

const COLOR: Record<NetLevel, string> = { good: '#16A34A', ok: '#D97706', slow: '#DC2626', offline: '#94A3B8' };
const ADVICE: Record<NetLevel, string> = {
  good: 'Everything — voice marks entry, photos, WhatsApp, reports — will work smoothly.',
  ok: 'Works fine. Photo uploads and big reports may take a few seconds.',
  slow: 'Pages and voice entry may be slow. Move closer to the Wi-Fi, switch to mobile data, or try again in a minute.',
  offline: 'No internet right now.',
};

function Bars({ n, color }: { n: number; color: string }) {
  return (
    <svg width="18" height="16" viewBox="0 0 18 16" aria-hidden>
      {[0, 1, 2].map((i) => (
        <rect key={i} x={1 + i * 6} y={11 - i * 5} width="4" height={5 + i * 5} rx="1" fill={i < n ? color : '#CBD5E1'} />
      ))}
    </svg>
  );
}

export function NetSpeed() {
  const [mbps, setMbps] = React.useState<number | null>(null);
  const [ping, setPing] = React.useState<number | null>(null);
  const [type, setType] = React.useState<string | null>(null);
  const [online, setOnline] = React.useState(true);
  const [open, setOpen] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testedAt, setTestedAt] = React.useState<number | null>(null);
  const [err, setErr] = React.useState('');
  const wrapRef = React.useRef<HTMLDivElement>(null);

  // Background: browser estimate (free) + a tiny ping now and every 2 minutes.
  React.useEffect(() => {
    let alive = true;
    const est = () => { const e = browserEstimate(); setType(e.type); if (e.mbps !== null) setMbps((m) => m ?? e.mbps); };
    const doPing = async () => {
      if (!navigator.onLine || document.hidden) return;
      try { const p = await measurePing(1); if (alive) setPing(p); } catch { /* offline — the offline screen handles it */ }
    };
    est(); doPing();
    const iv = setInterval(doPing, 120_000);
    const on = () => { setOnline(true); doPing(); }, off = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    const conn = (navigator as any).connection;
    conn?.addEventListener?.('change', est);
    return () => { alive = false; clearInterval(iv); window.removeEventListener('online', on); window.removeEventListener('offline', off); conn?.removeEventListener?.('change', est); };
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const runTest = async () => {
    setTesting(true); setErr('');
    try {
      const p = await measurePing(3);
      setPing(p);
      setMbps(await measureDownload());
      setTestedAt(Date.now());
    } catch { setErr("Couldn't reach the school server — check the internet."); }
    setTesting(false);
  };
  const toggle = () => { setOpen((o) => { if (!o && !testedAt && !testing) runTest(); return !o; }); };

  const c = online ? classifyNet(mbps, ping) : { level: 'offline' as NetLevel, label: 'Offline', bars: 0 };
  const color = COLOR[c.level];

  return (
    <div ref={wrapRef} className="relative">
      <button onClick={toggle} aria-label={`Internet: ${c.label}`} title={`Internet: ${c.label}${mbps !== null ? ` · ${fmtMbps(mbps)}` : ''}${ping !== null ? ` · ${ping} ms` : ''}`}
        className="flex items-center gap-1.5 p-2 rounded-md hover:bg-slate-100">
        <Bars n={c.bars} color={color} />
        {mbps !== null && online && <span className="hidden md:inline text-[11px] font-semibold tabular-nums" style={{ color }}>{fmtMbps(mbps)}</span>}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-xl border border-slate-200 z-30 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-900">Internet speed</span>
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ color, background: `${color}14` }}>
              <Bars n={c.bars} color={color} /> {testing ? 'Testing…' : c.label}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Download</div>
              <div className="text-lg font-bold tabular-nums text-slate-900">{testing && mbps === null ? '…' : fmtMbps(mbps)}</div>
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Ping</div>
              <div className="text-lg font-bold tabular-nums text-slate-900">{ping === null ? '…' : `${ping} ms`}</div>
            </div>
          </div>
          <p className="text-xs text-slate-600 mt-3 leading-snug">{err || ADVICE[c.level]}</p>
          <div className="flex items-center justify-between mt-3">
            <span className="text-[10.5px] text-slate-400">{type ? `${String(type).toUpperCase()} · ` : ''}to the school server</span>
            <button onClick={runTest} disabled={testing || !online}
              className="inline-flex items-center gap-1 rounded-lg bg-purple-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-50">
              <Icon name="RefreshCw" size={12} className={testing ? 'animate-spin' : ''} /> {testing ? 'Testing' : 'Test again'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
