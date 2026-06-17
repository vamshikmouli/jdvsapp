'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Card, Chip, Skeleton, EmptyState, Button, Input } from '@/components/Primitives';
import { Icon } from '@/components/Icon';
import { STATUS_LABEL, statusTone, fmtMins, fmtTime } from '@/lib/staffAttendance/display';

const TYPE_LABEL: Record<string, string> = { CASUAL: 'Casual', SICK: 'Sick', EARNED: 'Earned', UNPAID: 'Unpaid', OTHER: 'Other' };

interface Data {
  staff: { id: string; name: string; designation: string | null; hasPin: boolean; device: { deviceName: string | null; lastUsedAt: string } | null };
  days: { date: string; status: string; late: boolean; lateMinutes: number; firstIn: string | null; lastOut: string | null; workedMinutes: number }[];
  punches: { type: 'IN' | 'OUT'; at: string; source: string; withinFence: boolean; distanceM: number | null; note: string | null }[];
}

export default function StaffAttendanceDetailPage() {
  const { staffId } = useParams<{ staffId: string }>();
  const { data: session } = useSession();
  const canApprove = (((session?.user as any)?.perms as string[]) || []).includes('LEAVE_APPROVE');
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [bal, setBal] = useState<{ year: string; startYear: number; balances: any[] } | null>(null);

  const loadBal = useCallback(async () => {
    const r = await fetch(`/api/leave/balance?staffId=${staffId}`);
    if (r.ok) setBal(await r.json());
  }, [staffId]);

  useEffect(() => {
    fetch(`/api/staff-attendance/${staffId}`).then(async (r) => {
      if (r.ok) setData(await r.json());
      setLoading(false);
    });
    loadBal();
  }, [staffId, loadBal]);

  const setOverride = async (type: string, days: number | null) => {
    if (!bal) return;
    await fetch('/api/leave/balance', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staffId, year: bal.startYear, type, days }),
    });
    await loadBal();
  };

  if (loading) return <div className="max-w-3xl mx-auto p-6 space-y-3"><Skeleton height={80} /><Skeleton height={300} /></div>;
  if (!data) return <EmptyState icon="UserX" title="Not found" body="This staff member could not be loaded." />;

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
      <Link href="/admin/staff-attendance" className="text-sm text-slate-500 hover:text-slate-700 inline-flex items-center gap-1"><Icon name="ChevronLeft" size={16} />Staff attendance</Link>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{data.staff.name}</h1>
        <p className="text-sm text-slate-500">
          {data.staff.designation || 'Staff'}
          {data.staff.device ? ` · 📱 ${data.staff.device.deviceName || 'registered'}` : ''}
          {data.staff.hasPin ? ' · 🔑 kiosk PIN' : ''}
        </p>
      </div>

      {bal && (
        <Card title={`Leave balance · ${bal.year}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-1 pr-4 font-medium">Type</th>
                  <th className="py-1 pr-4 font-medium">Entitlement</th>
                  <th className="py-1 pr-4 font-medium">Used</th>
                  <th className="py-1 pr-4 font-medium">Pending</th>
                  <th className="py-1 pr-4 font-medium">Remaining</th>
                  {canApprove && <th className="py-1 font-medium">Override</th>}
                </tr>
              </thead>
              <tbody>
                {bal.balances.map((b) => (
                  <tr key={b.type} className="border-t border-slate-50">
                    <td className="py-1.5 pr-4 text-slate-700">{TYPE_LABEL[b.type]}</td>
                    <td className="py-1.5 pr-4 text-slate-600">{b.unlimited ? 'No limit' : b.entitlement}</td>
                    <td className="py-1.5 pr-4 text-slate-600">{b.used}</td>
                    <td className="py-1.5 pr-4 text-slate-400">{b.pending || '—'}</td>
                    <td className="py-1.5 pr-4 font-medium text-slate-900">{b.unlimited ? '—' : b.remaining}</td>
                    {canApprove && (
                      <td className="py-1.5">
                        <OverrideCell type={b.type} current={b.unlimited ? 0 : b.entitlement} onSave={(d) => setOverride(b.type, d)} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title="Last 30 days" padded={false}>
        {data.days.length === 0 ? (
          <EmptyState icon="Calendar" title="No records" body="No attendance recorded in this period." />
        ) : (
          <div className="divide-y divide-slate-50">
            {data.days.map((d) => (
              <div key={d.date} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="text-slate-700 w-32">{new Date(d.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                <span className="text-slate-400 text-xs flex-1">{fmtTime(d.firstIn)} – {fmtTime(d.lastOut)} · {fmtMins(d.workedMinutes)}</span>
                <Chip tone={statusTone(d.status)}>{STATUS_LABEL[d.status] ?? d.status}{d.late ? ` · ${d.lateMinutes}m late` : ''}</Chip>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Recent punches" padded={false}>
        {data.punches.length === 0 ? (
          <div className="px-4 py-6 text-sm text-slate-400 text-center">No punches yet.</div>
        ) : (
          <div className="divide-y divide-slate-50">
            {data.punches.map((p, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="flex items-center gap-2">
                  <span className={`font-medium ${p.type === 'IN' ? 'text-success-700' : 'text-danger-700'}`}>{p.type}</span>
                  <span className="text-slate-500">{new Date(p.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}</span>
                </span>
                <span className="flex items-center gap-2 text-xs text-slate-400">
                  <span>{p.source.toLowerCase()}</span>
                  {p.distanceM != null && <span>{Math.round(p.distanceM)}m</span>}
                  {!p.withinFence && <Chip tone="danger">off-site</Chip>}
                  {p.note && <span className="italic">{p.note}</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function OverrideCell({ type, current, onSave }: { type: string; current: number; onSave: (days: number | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(current));
  if (!editing) {
    return <button onClick={() => { setVal(String(current)); setEditing(true); }} className="text-xs text-purple-600 hover:underline">Edit</button>;
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Input type="number" min={0} value={val} onChange={(e) => setVal(e.target.value)} className="w-20" />
      <Button size="sm" kind="primary" onClick={() => { onSave(val === '' ? null : Number(val)); setEditing(false); }}>Save</Button>
      <Button size="sm" kind="tertiary" onClick={() => onSave(null)}>Reset</Button>
      <button onClick={() => setEditing(false)} className="text-xs text-slate-400">✕</button>
    </span>
  );
}
