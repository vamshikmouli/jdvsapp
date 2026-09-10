'use client';

import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Icon } from '@/components/Icon';
import { NotificationBell } from '@/components/layout/NotificationBell';
import { GlobalSearch } from '@/components/layout/GlobalSearch';

interface TopBarProps {
  title: string;
  subtitle?: string;
  showMenu?: boolean;
  onMenu?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

interface YearOpt { id: string; label: string; isActive: boolean }

// Whole-app academic-year switcher. Picking a year sets a session cookie that
// every server query reads (via getActiveYear), then reloads so all data follows.
function YearSwitcher() {
  const { data: session } = useSession();
  const canManage = (((session?.user as any)?.perms as string[]) || []).includes('SETTINGS_MANAGE');
  const [years, setYears] = useState<YearOpt[]>([]);
  const [current, setCurrent] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newId, setNewId] = useState('');
  const [err, setErr] = useState('');

  const loadYears = () => fetch('/api/years').then((r) => (r.ok ? r.json() : { years: [] })).then((d) => { setYears(d.years || []); setCurrent(d.currentId || ''); }).catch(() => {});
  useEffect(() => { loadYears(); }, []);

  const change = async (id: string) => {
    if (!id || id === current) return;
    setBusy(true);
    await fetch('/api/years', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ yearId: id }) }).catch(() => {});
    window.location.reload();
  };

  const createYear = async () => {
    const id = newId.trim();
    if (!/^\d{4}-\d{2}$/.test(id)) { setErr('Use YYYY-YY, e.g. 2025-26'); return; }
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/years', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', id, label: id }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Failed');
      await loadYears();
      setAdding(false); setNewId('');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  };

  if (years.length === 0) return null;
  return (
    <div className="relative flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-md pl-2.5 pr-1.5 py-1.5" title="Academic year — applies to the whole app">
      <Icon name="CalendarRange" size={16} className="text-slate-400 flex-shrink-0" />
      <select value={current} disabled={busy} onChange={(e) => change(e.target.value)}
        className="bg-transparent border-0 outline-none text-sm font-medium text-slate-800 pr-1 cursor-pointer disabled:opacity-50">
        {years.map((y) => <option key={y.id} value={y.id}>{y.label}{y.isActive ? ' (current)' : ''}</option>)}
      </select>
      {canManage && (
        <button onClick={() => { setAdding((v) => !v); setErr(''); }} title="Add academic year"
          className="ml-0.5 p-0.5 text-slate-400 hover:text-purple-600 rounded flex-shrink-0">
          <Icon name={adding ? 'X' : 'Plus'} size={15} />
        </button>
      )}
      {canManage && adding && (
        <div className="absolute right-0 top-full mt-1.5 w-56 bg-white border border-slate-200 rounded-lg shadow-lg p-3 z-30">
          <div className="text-xs font-medium text-slate-600 mb-1.5">New academic year</div>
          <input autoFocus value={newId} disabled={busy}
            onChange={(e) => setNewId(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') createYear(); }}
            placeholder="2025-26"
            className="w-full px-2 py-1.5 rounded-md border border-slate-200 text-sm outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20" />
          {err && <div className="text-xs text-red-600 mt-1">{err}</div>}
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={() => { setAdding(false); setNewId(''); setErr(''); }} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1">Cancel</button>
            <button onClick={createYear} disabled={busy} className="text-xs font-medium text-white bg-purple-500 hover:bg-purple-600 disabled:opacity-50 rounded-md px-3 py-1">{busy ? 'Adding…' : 'Add year'}</button>
          </div>
          <div className="text-[10px] text-slate-400 mt-2">Added blank (no fees, not made current). Set fees in Fees → Fee setup; switch to it from this dropdown.</div>
        </div>
      )}
    </div>
  );
}

export function TopBar({ title, subtitle, onMenu, collapsed = false, onToggleCollapse }: TopBarProps) {
  const { data: session } = useSession();
  const isParent = !!(session?.user as any)?.isParent;
  return (
    <header className={`fixed left-0 right-0 top-0 h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 sm:px-6 lg:px-8 z-20 transition-all duration-200 ${collapsed ? 'lg:left-16' : 'lg:left-60'}`}>
      <div className="flex items-center gap-2 min-w-0">
        {/* Hamburger — mobile/tablet only */}
        <button onClick={onMenu} className="lg:hidden p-2 -ml-2 hover:bg-slate-100 rounded-md flex-shrink-0">
          <Icon name="Menu" size={20} />
        </button>
        {/* Collapse toggle — desktop only */}
        {onToggleCollapse && (
          <button onClick={onToggleCollapse} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} className="hidden lg:flex p-2 -ml-2 hover:bg-slate-100 rounded-md flex-shrink-0 text-slate-500">
            <Icon name={collapsed ? 'PanelLeftOpen' : 'PanelLeftClose'} size={20} />
          </button>
        )}
        <div className="min-w-0">
          <h1 className="font-semibold text-slate-900 truncate">{title}</h1>
          {subtitle && <p className="text-xs text-slate-500 truncate">{subtitle}</p>}
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <YearSwitcher />

        <GlobalSearch />

        <NotificationBell />

        {isParent && (
          <a href="/parent" className="inline-flex items-center gap-1.5 text-sm font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-md px-2.5 py-1.5 transition-colors" title="Switch to the Parent app">
            <Icon name="Smartphone" size={16} />
            <span className="hidden sm:inline">Parent app</span>
          </a>
        )}
      </div>
    </header>
  );
}
