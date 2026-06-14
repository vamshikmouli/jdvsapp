'use client';

import React, { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Card, Chip, EmptyState, Skeleton } from '@/components/Primitives';
import { Icon } from '@/components/Icon';

interface DashboardData {
  kpis: { studentsTotal: number; studentsActive: number; staffTotal: number; classesTotal: number };
  today: { present: number; absent: number; leave: number; late: number; marked: number; pct: number; activeStudents: number; absentNames: string[]; leaveNames: string[] };
  chart: { date: string; present: number; total: number; pct: number }[];
  todaySessions: { classId: string; className: string; students: number; slots: { key: string; label: string; status: string }[] }[];
  classAttendance: { classId: string; className: string; total: number; marked: number; present: number; absent: number; leave: number; pct: number }[];
  activity: { type: string; text: string; meta: string; at: string }[];
}

function shortClassName(name: string) {
  return name.replace(/\s?STD$/, '');
}

function todayHeading() {
  return new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const SESSION_STATUS: Record<string, { label: string; tone: 'success' | 'warn' | 'neutral' }> = {
  taken: { label: 'Reopened', tone: 'warn' },
  locked: { label: 'Submitted', tone: 'success' },
  pending: { label: 'Pending', tone: 'neutral' },
};

const ACCENT: Record<string, { badge: string; ring: string }> = {
  purple: { badge: 'bg-purple-100 text-purple-700', ring: 'from-purple-500/10' },
  green: { badge: 'bg-success-100 text-success-700', ring: 'from-success-500/10' },
  blue: { badge: 'bg-info-100 text-info-700', ring: 'from-info-500/10' },
  amber: { badge: 'bg-marigold-100 text-marigold-700', ring: 'from-marigold-500/10' },
};

function Kpi({
  icon,
  accent,
  label,
  value,
  caption,
}: {
  icon: string;
  accent: keyof typeof ACCENT;
  label: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
}) {
  const a = ACCENT[accent];
  return (
    <div className="relative overflow-hidden bg-white rounded-xl border border-slate-200 shadow-xs hover:shadow-md transition-shadow p-4">
      <div className={`pointer-events-none absolute -top-8 -right-8 w-28 h-28 rounded-full bg-gradient-to-br ${a.ring} to-transparent`} />
      <div className="relative">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${a.badge}`}>
          <Icon name={icon as any} size={20} />
        </div>
        <div className="text-2xl font-bold text-slate-900 mt-3 leading-none">{value}</div>
        <div className="text-sm font-medium text-slate-600 mt-1.5">{label}</div>
        {caption && <div className="text-xs text-slate-400 mt-0.5">{caption}</div>}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch('/api/dashboard');
        if (!res.ok) throw new Error(`Failed to load dashboard (${res.status})`);
        setData(await res.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const firstName = session?.user?.name?.split(' ')[0] || 'there';
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  const maxPct = data ? Math.max(100, ...data.chart.map((c) => c.pct)) : 100;
  const presentNow = data ? data.today.present + data.today.late : 0;

  return (
    <>
      {/* ===== Greeting ===== */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{greeting}, {firstName} 👋</h1>
        <span className="text-xs sm:text-sm text-slate-400">{todayHeading()}</span>
      </div>

      {/* ===== Loading ===== */}
      {loading && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-slate-200 p-4">
                <Skeleton height={40} width={40} rounded="lg" />
                <Skeleton height={26} width="50%" className="mt-3" />
                <Skeleton height={14} width="70%" className="mt-2" />
              </div>
            ))}
          </div>
          <Card title="Class-wise attendance — today" className="mt-6">
            <div className="h-56 flex items-end gap-3 pt-6">
              {Array.from({ length: 13 }).map((_, i) => (
                <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
                  <Skeleton height={`${Math.random() * 70 + 20}%`} width="100%" className="max-w-[34px] rounded-t" />
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {!loading && error && (
        <div className="mt-6">
          <EmptyState icon="AlertCircle" title="Couldn't load dashboard" body={error} />
        </div>
      )}

      {!loading && data && (
        <>
          {/* ===== KPI tiles ===== */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
            <Kpi
              icon="CalendarCheck"
              accent="green"
              label="Attendance today"
              value={data.today.marked ? `${data.today.pct}%` : '—'}
              caption={data.today.marked ? `${presentNow} of ${data.today.marked} marked` : 'Not taken yet'}
            />
            <Kpi
              icon="UserCheck"
              accent="blue"
              label="Students present"
              value={data.today.marked ? `${presentNow}/${data.today.marked}` : '0'}
              caption={
                <span
                  className={data.today.absent + data.today.leave > 0 ? 'cursor-help' : ''}
                  title={
                    data.today.absent + data.today.leave > 0
                      ? [
                          data.today.absentNames.length ? `Absent (${data.today.absent}):\n${data.today.absentNames.join('\n')}` : '',
                          data.today.leaveNames.length ? `On leave (${data.today.leave}):\n${data.today.leaveNames.join('\n')}` : '',
                        ].filter(Boolean).join('\n\n')
                      : undefined
                  }
                >
                  {data.today.absent} absent · {data.today.leave} leave
                </span>
              }
            />
            <Kpi
              icon="Users"
              accent="purple"
              label="Total students"
              value={data.kpis.studentsTotal}
              caption={`${data.kpis.studentsActive} active`}
            />
            <Kpi
              icon="GraduationCap"
              accent="amber"
              label="Classes · Staff"
              value={`${data.kpis.classesTotal} · ${data.kpis.staffTotal}`}
              caption="across the school"
            />
          </div>

          {/* ===== Class-wise attendance — vertical bars ===== */}
          <Card title="Class-wise attendance — today" className="mt-6" action={<Chip tone="neutral">present / total</Chip>}>
            {data.classAttendance.length === 0 ? (
              <div className="py-8">
                <EmptyState icon="ClipboardList" title="No classes" body="Add classes to see attendance here." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div
                  className="flex items-end gap-3 h-56 pt-6"
                  style={{ minWidth: `${data.classAttendance.length * 46}px` }}
                >
                  {data.classAttendance.map((c) => {
                    const notMarked = c.marked === 0;
                    const barColor =
                      c.pct >= 90 ? 'bg-success-500' : c.pct >= 75 ? 'bg-marigold-500' : 'bg-danger-500';
                    return (
                      <div key={c.classId} className="flex-1 flex flex-col items-center justify-end h-full gap-1.5 group">
                        <span className={`text-[10px] font-bold whitespace-nowrap ${notMarked ? 'text-slate-300' : 'text-slate-700'}`}>
                          {notMarked ? '—' : `${c.present}/${c.total}`}
                        </span>
                        <div className="relative w-full flex justify-center flex-1 items-end">
                          {/* track */}
                          <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-[30px] h-full rounded-md bg-slate-50" />
                          {/* value */}
                          <div
                            className={`relative w-full max-w-[30px] rounded-md transition-all duration-300 group-hover:brightness-95 ${
                              notMarked ? 'bg-slate-200' : barColor
                            }`}
                            style={{ height: notMarked ? '6px' : `${Math.max(c.pct, 4)}%` }}
                            title={`${c.className} · ${notMarked ? 'Not marked' : `${c.present}/${c.total} present · ${c.pct}%`}`}
                          />
                        </div>
                        <span className="text-[10px] font-medium text-slate-500 text-center w-full truncate" title={c.className}>
                          {shortClassName(c.className)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>

          {/* ===== Trend + Today's sessions ===== */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
            <div className="lg:col-span-2">
              <Card title="Attendance — last 14 days" action={<Chip tone="info">Whole school</Chip>}>
                {data.chart.every((c) => c.total === 0) ? (
                  <div className="py-8">
                    <EmptyState icon="BarChart3" title="No attendance data yet" body="Mark attendance to see the trend here." />
                  </div>
                ) : (
                  <div className="flex items-end justify-between gap-2 h-48 pt-4">
                    {data.chart.map((day) => {
                      const heightPct = day.total ? (day.pct / maxPct) * 100 : 0;
                      const d = new Date(day.date);
                      return (
                        <div key={day.date} className="flex-1 flex flex-col items-center gap-2 h-full justify-end group">
                          <div className="relative w-full flex justify-center">
                            <div
                              className="w-full max-w-[26px] rounded-t-md bg-gradient-to-t from-purple-600 to-purple-400 group-hover:brightness-110 transition-all"
                              style={{ height: `${Math.max(heightPct, day.total ? 4 : 0)}%`, minHeight: day.total ? 4 : 0 }}
                              title={`${day.pct}% · ${day.present}/${day.total}`}
                            />
                          </div>
                          <span className="text-[10px] text-slate-400">{d.getDate()}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </div>

            <Card title="Today's sessions" padded={false}>
              <div className="max-h-80 overflow-y-auto">
                {data.todaySessions.map((s) => (
                  <div key={s.classId} className="flex items-center justify-between px-6 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <div>
                      <div className="font-medium text-slate-900 text-sm">{shortClassName(s.className)}</div>
                      <div className="text-xs text-slate-500">{s.students} students</div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      {s.slots.map((sl) => (
                        <div key={sl.key} className="flex items-center gap-1.5">
                          <span className="text-[10px] text-slate-400 truncate max-w-[80px]" title={sl.label}>{sl.label}</span>
                          <Chip tone={SESSION_STATUS[sl.status].tone}>{SESSION_STATUS[sl.status].label}</Chip>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* ===== Recent activity + breakdown ===== */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            <Card title="Recent activity" padded={false}>
              {data.activity.length === 0 ? (
                <div className="py-8">
                  <EmptyState icon="Activity" title="No activity yet" body="Actions across the school will show up here." />
                </div>
              ) : (
                <div>
                  {data.activity.map((a, i) => (
                    <div key={i} className="flex items-center gap-3 px-6 py-3 border-b border-slate-100 last:border-0">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                        a.type === 'attendance' ? 'bg-info-50 text-info-600' : 'bg-purple-50 text-purple-600'
                      }`}>
                        <Icon name={a.type === 'attendance' ? 'CalendarCheck' : 'UserPlus'} size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-slate-900 truncate">{a.text}</div>
                        <div className="text-xs text-slate-500">{a.meta}</div>
                      </div>
                      <span className="text-xs text-slate-400 flex-shrink-0">{relativeTime(a.at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Attendance breakdown — today">
              {data.today.marked === 0 ? (
                <div className="py-8">
                  <EmptyState icon="ClipboardList" title="No attendance taken today" body="Head to Attendance to mark a class." />
                </div>
              ) : (
                <div className="space-y-4 pt-2">
                  {[
                    { label: 'Present', value: data.today.present, color: 'bg-success-500', names: [] as string[] },
                    { label: 'Late', value: data.today.late, color: 'bg-marigold-500', names: [] as string[] },
                    { label: 'Leave', value: data.today.leave, color: 'bg-info-500', names: data.today.leaveNames },
                    { label: 'Absent', value: data.today.absent, color: 'bg-danger-500', names: data.today.absentNames },
                  ].map((row) => {
                    const pct = data.today.marked ? Math.round((row.value / data.today.marked) * 100) : 0;
                    const hasNames = row.names.length > 0;
                    return (
                      <div
                        key={row.label}
                        className={hasNames ? 'cursor-help' : ''}
                        title={hasNames ? `${row.label} (${row.names.length}):\n${row.names.join('\n')}` : undefined}
                      >
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="text-slate-700 inline-flex items-center gap-1">
                            {row.label}
                            {hasNames && <Icon name="Info" size={12} className="text-slate-400" />}
                          </span>
                          <span className="text-slate-900 font-medium">{row.value} · {pct}%</span>
                        </div>
                        <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full ${row.color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
