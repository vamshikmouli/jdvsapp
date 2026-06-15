'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { PageHeader, Button, Card, Input, Select, Field, Chip, EmptyState, Skeleton, Modal, Drawer } from '@/components/Primitives';
import { Icon } from '@/components/Icon';
import { downloadBackup } from '@/lib/utils';
import { EntryTab, ApprovalsTab } from './entry-ui';

type Tab = 'entry' | 'approvals' | 'subjects' | 'classmap' | 'assessments' | 'grades';

const ALL_TABS: { id: Tab; label: string; icon: string; perm: string }[] = [
  { id: 'entry', label: 'Entry', icon: 'PencilLine', perm: 'MARKS_ENTER' },
  { id: 'approvals', label: 'Approvals', icon: 'CheckCircle2', perm: 'MARKS_APPROVE' },
  { id: 'subjects', label: 'Subjects', icon: 'BookOpen', perm: 'MARKS_SETUP' },
  { id: 'classmap', label: 'Class subjects', icon: 'Network', perm: 'MARKS_SETUP' },
  { id: 'assessments', label: 'Assessments', icon: 'ClipboardList', perm: 'MARKS_SETUP' },
  { id: 'grades', label: 'Grade scale', icon: 'Award', perm: 'MARKS_SETUP' },
];

