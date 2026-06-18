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

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/staff-attendance?date=${date}`);
    if (res.ok) setBoard(await res.json());
    setLoading(false);
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const summary = board?.summary;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Staff attendance</h1>
          <p className="text-sm text-slate-500">Daily punch board for all staff.</p>
        </div>
        <div className="flex items-center gap-2">
          <Input type="date" value={date} max={todayKey()} onChange={(e) => setDate(e.target.value)} />
          <Button icon="Download" onClick={() => { const m = date.slice(0, 7); window.open(`/api/staff-attendance/export?from=${m}-01&to=${date}`, '_blank'); }}>Export month</Button>
          {canManage && <Link href={`/admin/staff-attendance/bulk?date=${date}`}><Button kind="primary" icon="ClipboardCheck">Mark attendance</Button></Link>}
          {canManage && <Link href="/admin/staff-attendance/kiosk"><Button icon="Tablet">Kiosk</Button></Link>}
          {canConfig && <Link href="/admin/staff-attendance/config"><Button icon="Settings">Settings</Button></Link>}
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                  <th className="px-4 py-2 font-medium">Staff</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">In</th>
                  <th className="px-4 py-2 font-medium">Out</th>
                  <th className="px-4 py-2 font-medium">Worked</th>
                  <th className="px-4 py-2 font-medium">Method</th>
                  {canManage && <th className="px-4 py-2 font-medium text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {board.rows.map((r) => (
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
      <div className="flex gap-1 mb-4 text-sm">
        {([['punch', 'Add punch'], ['status', 'Set status'], ['pin', 'Kiosk PIN'], ['device', 'Device']] as const).map(([k, label]) => (
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
          <p className="text-sm text-slate-600">For staff who punch on the shared kiosk. {row.hasPin ? 'A PIN is already set.' : 'No PIN set yet.'}</p>
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
