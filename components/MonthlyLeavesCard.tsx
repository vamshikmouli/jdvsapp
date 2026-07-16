'use client';

import { useEffect, useState } from 'react';
import { Card, Skeleton } from '@/components/Primitives';

interface Row {
  staffId: string;
  name: string;
  designation: string | null;
  leaveDays: number;
  byType: Record<string, number>;
}

const TYPE_LABEL: Record<string, string> = { EARNED: 'Earned', SICK: 'Sick', UNPAID: 'Unpaid', CASUAL: 'Casual', OTHER: 'Other' };
function curMonth() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function fmtDays(n: number) { return `${n} day${n === 1 ? '' : 's'}`; }
function breakdown(byType: Record<string, number>) {
  return Object.entries(byType).map(([t, n]) => `${TYPE_LABEL[t] ?? t}: ${n}`).join(', ');
}

// Monthly per-staff leave leaderboard: who took the most, and who took none.
export function MonthlyLeavesCard() {
  const [month, setMonth] = useState(curMonth());
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let alive = true;
    setRows(null);
    fetch(`/api/staff-attendance/monthly-leaves?month=${month}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setRows(d?.rows ?? []); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [month]);

  const took = rows?.filter((r) => r.leaveDays > 0) ?? [];
  const none = rows?.filter((r) => r.leaveDays === 0) ?? [];

  return (
    <Card
      title="Staff leaves — monthly"
      className="mt-6"
      action={
        <input
          type="month"
          value={month}
          max={curMonth()}
          onChange={(e) => setMonth(e.target.value)}
          className="text-sm border border-slate-200 rounded-md px-2 py-1 text-slate-700"
        />
      }
    >
      {rows === null ? (
        <Skeleton height={140} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* Took leave — most first */}
          <div>
            <div className="text-sm font-semibold text-slate-800 mb-2">Took leave · {took.length}</div>
            {took.length === 0 ? (
              <div className="text-sm text-slate-400">Nobody took leave this month.</div>
            ) : (
              <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                {took.map((r, i) => (
                  <div key={r.staffId} className="flex items-center justify-between gap-2 text-sm" title={breakdown(r.byType)}>
                    <span className="text-slate-700 truncate">
                      <span className="text-slate-400 tabular-nums">{i + 1}.</span> {r.name}
                    </span>
                    <span className="font-semibold text-danger-600 shrink-0">{fmtDays(r.leaveDays)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* No leaves — perfect attendance */}
          <div>
            <div className="text-sm font-semibold text-slate-800 mb-2">No leaves · {none.length}</div>
            {none.length === 0 ? (
              <div className="text-sm text-slate-400">Everyone took some leave.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5 max-h-80 overflow-y-auto pr-1">
                {none.map((r) => (
                  <span key={r.staffId} className="text-xs bg-success-50 text-success-700 rounded-md px-2 py-1">{r.name}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
