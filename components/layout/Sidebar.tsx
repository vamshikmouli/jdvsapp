'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { Icon } from '@/components/Icon';
import { STAFF_NAV, ROLE_META } from '@/lib/navigation';
import { useBranding } from '@/components/useBranding';
import { permAllows } from '@/lib/rbac/crud';
import { Surface, Permission } from '@prisma/client';

function initialsOf(name: string) {
  return name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
  collapsed?: boolean; // desktop icon-only mode
}

export function Sidebar({ open = false, onClose, collapsed = false }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const brand = useBranding();
  const [menuOpen, setMenuOpen] = React.useState(false);
  // Collapsed-rail flyout — which group's menu is popped out beside the icon rail,
  // and where (viewport top of the hovered group). Portalled to <body> because the
  // sidebar scroll container clips anything spilling out to the right.
  const [flyout, setFlyout] = React.useState<{ index: number; top: number } | null>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const openFlyout = (index: number, el: HTMLElement) => { cancelClose(); setFlyout({ index, top: el.getBoundingClientRect().top }); };
  const scheduleClose = () => { cancelClose(); closeTimer.current = setTimeout(() => setFlyout(null), 140); };
  React.useEffect(() => { setFlyout(null); }, [pathname]);
  React.useEffect(() => {
    if (!flyout) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFlyout(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flyout]);

  // Section lock — some menus need a password to open (configured in Settings).
  const [lock, setLock] = React.useState<{ lockedMenus: string[]; hasPassword: boolean }>({ lockedMenus: [], hasPassword: false });
  const [gate, setGate] = React.useState<string | null>(null); // nav id being unlocked
  const [gatePw, setGatePw] = React.useState('');
  const [gateErr, setGateErr] = React.useState('');
  const [gateBusy, setGateBusy] = React.useState(false);
  React.useEffect(() => {
    fetch('/api/settings/section-lock').then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setLock({ lockedMenus: d.lockedMenus || [], hasPassword: !!d.hasPassword }); }).catch(() => {});
  }, []);
  const isLocked = (id: string) => lock.hasPassword && lock.lockedMenus.includes(id);

  // Collapsible nav groups — open by default, preference remembered per device.
  const [closedGroups, setClosedGroups] = React.useState<Record<string, boolean>>({});
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem('navGroupsClosed');
      if (saved) setClosedGroups(JSON.parse(saved));
    } catch {}
  }, []);
  const isGroupOpen = (label: string) => !closedGroups[label];
  const toggleGroup = (label: string) => {
    setClosedGroups((prev) => {
      const next = { ...prev, [label]: !prev[label] };
      try { localStorage.setItem('navGroupsClosed', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const userName = session?.user?.name || 'User';
  const perms = ((session?.user as any)?.perms as string[]) || [];
  const surface = ((session?.user as any)?.surface as Surface) || 'ADMIN';
  const roleName = (session?.user as any)?.roleName || ROLE_META[surface]?.title || 'Staff';
  const meta = ROLE_META[surface] || ROLE_META.ADMIN;

  // Show only the nav items this user has permission for (no perm = always shown).
  // `perm` may be a single key or a list (any-of); permAllows honours the
  // MANAGE⇄CRUD bridge so nav visibility matches what the APIs actually allow.
  const permSet = new Set(perms as Permission[]);
  const allowed = (need: Permission | Permission[] | undefined) =>
    !need || (Array.isArray(need) ? need.some((p) => permAllows(permSet, p)) : permAllows(permSet, need));
  const groups = STAFF_NAV.map((g) => ({
    ...g,
    items: g.items.filter((it) => allowed(it.perm)),
  })).filter((g) => g.items.length > 0);

  const hrefFor = (id: string) => `/admin/${id}`;
  const isActive = (id: string) => {
    const href = hrefFor(id);
    return pathname === href || pathname.startsWith(href + '/');
  };

  const submitGate = async () => {
    if (!gate) return;
    setGateBusy(true); setGateErr('');
    try {
      const r = await fetch('/api/settings/section-lock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: gatePw }) });
      const d = await r.json();
      if (d.ok) { const target = gate; setGate(null); setGatePw(''); onClose?.(); router.push(hrefFor(target)); }
      else setGateErr('Incorrect password.');
    } catch { setGateErr('Could not verify — try again.'); }
    finally { setGateBusy(false); }
  };

  const handleSignOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    signOut({ callbackUrl: '/' });
  };

  // One renderer for every nav link, used by the expanded sidebar, the mobile
  // drawer, and the collapsed-rail flyout. `variant`:
  //  - 'rail'  → icon-only on desktop (labels hidden at lg), full on mobile.
  //  - 'full'  → icon + label, left-aligned (expanded sidebar / drawer / flyout).
  const renderItem = (item: (typeof groups)[number]['items'][number], variant: 'rail' | 'full') => {
    const rail = variant === 'rail';
    const active = isActive(item.id);
    const locked = isLocked(item.id) && !active;
    const cls = `w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${rail ? 'lg:justify-center lg:px-2' : ''} ${active ? 'bg-purple-50 text-purple-700 font-semibold' : 'text-slate-700 hover:bg-slate-100'}`;
    const inner = (
      <>
        <Icon name={item.icon as any} size={18} className="flex-shrink-0" />
        <span className={`flex-1 text-left ${rail ? 'lg:hidden' : ''}`}>{item.label}</span>
        {isLocked(item.id) && <Icon name="Lock" size={13} className={`text-slate-400 flex-shrink-0 ${rail ? 'lg:hidden' : ''}`} />}
      </>
    );
    const onNav = () => { onClose?.(); setFlyout(null); };
    // Locked (and not already inside it): a plain button that opens the password
    // prompt — never navigates, so nothing leaks before unlock.
    return locked ? (
      <button key={item.id} type="button" title={`${item.label} — password required`}
        onClick={() => { setGate(item.id); setGatePw(''); setGateErr(''); setFlyout(null); }} className={cls}>
        {inner}
      </button>
    ) : item.newTab ? (
      // Full-screen tools open in a new browser tab so they get the whole window.
      <a key={item.id} href={hrefFor(item.id)} target="_blank" rel="noopener" onClick={onNav} title={`${item.label} (opens in a new tab)`} className={cls}>
        {inner}
      </a>
    ) : (
      <Link key={item.id} href={hrefFor(item.id)} onClick={onNav} title={item.label} className={cls}>
        {inner}
      </Link>
    );
  };
  const renderItems = (items: (typeof groups)[number]['items'], variant: 'rail' | 'full') => (
    <div className="space-y-1">{items.map((it) => renderItem(it, variant))}</div>
  );

  return (
    <>
      {/* Backdrop (mobile only, when drawer open) */}
      <div
        className={`fixed inset-0 bg-black/40 z-30 lg:hidden transition-opacity ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        className={`fixed left-0 top-0 bottom-0 w-60 ${collapsed ? 'lg:w-16' : 'lg:w-60'} bg-white border-r border-slate-200 flex flex-col overflow-y-auto z-40 transform transition-all duration-200 lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
      {/* Brand */}
      <div className={`p-4 border-b border-slate-100 ${collapsed ? 'lg:px-0' : ''}`}>
        <Link href="/admin/dashboard" className={`flex items-center gap-3 ${collapsed ? 'lg:justify-center' : ''}`} title={brand.schoolName}>
          <div className="w-8 h-8 rounded-md bg-purple-600 flex items-center justify-center text-white font-bold text-sm overflow-hidden shrink-0">
            {brand.logoUrl
              ? <img src={brand.logoUrl} alt="" className="w-full h-full object-contain bg-white" />
              : 'JD'}
          </div>
          <div className={collapsed ? 'lg:hidden' : ''}>
            <div className="font-semibold text-slate-900 text-sm">{brand.schoolName}</div>
            <div className="text-xs text-slate-500">School ERP</div>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-2">
        {groups.map((group, index) => {
          // Collapsed desktop icon rail: icons only, with a hover/focus flyout (below)
          // that reveals this group's menu beside the rail WITHOUT widening it. On mobile
          // (<lg) the drawer isn't collapsed — labels show inline and the flyout stays hidden.
          if (collapsed) {
            return (
              <div
                key={index}
                className="mb-2"
                onMouseEnter={(e) => openFlyout(index, e.currentTarget)}
                onMouseLeave={scheduleClose}
                onFocusCapture={(e) => openFlyout(index, e.currentTarget)}
                onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) scheduleClose(); }}
              >
                {index > 0 && <div className="my-2 mx-2 border-t border-slate-100 hidden lg:block" />}
                {renderItems(group.items, 'rail')}
              </div>
            );
          }

          if (!group.label) {
            return <div key={index} className="mb-4">{renderItems(group.items, 'full')}</div>;
          }

          const grpOpen = isGroupOpen(group.label);
          return (
            <div key={index} className="mb-4">
              <button
                onClick={() => toggleGroup(group.label!)}
                className="w-full flex items-center justify-between px-4 py-2 text-xs uppercase font-semibold text-slate-400 tracking-wide hover:text-slate-600 transition-colors"
                aria-expanded={grpOpen}
              >
                <span>{group.label}</span>
                <Icon
                  name="ChevronDown"
                  size={14}
                  className="flex-shrink-0 transition-transform duration-200"
                  style={{ transform: grpOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                />
              </button>
              <div
                className="grid"
                style={{ gridTemplateRows: grpOpen ? '1fr' : '0fr', transition: 'grid-template-rows 200ms ease-in-out' }}
              >
                <div className="overflow-hidden">
                  <div className="pt-1">{renderItems(group.items, 'full')}</div>
                </div>
              </div>
            </div>
          );
        })}
      </nav>

      {/* Collapsed-rail flyout — portalled beside the rail. Desktop (lg) only; on touch/
          mobile it never opens (no hover) and is display-hidden as a safeguard. */}
      {flyout && typeof document !== 'undefined' && groups[flyout.index] && createPortal(
        <div
          className="hidden lg:block fixed z-50 pl-2"
          style={{ left: 64, top: Math.max(8, flyout.top) }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div className="min-w-[204px] max-h-[82vh] overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg py-2">
            {groups[flyout.index].label && (
              <div className="px-4 pb-1.5 text-xs uppercase font-semibold text-slate-400 tracking-wide">{groups[flyout.index].label}</div>
            )}
            <div className="px-1.5">{renderItems(groups[flyout.index].items, 'full')}</div>
          </div>
        </div>,
        document.body,
      )}

      {/* User menu */}
      <div className="border-t border-slate-100 p-3 relative">
        {menuOpen && (
          <div className="absolute bottom-full left-3 right-3 mb-2 bg-white border border-slate-200 rounded-md shadow-md py-1">
            <Link
              href="/admin/settings"
              onClick={() => setMenuOpen(false)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
            >
              <Icon name="UserCircle" size={16} />
              My account
            </Link>
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
            >
              <Icon name="LogOut" size={16} />
              Sign out
            </button>
          </div>
        )}
        <button
          onClick={() => setMenuOpen((o) => !o)}
          title={userName}
          className={`w-full flex items-center gap-3 p-2 rounded-md hover:bg-slate-100 ${collapsed ? 'lg:justify-center' : ''}`}
        >
          <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-xs font-semibold text-purple-700 shrink-0">
            {initialsOf(userName)}
          </div>
          <div className={`flex-1 min-w-0 text-left ${collapsed ? 'lg:hidden' : ''}`}>
            <div className="text-sm font-medium text-slate-900 truncate">{userName}</div>
            <div className="text-xs text-slate-500 flex items-center gap-1">
              <Icon name={meta.icon as any} size={12} className="flex-shrink-0" />
              {roleName}
            </div>
          </div>
          <Icon name="ChevronsUpDown" size={16} className={`text-slate-400 flex-shrink-0 ${collapsed ? 'lg:hidden' : ''}`} />
        </button>
      </div>
      </aside>

      {/* Section-lock password prompt */}
      {gate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!gateBusy) setGate(null); }}>
          <div className="w-full max-w-sm bg-white rounded-xl shadow-xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-9 h-9 rounded-full bg-purple-100 flex items-center justify-center text-purple-700"><Icon name="Lock" size={18} /></div>
              <div>
                <div className="font-semibold text-slate-900 leading-tight">Password required</div>
                <div className="text-xs text-slate-500">{STAFF_NAV.flatMap((g) => g.items).find((i) => i.id === gate)?.label || 'This section'}</div>
              </div>
            </div>
            <input
              type="password" autoFocus value={gatePw} disabled={gateBusy}
              onChange={(e) => { setGatePw(e.target.value); setGateErr(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') submitGate(); if (e.key === 'Escape') setGate(null); }}
              placeholder="Enter section password"
              className="mt-3 w-full px-3 py-2 rounded-md border border-slate-200 text-sm outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20"
            />
            {gateErr && <div className="mt-1.5 text-sm text-red-600">{gateErr}</div>}
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setGate(null)} disabled={gateBusy} className="text-sm text-slate-600 hover:text-slate-800 px-3 py-1.5">Cancel</button>
              <button onClick={submitGate} disabled={gateBusy || !gatePw} className="text-sm font-medium text-white bg-purple-500 hover:bg-purple-600 disabled:opacity-50 rounded-md px-4 py-1.5">{gateBusy ? 'Checking…' : 'Unlock'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
