'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { Icon } from '@/components/Icon';
import { feeMoney } from '@/lib/fees';
import { PushOptIn } from '@/components/PushOptIn';
import { useBranding } from '@/components/useBranding';

interface Child {
  id: string;
  name: string;
  className: string;
  roll: string | null;
  gender?: string;
  todayStatus: string;
  present: number;
  absent: number;
  leave: number;
  marked: number;
  pct: number;
  days: { date: string; status: string }[];
}

const STATUS_META: Record<string, { label: string; chip: string; cell: string; dot: string }> = {
  PRESENT: { label: 'Present', chip: 'bg-success-50 text-success-700', cell: 'bg-success-500 text-white', dot: 'bg-success-500' },
  LATE: { label: 'Late', chip: 'bg-marigold-50 text-marigold-700', cell: 'bg-marigold-600 text-white', dot: 'bg-marigold-500' },
  LEAVE: { label: 'On leave', chip: 'bg-info-50 text-info-700', cell: 'bg-info-500 text-white', dot: 'bg-info-500' },
  ABSENT: { label: 'Absent', chip: 'bg-danger-50 text-danger-700', cell: 'bg-danger-500 text-white', dot: 'bg-danger-500' },
  none: { label: 'Not marked', chip: 'bg-slate-100 text-slate-500', cell: '', dot: 'bg-slate-200' },
};

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function initials(name: string) {
  return name.split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}
function pad(n: number) { return String(n).padStart(2, '0'); }
function todayKeyUTC() {
  const n = new Date();
  return `${n.getUTCFullYear()}-${pad(n.getUTCMonth() + 1)}-${pad(n.getUTCDate())}`;
}

