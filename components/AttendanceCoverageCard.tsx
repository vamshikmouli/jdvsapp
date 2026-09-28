'use client';

import { useEffect, useState } from 'react';
import { Card, Skeleton } from '@/components/Primitives';

interface DayMeta { day: number; dow: number; sunday: boolean; holiday: string | null; future: boolean }
interface ClassCov { id: string; name: string; taken: number[]; marked: number; schoolDays: number }
interface Coverage { monthLabel: string; month: string; nDays: number; days: DayMeta[]; classes: ClassCov[]; schoolDays: number }

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
function curMonth() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function shortClassName(name: string) { return name.replace(/\s*standard\s*/i, '').replace(/\s*STD\s*/i, '').trim() || name; }

// Per-class × per-day attendance coverage for a month — green = marked, red = a
// school day that was missed, muted = Sunday / holiday / future. Spot gaps fast.
export function AttendanceCoverageCard() {
  const [month, setMonth] = useState(curMonth());
  const [data, setData] = useState<Coverage | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/dashboard/attendance-coverage?month=${month}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) { setData(d); setLoading(false); } })
      .catch(() => { if (alive) { setData(null); setLoading(false); } });
    return () => { alive = false; };
  }, [month]);

  return (
    <Card
      title="Attendance coverage — monthly"
      className="mt-6"
      action={
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="px-2 py-1 rounded-md border border-slate-200 text-xs text-slate-700 focus:border-purple-500 focus:outline-none"
        />
      }
    >
      {loading ? (
        <div className="space-y-1.5 pt-1">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={16} />)}</div>
      ) : !data || data.classes.length === 0 ? (
        <p className="text-sm text-slate-400 py-4 text-center">No classes to show.</p>
      ) : (
        <div className="pt-1">
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 mb-2">
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-success-500" /> Marked</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-danger-300" /> Not marked</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-slate-200" /> Sun / holiday</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm border border-slate-200 bg-white" /> Upcoming</span>
            <span className="ml-auto text-slate-400">{data.monthLabel}</span>
          </div>

          <div className="overflow-x-auto -mx-1 px-1">
            <table className="border-separate" style={{ borderSpacing: '2px' }}>
              <thead>
                <tr>
                  <th className="sticky left-0 bg-white z-10" />
                  {data.days.map((d) => (
                    <th key={d.day} className="w-3.5 align-bottom">
                      <div className={`text-[8px] leading-none font-medium ${d.sunday ? 'text-danger-400' : 'text-slate-400'}`}>{DOW[d.dow]}</div>
                      <div className="text-[8px] leading-tight text-slate-400 tabular-nums">{d.day}</div>
                    </th>
                  ))}
                  <th className="sticky right-0 bg-white z-10 pl-2 text-[10px] font-semibold text-slate-400 text-right">Marked</th>
                </tr>
              </thead>
              <tbody>
                {data.classes.map((c) => {
                  const takenSet = new Set(c.taken);
                  const complete = c.marked >= c.schoolDays && c.schoolDays > 0;
                  return (
                    <tr key={c.id}>
                      <td className="sticky left-0 bg-white z-10 pr-2 text-[11px] font-medium text-slate-700 whitespace-nowrap">{shortClassName(c.name)}</td>
                      {data.days.map((d) => {
                        const off = d.sunday || !!d.holiday;
                        let cls: string, title: string;
                        if (off) { cls = 'bg-slate-200'; title = d.holiday ? `Holiday: ${d.holiday}` : 'Sunday'; }
                        else if (d.future) { cls = 'bg-white border border-slate-200'; title = 'Upcoming'; }
                        else if (takenSet.has(d.day)) { cls = 'bg-success-500'; title = 'Marked'; }
                        else { cls = 'bg-danger-300'; title = 'Not marked'; }
                        return <td key={d.day} className="p-0"><div className={`w-3.5 h-3.5 rounded-sm ${cls}`} title={`${shortClassName(c.name)} · ${d.day} — ${title}`} /></td>;
                      })}
                      <td className="sticky right-0 bg-white z-10 pl-2 text-right whitespace-nowrap">
                        <span className={`text-[11px] font-semibold tabular-nums ${complete ? 'text-success-700' : 'text-slate-600'}`}>{c.marked}</span>
                        <span className="text-[10px] text-slate-400 tabular-nums">/{c.schoolDays}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}