export default function MarksPage() {
  const { data: session } = useSession();
  const perms = ((session?.user as any)?.perms as string[]) || [];
  const tabs = useMemo(() => ALL_TABS.filter((t) => perms.includes(t.perm)), [perms.join(',')]);
  const [picked, setPicked] = useState<Tab | null>(null);
  const tab: Tab | undefined = picked && tabs.some((t) => t.id === picked) ? picked : tabs[0]?.id;
  const wide = tab === 'entry' || tab === 'approvals';

  // ----- Export / import (configuration + mark sheets + marks) -----
  const canExport = perms.includes('REPORTS_EXPORT') || perms.includes('SETTINGS_MANAGE');
  const canImport = perms.includes('MARKS_SETUP') || perms.includes('MARKS_APPROVE') || perms.includes('SETTINGS_MANAGE');
  const [exporting, setExporting] = useState(false);
  const doExport = async () => {
    setExporting(true);
    try { await downloadBackup('marks'); } catch (e) { alert(e instanceof Error ? e.message : 'Export failed'); } finally { setExporting(false); }
  };
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [importResult, setImportResult] = useState<
    { ok: boolean; totals: { upserted: number; failed: number }; results: { sheet: string; total: number; upserted: number; failed: number; errors: string[] }[]; error?: string } | null
  >(null);
  const pickImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) setPendingImport(f);
  };
  const doImport = async () => {
    if (!pendingImport) return;
    const file = pendingImport;
    setPendingImport(null);
    setImporting(true);
    try {
      const res = await fetch('/api/backup/import?group=marks', { method: 'POST', body: file });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Import failed (${res.status})`);
      setImportResult(data);
      setRefreshKey((k) => k + 1); // re-fetch the active config tab
    } catch (err) {
      setImportResult({ ok: false, totals: { upserted: 0, failed: 0 }, results: [], error: err instanceof Error ? err.message : 'Import failed' });
    } finally {
      setImporting(false);
    }
  };

  if (tabs.length === 0) {
    return (
      <>
        <PageHeader eyebrow="Academics" title="Marks" meta="Assessment marks for students." />
        <Card className="mt-6"><EmptyState icon="ClipboardList" title="No marks access" body="You don't have permission for the marks module." /></Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Academics"
        title="Marks"
        meta="Enter, approve and configure Formative & Summative assessment marks."
        actions={(canExport || canImport) ? (
          <>
            {canExport && <Button icon="Download" onClick={doExport} disabled={exporting}>{exporting ? 'Exporting…' : 'Export'}</Button>}
            {canImport && <Button icon="Upload" onClick={() => importInputRef.current?.click()} disabled={importing}>{importing ? 'Importing…' : 'Import'}</Button>}
          </>
        ) : undefined}
      />

      <div className="flex items-center gap-1 mt-6 border-b border-slate-200 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setPicked(t.id)}
            className={`inline-flex items-center gap-2 px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap flex-shrink-0 transition-colors ${tab === t.id ? 'border-purple-500 text-purple-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            <Icon name={t.icon as any} size={16} />{t.label}
          </button>
        ))}
      </div>

      <div key={refreshKey} className={`mt-5 ${wide ? 'max-w-5xl' : 'max-w-3xl'}`}>
        {tab === 'entry' && <EntryTab />}
        {tab === 'approvals' && <ApprovalsTab />}
        {tab === 'subjects' && <SubjectsTab />}
        {tab === 'classmap' && <ClassMapTab />}
        {tab === 'assessments' && <AssessmentsTab />}
        {tab === 'grades' && <GradesTab />}
      </div>

      {/* Hidden file picker for marks import */}
      <input ref={importInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={pickImport} />

      {/* Confirm before overwriting */}
      <Modal
        open={!!pendingImport}
        onClose={() => setPendingImport(null)}
        title="Import marks?"
        subtitle={pendingImport?.name || ''}
        width={460}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setPendingImport(null)}>Cancel</Button>
            <Button kind="primary" icon="Upload" onClick={doImport} disabled={importing}>
              {importing ? 'Importing…' : 'Restore marks'}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-600">
          Restores the marks configuration (<b>Subjects, Grade scale, Assessments, Class subjects, per-assessment
          max marks</b>) and the <b>mark sheets &amp; marks</b> from a previously exported workbook. Each row is
          matched by its id — existing records are updated and missing ones re-created. Other data is left untouched.
        </p>
      </Modal>

      {/* Result */}
      <Modal
        open={!!importResult}
        onClose={() => setImportResult(null)}
        title="Import complete"
        width={460}
        footer={<div className="flex justify-end"><Button kind="primary" onClick={() => setImportResult(null)}>Done</Button></div>}
      >
        {importResult?.error ? (
          <div className="px-4 py-2.5 bg-danger-50 text-danger-700 rounded-md text-sm">{importResult.error}</div>
        ) : importResult ? (
          <div>
            <div className={`px-4 py-2.5 rounded-md text-sm mb-3 ${importResult.ok ? 'bg-success-50 text-success-700' : 'bg-amber-50 text-amber-800'}`}>
              Restored {importResult.totals.upserted} record{importResult.totals.upserted === 1 ? '' : 's'}
              {importResult.totals.failed > 0 ? ` · ${importResult.totals.failed} failed` : ''}.
            </div>
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
              {importResult.results.filter((r) => r.total > 0 || r.failed > 0).map((r) => (
                <div key={r.sheet} className="px-4 py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-800">{r.sheet}</span>
                    <span className="text-slate-500">
                      {r.upserted}/{r.total}
                      {r.failed > 0 && <span className="text-danger-600"> · {r.failed} failed</span>}
                    </span>
                  </div>
                  {r.errors.length > 0 && (
                    <ul className="mt-1 text-xs text-danger-600 list-disc list-inside">
                      {r.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  )}
                </div>
              ))}
              {importResult.results.every((r) => r.total === 0 && r.failed === 0) && (
                <div className="px-4 py-3 text-sm text-slate-500">
                  No marks rows found in this file. Make sure you uploaded a marks export.
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}

/* small toggle */
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${on ? 'bg-purple-500' : 'bg-slate-300'}`}>
      <span className={`inline-block h-[18px] w-[18px] transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

/* ---------------- Subjects ---------------- */
interface Subject { id: string; name: string; code: string | null; order: number; active: boolean; gradeOnly: boolean; classCount: number }

function SubjectsTab() {
  const [items, setItems] = useState<Subject[] | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const r = await fetch('/api/subjects');
    setItems(r.ok ? await r.json() : []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/subjects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, code }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Failed');
      setName(''); setCode(''); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  };
  const patch = async (id: string, data: any) => { await fetch('/api/subjects', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...data }) }); load(); };
  const del = async (s: Subject) => {
    if (!confirm(`Delete subject "${s.name}"?`)) return;
    const r = await fetch(`/api/subjects?id=${s.id}`, { method: 'DELETE' });
    if (!r.ok) alert((await r.json().catch(() => ({}))).error || 'Failed to delete');
    load();
  };
  const move = async (i: number, dir: -1 | 1) => {
    if (!items) return;
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next); // optimistic
    await fetch('/api/subjects/reorder', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: next.map((x) => x.id) }) });
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="text-sm font-semibold text-slate-900 mb-3">Add a subject</div>
        {error && <div className="mb-3 bg-danger-50 border border-danger-100 rounded-md p-2 text-xs text-danger-700">{error}</div>}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]"><Field label="Subject name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mathematics" /></Field></div>
          <div className="w-28"><Field label="Code"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="MATH" /></Field></div>
          <Button kind="primary" icon="Plus" onClick={add} disabled={busy || !name.trim()}>Add</Button>
        </div>
      </Card>

      {items === null ? <Skeleton height={120} rounded="lg" /> : items.length === 0 ? (
        <Card><EmptyState icon="BookOpen" title="No subjects yet" body="Add subjects above (English, Maths, EVS…)." /></Card>
      ) : (
        <Card padded={false}>
          <div className="divide-y divide-slate-100">
            {items.map((s, i) => (
              <div key={s.id} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 py-2.5">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="flex flex-col flex-shrink-0">
                    <button disabled={i === 0} onClick={() => move(i, -1)} className="text-slate-300 hover:text-purple-600 disabled:opacity-25 disabled:hover:text-slate-300 -my-0.5" title="Move up"><Icon name="ChevronUp" size={16} /></button>
                    <button disabled={i === items.length - 1} onClick={() => move(i, 1)} className="text-slate-300 hover:text-purple-600 disabled:opacity-25 disabled:hover:text-slate-300 -my-0.5" title="Move down"><Icon name="ChevronDown" size={16} /></button>
                  </div>
                  <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center flex-shrink-0 text-xs font-bold">{(s.code || s.name).slice(0, 3).toUpperCase()}</div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900">{s.name}{!s.active && <span className="ml-2 text-[11px] text-slate-400">(inactive)</span>}{s.gradeOnly && <span className="ml-2 text-[10px] font-semibold text-purple-600 bg-purple-50 rounded px-1.5 py-0.5">GRADE ONLY</span>}</div>
                    <div className="text-xs text-slate-500">{s.code ? s.code + ' · ' : ''}{s.classCount} class{s.classCount === 1 ? '' : 'es'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0 pl-11 sm:pl-0">
                  <label className="flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer" title="Show a grade and exclude this subject from the marks total">
                    <input type="checkbox" checked={s.gradeOnly} onChange={(e) => patch(s.id, { gradeOnly: e.target.checked })} className="rounded border-slate-300 text-purple-600 focus:ring-purple-500/20" />
                    Grade only
                  </label>
                  <span className="text-[11px] text-slate-400 w-12 text-right">{s.active ? 'Active' : 'Off'}</span>
                  <Toggle on={s.active} onChange={(v) => patch(s.id, { active: v })} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ---------------- Class ↔ subject mapping ---------------- */
interface ClassRow { id: string; name: string; order: number }

function ClassMapTab() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [map, setMap] = useState<Record<string, string[]>>({});
  const [activeClass, setActiveClass] = useState<string | null>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [c, s, m] = await Promise.all([fetch('/api/classes'), fetch('/api/subjects'), fetch('/api/class-subjects')]);
    const cls: any[] = c.ok ? await c.json() : [];
    setClasses(cls.map((x) => ({ id: x.id, name: x.name, order: x.order })).sort((a, b) => a.order - b.order));
    setSubjects((s.ok ? await s.json() : []).filter((x: Subject) => x.active));
    setMap(m.ok ? (await m.json()).map : {});
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const openClass = (id: string) => { setActiveClass(id); setDraft(new Set(map[id] || [])); };
  const toggle = (sid: string) => setDraft((d) => { const n = new Set(d); n.has(sid) ? n.delete(sid) : n.add(sid); return n; });
  const save = async () => {
    if (!activeClass) return;
    setSaving(true);
    await fetch('/api/class-subjects', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classId: activeClass, subjectIds: Array.from(draft) }) });
    setMap((m) => ({ ...m, [activeClass]: Array.from(draft) }));
    setSaving(false); setActiveClass(null);
  };

  if (loading) return <Skeleton height={200} rounded="lg" />;
  if (subjects.length === 0) return <Card><EmptyState icon="BookOpen" title="Add subjects first" body="Create subjects in the Subjects tab, then map them to classes here." /></Card>;

  return (
    <>
      <Card padded={false}>
        <div className="divide-y divide-slate-100">
          {classes.map((c) => {
            const ids = map[c.id] || [];
            return (
              <button key={c.id} onClick={() => openClass(c.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 text-xs font-medium flex-shrink-0">{c.name.replace(/\s?STD$/i, '')}</span>
                <div className="flex-1 min-w-0 text-sm text-slate-600 truncate">
                  {ids.length === 0 ? <span className="text-slate-400">No subjects mapped</span> : subjects.filter((s) => ids.includes(s.id)).map((s) => s.name).join(', ')}
                </div>
                <span className="text-xs text-slate-400">{ids.length} subj</span>
                <Icon name="ChevronRight" size={16} className="text-slate-300" />
              </button>
            );
          })}
        </div>
      </Card>

      {activeClass && (
        <Drawer open onClose={() => setActiveClass(null)} title={`Subjects for ${classes.find((c) => c.id === activeClass)?.name || ''}`} subtitle={`${draft.size} of ${subjects.length} selected`} width={480}
          footer={<div className="flex items-center justify-between gap-2">
            <div className="flex gap-3 text-xs">
              <button onClick={() => setDraft(new Set(subjects.map((s) => s.id)))} className="text-purple-600 hover:text-purple-700 font-medium">Select all</button>
              <span className="text-slate-300">·</span>
              <button onClick={() => setDraft(new Set())} className="text-slate-500 hover:text-slate-700">Clear</button>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setActiveClass(null)}>Cancel</Button>
              <Button kind="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
            </div>
          </div>}>
          <p className="text-sm text-slate-500 mb-3">Tap a subject to add or remove it from this class.</p>
          <div className="flex flex-wrap gap-2">
            {subjects.map((s) => {
              const on = draft.has(s.id);
              return (
                <button key={s.id} type="button" onClick={() => toggle(s.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors ${on ? 'border-purple-500 bg-purple-500 text-white' : 'border-slate-300 bg-white text-slate-600 hover:border-purple-300 hover:text-purple-700'}`}>
                  <Icon name={on ? 'Check' : 'Plus'} size={14} />
                  {s.name}
                </button>
              );
            })}
          </div>
        </Drawer>
      )}
    </>
  );
}

/* ---------------- Assessments ---------------- */
interface Assessment { id: string; name: string; type: 'FORMATIVE' | 'SUMMATIVE'; term: string | null; order: number; defaultMax: number; publishedToParents: boolean; archived?: boolean; sheetCount: number }

function AssessmentsTab() {
  const [items, setItems] = useState<Assessment[] | null>(null);
  const [edit, setEdit] = useState<Partial<Assessment> | null>(null);
  const [maxFor, setMaxFor] = useState<Assessment | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/assessments${showArchived ? '?archived=1' : ''}`);
    setItems(r.ok ? (await r.json()).items : []);
  }, [showArchived]);
  useEffect(() => { load(); }, [load]);

  const patch = async (id: string, data: any) => { await fetch('/api/assessments', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...data }) }); load(); };
  const del = async (a: Assessment) => {
    if (!confirm(`Archive assessment "${a.name}"? It's hidden from entry, setup and reports but kept (marks preserved) and restorable.`)) return;
    const r = await fetch(`/api/assessments?id=${a.id}`, { method: 'DELETE' });
    if (!r.ok) alert((await r.json().catch(() => ({}))).error || 'Failed to archive');
    load();
  };
  const restore = async (a: Assessment) => { await fetch(`/api/assessments?id=${a.id}&restore=1`, { method: 'DELETE' }); load(); };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="rounded border-slate-300 text-purple-600 focus:ring-purple-500/20" />
          Show archived
        </label>
        <Button kind="primary" icon="Plus" onClick={() => setEdit({ type: 'FORMATIVE', defaultMax: 20 })}>New assessment</Button>
      </div>

      {items === null ? <Skeleton height={160} rounded="lg" /> : items.length === 0 ? (
        <Card><EmptyState icon="ClipboardList" title="No assessments yet" body="Add FA/SA exams for this year — e.g. FA1, SA1." /></Card>
      ) : (
        <Card padded={false}>
          <div className="divide-y divide-slate-100">
            {items.map((a) => (
              <div key={a.id} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 py-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <Chip tone={a.type === 'SUMMATIVE' ? 'info' : 'neutral'}>{a.type === 'SUMMATIVE' ? 'SA' : 'FA'}</Chip>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900">{a.name}{a.term ? <span className="ml-2 text-[11px] text-slate-400">{a.term}</span> : ''}</div>
                    <div className="text-xs text-slate-500">Max {a.defaultMax} · {a.sheetCount} sheet{a.sheetCount === 1 ? '' : 's'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 pl-11 sm:pl-0">
                  {a.archived ? (
                    <button onClick={() => restore(a)} className="text-[11px] font-medium text-success-600 hover:text-success-700 inline-flex items-center gap-1" title="Restore"><Icon name="ArchiveRestore" size={14} />Restore</button>
                  ) : (<>
                    <button onClick={() => setMaxFor(a)} className="text-[11px] font-medium text-purple-600 hover:text-purple-700 inline-flex items-center gap-1" title="Set max marks per subject"><Icon name="SlidersHorizontal" size={14} />Max marks</button>
                    <div className="flex items-center gap-1.5" title="Visible to parents">
                      <span className="text-[11px] text-slate-400">Published</span>
                      <Toggle on={a.publishedToParents} onChange={(v) => patch(a.id, { publishedToParents: v })} />
                    </div>
                    <button onClick={() => setEdit(a)} className="text-slate-300 hover:text-purple-600 p-1" title="Edit"><Icon name="Pencil" size={16} /></button>
                    <button onClick={() => del(a)} className="text-slate-300 hover:text-amber-600 p-1" title="Archive"><Icon name="Archive" size={16} /></button>
                  </>)}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {edit && <AssessmentModal initial={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {maxFor && <MaxMarksDrawer assessment={maxFor} onClose={() => setMaxFor(null)} onSaved={() => { setMaxFor(null); load(); }} />}
    </div>
  );
}

/* Per-subject max marks for an assessment */
interface SubjMax { id: string; name: string; gradeOnly: boolean; max: number; isOverride: boolean }
function MaxMarksDrawer({ assessment, onClose, onSaved }: { assessment: Assessment; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<SubjMax[] | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const r = await fetch(`/api/assessment-subjects?assessmentId=${assessment.id}`);
      if (r.ok) { const d = await r.json(); setRows(d.subjects); setVals(Object.fromEntries(d.subjects.map((s: SubjMax) => [s.id, String(s.max)]))); }
      else setRows([]);
    })();
  }, [assessment.id]);

  const save = async () => {
    setBusy(true); setError('');
    try {
      const maxes = (rows || []).map((s) => ({ subjectId: s.id, max: Number(vals[s.id]) }));
      if (maxes.some((m) => !(m.max > 0))) throw new Error('Every max must be greater than 0');
      const r = await fetch('/api/assessment-subjects', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assessmentId: assessment.id, maxes }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Failed');
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  };

  return (
    <Drawer open onClose={onClose} title={`Max marks · ${assessment.name}`} subtitle={`Default ${assessment.defaultMax} — override any subject below`} width={460}
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button kind="primary" onClick={save} disabled={busy || !rows}>{busy ? 'Saving…' : 'Save'}</Button></div>}>
      {!rows ? <Skeleton height={240} /> : rows.length === 0 ? (
        <EmptyState icon="BookOpen" title="No subjects" body="Add subjects in the Subjects tab first." />
      ) : (
        <>
          {error && <div className="mb-3 bg-danger-50 border border-danger-100 rounded-md p-2 text-xs text-danger-700">{error}</div>}
          <div className="space-y-2">
            {rows.map((s) => (
              <div key={s.id} className="flex items-center gap-3">
                <div className="flex-1 min-w-0 text-sm text-slate-800 truncate">{s.name}{s.gradeOnly && <span className="ml-1.5 text-[10px] text-purple-600">(grade)</span>}</div>
                <div className="w-24"><Input type="number" value={vals[s.id] ?? ''} onChange={(e) => setVals((v) => ({ ...v, [s.id]: e.target.value }))} className="text-right tabular-nums" /></div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-3">Changing a max updates draft/submitted sheets too. Approved sheets keep their max.</p>
        </>
      )}
    </Drawer>
  );
}

function AssessmentModal({ initial, onClose, onSaved }: { initial: Partial<Assessment>; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!initial.id;
  const [name, setName] = useState(initial.name || '');
  const [type, setType] = useState<'FORMATIVE' | 'SUMMATIVE'>(initial.type || 'FORMATIVE');
  const [term, setTerm] = useState(initial.term || '');
  const [defaultMax, setDefaultMax] = useState(String(initial.defaultMax ?? 20));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true); setError('');
    try {
      const body = { id: initial.id, name, type, term, defaultMax: Number(defaultMax) };
      const r = await fetch('/api/assessments', { method: isEdit ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Failed');
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? 'Edit assessment' : 'New assessment'} width={460}
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button kind="primary" onClick={save} disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save'}</Button></div>}>
      <div className="space-y-4">
        {error && <div className="bg-danger-50 border border-danger-100 rounded-md p-2 text-xs text-danger-700">{error}</div>}
        <Field label="Name" hint="e.g. FA1, SA1, Mid-term"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="FA1" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value as any)}><option value="FORMATIVE">Formative (FA)</option><option value="SUMMATIVE">Summative (SA)</option></Select></Field>
          <Field label="Max marks"><Input type="number" value={defaultMax} onChange={(e) => setDefaultMax(e.target.value)} className="text-right tabular-nums" /></Field>
        </div>
        <Field label="Term (optional)" hint="Group on the report card, e.g. Term 1"><Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Term 1" /></Field>
      </div>
    </Modal>
  );
}

/* ---------------- Grade scale ---------------- */
interface Band { label: string; minPercent: number | string; maxPercent: number | string }
const DEFAULT_BANDS: Band[] = [
  { label: 'A1', minPercent: 91, maxPercent: 100 },
  { label: 'A2', minPercent: 81, maxPercent: 90 },
  { label: 'B1', minPercent: 71, maxPercent: 80 },
  { label: 'B2', minPercent: 61, maxPercent: 70 },
  { label: 'C1', minPercent: 51, maxPercent: 60 },
  { label: 'C2', minPercent: 41, maxPercent: 50 },
  { label: 'D', minPercent: 33, maxPercent: 40 },
  { label: 'E', minPercent: 0, maxPercent: 32 },
];

function GradesTab() {
  const [bands, setBands] = useState<Band[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch('/api/grade-bands');
    const data = r.ok ? await r.json() : [];
    setBands(data.length ? data.map((b: any) => ({ label: b.label, minPercent: b.minPercent, maxPercent: b.maxPercent })) : []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const update = (i: number, key: keyof Band, val: string) => setBands((b) => b!.map((x, j) => (j === i ? { ...x, [key]: val } : x)));
  const addRow = () => setBands((b) => [...(b || []), { label: '', minPercent: '', maxPercent: '' }]);
  const removeRow = (i: number) => setBands((b) => b!.filter((_, j) => j !== i));
  const useDefaults = () => setBands(DEFAULT_BANDS.map((b) => ({ ...b })));

  const save = async () => {
    setBusy(true); setError(''); setSaved(false);
    try {
      const r = await fetch('/api/grade-bands', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bands }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Failed');
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  };

  if (bands === null) return <Skeleton height={240} rounded="lg" />;

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-slate-900">Grade bands</div>
        {bands.length === 0 && <Button size="sm" onClick={useDefaults}>Use standard A1–E</Button>}
      </div>
      {error && <div className="mb-3 bg-danger-50 border border-danger-100 rounded-md p-2 text-xs text-danger-700">{error}</div>}

      {bands.length === 0 ? (
        <EmptyState icon="Award" title="No grade scale" body="Add bands below, or use the standard A1–E scale." />
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_5rem_5rem_2rem] gap-2 text-[11px] uppercase tracking-wide text-slate-400 px-1">
            <div>Grade</div><div className="text-right">Min %</div><div className="text-right">Max %</div><div />
          </div>
          {bands.map((b, i) => (
            <div key={i} className="grid grid-cols-[1fr_5rem_5rem_2rem] gap-2 items-center">
              <Input value={b.label} onChange={(e) => update(i, 'label', e.target.value)} placeholder="A1" />
              <Input type="number" value={String(b.minPercent)} onChange={(e) => update(i, 'minPercent', e.target.value)} className="text-right tabular-nums" />
              <Input type="number" value={String(b.maxPercent)} onChange={(e) => update(i, 'maxPercent', e.target.value)} className="text-right tabular-nums" />
              <button onClick={() => removeRow(i)} className="text-slate-300 hover:text-danger-600 p-1"><Icon name="X" size={16} /></button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between mt-4">
        <Button size="sm" icon="Plus" onClick={addRow}>Add band</Button>
        <div className="flex items-center gap-3">
          {saved && <span className="text-xs text-success-600 inline-flex items-center gap-1"><Icon name="Check" size={14} /> Saved</span>}
          <Button kind="primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save scale'}</Button>
        </div>
      </div>
    </Card>
  );
}
