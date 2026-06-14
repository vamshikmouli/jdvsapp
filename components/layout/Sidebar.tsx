'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { Icon } from '@/components/Icon';
import { STAFF_NAV, ROLE_META } from '@/lib/navigation';
import { Surface } from '@prisma/client';

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
}

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [menuOpen, setMenuOpen] = React.useState(false);

  const userName = session?.user?.name || 'User';
  const perms = ((session?.user as any)?.perms as string[]) || [];
  const surface = ((session?.user as any)?.surface as Surface) || 'ADMIN';
  const roleName = (session?.user as any)?.roleName || ROLE_META[surface]?.title || 'Staff';
  const meta = ROLE_META[surface] || ROLE_META.ADMIN;

  // Show only the nav items this user has permission for (no perm = always shown)
  const groups = STAFF_NAV.map((g) => ({
    ...g,
    items: g.items.filter((it) => !it.perm || perms.includes(it.perm)),
  })).filter((g) => g.items.length > 0);

  const hrefFor = (id: string) => `/admin/${id}`;
  const isActive = (id: string) => {
    const href = hrefFor(id);
    return pathname === href || pathname.startsWith(href + '/');
  };

  const handleSignOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    signOut({ callbackUrl: '/' });
  };

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
        className={`fixed left-0 top-0 bottom-0 w-60 bg-white border-r border-slate-200 flex flex-col overflow-y-auto z-40 transform transition-transform duration-200 lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
      {/* Brand */}
      <div className="p-4 border-b border-slate-100">
        <Link href="/admin/dashboard" className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-purple-600 flex items-center justify-center text-white font-bold text-sm">
            JD
          </div>
          <div>
            <div className="font-semibold text-slate-900 text-sm">Jnana Deepika</div>
            <div className="text-xs text-slate-500">School ERP</div>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-2">
        {groups.map((group, index) => (
          <div key={index} className="mb-4">
            {group.label && (
              <div className="px-4 py-2 text-xs uppercase font-semibold text-slate-400 tracking-wide">
                {group.label}
              </div>
            )}
            <div className="space-y-1">
              {group.items.map((item) => {
                const active = isActive(item.id);
                return (
                  <Link
                    key={item.id}
                    href={hrefFor(item.id)}
                    onClick={onClose}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      active ? 'bg-purple-50 text-purple-700 font-semibold' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Icon name={item.icon as any} size={18} className="flex-shrink-0" />
                    <span className="flex-1 text-left">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

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
          className="w-full flex items-center gap-3 p-2 rounded-md hover:bg-slate-100"
        >
          <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-xs font-semibold text-purple-700">
            {initialsOf(userName)}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <div className="text-sm font-medium text-slate-900 truncate">{userName}</div>
            <div className="text-xs text-slate-500 flex items-center gap-1">
              <Icon name={meta.icon as any} size={12} className="flex-shrink-0" />
              {roleName}
            </div>
          </div>
          <Icon name="ChevronsUpDown" size={16} className="text-slate-400 flex-shrink-0" />
        </button>
      </div>
      </aside>
    </>
  );
}
