'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PageHeader, Button, Card, EmptyState, Skeleton } from '@/components/Primitives';
import { Icon } from '@/components/Icon';
import { toast } from '@/lib/toast';

type Status = 'PRESENT' | 'ABSENT' | 'LEAVE' | 'LATE';

interface SchoolClass { id: string; name: string; _count: { students: number } }
interface DayCol { day: number; iso: string; dow: number; sunday: boolean; holiday: string | null; future?: boolean }
interface RegisterData {
  monthLabel: string;
  slot: string;
  nDays: number;
  days: DayCol[];
  roster: { id: string; name: string }[];
  marks: Record<string, Record<number, Status>>;
  lockedDays: string[];
}

// Dropdown options — short codes match the paper register (DA = delayed arrival).
const OPTIONS: { v: Status; code: string; label: string }[] = [
  { v: 'PRESENT', code: 'P', label: 'Present' },
  { v: 'ABSENT', code: 'A', label: 'Absent' },
  { v: 'LEAVE', code: 'L', label: 'Leave' },
  { v: 'LATE', code: 'DA', label: 'Delayed arrival' },
];
const CELL_CLASS: Record<Status, string> = {
  PRESENT: 'bg-success-50 text-success-700',
  ABSENT: 'bg-danger-50 text-danger-700',
  LEAVE: 'bg-info-50 text-info-700',
  LATE: 'bg-marigold-50 text-marigold-700',
};
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function thisMonth() { return new Date().toISOString().slice(0, 7); }
function shortClassName(name: string) { return name.replace(/\s*standard\s*/i, '').replace(/\s*STD\s*/i, '').trim() || name; }

