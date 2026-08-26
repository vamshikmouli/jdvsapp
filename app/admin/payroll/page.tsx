'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Button, Chip, Select, EmptyState, Skeleton } from '@/components/Primitives';
import { Icon } from '@/components/Icon';

interface RunSummary { id: string; periodMonth: string; status: string; creditOn: string; staffCount: number; netTotal: number; paidCount: number }
interface Item {
  id: string; staffName: string; designation: string | null; accountNo: string | null; ifsc: string | null; attendanceTracked: boolean;
  presentDays: number; halfDays: number; paidLeaveDays: number; unpaidLeaveDays: number; absentDays: number;
  holidayDays: number; weeklyOffDays: number; lopDays: number;
  grossSalary: number; lopAmount: number; pfAmount: number; esiAmount: number; esiApplicable?: boolean; otherDeductions: number; bonus: number; netSalary: number;
  status: string; paidAt: string | null;
}
interface RunDetail { id: string; periodMonth: string; status: string; creditOn: string; note: string | null; items: Item[] }

const rupee = (n: number) => '₹' + (n || 0).toLocaleString('en-IN');
const rupeeK = (n: number) => (n >= 100000 ? '₹' + (n / 100000).toFixed(2) + 'L' : rupee(n));
function monthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function prevMonthKey() {
  const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const statusTone = (s: string) => (s === 'PAID' ? 'success' : s === 'APPROVED' ? 'info' : 'warn') as any;
// The "Net" = gross − LOP − other deductions + bonus. This is the ESI base.
const netPre = (it: Item) => it.grossSalary - it.lopAmount - it.otherDeductions + it.bonus;
function fmtDateTime(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
}
function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?';
}
// Deterministic soft avatar colour from the name.
const AV = ['bg-purple-100 text-purple-700', 'bg-info-100 text-info-700', 'bg-success-100 text-success-700', 'bg-marigold-100 text-marigold-700', 'bg-rose-100 text-rose-700'];
const avatarColor = (s: string) => AV[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % AV.length];

