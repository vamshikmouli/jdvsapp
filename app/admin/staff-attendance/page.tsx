'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Button, Card, Chip, Modal, Field, Input, Select, EmptyState, Skeleton } from '@/components/Primitives';
import { Icon } from '@/components/Icon';
import { STATUS_LABEL, statusTone, fmtMins, fmtTime } from '@/lib/staffAttendance/display';

interface Row {
  staffId: string;
  name: string;
  designation: string | null;
  hasDevice: boolean;
  hasPin: boolean;
  status: string;
  late: boolean;
  lateMinutes: number;
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  locked: boolean;
  currentStreak: number;
}
interface Board { date: string; rows: Row[]; summary: Record<string, number>; }

function todayKey() { return new Date().toISOString().slice(0, 10); }

export default function StaffAttendancePage() {
  const { data: session } = useSession();
  const perms = ((session?.user as any)?.perms as string[]) || [];
  const canManage = perms.includes('STAFF_ATTENDANCE_MANAGE');
  const canConfig = perms.includes('STAFF_ATTENDANCE_CONFIG');

  const [date, setDate] = useState(todayKey());
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Row | null>(null);
  const [sortKey, setSortKey] = useState<keyof Row>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/staff-attendance?date=${date}`);
    if (res.ok) setBoard(await res.json());
    setLoading(false);
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const handleSort = (key: keyof Row) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const getSortedRows = () => {
    if (!board?.rows) return [];
    const rows = [...board.rows];
    rows.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      let cmp = 0;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        cmp = aVal.localeCompare(bVal);
      } else if (typeof aVal === 'number' && typeof bVal === 'number') {
        cmp = aVal - bVal;
      } else if (typeof aVal === 'boolean' && typeof bVal === 'boolean') {
        cmp = (aVal ? 1 : 0) - (bVal ? 1 : 0);
      } else {
        cmp = String(aVal).localeCompare(String(bVal));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  };

  const summary = board?.summary;
  const sortedRows = getSortedRows();

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Staff attendance</h1>
          <p className="text-sm text-slate-500">Daily punch board for all staff.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input type="date" value={date} max={todayKey()} onChange={(e) => setDate(e.target.value)} className="w-full sm:w-auto" />
          {/* Phones: a tidy 2-up grid of equal-width buttons. Desktop: inline row. */}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            {canManage && <Link href={`/admin/staff-attendance/bulk?date=${date}`} className="w-full sm:w-auto"><Button kind="primary" icon="ClipboardCheck" className="w-full justify-center">Mark</Button></Link>}
            <Button icon="Download" onClick={() => { const m = date.slice(0, 7); window.open(`/api/staff-attendance/export?from=${m}-01&to=${date}`, '_blank'); }} className="w-full justify-center sm:w-auto">Export</Button>
            {canManage && <Link href="/admin/staff-attendance/regularization" className="w-full sm:w-auto"><Button icon="FileText" className="w-full justify-center">Requests</Button></Link>}
            {canConfig && <Link href="/admin/staff-attendance/config" className="w-full sm:w-auto"><Button icon="Settings" className="w-full justify-center">Settings</Button></Link>}
          </div>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {([
            ['Present', summary.present, 'text-success-700'], ['Half day', summary.halfDay, 'text-warn-700'],
            ['Absent', summary.absent, 'text-danger-700'], ['Leave', summary.leave, 'text-info-700'],
            ['Off', summary.off, 'text-slate-700'], ['Late', summary.late, 'text-warn-700'],
          ] as const).map(([label, val, color]) => (
            <Card key={label} padded={false}>
              <div className="px-3 py-2">
                <div className="text-xs text-slate-500">{label}</div>
                <div className={`text-lg font-semibold ${color}`}>{val ?? 0}</div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card padded={false}>
        {loading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={40} />)}</div>
        ) : !board || board.rows.length === 0 ? (
          <EmptyState icon="Users" title="No staff" body="Add staff to start tracking attendance." />
        ) : (
          <>
            {/* Mobile: stacked cards — every desktop column surfaced as a labeled field. */}
            <div className="md:hidden divide-y divide-slate-100">
              {board.rows.map((r) => (
                <div key={r.staffId} className="p-3 space-y-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/admin/staff-attendance/${r.staffId}`} className="font-medium text-slate-900">{r.name}</Link>
                      {r.designation && <div className="text-xs text-slate-400 truncate">{r.designation}</div>}
                    </div>
                    {canManage && <Button size="sm" kind="tertiary" icon="Pencil" onClick={() => setActive(r)} className="shrink-0">Manage</Button>}
                  </div>

                  <Chip tone={statusTone(r.status)}>{STATUS_LABEL[r.status] ?? r.status}{r.late ? ` · ${r.lateMinutes}m late` : ''}</Chip>

                  <div className="grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
                    <div>
                      <div className="text-slate-400">In</div>
                      <div className="text-slate-700 font-medium">{fmtTime(r.firstIn)}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">Out</div>
                      <div className="text-slate-700 font-medium">{fmtTime(r.lastOut)}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">Worked</div>
                      <div className="text-slate-700 font-medium">{fmtMins(r.workedMinutes)}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">Streak</div>
                      {r.currentStreak > 0 ? (
                        <div className="flex items-center gap-1 font-medium text-orange-600">
                          <Icon name="Flame" size={13} className="text-orange-500" />{r.currentStreak}
                        </div>
                      ) : (
                        <div className="text-slate-400">—</div>
                      )}
                    </div>
                    <div className="col-span-2">
                      <div className="text-slate-400">Method</div>
                      <div className="flex items-center gap-1.5 text-slate-500">
                        {r.hasDevice && <span className="inline-flex items-center gap-1"><Icon name="Smartphone" size={14} />Phone</span>}
                        {r.hasPin && <span className="inline-flex items-center gap-1"><Icon name="KeyRound" size={14} />PIN</span>}
                        {!r.hasDevice && !r.hasPin && <span className="text-slate-400">—</span>}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop: table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                    <th className="px-4 py-2 font-medium cursor-pointer hover:text-slate-700 select-none" onClick={() => handleSort('name')}>
                      <div className="flex items-center gap-1.5">Staff {sortKey === 'name' && <Icon name={sortDir === 'asc' ? 'ChevronUp' : 'ChevronDown'} size={14} />}</div>
                    </th>
                    <th className="px-4 py-2 font-medium cursor-pointer hover:text-slate-700 select-none" onClick={() => handleSort('status')}>
                      <div className="flex items-center gap-1.5">Status {sortKey === 'status' && <Icon name={sortDir === 'asc' ? 'ChevronUp' : 'ChevronDown'} size={14} />}</div>
                    </th>
                    <th className="px-4 py-2 font-medium cursor-pointer hover:text-slate-700 select-none" onClick={() => handleSort('firstIn')}>
                      <div className="flex items-center gap-1.5">In {sortKey === 'firstIn' && <Icon name={sortDir === 'asc' ? 'ChevronUp' : 'ChevronDown'} size={14} />}</div>
                    </th>
                    <th className="px-4 py-2 font-medium cursor-pointer hover:text-slate-700 select-none" onClick={() => handleSort('lastOut')}>
                      <div className="flex items-center gap-1.5">Out {sortKey === 'lastOut' && <Icon name={sortDir === 'asc' ? 'ChevronUp' : 'ChevronDown'} size={14} />}</div>
                    </th>
                    <th className="px-4 py-2 font-medium cursor-pointer hover:text-slate-700 select-none" onClick={() => handleSort('workedMinutes')}>
                      <div className="flex items-center gap-1.5">Worked {sortKey === 'workedMinutes' && <Icon name={sortDir === 'asc' ? 'ChevronUp' : 'ChevronDown'} size={14} />}</div>
                    </th>
                    <th className="px-4 py-2 font-medium cursor-pointer hover:text-slate-700 select-none" onClick={() => handleSort('currentStreak')}>
                      <div className="flex items-center gap-1.5">Streak {sortKey === 'currentStreak' && <Icon name={sortDir === 'asc' ? 'ChevronUp' : 'ChevronDown'} size={14} />}</div>
                    </th>
                    <th className="px-4 py-2 font-medium">Method</th>
                    {canManage && <th className="px-4 py-2 font-medium text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {sortedRows.map((r) => (
                    <tr key={r.staffId} className="hover:bg-slate-50">
                      <td className="px-4 py-2">
                        <Link href={`/admin/staff-attendance/${r.staffId}`} className="font-medium text-slate-900 hover:text-purple-700">{r.name}</Link>
                        {r.designation && <div className="text-xs text-slate-400">{r.designation}</div>}
                      </td>
                      <td className="px-4 py-2"><Chip tone={statusTone(r.status)}>{STATUS_LABEL[r.status] ?? r.status}{r.late ? ` · ${r.lateMinutes}m late` : ''}</Chip></td>
                      <td className="px-4 py-2 text-slate-600">{fmtTime(r.firstIn)}</td>
                      <td className="px-4 py-2 text-slate-600">{fmtTime(r.lastOut)}</td>
                      <td className="px-4 py-2 text-slate-600">{fmtMins(r.workedMinutes)}</td>
                      <td className="px-4 py-2">
                        {r.currentStreak > 0 ? (
                          <div className="flex items-center gap-1.5">
                            <Icon name="Flame" size={15} className="text-orange-500" />
                            <span className="font-medium text-orange-600">{r.currentStreak}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <span className="inline-flex gap-1 text-slate-400">
                          {r.hasDevice && <Icon name="Smartphone" size={15} />}
                          {r.hasPin && <Icon name="KeyRound" size={15} />}
                          {!r.hasDevice && !r.hasPin && <span className="text-xs">—</span>}
                        </span>
                      </td>
                      {canManage && (
                        <td className="px-4 py-2 text-right">
                          <Button size="sm" kind="tertiary" icon="Pencil" onClick={() => setActive(r)}>Manage</Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {active && canManage && (
        <ManageModal row={active} date={date} onClose={() => setActive(null)} onDone={() => { setActive(null); load(); }} />
      )}
    </div>
  );
}

function ManageModal({ row, date, onClose, onDone }: { row: Row; date: string; onClose: () => void; onDone: () => void }) {
  const [tab, setTab] = useState<'punch' | 'status' | 'pin' | 'device'>('punch');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [punchType, setPunchType] = useState<'IN' | 'OUT'>('IN');
  const [time, setTime] = useState('09:00');
  const [status, setStatus] = useState('LEAVE');
  const [pin, setPin] = useState('');

  const call = async (url: string, body: any, method = 'POST') => {
    setBusy(true); setError('');
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Failed');
      onDone();
    } catch (e: any) { setError(e?.message || 'Failed'); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={`Manage — ${row.name}`} subtitle={new Date(date).toLocaleDateString('en-IN', { dateStyle: 'medium' })}>
      <div className="flex flex-wrap gap-1 mb-4 text-sm">
        {([['punch', 'Add punch'], ['status', 'Set status'], ['pin', 'Attendance PIN'], ['device', 'Device']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-md ${tab === k ? 'bg-purple-100 text-purple-700' : 'text-slate-600 hover:bg-slate-100'}`}>{label}</button>
        ))}
      </div>
      {error && <div className="rounded-md bg-danger-50 text-danger-700 text-sm px-3 py-2 mb-3">{error}</div>}

      {tab === 'punch' && (
        <div className="space-y-3">
          <Field label="Direction"><Select value={punchType} onChange={(e) => setPunchType(e.target.value as any)}><option value="IN">Punch in</option><option value="OUT">Punch out</option></Select></Field>
          <Field label="Time"><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
          <Button kind="primary" disabled={busy} onClick={() => call('/api/staff-attendance/manage/regularize', { action: 'punch', staffId: row.staffId, type: punchType, at: new Date(`${date}T${time}:00`).toISOString() })}>Add punch</Button>
        </div>
      )}
      {tab === 'status' && (
        <div className="space-y-3">
          <Field label="Mark day as"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="LEAVE">Leave</option><option value="HOLIDAY">Holiday</option><option value="ABSENT">Absent</option></Select></Field>
          <Button kind="primary" disabled={busy} onClick={() => call('/api/staff-attendance/manage/regularize', { action: 'status', staffId: row.staffId, date, status })}>Set status</Button>
        </div>
      )}
      {tab === 'pin' && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">For staff who can’t use fingerprint / Face ID. Works on their own phone (“Punch with PIN”) and at the shared kiosk. {row.hasPin ? 'A PIN is already set.' : 'No PIN set yet.'}</p>
          <Field label="New PIN (4–6 digits)"><Input inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="••••" /></Field>
          <div className="flex gap-2">
            <Button kind="primary" disabled={busy || pin.length < 4} onClick={() => call('/api/staff-attendance/manage/pin', { staffId: row.staffId, pin })}>Save PIN</Button>
            {row.hasPin && <Button kind="danger" disabled={busy} onClick={() => call(`/api/staff-attendance/manage/pin?staffId=${row.staffId}`, null, 'DELETE')}>Remove</Button>}
          </div>
        </div>
      )}
      {tab === 'device' && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">{row.hasDevice ? 'A phone is registered. Reset it so the staff member can enroll a new phone.' : 'No phone registered.'}</p>
          <Button kind="danger" disabled={busy || !row.hasDevice} onClick={() => call('/api/staff-attendance/manage/reset-device', { staffId: row.staffId })}>Reset registered device</Button>
        </div>
      )}
    </Modal>
  );
}
