'use client';

import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Icon } from '@/components/Icon';

interface TopBarProps {
  title: string;
  subtitle?: string;
  showMenu?: boolean;
  onMenu?: () => void;
}

interface YearOpt { id: string; label: string; isActive: boolean }

// Whole-app academic-year switcher. Picking a year sets a session cookie that
// every server query reads (via getActiveYear), then reloads so all data follows.
function YearSwitcher() {
  const [years, setYears] = useState<YearOpt[]>([]);
  const [current, setCurrent] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/years').then((r) => (r.ok ? r.json() : { years: [] })).then((d) => { setYears(d.years || []); setCurrent(d.currentId || ''); }).catch(() => {});
  }, []);

  const change = async (id: string) => {
    if (!id || id === current) return;
    setBusy(true);
    await fetch('/api/years', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ yearId: id }) }).catch(() => {});
    window.location.reload();
  };

  if (years.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-md pl-2.5 pr-1.5 py-1.5" title="Academic year — applies to the whole app">
      <Icon name="CalendarRange" size={16} className="text-slate-400 flex-shrink-0" />
      <select value={current} disabled={busy} onChange={(e) => change(e.target.value)}
        className="bg-transparent border-0 outline-none text-sm font-medium text-slate-800 pr-1 cursor-pointer disabled:opacity-50">
        {years.map((y) => <option key={y.id} value={y.id}>{y.label}{y.isActive ? ' (current)' : ''}</option>)}
      </select>
    </div>
  );
}

export function TopBar({ title, subtitle, onMenu }: TopBarProps) {
  const { data: session } = useSession();
  const isParent = !!(session?.user as any)?.isParent;
  return (
    <header className="fixed left-0 lg:left-60 right-0 top-0 h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 sm:px-6 lg:px-8 z-20">
      <div className="flex items-center gap-2 min-w-0">
        {/* Hamburger — mobile/tablet only */}
        <button onClick={onMenu} className="lg:hidden p-2 -ml-2 hover:bg-slate-100 rounded-md flex-shrink-0">
          <Icon name="Menu" size={20} />
        </button>
        <div className="min-w-0">
          <h1 className="font-semibold text-slate-900 truncate">{title}</h1>
          {subtitle && <p className="text-xs text-slate-500 truncate">{subtitle}</p>}
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <YearSwitcher />

        <div className="hidden lg:flex items-center gap-2 bg-slate-50 rounded-md px-3 py-2 w-48 lg:w-56">
          <Icon name="Search" size={16} className="text-slate-400" />
          <input
            type="text"
            placeholder="Search students, classes..."
            className="bg-transparent border-0 outline-none text-sm flex-1 min-w-0"
          />
        </div>

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