export default function AttendanceRegisterPage() {
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [classId, setClassId] = useState('');
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<RegisterData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // grid[studentId][day] = status. A missing cell means "Present" (the default).
  const [grid, setGrid] = useState<Record<string, Record<number, Status>>>({});

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/classes');
      if (res.ok) {
        const list: SchoolClass[] = await res.json();
        setClasses(list);
        if (list.length) setClassId((c) => c || list[0].id);
      }
    })();
  }, []);

  const load = useCallback(async () => {
    if (!classId || !month) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/attendance/register?classId=${classId}&month=${month}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to load');
      const d: RegisterData = await res.json();
      setData(d);
      setGrid(d.marks || {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load register');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [classId, month]);
  useEffect(() => { load(); }, [load]);

  const editableDays = useMemo(() => (data ? data.days.filter((d) => !d.sunday && !d.holiday && !d.future) : []), [data]);

  // Effective status of a cell — grid value, or Present by default.
  const cellOf = (sid: string, day: number): Status => grid[sid]?.[day] ?? 'PRESENT';
  const setCell = (sid: string, day: number, v: Status) =>
    setGrid((g) => ({ ...g, [sid]: { ...(g[sid] || {}), [day]: v } }));

  // Reset every editable cell to Present.
  const allPresent = () => {
    if (!data) return;
    const next: Record<string, Record<number, Status>> = {};
    for (const s of data.roster) { next[s.id] = {}; for (const d of editableDays) next[s.id][d.day] = 'PRESENT'; }
    setGrid(next);
  };

  const presentCount = (sid: string) => editableDays.reduce((n, d) => n + (cellOf(sid, d.day) === 'PRESENT' || cellOf(sid, d.day) === 'LATE' ? 1 : 0), 0);
  const absentCount = (sid: string) => editableDays.reduce((n, d) => n + (cellOf(sid, d.day) === 'ABSENT' ? 1 : 0), 0);

  const save = async () => {
    if (!data) return;
    setSaving(true);
    try {
      // Send every editable cell with its effective status (persists Present-by-default).
      const cells: { studentId: string; day: number; status: Status }[] = [];
      for (const s of data.roster) for (const d of editableDays) cells.push({ studentId: s.id, day: d.day, status: cellOf(s.id, d.day) });
      const res = await fetch('/api/attendance/register', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId, month, cells }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Save failed');
      const skipped = j.skippedLockedDays?.length ? ` · ${j.skippedLockedDays.length} locked day(s) skipped` : '';
      toast.success(`Saved ${j.written} mark${j.written === 1 ? '' : 's'} across ${j.days} day(s)${skipped}.`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const cls = classes.find((c) => c.id === classId);

  return (
    <>
      <PageHeader
        title="Attendance register"
        meta={data ? `${cls ? shortClassName(cls.name) : '—'} · ${data.monthLabel} · ${data.roster.length} students` : 'Monthly bulk attendance'}
        actions={
          <>
            <Link href="/admin/attendance" className="text-sm text-slate-500 hover:text-slate-700 inline-flex items-center gap-1 mr-1">
              <Icon name="CalendarCheck" size={16} /> Daily marking
            </Link>
            <Button icon="CheckCheck" onClick={allPresent} disabled={!data || loading}>All present</Button>
            <Button kind="primary" icon="Save" onClick={save} disabled={!data || loading || saving}>
              {saving ? 'Saving…' : 'Save register'}
            </Button>
          </>
        }
      />

      {/* Controls + legend — one compact line to save vertical space */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-3">
        <select
          value={classId}
          onChange={(e) => setClassId(e.target.value)}
          className="px-2.5 py-1.5 rounded-md border border-slate-200 text-sm font-medium text-slate-900 bg-white focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 focus:outline-none"
        >
          {classes.map((c) => (
            <option key={c.id} value={c.id}>{shortClassName(c.name)} · {c._count.students} students</option>
          ))}
        </select>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="px-2.5 py-1.5 rounded-md border border-slate-200 text-sm text-slate-900 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500 ml-auto">
          <span className="inline-flex items-center gap-1"><span className={`w-3 h-3 rounded ${CELL_CLASS.PRESENT}`} /> P</span>
          <span className="inline-flex items-center gap-1"><span className={`w-3 h-3 rounded ${CELL_CLASS.ABSENT}`} /> A</span>
          <span className="inline-flex items-center gap-1"><span className={`w-3 h-3 rounded ${CELL_CLASS.LEAVE}`} /> L</span>
          <span className="inline-flex items-center gap-1"><span className={`w-3 h-3 rounded ${CELL_CLASS.LATE}`} /> DA</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-200" /> Sun</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-purple-200" /> Holiday</span>
          <span className="text-slate-400 hidden lg:inline">· defaults to Present — change absentees, then Save</span>
        </div>
      </div>

      <div className="mt-3">
        {loading ? (
          <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} height={34} />)}</div>
        ) : !data || data.roster.length === 0 ? (
          <Card><EmptyState icon="Users" title="No students" body="This class has no active students for the selected year." /></Card>
        ) : (
          <div className="overflow-auto border border-slate-200 rounded-lg bg-white" style={{ maxHeight: '70vh' }}>
            <table className="border-collapse text-sm">
              <thead className="sticky top-0 z-20">
                <tr>
                  <th className="sticky left-0 z-30 bg-slate-50 border-b border-r border-slate-200 px-3 py-2 text-left font-semibold text-slate-700 min-w-[180px]">
                    Name
                  </th>
                  {data.days.map((d) => (
                    <th
                      key={d.day}
                      title={d.holiday || DOW[d.dow]}
                      className={`border-b border-slate-200 px-1 py-1 text-center font-semibold w-9 ${
                        d.holiday ? 'bg-purple-100 text-purple-700' : d.sunday ? 'bg-slate-100 text-slate-400' : d.future ? 'bg-white text-slate-300' : 'bg-slate-50 text-slate-600'
                      }`}
                    >
                      <div className="text-[13px] leading-none">{d.day}</div>
                      <div className="text-[9px] font-normal leading-none mt-0.5">{d.holiday ? 'H' : DOW[d.dow].slice(0, 1)}</div>
                    </th>
                  ))}
                  <th className="sticky right-0 z-30 bg-slate-50 border-b border-l border-slate-200 px-2 py-2 text-center font-semibold text-slate-600" title="Present + delayed / Absent">P / A</th>
                </tr>
              </thead>
              <tbody>
                {data.roster.map((s, ri) => (
                  <tr key={s.id} className={ri % 2 ? 'bg-slate-50/40' : ''}>
                    <td className="sticky left-0 z-10 bg-inherit border-r border-slate-200 px-3 py-1 text-slate-800 whitespace-nowrap min-w-[180px]">
                      <span className="text-slate-400 mr-1.5 tabular-nums">{ri + 1}.</span>{s.name}
                    </td>
                    {data.days.map((d) => {
                      if (d.sunday || d.holiday || d.future) {
                        return <td key={d.day} className={`text-center align-middle w-9 ${d.holiday ? 'bg-purple-50 text-purple-300' : d.future ? 'bg-white text-slate-200' : 'bg-slate-100 text-slate-300'}`}>·</td>;
                      }
                      const v = cellOf(s.id, d.day);
                      return (
                        <td key={d.day} className="p-0 w-9 border-slate-100">
                          <select
                            value={v}
                            onChange={(e) => setCell(s.id, d.day, e.target.value as Status)}
                            title={`${s.name} · ${d.iso}`}
                            className={`w-full h-8 text-center text-[12px] font-semibold border-0 outline-none appearance-none cursor-pointer ${CELL_CLASS[v]}`}
                            style={{ textAlignLast: 'center' }}
                          >
                            {OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.code}</option>)}
                          </select>
                        </td>
                      );
                    })}
                    <td className="sticky right-0 z-10 bg-inherit border-l border-slate-200 px-2 py-1 text-center tabular-nums text-xs">
                      <span className="text-success-700 font-semibold">{presentCount(s.id)}</span>
                      <span className="text-slate-300"> / </span>
                      <span className="text-danger-700 font-semibold">{absentCount(s.id)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
