'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { PageHeader, Button, Card, Field, Select, EmptyState, Skeleton, Chip } from '@/components/Primitives';
import { Icon } from '@/components/Icon';

interface YearOpt { id: string; label: string; isActive: boolean; enrollmentCount: number }

export default function PromotionsPage() {
  const { data: session } = useSession();
  const canManage = ((session?.user as any)?.perms as string[] | undefined)?.includes('SETTINGS_MANAGE');

  const [years, setYears] = useState<YearOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [shift, setShift] = useState('1'); // '1' promote, '0' copy, '-1' move back
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch('/api/years');
    if (r.ok) { const d = await r.json(); setYears(d.years || []); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const yearLabel = (id: string) => years.find((y) => y.id === id)?.label || id;

  const run = async () => {
    setError(''); setResult(null);
    if (!source || !target) { setError('Pick both a source and a target year'); return; }
    if (source === target) { setError('Source and target must be different years'); return; }
    const dir = shift === '1' ? 'promote (move up one class)' : shift === '-1' ? 'move back one class' : 'copy the same classes';
    if (!confirm(`Build ${yearLabel(target)} from ${yearLabel(source)} — ${dir}?\n\n${overwrite ? 'This OVERWRITES existing enrollments in the target year.' : 'Students already in the target year are skipped.'}`)) return;
    setBusy(true);
    try {
      const r = await fetch('/api/enrollments/promote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceYearId: source, targetYearId: target, shift: Number(shift), overwrite }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Failed');
      setResult(d);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  };

  if (!canManage) {
    return (<><PageHeader eyebrow="Administration" title="Student promotions" /><Card className="mt-6"><EmptyState icon="Lock" title="No access" body="You need settings-management permission for promotions." /></Card></>);
  }

  return (
    <>
      <PageHeader eyebrow="Administration" title="Student promotions" meta="Build a year's class list from another year — promote students up, copy, or back-fill past years." />

      <div className="mt-6 max-w-2xl space-y-5">
        {/* Year overview */}
        <Card title="Academic years">
          {loading ? <Skeleton height={80} /> : (
            <div className="space-y-2">
              {years.map((y) => (
                <div key={y.id} className="flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-800">{y.label}{y.isActive && <Chip tone="success">current</Chip>}</span>
                  <span className="text-slate-500">{y.enrollmentCount} student{y.enrollmentCount === 1 ? '' : 's'} enrolled</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Run a promotion */}
        <Card title="Build / promote a year">
          {error && <div className="mb-4 bg-danger-50 border border-danger-100 rounded-md p-3 text-sm text-danger-700">{error}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Take students from"><Select value={source} onChange={(e) => setSource(e.target.value)}><option value="">Select year…</option>{years.map((y) => <option key={y.id} value={y.id}>{y.label} ({y.enrollmentCount})</option>)}</Select></Field>
            <Field label="And build"><Select value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Select year…</option>{years.map((y) => <option key={y.id} value={y.id}>{y.label} ({y.enrollmentCount})</option>)}</Select></Field>
          </div>

          <div className="mt-4">
            <div className="text-sm font-medium text-slate-700 mb-2">What happens to each student's class?</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {[
                { v: '1', label: 'Promote', sub: 'Move up one class (1st → 2nd). Final class graduates.', icon: 'ArrowUp' },
                { v: '0', label: 'Copy', sub: 'Same class (e.g. a repeat year).', icon: 'Equal' },
                { v: '-1', label: 'Move back', sub: 'One class lower — for back-filling last year.', icon: 'ArrowDown' },
              ].map((o) => (
                <button key={o.v} onClick={() => setShift(o.v)} className={`text-left rounded-xl border p-3 transition-colors ${shift === o.v ? 'border-purple-500 bg-purple-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"><Icon name={o.icon as any} size={15} />{o.label}</div>
                  <div className="text-[11px] text-slate-500 mt-1">{o.sub}</div>
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 mt-4 text-sm text-slate-600 cursor-pointer">
            <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} className="rounded border-slate-300 text-purple-600 focus:ring-purple-500/20" />
            Overwrite students already enrolled in the target year
          </label>

          <div className="flex justify-end mt-5">
            <Button kind="primary" icon="Play" onClick={run} disabled={busy}>{busy ? 'Working…' : 'Run'}</Button>
          </div>

          {result && (
            <div className="mt-4 bg-success-50 border border-success-100 rounded-lg p-3 text-sm text-success-800">
              <div className="font-semibold inline-flex items-center gap-1.5"><Icon name="CheckCircle2" size={16} />Done</div>
              <div className="text-xs mt-1 text-success-700">
                {result.created} enrolled into {yearLabel(target)} (from {result.source}).
                {result.graduated ? ` ${result.graduated} graduated (no next class).` : ''}
                {result.noClass ? ` ${result.noClass} skipped (no lower class).` : ''}
                {result.skippedExisting ? ` ${result.skippedExisting} already enrolled — skipped.` : ''}
              </div>
            </div>
          )}
        </Card>

        <p className="text-xs text-slate-400">Promotions only set which class a student is in per year. Fees and marks are entered per year separately. Sections are matched by name when the target class has one.</p>
      </div>
    </>
  );
}
