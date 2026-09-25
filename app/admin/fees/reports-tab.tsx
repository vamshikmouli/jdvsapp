'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useSession } from 'next-auth/react';
import { PageHeader, Button, Card, Select, Input, Field, Drawer, Modal, EmptyState, Skeleton, TableRowSkeleton, Avatar, Chip, Th, sortRows, nextSort, type SortState } from '@/components/Primitives';
import { Icon } from '@/components/Icon';
import { downloadBackup } from '@/lib/utils';
import { feeMoney, statusTone, statusLabel, PAY_METHODS, PAY_METHOD_LABEL, type ChargeStatus, type AccountSummary } from '@/lib/fees';
import { CLASSES, CLASS_ID_BY_KEY, CLASS_KEY_BY_ID, VILLAGE_VAN_FEES, type Gender as FeeGender, type ClassKey } from '@/lib/feeStructure';
import { UNIFORM_ITEM_DEFS, itemsForFromMatrix, type UniformMatrix } from '@/lib/uniformMatrix';
import { CollectDrawer, PaymentTimeline, type Account } from './account-ui';
import { MultiCollectDrawer } from './multi-collect-ui';
import { useBranding } from '@/components/useBranding';
import { CollectionSettingsPanel } from './collection-settings';
import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query';
import { shortClass } from './_shared';

/* ============================ Reports ============================ */

interface ReportData {
  year: { id: string; label: string };
  collectedTotal: number;
  paymentCount: number;
  byHead: { key: string; name: string; amount: number }[];
  byClass: { name: string; amount: number }[];
  byVillage: { name: string; amount: number }[];
  byMethod: { method: string; amount: number }[];
  byDayMethods: Record<string, { method: string; amount: number }[]>;
  byDay: { day: string; amount: number }[];
  outstanding: { id: string; name: string; className: string | null; balance: number }[];
  outstandingTotal: number;
  notPaidInRange: { id: string; name: string; className: string | null; balance: number }[];
  notPaidInRangeTotal: number;
  notPaidInRangeCount: number;
  rangeActive: boolean;
  billedTotal: number;
  collectedAllTotal: number;
  withDues: number;
  classSummary: { classId: string | null; name: string; billed: number; collected: number; pending: number; students: number; withDues: number }[];
  oldFeeCollected: number;
  oldFeePending: number;
  uniformCollected: number;
  uniformPending: number;
  uniformItems: { name: string; collected: number; pending: number }[];
  uniformPendingStudents: { id: string; name: string; className: string | null; balance: number }[];
  vanByVillage: { village: string; count: number; charged: number; collected: number; pending: number; students: { id: string; name: string; className: string | null; charged: number; paid: number; pending: number }[] }[];
  concessionTotal: number;
  concessionByHead: { name: string; amount: number }[];
  concessionStudents: { id: string; name: string; className: string | null; amount: number }[];
  oldDue: { id: string; name: string; className: string | null; amount: number; paid: number; balance: number }[];
  oldDueUnpaid: { id: string; name: string; className: string | null; amount: number; paid: number; balance: number }[];
  installmentDue: { id: string; name: string; className: string | null; label: string; dueDate: string | null; balance: number; status: ChargeStatus }[];
}

