'use client';

import React from 'react';
import { Icon } from '@/components/Icon';
import { ATTENDANCE_START_MONTH } from '@/lib/staffAttendance/schedule';

export interface CalDay {
  date: string;        // ISO date (…T00:00:00Z)
  status: string;      // PRESENT | HALF_DAY | ABSENT | LEAVE | HOLIDAY | WEEKLY_OFF
  late?: boolean;
  halfSession?: string | null; // for HALF_DAY leave: MORNING | AFTERNOON (which half is off)
}

// A half-day leave's cell is split left→right (morning | afternoon): the session
// they attended is green, the session off is red. halfSession = the OFF session.
function halfSplitStyle(halfSession?: string | null): React.CSSProperties | undefined {
  const GREEN = '#156D3B', RED = '#A4231F'; // matches success-600 (present) / danger-600 (absent)
  if (halfSession === 'MORNING') return { background: `linear-gradient(90deg, ${RED} 50%, ${GREEN} 50%)` };   // morning off
  if (halfSession === 'AFTERNOON') return { background: `linear-gradient(90deg, ${GREEN} 50%, ${RED} 50%)` }; // afternoon off
  return undefined;
}

interface Props {
  month: string;       // "YYYY-MM"
  days: CalDay[];
  todayKey?: string;   // "YYYY-MM-DD" to highlight
  onMonthChange?: (month: string) => void;
  maxMonth?: string;   // cap forward navigation (default: current month)
  loading?: boolean;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// status -> [cell classes, short label]. Static strings so Tailwind keeps them.
// Dark, filled cells with white text for strong at-a-glance contrast.
const STYLE: Record<string, { cls: string; label: string }> = {
  PRESENT: { cls: 'bg-success-600 text-white', label: 'P' },
  HALF_DAY: { cls: 'bg-warn-600 text-white', label: '½' },
  ABSENT: { cls: 'bg-danger-600 text-white', label: 'A' },
  LEAVE: { cls: 'bg-info-600 text-white', label: 'L' },
  HOLIDAY: { cls: 'bg-purple-600 text-white', label: 'H' },
  WEEKLY_OFF: { cls: 'bg-slate-500 text-white', label: 'O' },
};
const EMPTY = { cls: 'bg-slate-50 text-slate-300', label: '' };

const LEGEND: [string, string][] = [
  ['Present', 'bg-success-600'], ['Half day', 'bg-warn-600'], ['Absent', 'bg-danger-600'],
  ['Leave', 'bg-info-600'], ['Holiday', 'bg-purple-600'], ['Off', 'bg-slate-500'],
];

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function AttendanceCalendar({ month, days, todayKey, onMonthChange, maxMonth, loading }: Props) {
  const [y, m] = month.split('-').map(Number);
  const byDate = new Map(days.map((d) => [d.date.slice(0, 10), d]));
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cap = maxMonth || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const canNext = month < cap;
  const canPrev = month > ATTENDANCE_START_MONTH; // don't go before the system start

  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  // Month tally.
  const tally = days.reduce((a, d) => { a[d.status] = (a[d.status] || 0) + 1; return a; }, {} as Record<string, number>);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => canPrev && onMonthChange?.(shiftMonth(month, -1))} disabled={!onMonthChange || !canPrev}
          className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 disabled:opacity-40"><Icon name="ChevronLeft" size={18} /></button>
        <div className="text-sm font-medium text-slate-800">{MONTH_NAMES[m - 1]} {y}</div>
        <button onClick={() => canNext && onMonthChange?.(shiftMonth(month, 1))} disabled={!onMonthChange || !canNext}
          className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 disabled:opacity-40"><Icon name="ChevronRight" size={18} /></button>
      </div>

      <div className={`grid grid-cols-7 gap-1 ${loading ? 'opacity-50' : ''}`}>
        {WEEKDAYS.map((w, i) => (
          <div key={i} className="text-center text-[11px] font-medium text-slate-400 pb-1">{w}</div>
        ))}
        {cells.map((day, i) => {
          if (day == null) return <div key={i} />;
          const dateKey = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const rec = byDate.get(dateKey);
          const st = rec ? (STYLE[rec.status] || EMPTY) : EMPTY;
          const split = rec?.status === 'HALF_DAY' ? halfSplitStyle(rec.halfSession) : undefined;
          const isToday = dateKey === todayKey;
          return (
            <div key={i} title={rec ? rec.status.replace('_', ' ').toLowerCase() : ''}
              style={split}
              className={`relative aspect-square rounded-md flex flex-col items-center justify-center ${split ? 'text-white' : st.cls} ${isToday ? 'ring-2 ring-purple-400' : ''}`}>
              <span className="text-[11px] leading-none opacity-70">{day}</span>
              {st.label && <span className="text-sm font-semibold leading-tight">{st.label}</span>}
              {rec?.late && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-danger-600 ring-1 ring-white" title="late" />}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3">
        {LEGEND.map(([label, dot]) => (
          <span key={label} className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
            {label === 'Half day'
              ? <span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'linear-gradient(90deg,#156D3B 50%,#A4231F 50%)' }} />
              : <span className={`w-2.5 h-2.5 rounded-sm ${dot}`} />}
            {label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500"><span className="w-1.5 h-1.5 rounded-full bg-danger-600 ring-1 ring-white" />late</span>
      </div>

      <div className="flex flex-wrap gap-3 mt-3 text-xs">
        <span className="text-success-700 font-medium">{tally.PRESENT || 0} present</span>
        <span className="text-warn-700 font-medium">{tally.HALF_DAY || 0} half</span>
        <span className="text-danger-700 font-medium">{tally.ABSENT || 0} absent</span>
        <span className="text-info-700 font-medium">{tally.LEAVE || 0} leave</span>
      </div>
    </div>
  );
}