// ---------- Month calendar for one child ----------
function ChildCalendar({ studentId }: { studentId: string }) {
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth()); // 0-based
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<{ present: number; absent: number; leave: number; pct: number; marked: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/parent/attendance?studentId=${studentId}&month=${year}-${pad(month + 1)}`);
      if (res.ok) {
        const d = await res.json();
        setStatuses(d.statuses || {});
        setSummary(d.summary || null);
      }
    } finally {
      setLoading(false);
    }
  }, [studentId, year, month]);

  useEffect(() => { load(); }, [load]);

  const prev = () => { if (month === 0) { setYear((y) => y - 1); setMonth(11); } else setMonth((m) => m - 1); };
  const next = () => { if (month === 11) { setYear((y) => y + 1); setMonth(0); } else setMonth((m) => m + 1); };
  const canNext = year < now.getUTCFullYear() || (year === now.getUTCFullYear() && month < now.getUTCMonth());

  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const tKey = todayKeyUTC();

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="px-4 py-3 border-t border-slate-100">
      {/* Month nav */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={prev} className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500"><Icon name="ChevronLeft" size={18} /></button>
        <div className="text-sm font-semibold text-slate-900">{MONTHS[month]} {year}</div>
        <button onClick={next} disabled={!canNext} className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed"><Icon name="ChevronRight" size={18} /></button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map((w, i) => (
          <div key={i} className="text-center text-[10px] font-semibold text-slate-400">{w}</div>
        ))}
      </div>

      {/* Day grid */}
      <div className={`grid grid-cols-7 gap-1 ${loading ? 'opacity-50' : ''}`}>
        {cells.map((d, i) => {
          if (d === null) return <div key={`b${i}`} />;
          const key = `${year}-${pad(month + 1)}-${pad(d)}`;
          const st = statuses[key];
          const meta = STATUS_META[st] || STATUS_META.none;
          const isToday = key === tKey;
          return (
            <div
              key={key}
              title={st ? `${key} · ${meta.label}` : key}
              className={`aspect-square rounded-md flex items-center justify-center text-xs font-medium ${
                st ? meta.cell : 'text-slate-400'
              } ${isToday ? 'ring-2 ring-purple-500' : ''}`}
            >
              {d}
            </div>
          );
        })}
      </div>

      {/* Month tally */}
      {summary && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-[11px] text-slate-500">
          <span><b className="text-success-700">{summary.present}</b> present</span>
          <span><b className="text-danger-700">{summary.absent}</b> absent</span>
          <span><b className="text-info-700">{summary.leave}</b> leave</span>
          {summary.marked > 0 && <span className="ml-auto font-medium text-slate-700">{summary.pct}% present</span>}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[10px] text-slate-500">
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-success-500" /> Present</span>
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-danger-500" /> Absent</span>
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-info-500" /> Leave</span>
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-marigold-600" /> Late</span>
      </div>
    </div>
  );
}

// Compact attendance donut.
function MiniDonut({ pct, marked }: { pct: number; marked: number }) {
  const size = 58, stroke = 7, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
  const color = !marked ? '#cbd5e1' : pct >= 90 ? '#1F8A4C' : pct >= 75 ? '#C97A0A' : '#C7322E';
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="flex-shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset 400ms' }} />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" style={{ fontSize: 14, fontWeight: 700, fill: '#0f141b' }}>{marked ? `${pct}%` : '—'}</text>
    </svg>
  );
}

// ---------- One child card: avatar + donut + fee + Attendance / Fees ----------
function ChildCard({ child, fee }: { child: Child; fee: FeeData | null }) {
  const [view, setView] = useState<'attendance' | 'fees'>('attendance');
  const t = STATUS_META[child.todayStatus] || STATUS_META.none;
  const last14 = child.days?.slice(-14) || [];
  const balance = fee?.summary.totalBalance;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* gradient header w/ circular avatar */}
      <div className="flex items-center gap-3 p-4 bg-gradient-to-br from-purple-50 to-white">
        <div className="w-12 h-12 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold flex-shrink-0 ring-2 ring-white shadow">
          {initials(child.name)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-slate-900 truncate">{child.name}</div>
          <div className="text-xs text-slate-500">{child.className}{child.roll ? ` · Roll ${child.roll}` : ''}</div>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${t.chip}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} /> {t.label}
        </span>
      </div>

      {/* donut + fee cards */}
      <div className="grid grid-cols-2 gap-2 px-4">
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 flex items-center gap-3">
          <MiniDonut pct={child.pct} marked={child.marked} />
          <div className="text-[11px] leading-tight">
            <div className="font-semibold text-slate-700 mb-0.5">This month</div>
            <div className="text-success-700">{child.present} present</div>
            <div className="text-danger-700">{child.absent} absent</div>
            {child.leave > 0 && <div className="text-info-700">{child.leave} leave</div>}
          </div>
        </div>
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 flex flex-col justify-center">
          <div className="text-[11px] text-slate-500">Fee balance</div>
          <div className={`text-xl font-bold tabular-nums ${balance && balance > 0 ? 'text-danger-700' : 'text-success-700'}`}>{balance != null ? feeMoney(balance) : '—'}</div>
          {fee && <div className="text-[10px] text-slate-400 mt-0.5">of {feeMoney(fee.summary.totalCharged)} · paid {feeMoney(fee.summary.totalPaid)}</div>}
        </div>
      </div>

      {/* last 2 weeks strip */}
      <div className="px-4 pt-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Last 2 weeks</span>
          <div className="flex items-center gap-2 text-[10px] text-slate-400">
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-success-500" />P</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-danger-500" />A</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-info-500" />L</span>
          </div>
        </div>
        <div className="flex gap-1">
          {last14.map((d) => {
            const m = STATUS_META[d.status] || STATUS_META.none;
            return <div key={d.date} title={`${d.date} · ${m.label}`} className={`flex-1 h-6 rounded ${d.status === 'none' ? 'bg-slate-100' : m.cell}`} />;
          })}
        </div>
      </div>

      {/* toggle */}
      <div className="px-4 pt-3 pb-1">
        <div className="grid grid-cols-2 gap-1 bg-slate-100 rounded-lg p-1">
          {(['attendance', 'fees'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`py-1.5 text-xs font-semibold rounded-md transition-colors ${view === v ? 'bg-white text-purple-700 shadow-sm' : 'text-slate-500'}`}>
              {v === 'attendance' ? 'Attendance' : 'Fees'}
            </button>
          ))}
        </div>
      </div>

      {view === 'attendance' ? <ChildCalendar studentId={child.id} /> : <ChildFees data={fee} loading={false} />}
    </div>
  );
}

// ---------- Fee summary for one child ----------
interface FeeData {
  year: string;
  summary: { totalCharged: number; totalPaid: number; totalBalance: number; concession: number; heads: { key: string; name: string; balance: number }[] };
  payments: { id: string; receiptNo: string; total: number; paidAt: string }[];
  concessions: { feeTypeName: string; amount: number; status: string }[];
}

function ChildFees({ data, loading }: { data: FeeData | null; loading: boolean }) {
  if (loading) return <div className="px-4 py-4 border-t border-slate-100"><div className="h-24 bg-slate-100 rounded-lg animate-pulse" /></div>;
  if (!data) return <div className="px-4 py-6 border-t border-slate-100 text-sm text-slate-400 text-center">No fees on record.</div>;

  const s = data.summary;
  return (
    <div className="px-4 py-3 border-t border-slate-100">
      <div className="grid grid-cols-3 gap-2 mb-3">
        {[
          { l: 'Total fee', v: s.totalCharged, c: 'text-slate-900' },
          { l: 'Paid', v: s.totalPaid, c: 'text-success-700' },
          { l: 'Balance', v: s.totalBalance, c: 'text-danger-700' },
        ].map((b) => (
          <div key={b.l} className="rounded-lg bg-slate-50 px-2 py-2 text-center">
            <div className={`text-sm font-bold tabular-nums ${b.c}`}>{feeMoney(b.v)}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">{b.l}</div>
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        {s.heads.map((h) => (
          <div key={h.key} className="flex items-center justify-between text-sm">
            <span className="text-slate-700">{h.name}</span>
            {h.balance > 0
              ? <span className="text-danger-700 font-medium tabular-nums">{feeMoney(h.balance)} due</span>
              : <span className="text-success-600 text-xs font-medium">Paid</span>}
          </div>
        ))}
      </div>

      {data.concessions?.length > 0 && (
        <div className="mt-2 text-[11px] text-info-700">
          Concession: {data.concessions.map((c) => `${c.feeTypeName} ${feeMoney(c.amount)}${c.status === 'PENDING' ? ' (pending)' : ''}`).join(', ')}
        </div>
      )}

      {data.payments?.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="text-[11px] font-semibold text-slate-500 mb-1.5">Recent payments</div>
          <div className="space-y-1.5">
            {data.payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-xs">
                <span className="text-slate-500 font-mono truncate">{p.receiptNo}</span>
                <span className="text-slate-400">{new Date(p.paidAt).toLocaleDateString('en-IN')}</span>
                <span className="font-semibold tabular-nums text-slate-900">{feeMoney(p.total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 text-[11px] text-slate-400 text-center">{s.totalBalance > 0 ? 'Please pay the balance at the school office.' : 'All fees cleared. Thank you!'}</div>
    </div>
  );
}

// ---------- Top summary banner ----------
function SummaryBanner({ n, avgPct, totalDue, withDues }: { n: number; avgPct: number; totalDue: number; withDues: number }) {
  const stats = [
    { icon: 'Users', label: n === 1 ? 'Child' : 'Children', value: String(n), tone: 'text-slate-900', bg: 'bg-purple-100 text-purple-700' },
    { icon: 'CalendarCheck', label: 'Avg attendance', value: avgPct ? `${avgPct}%` : '—', tone: !avgPct ? 'text-slate-400' : avgPct >= 90 ? 'text-success-700' : avgPct >= 75 ? 'text-marigold-700' : 'text-danger-700', bg: 'bg-success-100 text-success-700' },
    { icon: 'Wallet', label: withDues ? `${withDues} with dues` : 'All cleared', value: feeMoney(totalDue), tone: totalDue > 0 ? 'text-danger-700' : 'text-success-700', bg: 'bg-marigold-100 text-marigold-700' },
  ];
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 grid grid-cols-3 divide-x divide-slate-100">
      {stats.map((s) => (
        <div key={s.label} className="flex flex-col items-center px-1 text-center">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-1 ${s.bg}`}><Icon name={s.icon as any} size={16} /></div>
          <div className={`text-base font-bold tabular-nums ${s.tone}`}>{s.value}</div>
          <div className="text-[10px] text-slate-500">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