export function ReportsTab() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [headDrill, setHeadDrill] = useState<{ key: string; name: string } | null>(null);
  const [classDrill, setClassDrill] = useState<{ classId: string; name: string } | null>(null);
  const [uniformDrill, setUniformDrill] = useState(false);
  const [concessionDrill, setConcessionDrill] = useState(false);
  const [dayDrill, setDayDrill] = useState<string | null>(null);
  const [vanDrill, setVanDrill] = useState<ReportData['vanByVillage'][number] | null>(null);

  // Cached per date range. Reports are the heaviest query on the throttled VM;
  // re-opening the tab or toggling a drawer no longer re-runs the aggregation.
  const reportsUrl = (() => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return `/api/fees/reports?${params}`;
  })();
  const { data, isLoading } = useQuery({
    queryKey: ['fees', 'reports', from, to],
    queryFn: () => jsonFetcher<ReportData>(reportsUrl),
  });
  const loading = isLoading;

  const thisMonth = () => {
    const now = new Date();
    setFrom(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
    setTo(new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10));
  };
  const clearRange = () => { setFrom(''); setTo(''); };

  if (loading || !data) return <div className="mt-6 space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={44} />)}</div>;

  const rate = data.billedTotal > 0 ? Math.round((data.collectedAllTotal / data.billedTotal) * 100) : 0;

  return (
    <div className="mt-6 space-y-5">
      {/* Year overview — compact KPI strip (denser than the old hero, more data) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {([
          { label: `Collected · ${data.year.label}`, value: feeMoney(data.collectedAllTotal), icon: 'IndianRupee', bar: 'bg-purple-500', badge: 'bg-purple-100 text-purple-700', sub: `${rate}% of billed` },
          { label: 'Billed (year)', value: feeMoney(data.billedTotal), icon: 'ReceiptText', bar: 'bg-slate-400', badge: 'bg-slate-100 text-slate-700' },
          { label: 'Outstanding', value: feeMoney(data.outstandingTotal), icon: 'AlertCircle', bar: 'bg-danger-500', badge: 'bg-danger-100 text-danger-700', sub: `${data.withDues} student${data.withDues === 1 ? '' : 's'}` },
          { label: 'Collection rate', value: `${rate}%`, icon: 'TrendingUp', bar: 'bg-purple-500', badge: 'bg-purple-100 text-purple-700', pct: rate },
          { label: 'Uniform collected', value: feeMoney(data.uniformCollected), icon: 'Shirt', bar: 'bg-info-500', badge: 'bg-info-100 text-info-700', sub: data.uniformPending > 0 ? `${feeMoney(data.uniformPending)} pending` : 'fully paid' },
          { label: 'Old fee collected', value: feeMoney(data.oldFeeCollected), icon: 'History', bar: 'bg-success-500', badge: 'bg-success-100 text-success-700' },
          { label: 'Old fee pending', value: feeMoney(data.oldFeePending), icon: 'History', bar: 'bg-danger-500', badge: 'bg-danger-100 text-danger-700' },
          { label: 'Uniform pending', value: feeMoney(data.uniformPending), icon: 'Shirt', bar: 'bg-danger-500', badge: 'bg-danger-100 text-danger-700' },
        ] as { label: string; value: string; icon: string; bar: string; badge: string; sub?: string; pct?: number }[]).map((k) => (
          <div key={k.label} className="relative bg-white border border-slate-200 rounded-2xl shadow-xs px-3.5 py-3 overflow-hidden">
            <span className={`absolute left-0 top-0 bottom-0 w-1 ${k.bar}`} aria-hidden />
            <div className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${k.badge}`}><Icon name={k.icon as any} size={15} /></div>
              <div className="text-[10.5px] text-slate-500 leading-tight">{k.label}</div>
            </div>
            <div className="text-lg font-bold text-slate-900 leading-none tabular-nums mt-2 truncate">{k.value}</div>
            {k.sub && <div className="text-[10.5px] text-slate-400 mt-1">{k.sub}</div>}
            {typeof k.pct === 'number' && <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full rounded-full ${k.bar}`} style={{ width: `${Math.min(100, k.pct)}%` }} /></div>}
          </div>
        ))}
      </div>

      {/* range filter — collection within a date range (also drives "not paid in range") */}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Button size="sm" onClick={thisMonth}>This month</Button>
          <Button size="sm" onClick={clearRange}>Whole year</Button>
          <div className="ml-auto text-right">
            <div className="text-2xl font-bold text-purple-600 tabular-nums">{feeMoney(data.collectedTotal)}</div>
            <div className="text-xs text-slate-500">{data.paymentCount} payments {from || to ? 'in range' : `· year ${data.year.label}`}</div>
          </div>
        </div>
        {data.rangeActive && (
          <p className="text-[12px] text-slate-500 mt-3 pt-3 border-t border-slate-100">
            Set a range (e.g. 20 May → today) to see the <b className="text-danger-700">{data.notPaidInRangeCount}</b> student{data.notPaidInRangeCount === 1 ? '' : 's'} who owe money and made <b>no payment</b> in that period — listed below.
          </p>
        )}
      </Card>

      {/* Who hasn't paid in the selected range (with dues, zero payments in range) */}
      {data.rangeActive && (
        <Card padded={false} title={<div className="flex items-center justify-between w-full">
          <span className="inline-flex items-center gap-2"><Icon name="UserX" size={16} className="text-danger-600" /> Not paid {from ? `since ${new Date(from).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}{to ? ` – ${new Date(to).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}</span>
          <span className="text-sm font-normal"><span className="text-slate-500">{data.notPaidInRangeCount} student{data.notPaidInRangeCount === 1 ? '' : 's'} · </span><span className="text-danger-700 font-semibold tabular-nums">{feeMoney(data.notPaidInRangeTotal)}</span></span>
        </div>}>
          <ReportRows
            head={['Student', 'Class', 'Outstanding']}
            rows={data.notPaidInRange.map((r) => [r.name + '  ·  ' + r.id, shortClass(r.className), feeMoney(r.balance)])}
            empty="Everyone with dues has paid something in this range 🎉"
          />
        </Card>
      )}

      {/* Class-wise: collected vs pending, with headcounts. Click a class → its students. */}
      <ClassBreakdown rows={data.classSummary} onClass={(r) => setClassDrill({ classId: r.classId || 'unassigned', name: r.name })} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <BarList title="Collection by fee head" icon="Layers" accent="purple"
          rows={data.byHead} empty="No collection yet" onRow={(r) => setHeadDrill({ key: r.key!, name: r.name })} />
        <BarList title="Collection by payment mode" icon="Wallet" accent="info"
          rows={data.byMethod.map((m) => ({ name: PAY_METHOD_LABEL[m.method as keyof typeof PAY_METHOD_LABEL] || m.method, amount: m.amount }))} empty="No collection yet" />
        <BarList title="Daily collection" icon="CalendarDays" accent="success"
          rows={data.byDay.map((r) => ({ key: r.day, name: new Date(r.day).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }), amount: r.amount }))}
          empty="No collection yet" onRow={(r) => setDayDrill(r.key!)} />
      </div>

      {/* Uniform — collected per item (White Uniform, School Uniform…) + pending drill-down */}
      <Card padded={false} title={<div className="flex items-center justify-between w-full">
        <span className="inline-flex items-center gap-2"><Icon name="Shirt" size={16} className="text-info-600" /> Uniform — collected by item</span>
        <span className="text-sm font-normal"><span className="text-success-700 font-semibold tabular-nums">{feeMoney(data.uniformCollected)}</span><span className="text-slate-400"> collected</span></span>
      </div>}>
        {data.uniformItems.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-slate-400">No uniform collection yet.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[360px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                    <th className="text-left font-semibold px-4 py-2">Item</th>
                    <th className="text-right font-semibold px-4 py-2">Collected</th>
                    <th className="text-right font-semibold px-4 py-2">Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {data.uniformItems.map((u) => (
                    <tr key={u.name} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-2 text-slate-800">{u.name}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-success-700 font-medium">{feeMoney(u.collected)}</td>
                      <td className={`px-4 py-2 text-right tabular-nums ${u.pending > 0 ? 'text-danger-700' : 'text-slate-400'}`}>{feeMoney(u.pending)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-200 font-semibold">
                    <td className="px-4 py-2 text-slate-900">Total</td>
                    <td className="px-4 py-2 text-right tabular-nums text-success-700">{feeMoney(data.uniformCollected)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-danger-700">{feeMoney(data.uniformPending)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {data.uniformPendingStudents.length > 0 && (
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-slate-100 bg-slate-50/50">
                <span className="text-[12.5px] text-slate-500">{data.uniformPendingStudents.length} student{data.uniformPendingStudents.length === 1 ? '' : 's'} owe uniform · {feeMoney(data.uniformPending)}</span>
                <Button size="sm" icon="ListChecks" onClick={() => setUniformDrill(true)}>View pending students</Button>
              </div>
            )}
          </>
        )}
      </Card>

      {/* Van fee by village — van students only */}
      {data.vanByVillage.length > 0 && (
        <Card padded={false} title={<div className="flex items-center justify-between w-full">
          <span className="inline-flex items-center gap-2"><Icon name="Bus" size={16} className="text-purple-600" /> Van fee by village <span className="text-slate-400 font-normal">(van students only)</span></span>
          <span className="text-sm font-normal"><span className="text-success-700 font-semibold tabular-nums">{feeMoney(data.vanByVillage.reduce((t, v) => t + v.collected, 0))}</span><span className="text-slate-400"> collected</span></span>
        </div>}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[420px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                  <th className="text-left font-semibold px-4 py-2">Village</th>
                  <th className="text-right font-semibold px-4 py-2">Students</th>
                  <th className="text-right font-semibold px-4 py-2">Collected</th>
                  <th className="text-right font-semibold px-4 py-2">Pending</th>
                </tr>
              </thead>
              <tbody>
                {data.vanByVillage.map((v) => (
                  <tr key={v.village} onClick={() => setVanDrill(v)} className="border-b border-slate-50 last:border-0 cursor-pointer hover:bg-purple-50/40">
                    <td className="px-4 py-2 text-slate-800"><span className="inline-flex items-center gap-1.5">{v.village}<Icon name="ChevronRight" size={13} className="text-slate-300" /></span></td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600">{v.count}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-success-700 font-medium">{feeMoney(v.collected)}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${v.pending > 0 ? 'text-danger-700' : 'text-slate-400'}`}>{feeMoney(v.pending)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 font-semibold">
                  <td className="px-4 py-2 text-slate-900">Total</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-700">{data.vanByVillage.reduce((t, v) => t + v.count, 0)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-success-700">{feeMoney(data.vanByVillage.reduce((t, v) => t + v.collected, 0))}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-danger-700">{feeMoney(data.vanByVillage.reduce((t, v) => t + v.pending, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      {/* Concessions given (fee waived) — by head + which students */}
      {data.concessionTotal > 0 && (
        <Card padded={false} title={<div className="flex items-center justify-between w-full">
          <span className="inline-flex items-center gap-2"><Icon name="BadgePercent" size={16} className="text-info-600" /> Concessions given <span className="text-slate-400 font-normal">(fee waived)</span></span>
          <span className="text-sm font-normal"><span className="text-info-700 font-semibold tabular-nums">{feeMoney(data.concessionTotal)}</span></span>
        </div>}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[320px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                  <th className="text-left font-semibold px-4 py-2">Fee head</th>
                  <th className="text-right font-semibold px-4 py-2">Concession</th>
                </tr>
              </thead>
              <tbody>
                {data.concessionByHead.map((h) => (
                  <tr key={h.name} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-2 text-slate-800">{h.name}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-info-700 font-medium">{feeMoney(h.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 font-semibold">
                  <td className="px-4 py-2 text-slate-900">Total</td>
                  <td className="px-4 py-2 text-right tabular-nums text-info-700">{feeMoney(data.concessionTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {data.concessionStudents.length > 0 && (
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-slate-100 bg-slate-50/50">
              <span className="text-[12.5px] text-slate-500">{data.concessionStudents.length} student{data.concessionStudents.length === 1 ? '' : 's'} got a concession</span>
              <Button size="sm" icon="ListChecks" onClick={() => setConcessionDrill(true)}>View students</Button>
            </div>
          )}
        </Card>
      )}

      {/* Old fee — who hasn't paid yet */}
      <Card padded={false} title={<div className="flex items-center justify-between w-full">
        <span className="inline-flex items-center gap-2"><Icon name="History" size={16} className="text-danger-600" /> Old fee — not paid yet</span>
        <span className="text-sm font-normal">
          <span className="text-slate-500">{data.oldDueUnpaid.length} student{data.oldDueUnpaid.length === 1 ? '' : 's'} · </span>
          <span className="text-danger-700 font-semibold tabular-nums">{feeMoney(data.oldFeePending)}</span>
        </span>
      </div>}>
        <ReportRows
          head={['Student', 'Class', 'Old fee', 'Paid', 'Pending']}
          rows={data.oldDueUnpaid.map((r) => [`${r.name}  ·  ${r.id}`, shortClass(r.className), feeMoney(r.amount), feeMoney(r.paid), feeMoney(r.balance)])}
          empty="No pending old fees 🎉"
        />
      </Card>

      <Card padded={false} title={<div className="flex items-center justify-between w-full">
        <span className="inline-flex items-center gap-2"><Icon name="AlertCircle" size={16} className="text-danger-600" /> Outstanding fees</span>
        <span className="text-sm font-normal"><span className="text-slate-500">{data.withDues} student{data.withDues === 1 ? '' : 's'} · </span><span className="text-danger-700 font-semibold tabular-nums">{feeMoney(data.outstandingTotal)}</span></span>
      </div>}>
        <ReportRows
          head={['Student', 'Class', 'Balance']}
          rows={data.outstanding.map((r) => [r.name + '  ·  ' + r.id, shortClass(r.className), feeMoney(r.balance)])}
          empty="Everyone is paid up 🎉"
        />
      </Card>

      <Card padded={false} title={<div className="flex items-center justify-between w-full">
        <span className="inline-flex items-center gap-2"><Icon name="CalendarClock" size={16} className="text-marigold-600" /> Installments due</span>
        <span className="text-sm font-normal text-slate-500">{data.installmentDue.length} pending</span>
      </div>}>
        <ReportRows head={['Student', 'Installment', 'Balance']} rows={data.installmentDue.map((r) => [r.name, `${r.label}${r.dueDate ? ' · ' + r.dueDate : ''}`, feeMoney(r.balance)])} empty="No pending installments" />
      </Card>

      {headDrill && <HeadPaymentsDrawer headKey={headDrill.key} headName={headDrill.name} from={from} to={to} onClose={() => setHeadDrill(null)} />}
      {classDrill && <ClassStudentsDrawer classId={classDrill.classId} className={classDrill.name} onClose={() => setClassDrill(null)} />}
      {uniformDrill && (
        <Drawer open onClose={() => setUniformDrill(false)} title="Uniform pending" width={520}
          subtitle={`${data.uniformPendingStudents.length} student(s) · ${feeMoney(data.uniformPending)}`}
          footer={<div className="flex justify-end"><Button onClick={() => setUniformDrill(false)}>Close</Button></div>}>
          <ReportRows
            head={['Student', 'Class', 'Pending']}
            rows={data.uniformPendingStudents.map((r) => [`${r.name}  ·  ${r.id}`, shortClass(r.className), feeMoney(r.balance)])}
            empty="No uniform dues 🎉"
          />
        </Drawer>
      )}
      {dayDrill && <DayCollectionDrawer date={dayDrill} onClose={() => setDayDrill(null)} />}
      {vanDrill && (
        <Drawer open onClose={() => setVanDrill(null)} title={`Van — ${vanDrill.village}`} width={560}
          subtitle={`${vanDrill.count} student${vanDrill.count === 1 ? '' : 's'} · ${feeMoney(vanDrill.collected)} collected · ${feeMoney(vanDrill.pending)} pending`}
          footer={<div className="flex justify-end"><Button onClick={() => setVanDrill(null)}>Close</Button></div>}>
          <div className="rounded-lg border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm min-w-[440px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                  <th className="text-left font-semibold px-3 py-2">Student</th>
                  <th className="text-right font-semibold px-3 py-2">Van fee</th>
                  <th className="text-right font-semibold px-3 py-2">Paid</th>
                  <th className="text-right font-semibold px-3 py-2">Pending</th>
                </tr>
              </thead>
              <tbody>
                {vanDrill.students.map((st) => (
                  <tr key={st.id} className="border-t border-slate-100">
                    <td className="px-3 py-2"><div className="text-slate-900">{st.name}</div><div className="text-[11px] text-slate-400">{shortClass(st.className)} · {st.id}</div></td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{feeMoney(st.charged)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-success-700">{feeMoney(st.paid)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${st.pending > 0 ? 'text-danger-700 font-medium' : 'text-slate-400'}`}>{feeMoney(st.pending)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Drawer>
      )}
      {concessionDrill && (
        <Drawer open onClose={() => setConcessionDrill(false)} title="Concessions given" width={520}
          subtitle={`${data.concessionStudents.length} student(s) · ${feeMoney(data.concessionTotal)}`}
          footer={<div className="flex justify-end"><Button onClick={() => setConcessionDrill(false)}>Close</Button></div>}>
          <ReportRows
            head={['Student', 'Class', 'Concession']}
            rows={data.concessionStudents.map((r) => [`${r.name}  ·  ${r.id}`, shortClass(r.className), feeMoney(r.amount)])}
            empty="No concessions"
          />
        </Drawer>
      )}
    </div>
  );
}

// Drill-down: students who paid toward a fee head, by date.
// Drill-down: who paid on a given day — receipts + payment-mode totals.
function DayCollectionDrawer({ date, onClose }: { date: string; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ['fees', 'day-collection', date],
    queryFn: () => jsonFetcher<{ date: string; total: number; count: number; rows: { studentId: string; student: string; className: string | null; amount: number; mode: string; receiptNo: string }[]; byMethod: { method: string; amount: number }[] }>(`/api/fees/reports/day-collection?date=${encodeURIComponent(date)}`),
  });
  const dayLabel = new Date(date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <Drawer open onClose={onClose} title="Who paid on this day" width={560}
      subtitle={data ? `${dayLabel} · ${data.count} receipt${data.count === 1 ? '' : 's'} · ${feeMoney(data.total)}` : dayLabel}
      footer={<div className="flex justify-end"><Button onClick={onClose}>Close</Button></div>}>
      {!data ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={40} />)}</div>
      ) : (
        <div className="space-y-4">
          {/* mode totals */}
          <div className="flex flex-wrap gap-2">
            {data.byMethod.map((m) => (
              <span key={m.method} className="inline-flex items-center gap-1.5 rounded-lg border border-info-100 bg-info-50 px-3 py-1.5 text-[13px]">
                <Icon name="Wallet" size={13} className="text-info-600" /><span className="text-slate-600">{PAY_METHOD_LABEL[m.method as keyof typeof PAY_METHOD_LABEL] || m.method}</span>
                <span className="font-semibold tabular-nums text-slate-900">{feeMoney(m.amount)}</span>
              </span>
            ))}
          </div>
          {/* who paid */}
          {data.rows.length === 0 ? (
            <EmptyState icon="ReceiptText" title="No collection" body="No payments were recorded on this day." />
          ) : (
            <div className="rounded-lg border border-slate-200 overflow-x-auto">
              <table className="w-full text-sm min-w-[460px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                    <th className="text-left font-semibold px-3 py-2">Student</th>
                    <th className="text-left font-semibold px-3 py-2">Mode</th>
                    <th className="text-right font-semibold px-3 py-2">Amount</th>
                    <th className="text-left font-semibold px-3 py-2">Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-3 py-2"><div className="text-slate-900">{r.student}</div><div className="text-[11px] text-slate-400">{shortClass(r.className)}</div></td>
                      <td className="px-3 py-2 text-slate-600 text-[12.5px]">{r.mode}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-900">{feeMoney(r.amount)}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{r.receiptNo}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-200 font-semibold">
                    <td className="px-3 py-2 text-slate-900" colSpan={2}>Total</td>
                    <td className="px-3 py-2 text-right tabular-nums text-success-700">{feeMoney(data.total)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

function HeadPaymentsDrawer({ headKey, headName, from, to, onClose }: { headKey: string; headName: string; from: string; to: string; onClose: () => void }) {
  const headUrl = (() => {
    const p = new URLSearchParams({ headKey });
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    return `/api/fees/reports/head-payments?${p}`;
  })();
  const { data, error: queryError } = useQuery({
    queryKey: ['fees', 'head-payments', headKey, from, to],
    queryFn: () => jsonFetcher<{ headName: string; total: number; count: number; rows: { studentId: string; student: string; className: string | null; date: string; amount: number; receiptNo: string; method: string; label: string }[] }>(headUrl),
  });
  const error = queryError ? (queryError instanceof Error ? queryError.message : 'Failed to load') : '';

  const rangeLabel = from || to ? `${from || '…'} → ${to || '…'}` : 'Whole year';

  return (
    <Drawer open onClose={onClose} title={headName} subtitle={`Who paid · ${rangeLabel}`} width={620}
      footer={<div className="flex justify-end"><Button onClick={onClose}>Close</Button></div>}>
      {!data && !error && <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={40} />)}</div>}
      {error && <EmptyState icon="AlertCircle" title="Couldn't load" body={error} />}
      {data && (
        <>
          <div className="flex items-center justify-between mb-3 text-sm">
            <span className="text-slate-500">{data.count} payment{data.count === 1 ? '' : 's'}</span>
            <span className="font-bold tabular-nums text-slate-900">{feeMoney(data.total)}</span>
          </div>
          {data.rows.length === 0 ? (
            <EmptyState icon="ReceiptText" title="No payments to this head" body="Nothing was collected for this fee head in the selected range." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="text-left font-semibold px-3 py-2">Date</th>
                    <th className="text-left font-semibold px-3 py-2">Student</th>
                    <th className="text-left font-semibold px-3 py-2">Class</th>
                    <th className="text-right font-semibold px-3 py-2">Amount</th>
                    <th className="text-left font-semibold px-3 py-2">Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-3 py-2 whitespace-nowrap text-slate-700">{new Date(r.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}</td>
                      <td className="px-3 py-2"><div className="text-slate-900">{r.student}</div>{r.label && !/^tuition|software|id\s*card/i.test(r.label) && <div className="text-[11px] text-slate-400">{r.label}</div>}</td>
                      <td className="px-3 py-2 text-slate-600">{shortClass(r.className)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-900">{feeMoney(r.amount)}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{r.receiptNo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}

// Drill-down: each student in a class with their paid & pending for the year.
function ClassStudentsDrawer({ classId, className, onClose }: { classId: string; className: string; onClose: () => void }) {
  const { data, error: queryError } = useQuery({
    queryKey: ['fees', 'class-students', classId],
    queryFn: () => jsonFetcher<{ className: string; students: { id: string; name: string; billed: number; paid: number; pending: number }[]; totals: { billed: number; paid: number; pending: number } }>(`/api/fees/reports/class-students?classId=${encodeURIComponent(classId)}`),
  });
  const error = queryError ? (queryError instanceof Error ? queryError.message : 'Failed to load') : '';

  return (
    <Drawer open onClose={onClose} title={shortClass(className) || 'Class'} subtitle="Each student — paid & pending" width={620}
      footer={<div className="flex justify-end"><Button onClick={onClose}>Close</Button></div>}>
      {!data && !error && <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} height={40} />)}</div>}
      {error && <EmptyState icon="AlertCircle" title="Couldn't load" body={error} />}
      {data && (
        <>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[
              { label: 'Billed', value: feeMoney(data.totals.billed), tone: 'text-slate-900' },
              { label: 'Paid', value: feeMoney(data.totals.paid), tone: 'text-success-700' },
              { label: 'Pending', value: feeMoney(data.totals.pending), tone: data.totals.pending > 0 ? 'text-danger-700' : 'text-slate-400' },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-center">
                <div className={`text-base font-bold tabular-nums ${s.tone}`}>{s.value}</div>
                <div className="text-[11px] uppercase tracking-wide text-slate-400 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
          {data.students.length === 0 ? (
            <EmptyState icon="Users" title="No students" body="No students in this class." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 sticky top-0">
                  <tr>
                    <th className="text-left font-semibold px-3 py-2">Student</th>
                    <th className="text-right font-semibold px-3 py-2">Paid</th>
                    <th className="text-right font-semibold px-3 py-2">Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {data.students.map((s) => (
                    <tr key={s.id} className="border-t border-slate-100 odd:bg-slate-50/40">
                      <td className="px-3 py-2"><div className="text-slate-900">{s.name}</div><div className="text-[11px] text-slate-400 font-mono">{s.id}</div></td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-success-700">{feeMoney(s.paid)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-semibold ${s.pending > 0 ? 'text-danger-700' : 'text-slate-400'}`}>{feeMoney(s.pending)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}

// A breakdown list where each row carries a proportional bar — turns a plain
// column of numbers into an at-a-glance visual. Optionally clickable (drill-down).
const BAR_ACCENT: Record<string, { bar: string; chip: string }> = {
  purple: { bar: 'bg-purple-500', chip: 'bg-purple-100 text-purple-700' },
  info: { bar: 'bg-info-500', chip: 'bg-info-100 text-info-700' },
  marigold: { bar: 'bg-marigold-500', chip: 'bg-marigold-100 text-marigold-700' },
  success: { bar: 'bg-success-500', chip: 'bg-success-100 text-success-700' },
};
function BarList({ title, icon, accent = 'purple', rows, empty, onRow }: {
  title: string; icon: string; accent?: keyof typeof BAR_ACCENT;
  rows: { key?: string; name: string; amount: number }[]; empty: string;
  onRow?: (r: { key?: string; name: string; amount: number }) => void;
}) {
  const a = BAR_ACCENT[accent] || BAR_ACCENT.purple;
  const total = rows.reduce((t, r) => t + r.amount, 0);
  const max = Math.max(1, ...rows.map((r) => r.amount));
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <span className={`w-7 h-7 rounded-lg grid place-items-center ${a.chip}`}><Icon name={icon as any} size={15} /></span>
          <span className="text-sm font-bold text-slate-900">{title}</span>
        </div>
        {rows.length > 0 && <span className="text-xs font-semibold tabular-nums text-slate-500">{feeMoney(total)}</span>}
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-slate-400">{empty}</div>
      ) : (
        <div className="p-2 max-h-96 overflow-y-auto">
          {rows.map((r, i) => (
            <div key={r.key || i} onClick={onRow ? () => onRow(r) : undefined}
              className={`group rounded-lg px-3 py-2 transition-colors ${onRow ? 'cursor-pointer hover:bg-slate-50' : ''}`}
              title={onRow ? 'Show who paid, by date' : undefined}>
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <span className="text-[13px] text-slate-700 truncate">{r.name}</span>
                <span className="text-[13px] font-semibold tabular-nums text-slate-900 whitespace-nowrap flex items-center gap-1">
                  {feeMoney(r.amount)}
                  {onRow && <Icon name="ChevronRight" size={13} className="text-slate-300 group-hover:text-purple-400" />}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div className={`h-full rounded-full ${a.bar}`} style={{ width: `${Math.max(3, (r.amount / max) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Class-wise detail: billed / collected / pending, a collected-vs-pending bar,
// and how many students still owe. The core "who's behind, by class" view.
function ClassBreakdown({ rows, onClass }: { rows: { classId: string | null; name: string; billed: number; collected: number; pending: number; students: number; withDues: number }[]; onClass?: (r: { classId: string | null; name: string }) => void }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <span className="w-7 h-7 rounded-lg grid place-items-center bg-info-100 text-info-700"><Icon name="GraduationCap" size={15} /></span>
          <span className="text-sm font-bold text-slate-900">Class-wise collection &amp; pending</span>
        </div>
        <span className="text-xs text-slate-400">{rows.length} class{rows.length === 1 ? '' : 'es'}</span>
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-slate-400">No data yet</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left font-semibold px-5 py-2.5">Class</th>
                <th className="text-right font-semibold px-4 py-2.5">Students</th>
                <th className="text-right font-semibold px-4 py-2.5">Collected</th>
                <th className="text-right font-semibold px-4 py-2.5">Pending</th>
                <th className="text-left font-semibold px-4 py-2.5 w-[170px]">Progress</th>
                {onClass && <th className="px-2" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pct = r.billed > 0 ? Math.round((r.collected / r.billed) * 100) : 100;
                return (
                  <tr key={r.name} onClick={onClass ? () => onClass({ classId: r.classId, name: r.name }) : undefined}
                    className={`group border-t border-slate-100 transition-colors ${onClass ? 'cursor-pointer hover:bg-purple-50/40' : 'hover:bg-slate-50/60'}`}
                    title={onClass ? 'Show each student — paid & pending' : undefined}>
                    <td className="px-5 py-2.5 font-medium text-slate-800 whitespace-nowrap">{shortClass(r.name)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                      {r.students}
                      {r.withDues > 0 && <span className="ml-1.5 inline-flex items-center rounded-full bg-danger-50 text-danger-700 text-[10.5px] font-semibold px-1.5 py-0.5">{r.withDues} due</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-success-700">{feeMoney(r.collected)}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${r.pending > 0 ? 'text-danger-700' : 'text-slate-400'}`}>{feeMoney(r.pending)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-danger-100 overflow-hidden min-w-[70px]">
                          <div className="h-full rounded-full bg-success-500" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[11px] tabular-nums text-slate-500 w-9 text-right">{pct}%</span>
                      </div>
                    </td>
                    {onClass && <td className="px-2 text-right"><Icon name="ChevronRight" size={15} className="text-slate-300 group-hover:text-purple-400" /></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ReportRows({ head, rows, empty }: { head: string[]; rows: string[][]; empty: string }) {
  if (rows.length === 0) return <div className="py-8"><EmptyState icon="CheckCircle2" title={empty} /></div>;
  return (
    <div className="overflow-x-auto max-h-96 overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur">
          <tr className="text-[11px] uppercase tracking-wide text-slate-500">
            {head.map((h, i) => <th key={i} className={`font-semibold px-6 py-2.5 border-b border-slate-200 ${i === head.length - 1 ? 'text-right' : 'text-left'}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100 odd:bg-slate-50/40 hover:bg-purple-50/40 transition-colors">
              {r.map((cell, j) => <td key={j} className={`px-6 py-2 ${j === r.length - 1 ? 'text-right tabular-nums font-semibold text-slate-900' : 'text-slate-700'}`}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
