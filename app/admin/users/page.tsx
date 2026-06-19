'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Button, Card, Chip, Input, EmptyState, Skeleton } from '@/components/Primitives';
import { Icon } from '@/components/Icon';

interface UserRow {
  id: string;
  name: string;
  roleName: string;
  roleKey: string;
  phone: string;
  email: string;
  initialPin: string | null;
  hasOwnPassword: boolean;
  isActive: boolean;
  lastLogin: string | null;
  children: string[];
}

export default function UsersPage() {
  const { data: session } = useSession();
  const perms = ((session?.user as any)?.perms as string[]) || [];
  const canManage = perms.includes('USERS_MANAGE');

  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'parent' | 'staff' | 'all'>('parent');
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/users');
    if (res.ok) setRows(await res.json());
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const resetPin = async (u: UserRow) => {
    if (!confirm(`Reset login PIN for ${u.name}? Their current PIN stops working and they'll get a new one.`)) return;
    setBusy(u.id); setFlash('');
    try {
      const res = await fetch(`/api/users/${u.id}/reset-pin`, { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Failed');
      setFlash(`New PIN for ${j.name}: ${j.tempPin}`);
      await load();
    } catch (e: any) {
      setFlash(e?.message || 'Failed to reset');
    } finally { setBusy(null); }
  };

  if (!canManage) {
    return <EmptyState icon="Lock" title="Not available" body="You don't have permission to view login accounts." />;
  }

  // Parents (student logins) vs staff (everyone else: teacher/accountant/admin/kiosk).
  const isParent = (r: UserRow) => r.roleKey === 'parent';
  const inTab = (r: UserRow) => tab === 'all' ? true : tab === 'parent' ? isParent(r) : !isParent(r);
  const counts = {
    parent: rows.filter(isParent).length,
    staff: rows.filter((r) => !isParent(r)).length,
    all: rows.length,
  };

  const filtered = rows.filter((r) => {
    if (!inTab(r)) return false;
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return r.name.toLowerCase().includes(s) || r.phone.includes(s) || (r.initialPin || '').includes(s) || r.children.some((c) => c.toLowerCase().includes(s));
  });

  const pinCell = (u: UserRow) => {
    if (u.initialPin) return <span className="font-mono font-semibold text-purple-700 tracking-wider">{u.initialPin}</span>;
    if (u.hasOwnPassword) return <span className="text-xs text-slate-400">Set by user</span>;
    return <span className="text-xs text-slate-400">Phone number</span>;
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Logins &amp; PINs</h1>
        <p className="text-sm text-slate-500">Every login account and its initial PIN. Hand the PIN to the parent/staff; once they set their own, it shows “Set by user”.</p>
      </div>

      {flash && <div className="rounded-md bg-success-50 text-success-700 text-sm px-3 py-2">{flash}</div>}

      <div className="flex flex-wrap items-center gap-2">
        {([['parent', 'Students'], ['staff', 'Staff'], ['all', 'All']] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === k ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {label} <span className="text-xs opacity-70">({counts[k]})</span>
          </button>
        ))}
      </div>

      <Input placeholder="Search name, phone, PIN, or child…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />

      <Card padded={false}>
        {loading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} height={40} />)}</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="Users" title="No accounts" body="No login accounts match." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Role</th>
                  <th className="px-4 py-2 font-medium">Phone (login)</th>
                  <th className="px-4 py-2 font-medium">Children</th>
                  <th className="px-4 py-2 font-medium">Login PIN</th>
                  <th className="px-4 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <span className="font-medium text-slate-900">{u.name}</span>
                      {!u.isActive && <Chip tone="neutral">Inactive</Chip>}
                    </td>
                    <td className="px-4 py-2 text-slate-600">{u.roleName}</td>
                    <td className="px-4 py-2 font-mono text-slate-600">{u.phone || '—'}</td>
                    <td className="px-4 py-2 text-slate-500 text-xs">{u.children.length ? u.children.join(', ') : '—'}</td>
                    <td className="px-4 py-2">{pinCell(u)}</td>
                    <td className="px-4 py-2 text-right">
                      <Button size="sm" kind="tertiary" icon="KeyRound" disabled={busy === u.id} onClick={() => resetPin(u)}>
                        {busy === u.id ? '…' : 'Reset PIN'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