export default function PayrollPage() {
  const { data: session } = useSession();
  const perms = ((session?.user as any)?.perms as string[]) || [];
  const canManage = perms.includes('PAYROLL_MANAGE');
  const canView = canManage || perms.includes('PAYROLL_VIEW');

  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selId, setSelId] = useState<string>('');
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [month, setMonth] = useState(prevMonthKey());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [payslip, setPayslip] = useState<Item | null>(null);
  const [branding, setBranding] = useState<{ schoolName: string; logoUrl: string | null }>({ schoolName: 'Jnana Deepika', logoUrl: null });

  useEffect(() => { fetch('/api/branding').then((r) => r.json()).then(setBranding).catch(() => {}); }, []);

  const downloadBankFile = () => {
    if (!detail) return;
    const a = document.createElement('a');
    a.href = `/api/payroll/${detail.id}/bank-csv`;
    a.download = `canara-salary-${detail.periodMonth}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  };

  const loadRuns = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/payroll');
    if (res.ok) {
      const rs: RunSummary[] = await res.json();
      setRuns(rs);
      setSelId((cur) => cur || rs[0]?.id || '');
    }
    setLoading(false);
  }, []);
  useEffect(() => { if (canView) loadRuns(); }, [canView, loadRuns]);

  const loadDetail = useCallback(async (id: string) => {
    if (!id) { setDetail(null); return; }
    const res = await fetch(`/api/payroll/${id}`);
    if (res.ok) setDetail(await res.json());
  }, []);
  useEffect(() => { loadDetail(selId); }, [selId, loadDetail]);

  const generate = async () => {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/payroll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ periodMonth: month }) });
      const j = await res.json();
      if (!res.ok) { if (j.runId) setSelId(j.runId); throw new Error(j.error || 'Failed'); }
      await loadRuns(); setSelId(j.id);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const runAction = async (action: string) => {
    if (!detail) return;
    if ((action === 'delete' && !confirm('Delete this payroll run? This cannot be undone.')) ||
        (action === 'payAll' && !confirm('Mark ALL rows as paid? Do this only after the bank transfer is done.'))) return;
    setBusy(true); setError('');
    try {
      const res = await fetch(`/api/payroll/${detail.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Failed');
      if (action === 'delete') { setSelId(''); setDetail(null); await loadRuns(); }
      else { await loadDetail(detail.id); await loadRuns(); }
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const patchItem = async (id: string, body: any) => {
    const res = await fetch(`/api/payroll/item/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) { const updated: Item = await res.json(); setDetail((d) => d ? { ...d, items: d.items.map((it) => it.id === id ? updated : it) } : d); loadRuns(); }
  };

  if (!canView) return <EmptyState icon="Lock" title="Not available" body="You don't have permission to view payroll." />;

  const totals = detail?.items.reduce((a, it) => ({
    gross: a.gross + it.grossSalary, netPre: a.netPre + netPre(it), lop: a.lop + it.lopAmount,
    other: a.other + it.otherDeductions, bonus: a.bonus + it.bonus, pf: a.pf + it.pfAmount,
    esi: a.esi + it.esiAmount, net: a.net + it.netSalary,
  }), { gross: 0, netPre: 0, lop: 0, other: 0, bonus: 0, pf: 0, esi: 0, net: 0 });
  const paidCount = detail?.items.filter((it) => it.status === 'PAID').length || 0;
  const totalCount = detail?.items.length || 0;
  const deductions = totals ? totals.lop + totals.other + totals.pf + totals.esi - totals.bonus : 0;
  const noBank = detail?.items.filter((it) => !it.accountNo).length || 0;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      {/* Header + toolbar */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Payroll</h1>
          <p className="text-sm text-slate-500 mt-0.5">Salary register from attendance — the app computes &amp; tracks, you make the transfers.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {canManage && (
            <div className="flex items-end gap-2 rounded-xl bg-white border border-slate-200 p-2 shadow-sm">
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1 px-1">Salary month</label>
                <input type="month" value={month} max={prevMonthKey()} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-purple-400 focus:ring-2 focus:ring-purple-100 outline-none" />
              </div>
              <Button kind="primary" icon="Plus" disabled={busy} onClick={generate}>Generate</Button>
            </div>
          )}
          {runs.length > 0 && (
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1 px-1">View run</label>
              <Select value={selId} onChange={(e) => setSelId(e.target.value)}>
                {runs.map((r) => <option key={r.id} value={r.id}>{monthLabel(r.periodMonth)} · {r.status}</option>)}
              </Select>
            </div>
          )}
        </div>
      </div>

      {error && <div className="rounded-xl bg-danger-50 border border-danger-100 text-danger-700 text-sm px-4 py-3 flex items-center gap-2"><Icon name="TriangleAlert" size={16} />{error}</div>}

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={92} />)}</div>
          <Skeleton height={280} />
        </div>
      ) : !detail ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-16">
          <EmptyState icon="Wallet" title="No payroll run yet" body={canManage ? 'Pick a salary month above and hit Generate to build the register.' : 'No runs available.'} />
        </div>
      ) : (
        <>
          {/* Summary stat cards */}
          {totals && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-2xl p-4 text-white shadow-sm bg-gradient-to-br from-purple-600 to-purple-500">
                <div className="flex items-center gap-1.5 text-purple-100 text-xs font-medium"><Icon name="Wallet" size={14} /> Total payable</div>
                <div className="text-2xl font-bold mt-1.5 tracking-tight">{rupee(totals.net)}</div>
                <div className="text-[11px] text-purple-100 mt-0.5">Credit on {new Date(detail.creditOn).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>
              </div>
              <StatCard icon="Users" label="Staff" value={String(totalCount)} sub={noBank > 0 ? `${noBank} missing bank details` : 'all have bank details'} subTone={noBank > 0 ? 'danger' : 'ok'} />
              <StatCard icon="Banknote" label="Gross" value={rupeeK(totals.gross)} sub={`net ${rupeeK(totals.netPre)} before PF/ESI`} />
              <StatCard icon="TrendingDown" label="Deductions" value={rupeeK(deductions)} sub={`LOP ${rupeeK(totals.lop)} · PF+ESI ${rupeeK(totals.pf + totals.esi)}`} />
            </div>
          )}

          {/* Register card */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            {/* Toolbar row */}
            <div className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60">
              <div className="flex items-center gap-3">
                <div className="font-semibold text-slate-900">{monthLabel(detail.periodMonth)}</div>
                <Chip tone={statusTone(detail.status)}>{detail.status}</Chip>
                {totalCount > 0 && (
                  <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500">
                    <div className="h-1.5 w-24 rounded-full bg-slate-200 overflow-hidden">
                      <div className="h-full bg-success-500 transition-all" style={{ width: `${Math.round((paidCount / totalCount) * 100)}%` }} />
                    </div>
                    {paidCount}/{totalCount} paid
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" kind="secondary" icon="Download" onClick={downloadBankFile}>Bank file</Button>
                {canManage && detail.status === 'DRAFT' && <Button size="sm" kind="primary" icon="CheckCheck" disabled={busy} onClick={() => runAction('approve')}>Approve</Button>}
                {canManage && detail.status === 'APPROVED' && <><Button size="sm" kind="tertiary" disabled={busy} onClick={() => runAction('reopen')}>Reopen</Button><Button size="sm" kind="primary" icon="Check" disabled={busy} onClick={() => runAction('payAll')}>Mark all paid</Button></>}
                {canManage && detail.status !== 'PAID' && <Button size="sm" kind="tertiary" icon="Trash2" disabled={busy} onClick={() => runAction('delete')}>Delete</Button>}
              </div>
            </div>

            {/* Register table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[980px] border-separate border-spacing-0">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 bg-white">
                    <th className="px-5 py-3 font-semibold sticky left-0 bg-white z-10">Staff</th>
                    <th className="px-4 py-3 font-semibold text-right">Gross / Net</th>
                    <th className="px-4 py-3 font-semibold text-right">Payable</th>
                    <th className="px-4 py-3 font-semibold text-center">Status</th>
                    <th className="px-4 py-3 font-semibold">Attendance</th>
                    <th className="px-4 py-3 font-semibold text-right">LOP</th>
                    <th className="px-4 py-3 font-semibold text-right">PF / ESI</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((it, i) => {
                    const editable = canManage && it.status !== 'PAID';
                    const paid = it.status === 'PAID';
                    return (
                      <tr key={it.id} className={`group border-t border-slate-50 ${paid ? 'bg-success-50/30' : i % 2 ? 'bg-slate-50/30' : ''} hover:bg-purple-50/40 transition-colors`}>
                        {/* Staff */}
                        <td className="px-5 py-3 sticky left-0 bg-inherit group-hover:bg-purple-50/40">
                          <div className="flex items-center gap-3">
                            <div className={`h-9 w-9 rounded-full grid place-items-center text-xs font-bold shrink-0 ${avatarColor(it.staffName)}`}>{initials(it.staffName)}</div>
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-900 truncate">{it.staffName}</div>
                              <div className="text-xs text-slate-400 truncate tabular-nums">
                                {it.accountNo || <span className="text-danger-500">no bank details</span>}
                              </div>
                            </div>
                          </div>
                        </td>
                        {/* Gross / Net */}
                        <td className="px-4 py-3 text-right tabular-nums">
                          <div className="font-medium text-slate-800">{rupee(it.grossSalary)}</div>
                          <div className="text-xs text-slate-400" title="Net = gross − LOP − other + bonus (ESI base)">net {rupee(netPre(it))}</div>
                        </td>
                        {/* Payable */}
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <span className={`tabular-nums font-bold text-[15px] ${paid ? 'text-success-600' : 'text-slate-900'}`}>{rupee(it.netSalary)}</span>
                            <button onClick={() => setPayslip(it)} title="View payslip" className="text-slate-300 hover:text-purple-600 transition-colors"><Icon name="ReceiptText" size={16} /></button>
                          </div>
                        </td>
                        {/* Status */}
                        <td className="px-4 py-3 text-center">
                          {paid
                            ? <div className="inline-flex flex-col items-center leading-tight">
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-success-700 bg-success-50 px-2 py-1 rounded-full"><Icon name="CircleCheck" size={13} /> Paid</span>
                                {it.paidAt && <span className="text-[10px] text-slate-400 mt-0.5">{fmtDateTime(it.paidAt)}</span>}
                              </div>
                            : canManage && detail.status !== 'DRAFT'
                              ? <button onClick={() => patchItem(it.id, { paid: true })} className="text-xs font-semibold text-purple-700 hover:text-white hover:bg-purple-600 border border-purple-200 hover:border-purple-600 px-2.5 py-1 rounded-full transition-colors">Mark paid</button>
                              : <Chip tone={statusTone(it.status)}>{it.status}</Chip>}
                        </td>
                        {/* Attendance */}
                        <td className="px-4 py-3">
                          {!it.attendanceTracked ? (
                            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-slate-100 text-slate-500" title="Off-campus / driver — not attendance tracked"><Icon name="CarFront" size={12} /> Full pay</span>
                          ) : (
                            <div className="flex flex-wrap gap-1 text-[11px]">
                              <span className="px-1.5 py-0.5 rounded-md bg-success-50 text-success-700 font-medium" title="Present (incl. late)">P {it.presentDays}</span>
                              {it.halfDays > 0 && <span className="px-1.5 py-0.5 rounded-md bg-marigold-50 text-marigold-700 font-medium" title="Half days">½ {it.halfDays}</span>}
                              {it.paidLeaveDays > 0 && <span className="px-1.5 py-0.5 rounded-md bg-info-50 text-info-700 font-medium" title="Paid leave">PL {it.paidLeaveDays}</span>}
                              {it.unpaidLeaveDays > 0 && <span className="px-1.5 py-0.5 rounded-md bg-danger-50 text-danger-700 font-medium" title="Unpaid leave">UL {it.unpaidLeaveDays}</span>}
                              {it.absentDays > 0 && <span className="px-1.5 py-0.5 rounded-md bg-danger-50 text-danger-700 font-medium" title="Absent">A {it.absentDays}</span>}
                            </div>
                          )}
                        </td>
                        {/* LOP */}
                        <td className="px-4 py-3 text-right tabular-nums">{it.lopAmount ? <span className="text-danger-600">−{rupee(it.lopAmount)}</span> : <span className="text-slate-300">—</span>}</td>
                        {/* PF / ESI */}
                        <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap text-xs">
                          {it.pfAmount ? <div className="text-slate-500" title="PF 12%">PF <span className="text-slate-700">−{rupee(it.pfAmount)}</span></div> : null}
                          {it.esiAmount ? <div className="text-slate-500" title="ESI 0.75% of net">ESI <span className="text-slate-700">−{rupee(it.esiAmount)}</span></div> : null}
                          {!it.pfAmount && !it.esiAmount ? <span className="text-slate-300">—</span> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {totals && (
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50/70 font-semibold text-slate-900">
                      <td className="px-5 py-3.5 sticky left-0 bg-slate-50/70">Total · {totalCount} staff</td>
                      <td className="px-4 py-3.5 text-right tabular-nums">
                        <div>{rupee(totals.gross)}</div>
                        <div className="text-xs font-normal text-slate-400">net {rupee(totals.netPre)}</div>
                      </td>
                      <td className="px-4 py-3.5 text-right tabular-nums text-purple-700 text-[15px]">{rupee(totals.net)}</td>
                      <td className="px-4 py-3.5 text-center text-xs font-normal text-slate-400">{paidCount}/{totalCount} paid</td>
                      <td className="px-4 py-3.5"></td>
                      <td className="px-4 py-3.5 text-right tabular-nums text-danger-600">{totals.lop ? '−' + rupee(totals.lop) : '—'}</td>
                      <td className="px-4 py-3.5 text-right tabular-nums text-xs text-slate-600 whitespace-nowrap">
                        {totals.pf ? <div>PF −{rupee(totals.pf)}</div> : null}
                        {totals.esi ? <div>ESI −{rupee(totals.esi)}</div> : null}
                        {!totals.pf && !totals.esi ? '—' : null}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}

      {payslip && detail && (
        <PayslipModal
          item={payslip}
          period={monthLabel(detail.periodMonth)}
          creditOn={new Date(detail.creditOn).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
          branding={branding}
          onClose={() => setPayslip(null)}
        />
      )}
    </div>
  );
}

function PayslipModal({ item, period, creditOn, branding, onClose }: {
  item: Item; period: string; creditOn: string; branding: { schoolName: string; logoUrl: string | null }; onClose: () => void;
}) {
  const gross = item.grossSalary;
  const basic = Math.round(gross * 0.5);
  const hra = Math.round(basic * 0.4);
  const allowances = gross - basic - hra;
  const net = gross - item.lopAmount - item.otherDeductions + item.bonus; // ESI base
  const totalDed = item.lopAmount + item.otherDeductions + item.pfAmount + item.esiAmount;
  const totalEarn = gross + item.bonus;
  const esiOn = item.esiApplicable || item.esiAmount > 0;
  const employerEsi = esiOn ? Math.round(0.0325 * net) : 0;

  const earnings: [string, number][] = [
    ['Basic Salary (50% of gross)', basic],
    ['HRA (40% of basic)', hra],
    ['Other Allowances', allowances],
  ];
  if (item.bonus) earnings.push(['Bonus / Allowance', item.bonus]);
  const deductions: [string, number][] = [];
  if (item.esiAmount) deductions.push([`ESI (0.75% of ${rupee(net)})`, item.esiAmount]);
  if (item.pfAmount) deductions.push(['PF (12%)', item.pfAmount]);
  if (item.otherDeductions) deductions.push(['Other (LIC etc.)', item.otherDeductions]);
  if (item.lopAmount) deductions.push([`Loss of pay (${item.lopDays}d)`, item.lopAmount]);
  const rowsN = Math.max(earnings.length, deductions.length);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-auto p-4 print:p-0 print:bg-white" onClick={onClose}>
      <style>{`@media print { body * { visibility: hidden !important; } #payslip-print, #payslip-print * { visibility: visible !important; } #payslip-print { position: absolute; left: 0; top: 0; width: 100%; } .no-print { display: none !important; } }`}</style>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-6 print:my-0 print:shadow-none print:max-w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-slate-100 no-print">
          <div className="font-semibold text-slate-900">Payslip</div>
          <div className="flex gap-2">
            <Button size="sm" kind="primary" icon="Printer" onClick={() => window.print()}>Print / Save PDF</Button>
            <Button size="sm" kind="tertiary" onClick={onClose}>Close</Button>
          </div>
        </div>
        <div id="payslip-print" className="p-6 text-slate-900">
          {/* Header */}
          <div className="flex items-center gap-3 pb-4 border-b border-slate-200">
            {branding.logoUrl && <img src={branding.logoUrl} alt="" className="h-14 w-14 object-contain" />}
            <div>
              <div className="text-lg font-bold leading-tight">{branding.schoolName}</div>
              <div className="text-sm text-slate-500">Salary Slip — {period}</div>
            </div>
          </div>
          {/* Employee */}
          <div className="grid grid-cols-2 gap-y-1.5 gap-x-4 text-sm py-4">
            <div><span className="text-slate-400">Name:</span> <span className="font-semibold">{item.staffName}</span></div>
            <div><span className="text-slate-400">Designation:</span> {item.designation || '—'}</div>
            <div><span className="text-slate-400">A/c No:</span> {item.accountNo || '—'}</div>
            <div><span className="text-slate-400">IFSC:</span> {item.ifsc || '—'}</div>
            <div><span className="text-slate-400">Credit on:</span> {creditOn}</div>
            <div><span className="text-slate-400">Status:</span> {item.status}</div>
          </div>
          {/* Earnings / Deductions */}
          <table className="w-full text-sm border border-slate-200 border-collapse">
            <thead>
              <tr className="bg-slate-50 text-left">
                <th className="border border-slate-200 px-3 py-2 font-semibold">Earnings</th>
                <th className="border border-slate-200 px-3 py-2 font-semibold text-right w-24">Rs</th>
                <th className="border border-slate-200 px-3 py-2 font-semibold">Deductions</th>
                <th className="border border-slate-200 px-3 py-2 font-semibold text-right w-24">Rs</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rowsN }).map((_, i) => (
                <tr key={i}>
                  <td className="border border-slate-200 px-3 py-2">{earnings[i]?.[0] || ''}</td>
                  <td className="border border-slate-200 px-3 py-2 text-right tabular-nums">{earnings[i] ? earnings[i][1].toLocaleString('en-IN') : ''}</td>
                  <td className="border border-slate-200 px-3 py-2">{deductions[i]?.[0] || ''}</td>
                  <td className="border border-slate-200 px-3 py-2 text-right tabular-nums">{deductions[i] ? deductions[i][1].toLocaleString('en-IN') : ''}</td>
                </tr>
              ))}
              <tr className="font-bold bg-slate-50">
                <td className="border border-slate-200 px-3 py-2">Gross Salary (earning before deduction)</td>
                <td className="border border-slate-200 px-3 py-2 text-right tabular-nums">{totalEarn.toLocaleString('en-IN')}</td>
                <td className="border border-slate-200 px-3 py-2">Total deductions</td>
                <td className="border border-slate-200 px-3 py-2 text-right tabular-nums">{totalDed.toLocaleString('en-IN')}</td>
              </tr>
            </tbody>
          </table>
          {/* Net pay */}
          <div className="flex items-center justify-between bg-cyan-300 px-4 py-3 mt-3 rounded-lg font-bold text-slate-900">
            <span>Net pay after deduction</span>
            <span className="tabular-nums">{rupee(item.netSalary)}</span>
          </div>
          {/* Employer contribution */}
          {employerEsi > 0 && (
            <table className="w-full text-sm border border-slate-200 border-collapse mt-3">
              <tbody>
                <tr>
                  <td className="border border-slate-200 px-3 py-2 text-slate-600">Contribution from School</td>
                  <td className="border border-slate-200 px-3 py-2">ESI (3.25% of {rupee(net)})</td>
                  <td className="border border-slate-200 px-3 py-2 text-right tabular-nums">{employerEsi.toLocaleString('en-IN')}</td>
                </tr>
                <tr className="font-bold bg-yellow-100">
                  <td className="border border-slate-200 px-3 py-2" colSpan={2}>Total employer contribution</td>
                  <td className="border border-slate-200 px-3 py-2 text-right tabular-nums">{employerEsi.toLocaleString('en-IN')}</td>
                </tr>
              </tbody>
            </table>
          )}
          <div className="text-[11px] text-slate-400 mt-4 text-center">This is a computer-generated payslip and does not require a signature.</div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, sub, subTone }: { icon: string; label: string; value: string; sub?: string; subTone?: 'ok' | 'danger' }) {
  return (
    <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-4">
      <div className="flex items-center gap-1.5 text-slate-400 text-xs font-medium">
        <Icon name={icon as any} size={14} /> {label}
      </div>
      <div className="text-2xl font-bold mt-1.5 tracking-tight text-slate-900">{value}</div>
      {sub && <div className={`text-[11px] mt-0.5 ${subTone === 'danger' ? 'text-danger-600' : subTone === 'ok' ? 'text-success-600' : 'text-slate-400'}`}>{sub}</div>}
    </div>
  );
}