// ---------- Home (children) screen ----------
function HomeScreen() {
  const [children, setChildren] = useState<Child[] | null>(null);
  const [feesById, setFeesById] = useState<Record<string, FeeData>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/parent/children');
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        const kids: Child[] = (await res.json()).children;
        setChildren(kids);
        const entries = await Promise.all(
          kids.map(async (c) => {
            const r = await fetch(`/api/parent/fees?studentId=${c.id}`);
            return [c.id, r.ok ? await r.json() : null] as const;
          })
        );
        setFeesById(Object.fromEntries(entries.filter((e) => e[1])) as Record<string, FeeData>);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <>{[0, 1].map((i) => (
    <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4 animate-pulse">
      <div className="h-12 bg-slate-100 rounded-lg" /><div className="h-40 bg-slate-100 rounded-lg mt-3" />
    </div>
  ))}</>;
  if (error) return <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center"><Icon name="AlertCircle" size={40} className="text-slate-300 mx-auto" /><p className="text-sm text-slate-600 mt-3">{error}</p></div>;
  if (children?.length === 0) return (
    <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
      <div className="text-4xl">👨‍👩‍👧</div>
      <h2 className="text-base font-semibold text-slate-900 mt-3">No children linked</h2>
      <p className="text-sm text-slate-500 mt-1">Your account isn&apos;t linked to any students yet. Please contact the school office.</p>
    </div>
  );

  const kids = children || [];
  const markedKids = kids.filter((c) => c.marked > 0);
  const avgPct = markedKids.length ? Math.round(markedKids.reduce((t, c) => t + c.pct, 0) / markedKids.length) : 0;
  const feeList = Object.values(feesById);
  const totalDue = feeList.reduce((t, f) => t + f.summary.totalBalance, 0);
  const withDues = feeList.filter((f) => f.summary.totalBalance > 0).length;

  return (
    <>
      <PushOptIn />
      <SummaryBanner n={kids.length} avgPct={avgPct} totalDue={totalDue} withDues={withDues} />
      {kids.map((c) => <ChildCard key={c.id} child={c} fee={feesById[c.id] || null} />)}
    </>
  );
}

