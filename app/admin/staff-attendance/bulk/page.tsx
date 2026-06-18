'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Button, Card, Input, Select, EmptyState, Skeleton } from '@/components/Primitives';
import { Icon } from '@/components/Icon';

interface Row { staffId: string; name: string; designation: string | null; status: string; }

const OPTIONS: [string, string][] = [
  ['PRESENT', 'Present'], ['HALF_DAY', 'Half day'], ['ABSENT', 'Absent'],
  ['LEAVE', 'Leave'], ['HOLIDAY', 'Holiday'], ['WEEKLY_OFF', 'Weekly off'],
  ['AUTO', 'Auto (from punches)'],
];
const PRESETS: [string, string][] = [
  ['PRESENT', 'All present'], ['HOLIDAY', 'All holiday'], ['WEEKLY_OFF', 'All weekly off'],
];

function todayKey() { return new Date().toISOString().slice(0, 10); }

export default function BulkAttendancePage() {
  const { data: session } = useSession();
  const canManage = (((session?.user as any)?.perms as string[]) || []).includes('STAFF_ATTENDANCE_MANAGE');

  const [date, setDate] = useState(todayKey());

  // Honor a ?date= passed from the board (client-only — avoids the useSearchParams Suspense rule).
  useEffect(() => {
    const d = new URLSearchParams(window.location.search).get('date');
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) setDate(d);
  }, []);
  const [rows, setRows] = useState<Row[]>([]);
  const [original, setOriginal] = useState<Record<string, string>>({});
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setMsg('');
    const res = await fetch(`/api/staff-attendance?date=${date}`);
    if (res.ok) {
      const b = await res.json();
      const rs: Row[] = b.rows;
      setRows(rs);
      const orig = Object.fromEntries(rs.map((r) => [r.staffId, r.status]));
      setOriginal(orig);
      setEdited(orig);
    }
    setLoading(false);
  }, [date]);
  useEffect(() => { load(); }, [load]);

  const changed = Object.keys(edited).filter((id) => edited[id] !== original[id]);
  const setAll = (status: string) => setEdited(Object.fromEntries(rows.map((r) => [r.staffId, status])));

  const save = async () => {
    setSaving(true); setMsg('');
    try {
      const entries = changed.map((staffId) => ({ staffId, status: edited[staffId] }));
      const res = await fetch('/api/staff-attendance/bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, entries }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Save failed');
      setMsg(`Saved ${j.updated} staff for ${date}.`);
      await load();
    } catch (e: any) { setMsg(e?.message || 'Save failed'); } finally { setSaving(false); }
  };

  if (!canManage) return <EmptyState icon="Lock" title="Not available" body="You can’t mark staff attendance." />;

  const visible = rows.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Mark attendance</h1>
          <p className="text-sm text-slate-500">Set status for many staff on one date.</p>
        </div>
        <Link href="/admin/staff-attendance" className="text-sm text-slate-500 hover:text-slate-700">Back to board</Link>
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Date</label>
            <Input type="date" value={date} max={todayKey()} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="block text-xs font-medium text-slate-500 mb-1">Find staff</label>
            <Input icon="Search" placeholder="Search name…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-100">
          <span className="text-xs text-slate-400 self-center mr-1">Quick set:</span>
          {PRESETS.map(([val, label]) => (
            <Button key={val} size="sm" onClick={() => setAll(val)}>{label}</Button>
          ))}
          <Button size="sm" kind="tertiary" onClick={() => setEdited(original)}>Reset</Button>
        </div>
      </Card>

      {msg && <div className="rounded-md bg-info-50 text-info-700 text-sm px-3 py-2">{msg}</div>}

      <Card padded={false}>
        {loading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={44} />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState icon="Users" title="No staff" body="Add staff first." />
        ) : (
          <div className="divide-y divide-slate-50">
            {visible.map((r) => {
              const isChanged = edited[r.staffId] !== original[r.staffId];
              return (
                <div key={r.staffId} className={`flex items-center justify-between gap-3 px-4 py-2.5 ${isChanged ? 'bg-amber-50/60' : ''}`}>
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 truncate">{r.name}</div>
                    {r.designation && <div className="text-xs text-slate-400 truncate">{r.designation}</div>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isChanged && <Icon name="PencilLine" size={14} className="text-amber-500" />}
                    <Select value={edited[r.staffId] ?? 'ABSENT'} onChange={(e) => setEdited({ ...edited, [r.staffId]: e.target.value })} className="w-40">
                      {OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Select>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div className="sticky bottom-3 flex items-center justify-between bg-white border border-slate-200 rounded-lg px-4 py-3 shadow-sm">
        <span className="text-sm text-slate-500">{changed.length} change{changed.length === 1 ? '' : 's'} pending</span>
        <Button kind="primary" icon="Check" disabled={saving || changed.length === 0} onClick={save}>
          {saving ? 'Saving…' : `Save ${changed.length || ''}`.trim()}
        </Button>
      </div>
    </div>
  );
}