// ---------- Circulars screen ----------
const CAT_TONE: Record<string, string> = {
  Event: 'bg-purple-100 text-purple-700',
  Exam: 'bg-info-100 text-info-700',
  Holiday: 'bg-success-100 text-success-700',
  Notice: 'bg-marigold-100 text-marigold-700',
  Fees: 'bg-danger-100 text-danger-700',
};
function CircularsScreen() {
  const [items, setItems] = useState<any[] | null>(null);
  useEffect(() => { (async () => { const r = await fetch('/api/parent/circulars'); if (r.ok) setItems((await r.json()).circulars); else setItems([]); })(); }, []);
  if (!items) return <div className="h-40 bg-white rounded-2xl border border-slate-200 animate-pulse" />;
  if (items.length === 0) return <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500"><Icon name="Megaphone" size={36} className="text-slate-300 mx-auto mb-2" />No circulars yet.</div>;
  return (
    <>
      {items.map((c) => (
        <div key={c.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1.5">
            {c.category && <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${CAT_TONE[c.category] || 'bg-slate-100 text-slate-600'}`}>{c.category}</span>}
            {c.pinned && <span className="inline-flex items-center gap-1 text-[11px] text-purple-600"><Icon name="Pin" size={12} /> Pinned</span>}
            <span className="ml-auto text-[11px] text-slate-400">{new Date(c.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
          </div>
          <h3 className="font-semibold text-slate-900">{c.title}</h3>
          <p className="text-sm text-slate-600 mt-1 whitespace-pre-line">{c.body}</p>
        </div>
      ))}
    </>
  );
}

// ---------- Photos screen ----------
function PhotosScreen() {
  const [albums, setAlbums] = useState<any[] | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  useEffect(() => { (async () => { const r = await fetch('/api/parent/photos'); if (r.ok) setAlbums((await r.json()).albums); else setAlbums([]); })(); }, []);
  if (!albums) return <div className="h-48 bg-white rounded-2xl border border-slate-200 animate-pulse" />;
  if (albums.length === 0) return <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500"><Icon name="Image" size={36} className="text-slate-300 mx-auto mb-2" />No photos yet.</div>;
  return (
    <>
      {albums.map((a) => (
        <div key={a.name} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="font-semibold text-slate-900 text-sm">{a.name}</span>
            <span className="text-[11px] text-slate-400">{a.photos.length} photos</span>
          </div>
          <div className="grid grid-cols-3 gap-1 p-1">
            {a.photos.map((ph: any) => (
              <button key={ph.id} onClick={() => setZoom(ph.url)} className="aspect-square overflow-hidden bg-slate-100">
                <img src={ph.url} alt={ph.caption || ''} loading="lazy" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      ))}
      {zoom && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setZoom(null)}>
          <img src={zoom} alt="" className="max-w-full max-h-full rounded-lg" />
          <button className="absolute top-4 right-4 text-white/80 p-2" onClick={() => setZoom(null)}><Icon name="X" size={24} /></button>
        </div>
      )}
    </>
  );
}

// ---------- Marks / report card screen ----------
interface ReportSubject { name: string; marks: number | null; isAbsent: boolean; max: number; grade: string | null; gradeOnly: boolean }
interface ReportAssessment { id: string; name: string; type: 'FORMATIVE' | 'SUMMATIVE'; term: string | null; subjects: ReportSubject[]; totalObtained: number; totalMax: number; percent: number | null; grade: string | null }
interface Report { year: string; student: { id: string; name: string; className: string | null; section: string | null }; assessments: ReportAssessment[]; hasGrades: boolean }

function marksInitials(name: string) {
  return name.split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

// Load an image for canvas use, CORS-enabled so it doesn't taint the canvas.
// Resolves null on any failure (then we just skip the logo).
function loadCanvasImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// Draw one assessment result as a shareable PNG (no external libraries).
async function renderResultImage(rep: Report, a: ReportAssessment, brand: { schoolName: string; logoUrl: string | null }): Promise<Blob> {
  const isSA = a.type === 'SUMMATIVE';
  const W = 720, PAD = 28, rowH = 46, headerH = 208, totalH = 58, footerH = 46;
  const H = headerH + a.subjects.length * rowH + totalH + footerH;
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = W * scale; canvas.height = H * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  const rr = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    if ((ctx as any).roundRect) (ctx as any).roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  };

  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);

  // Header band
  const grad = ctx.createLinearGradient(0, 0, W, headerH);
  if (isSA) { grad.addColorStop(0, '#6366f1'); grad.addColorStop(1, '#7c3aed'); }
  else { grad.addColorStop(0, '#f59e0b'); grad.addColorStop(1, '#b45309'); }
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, headerH);

  // School logo (best-effort) at top-left; the brand line shifts right when present.
  const logo = brand.logoUrl ? await loadCanvasImage(brand.logoUrl) : null;
  let brandX = PAD;
  if (logo) {
    const ls = 30;
    ctx.fillStyle = 'rgba(255,255,255,0.95)'; rr(PAD, 18, ls, ls, 6); ctx.fill();
    try { ctx.drawImage(logo, PAD + 3, 21, ls - 6, ls - 6); } catch {}
    brandX = PAD + ls + 8;
  }
  const cls = (rep.student.className || '').replace(/\s?STD$/i, '');
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '600 15px Arial'; ctx.textAlign = 'left';
  ctx.fillText(`${brand.schoolName}  ·  ${cls}${rep.student.section ? ' ' + rep.student.section : ''}  ·  ${rep.year}`, brandX, 38);
  ctx.fillStyle = '#ffffff'; ctx.font = '700 30px Arial';
  ctx.fillText(truncateText(ctx, rep.student.name, W - PAD * 2 - 150), PAD, 80);

  const badge = isSA ? 'SA' : 'FA';
  ctx.font = '700 14px Arial';
  const bw = ctx.measureText(badge).width + 18;
  ctx.fillStyle = 'rgba(255,255,255,0.25)'; rr(PAD, 96, bw, 24, 6); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.fillText(badge, PAD + 9, 113);
  ctx.font = '600 18px Arial';
  ctx.fillText(`${a.name}${a.term ? '  ·  ' + a.term : ''}`, PAD + bw + 12, 114);

  if (a.percent != null) {
    ctx.textAlign = 'right'; ctx.font = '800 44px Arial'; ctx.fillStyle = '#ffffff';
    ctx.fillText(`${a.percent}%`, W - PAD, 86);
    if (a.grade) {
      ctx.font = '700 16px Arial';
      const gw = ctx.measureText(a.grade).width + 18;
      ctx.fillStyle = '#ffffff'; rr(W - PAD - gw, 98, gw, 26, 6); ctx.fill();
      ctx.fillStyle = isSA ? '#4338ca' : '#92400e'; ctx.textAlign = 'center';
      ctx.fillText(a.grade, W - PAD - gw / 2, 116);
    }
    const barY = 152, barW = W - PAD * 2, barH = 10;
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; rr(PAD, barY, barW, barH, 5); ctx.fill();
    ctx.fillStyle = '#ffffff'; rr(PAD, barY, barW * Math.min(100, Math.max(0, a.percent)) / 100, barH, 5); ctx.fill();
  }

  let y = headerH;
  a.subjects.forEach((s, i) => {
    if (i % 2 === 1) { ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, y, W, rowH); }
    ctx.fillStyle = '#334155'; ctx.textAlign = 'left'; ctx.font = '500 17px Arial';
    ctx.fillText(truncateText(ctx, s.name, W * 0.55), PAD, y + 30);
    ctx.textAlign = 'right';
    const val = s.isAbsent ? 'AB' : (s.gradeOnly ? (s.grade || '—') : `${s.marks}/${s.max}`);
    ctx.fillStyle = s.isAbsent ? '#dc2626' : '#0f172a'; ctx.font = '600 17px Arial';
    ctx.fillText(val, W - PAD, y + 30);
    y += rowH;
  });

  ctx.fillStyle = '#f1f5f9'; ctx.fillRect(0, y, W, totalH);
  ctx.fillStyle = '#0f172a'; ctx.textAlign = 'left'; ctx.font = '700 19px Arial';
  ctx.fillText('Total', PAD, y + 37);
  ctx.textAlign = 'right';
  ctx.fillText(`${a.totalObtained}/${a.totalMax}`, W - PAD, y + 37);
  y += totalH;

  ctx.fillStyle = '#94a3b8'; ctx.textAlign = 'center'; ctx.font = '400 13px Arial';
  ctx.fillText(`Shared from ${brand.schoolName} · Parent app`, W / 2, y + 28);

  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('render failed'))), 'image/png'),
  );
}

function MarksScreen() {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const brand = useBranding();

  // Share the result as an IMAGE via the native share sheet (WhatsApp, etc.);
  // on desktop / where file-share isn't supported, the image is downloaded.
  const shareResult = async (rep: Report, a: ReportAssessment) => {
    try {
      const blob = await renderResultImage(rep, a, brand);
      const file = new File([blob], `${rep.student.name.replace(/\s+/g, '_')}-${a.name}.png`, { type: 'image/png' });
      const nav = navigator as any;
      if (nav.canShare?.({ files: [file] }) && nav.share) {
        await nav.share({ files: [file], title: `${rep.student.name} — ${a.name}` });
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = file.name;
        document.body.appendChild(link); link.click(); link.remove();
        URL.revokeObjectURL(url);
        setCopiedId(a.id);
        setTimeout(() => setCopiedId(null), 2000);
      }
    } catch {
      /* user dismissed the share sheet, or rendering failed — ignore */
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/parent/children');
        if (!res.ok) throw new Error('Failed to load');
        const kids: { id: string }[] = (await res.json()).children;
        const list = await Promise.all(
          kids.map(async (c) => {
            const r = await fetch(`/api/parent/marks?studentId=${c.id}`);
            return r.ok ? ((await r.json()) as Report) : null;
          })
        );
        setReports(list.filter(Boolean) as Report[]);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      }
    })();
  }, []);

  if (error) return <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-600"><Icon name="AlertCircle" size={36} className="text-slate-300 mx-auto mb-2" />{error}</div>;
  if (!reports) return <div className="h-48 bg-white rounded-2xl border border-slate-200 animate-pulse" />;
  if (reports.length === 0) return (
    <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
      <Icon name="GraduationCap" size={40} className="text-slate-300 mx-auto" />
      <p className="text-sm text-slate-600 mt-3">No children linked to your account.</p>
    </div>
  );

  return (
    <>
      {reports.map((rep) => (
        <div key={rep.student.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center text-sm font-bold flex-shrink-0">{marksInitials(rep.student.name)}</div>
            <div className="min-w-0">
              <div className="font-semibold text-slate-900 truncate">{rep.student.name}</div>
              <div className="text-xs text-slate-500">{(rep.student.className || '').replace(/\s?STD$/i, '')}{rep.student.section ? ` · ${rep.student.section}` : ''} · {rep.year}</div>
            </div>
          </div>

          {rep.assessments.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-400">
              <Icon name="FileClock" size={32} className="text-slate-300 mx-auto mb-2" />
              No results published yet.
            </div>
          ) : (
            rep.assessments.map((a) => {
              const isSA = a.type === 'SUMMATIVE';
              const grad = isSA ? 'from-indigo-500 to-purple-600' : 'from-marigold-500 to-marigold-700';
              return (
                <div key={a.id} className="border-b last:border-b-0 border-slate-100">
                  {/* Gradient result header */}
                  <div className={`bg-gradient-to-r ${grad} text-white px-4 py-3`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] font-extrabold tracking-wide px-1.5 py-0.5 rounded bg-white/25">{isSA ? 'SA' : 'FA'}</span>
                        <span className="text-sm font-bold truncate">{a.name}</span>
                        {a.term && <span className="text-[11px] text-white/75 truncate">{a.term}</span>}
                      </div>
                      <button
                        onClick={() => shareResult(rep, a)}
                        className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold bg-white/20 hover:bg-white/30 active:bg-white/40 rounded-full px-2.5 py-1 transition-colors"
                        title="Share result"
                      >
                        <Icon name={copiedId === a.id ? 'Check' : 'Share2'} size={13} />
                        {copiedId === a.id ? 'Saved' : 'Share'}
                      </button>
                    </div>
                    {a.percent != null && (
                      <div className="mt-2.5 flex items-center gap-2.5">
                        <div className="flex-1 h-1.5 rounded-full bg-white/25 overflow-hidden">
                          <div className="h-full bg-white rounded-full" style={{ width: `${Math.max(0, Math.min(100, a.percent))}%` }} />
                        </div>
                        <span className="text-lg font-extrabold tabular-nums leading-none">{a.percent}%</span>
                        {a.grade && <span className="text-[11px] font-extrabold px-1.5 py-0.5 rounded bg-white text-slate-900">{a.grade}</span>}
                      </div>
                    )}
                  </div>
                  {/* Subjects */}
                  <div>
                    {a.subjects.map((s) => (
                      <div key={s.name} className="flex items-center justify-between px-4 py-2 text-sm border-t border-slate-50">
                        <span className="text-slate-700 truncate">{s.name}{s.gradeOnly && <span className="ml-1.5 text-[10px] text-slate-400">(grade)</span>}</span>
                        <div className="flex items-center gap-2.5 flex-shrink-0">
                          {s.gradeOnly ? (
                            <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 min-w-[24px] text-center">{s.isAbsent ? 'AB' : (s.grade || '—')}</span>
                          ) : (
                            <>
                              <span className={`tabular-nums ${s.isAbsent ? 'text-danger-600 font-semibold' : 'text-slate-900 font-medium'}`}>{s.isAbsent ? 'AB' : `${s.marks}/${s.max}`}</span>
                              {s.grade && <span className="text-[10px] font-bold w-6 text-center text-slate-500">{s.grade}</span>}
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                    <div className="flex items-center justify-between px-4 py-2.5 text-sm font-bold bg-slate-50 border-t border-slate-100">
                      <span className="text-slate-700">Total</span>
                      <span className="tabular-nums text-slate-900">{a.totalObtained}<span className="font-medium text-slate-400">/{a.totalMax}</span></span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      ))}
      <p className="text-[11px] text-slate-400 text-center px-4">Only results approved and published by the school are shown.</p>
    </>
  );
}

type ParentTab = 'home' | 'marks' | 'circulars' | 'photos';

export default function ParentPage() {
  const { data: session } = useSession();
  const brand = useBranding();
  const [tab, setTab] = useState<ParentTab>('home');

  // Unread-circular badge (per-device, via localStorage).
  const [circularTimes, setCircularTimes] = useState<number[]>([]);
  const [seenAt, setSeenAt] = useState(0);
  useEffect(() => {
    setSeenAt(Number(localStorage.getItem('circularsSeenAt') || 0));
    fetch('/api/parent/circulars')
      .then((r) => (r.ok ? r.json() : { circulars: [] }))
      .then((d) => setCircularTimes((d.circulars || []).map((c: any) => new Date(c.publishedAt).getTime())))
      .catch(() => {});
  }, []);
  const unreadCirculars = circularTimes.filter((t) => t > seenAt).length;
  const selectTab = (k: ParentTab) => {
    if (k === 'circulars') {
      const now = Date.now();
      localStorage.setItem('circularsSeenAt', String(now));
      setSeenAt(now);
    }
    setTab(k);
  };

  const surface = (session?.user as any)?.surface as string | undefined;
  const isStaff = !!surface && surface !== 'PARENT'; // also has a staff role → can switch

  const firstName = session?.user?.name?.split(' ')[0] || 'Parent';
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  const handleSignOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    signOut({ callbackUrl: '/' });
  };

  const heading = tab === 'home' ? `${greeting}, ${firstName}` : tab === 'marks' ? 'Report card' : tab === 'circulars' ? 'Circulars' : 'Photos';

  const NAV: { k: ParentTab; label: string; icon: string }[] = [
    { k: 'home', label: 'Home', icon: 'House' },
    { k: 'marks', label: 'Marks', icon: 'GraduationCap' },
    { k: 'circulars', label: 'Circulars', icon: 'Megaphone' },
    { k: 'photos', label: 'Photos', icon: 'Image' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <header className="sticky top-0 z-10 bg-gradient-to-br from-purple-700 to-purple-500 text-white px-4 pt-5 pb-6">
        <div className="max-w-md mx-auto flex items-start justify-between">
          <div>
            <div className="text-xs text-purple-100/90 flex items-center gap-1.5">
              {brand.logoUrl && <img src={brand.logoUrl} alt="" className="w-4 h-4 rounded-sm object-contain bg-white/90 p-px" />}
              {brand.schoolName} · Parent
            </div>
            <h1 className="text-xl font-bold mt-0.5">{heading}</h1>
            {tab === 'home' && (
              <div className="text-xs text-purple-100/80 mt-0.5">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
            )}
          </div>
          <div className="flex items-center gap-1">
            {isStaff && (
              <a href="/admin/dashboard" className="inline-flex items-center gap-1.5 text-xs font-medium text-white bg-white/15 hover:bg-white/25 rounded-lg px-2.5 py-1.5 transition-colors" title="Switch to staff workspace">
                <Icon name="LayoutDashboard" size={15} />
                <span className="hidden xs:inline">Staff</span>
              </a>
            )}
            <button onClick={handleSignOut} className="p-2 -mr-2 rounded-lg hover:bg-white/10" title="Sign out">
              <Icon name="LogOut" size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-5 space-y-4">
        {tab === 'home' && <HomeScreen />}
        {tab === 'marks' && <MarksScreen />}
        {tab === 'circulars' && <CircularsScreen />}
        {tab === 'photos' && <PhotosScreen />}
      </main>

      <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 z-20">
        <div className="max-w-md mx-auto grid grid-cols-4">
          {NAV.map((t) => (
            <button key={t.k} onClick={() => selectTab(t.k)}
              className={`relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors ${tab === t.k ? 'text-purple-700' : 'text-slate-400 hover:text-slate-600'}`}>
              <span className="relative">
                <Icon name={t.icon as any} size={20} />
                {t.k === 'circulars' && unreadCirculars > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-danger-500 text-white text-[10px] font-bold flex items-center justify-center">{unreadCirculars > 9 ? '9+' : unreadCirculars}</span>
                )}
              </span>
              {t.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
