'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button, Card, Input, Select, Field, Chip, EmptyState, Skeleton, Modal } from '@/components/Primitives';
import { Icon } from '@/components/Icon';
import * as XLSX from 'xlsx';

const shortClass = (n: string | null) => (n ? n.replace(/\s?STD$/i, '') : '—');

interface Subject { id: string; name: string; active: boolean }
interface Assessment { id: string; name: string; type: 'FORMATIVE' | 'SUMMATIVE'; defaultMax: number }

interface GridStudent { id: string; name: string; roll: string | null; marksObtained: number | null; isAbsent: boolean; remark: string | null }
interface Grid {
  assessment: { id: string; name: string; type: string; defaultMax: number };
  class: { id: string; name: string }; section: { id: string; name: string } | null; subject: { id: string; name: string };
  sheetId: string | null; status: 'DRAFT' | 'SUBMITTED' | 'APPROVED'; maxMarks: number;
  enteredBy: string | null; approvedBy: string | null; canEdit: boolean; isAdmin: boolean;
  students: GridStudent[];
}

const STATUS_CHIP: Record<string, { tone: string; label: string }> = {
  DRAFT: { tone: 'neutral', label: 'Draft' },
  SUBMITTED: { tone: 'warn', label: 'Submitted' },
  APPROVED: { tone: 'success', label: 'Approved' },
};

/* ---------------- Marks entry (teacher + admin) ---------------- */
interface ClassGridSubject { id: string; name: string; max: number; status: 'DRAFT' | 'SUBMITTED' | 'APPROVED'; sheetId: string | null; canEdit: boolean; marks: Record<string, { marksObtained: number | null; isAbsent: boolean }> }
interface ClassGrid {
  assessment: { id: string; name: string; type: string; defaultMax: number };
  class: { id: string; name: string }; section: { id: string; name: string } | null;
  students: { id: string; name: string; roll: string | null }[];
  subjects: ClassGridSubject[]; isAdmin: boolean;
}

function StatusPill({ s }: { s: string }) {
  const map: Record<string, string> = { DRAFT: 'bg-slate-100 text-slate-500', SUBMITTED: 'bg-amber-100 text-amber-700', APPROVED: 'bg-green-100 text-green-700' };
  return <span className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded ${map[s] || map.DRAFT}`}>{s}</span>;
}

const cellInvalid = (t: string, max: number) => { const s = (t || '').trim(); if (s === '' || /^a/i.test(s)) return false; const n = Number(s); return isNaN(n) || n < 0 || n > max; };

// Whole-class grid: all subjects (columns) × all students (rows) in one screen.
export function EntryTab() {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [aId, setAId] = useState(''); const [cId, setCId] = useState(''); const [secId, setSecId] = useState('');
  const [grid, setGrid] = useState<ClassGrid | null>(null);
  // vals[subjectId][studentId] = cell text ('' | number | 'AB')
  const [vals, setVals] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);

  useEffect(() => { (async () => {
    const [a, c] = await Promise.all([fetch('/api/assessments'), fetch('/api/classes')]);
    setAssessments(a.ok ? (await a.json()).items : []);
    setClasses(c.ok ? await c.json() : []);
  })(); }, []);

  const cls = classes.find((c) => c.id === cId);
  const sections = cls?.sections || [];
  useEffect(() => { setSecId(''); setGrid(null); }, [cId]);

  const canLoad = !!(aId && cId && (sections.length === 0 || secId));

  const loadGrid = useCallback(async () => {
    setLoading(true); setError(''); setGrid(null);
    const qs = new URLSearchParams({ assessmentId: aId, classId: cId });
    if (secId) qs.set('sectionId', secId);
    const r = await fetch('/api/marks/grid?' + qs);
    if (r.ok) {
      const g: ClassGrid = await r.json();
      setGrid(g);
      const v: Record<string, Record<string, string>> = {};
      for (const su of g.subjects) { v[su.id] = {}; for (const st of g.students) { const m = su.marks[st.id]; v[su.id][st.id] = m ? (m.isAbsent ? 'AB' : (m.marksObtained != null ? String(m.marksObtained) : '')) : ''; } }
      setVals(v);
    } else setError((await r.json().catch(() => ({}))).error || 'Failed to load');
    setLoading(false);
  }, [aId, cId, secId]);
  useEffect(() => { if (canLoad) loadGrid(); }, [canLoad, loadGrid]);

  const setCell = (subId: string, stId: string, val: string) => setVals((v) => ({ ...v, [subId]: { ...v[subId], [stId]: val } }));

  const anyInvalid = grid ? grid.subjects.some((su) => grid.students.some((st) => cellInvalid(vals[su.id]?.[st.id] ?? '', su.max))) : false;
  const editableSubjects = grid ? grid.subjects.filter((s) => s.canEdit) : [];

  const save = async (action: 'save' | 'submit') => {
    if (!grid || anyInvalid) return;
    setBusy(true); setError(''); setToast('');
    try {
      const subjects = editableSubjects.map((su) => ({
        subjectId: su.id,
        marks: grid.students.map((st) => {
          const t = (vals[su.id]?.[st.id] ?? '').trim();
          if (t === '') return { studentId: st.id, marksObtained: null, isAbsent: false };
          if (/^a/i.test(t)) return { studentId: st.id, isAbsent: true, marksObtained: null };
          return { studentId: st.id, marksObtained: Number(t), isAbsent: false };
        }),
      }));
      const r = await fetch('/api/marks/grid', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assessmentId: aId, classId: cId, sectionId: secId || null, action, subjects }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Failed');
      setToast(action === 'submit' ? 'Submitted for approval' : 'Saved'); await loadGrid(); setTimeout(() => setToast(''), 2500);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Assessment"><Select value={aId} onChange={(e) => { setAId(e.target.value); setGrid(null); }}><option value="">Select…</option>{assessments.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.type === 'SUMMATIVE' ? 'SA' : 'FA'})</option>)}</Select></Field>
          <Field label="Class"><Select value={cId} onChange={(e) => setCId(e.target.value)}><option value="">Select…</option>{classes.map((c) => <option key={c.id} value={c.id}>{shortClass(c.name)}</option>)}</Select></Field>
          <Field label="Section"><Select value={secId} onChange={(e) => { setSecId(e.target.value); setGrid(null); }} disabled={sections.length === 0}>{sections.length === 0 ? <option value="">— (whole class)</option> : <><option value="">Select…</option>{sections.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</>}</Select></Field>
        </div>
      </Card>

      {error && <div className="bg-danger-50 border border-danger-100 rounded-md p-3 text-sm text-danger-700">{error}</div>}
      {loading && <Skeleton height={280} rounded="lg" />}

      {grid && !loading && (
        <Card padded={false}>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
            <div className="text-sm"><span className="font-semibold text-slate-900">{grid.assessment.name}</span><span className="text-slate-400"> · </span>{shortClass(grid.class.name)}{grid.section ? ` ${grid.section.name}` : ''}<span className="text-slate-400"> · </span>{grid.students.length} students · {grid.subjects.length} subjects</div>
            <div className="flex items-center gap-2 text-[10px] text-slate-400"><StatusPill s="DRAFT" /><StatusPill s="SUBMITTED" /><StatusPill s="APPROVED" /></div>
          </div>

          {grid.subjects.length === 0 ? (
            <div className="p-6"><EmptyState icon="BookOpen" title="No subjects mapped" body="Map subjects to this class in Setup → Class subjects, then come back." /></div>
          ) : grid.students.length === 0 ? (
            <div className="p-6"><EmptyState icon="Users" title="No students" body="This class/section has no active students." /></div>
          ) : (
            <>
            <div className="sm:hidden px-4 pt-2 text-[11px] text-slate-400 flex items-center gap-1"><Icon name="MoveHorizontal" size={13} />Swipe sideways to see all subjects</div>
            <div className="overflow-x-auto">
              <table className="text-sm border-collapse min-w-full">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-semibold text-slate-600 border-b border-slate-200 min-w-[130px] sm:min-w-[180px]">Student</th>
                    {grid.subjects.map((su) => (
                      <th key={su.id} className="px-2 py-2 text-center border-b border-l border-slate-200 min-w-[76px] align-top">
                        <div className="text-xs font-semibold text-slate-700 whitespace-nowrap flex items-center justify-center gap-1">{su.name}{!su.canEdit && <Icon name="Lock" size={11} className="text-slate-400" />}</div>
                        <div className="text-[10px] text-slate-400">max {su.max}</div>
                        <div className="mt-1"><StatusPill s={su.status} /></div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.students.map((st, i) => (
                    <tr key={st.id} className="hover:bg-slate-50/60">
                      <td className="sticky left-0 z-10 bg-white px-3 py-1.5 border-b border-slate-100 whitespace-nowrap">
                        <span className="text-[11px] text-slate-400 tabular-nums mr-1.5">{i + 1}</span>
                        <span className="text-slate-800">{st.name}</span>{st.roll && <span className="text-[11px] text-slate-400 ml-1.5">#{st.roll}</span>}
                      </td>
                      {grid.subjects.map((su) => {
                        const t = vals[su.id]?.[st.id] ?? '';
                        const bad = cellInvalid(t, su.max);
                        return (
                          <td key={su.id} className="px-1 py-1 text-center border-b border-l border-slate-100">
                            <input value={t} disabled={!su.canEdit} onChange={(e) => setCell(su.id, st.id, e.target.value)}
                              className={`w-14 text-center tabular-nums rounded border px-1 py-1 text-sm outline-none focus:ring-2 focus:ring-purple-500/20 ${bad ? 'border-danger-400 bg-danger-50 text-danger-700' : 'border-slate-200'} ${!su.canEdit ? 'bg-slate-50 text-slate-400 cursor-not-allowed' : ''}`} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-slate-100">
            <div className="text-xs text-slate-500">Type a mark, or <b>A</b> for absent. {anyInvalid && <span className="text-danger-600 font-medium">Some marks exceed the max.</span>}</div>
            <div className="flex items-center gap-2">
              {toast && <span className="text-xs text-success-600 inline-flex items-center gap-1"><Icon name="Check" size={14} />{toast}</span>}
              {editableSubjects.length > 0 && <Button icon="Upload" onClick={() => setUploadOpen(true)}>Upload marks</Button>}
              {editableSubjects.length > 0 ? (<>
                <Button onClick={() => save('save')} disabled={busy || anyInvalid}>Save draft</Button>
                <Button kind="primary" icon="Send" onClick={() => save('submit')} disabled={busy || anyInvalid}>Submit for approval</Button>
              </>) : <span className="text-xs text-slate-400">All subjects approved &amp; locked.</span>}
            </div>
          </div>
        </Card>
      )}

      {uploadOpen && grid && (
        <UploadMarksModal
          assessmentName={grid.assessment.name}
          className={shortClass(grid.class.name)}
          sectionName={grid.section?.name || null}
          subjects={grid.subjects.filter((s) => s.canEdit).map((s) => ({ id: s.id, name: s.name, max: s.max }))}
          students={grid.students}
          onClose={() => setUploadOpen(false)}
          onFill={(filled, summary) => {
            setVals((v) => {
              const nv = { ...v };
              for (const subId of Object.keys(filled)) nv[subId] = { ...(nv[subId] || {}), ...filled[subId] };
              return nv;
            });
            setUploadOpen(false);
            setToast(summary);
            setTimeout(() => setToast(''), 4500);
          }}
        />
      )}
    </div>
  );
}

/* ---------------- Upload marks (all-subjects Excel/CSV → grid) ---------------- */
interface UploadSubject { id: string; name: string; max: number }
interface UploadStudent { id: string; name: string; roll: string | null }

const uNorm = (s: any) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const uLetters = (s: any) => String(s ?? '').toUpperCase().replace(/[^A-Z]/g, '');

function UploadMarksModal({
  assessmentName, className, sectionName, subjects, students, onClose, onFill,
}: {
  assessmentName: string; className: string; sectionName: string | null;
  subjects: UploadSubject[]; students: UploadStudent[];
  onClose: () => void;
  onFill: (filled: Record<string, Record<string, string>>, summary: string) => void;
}) {
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState<{
    filled: Record<string, Record<string, string>>;
    perSubject: { name: string; count: number }[];
    subjectsMissing: string[];
    columnsUnmatched: string[];
    studentsMatched: number;
    rowsUnmatched: number;
    cells: number;
  } | null>(null);

  // Template: Student ID + Roll + Name, then one column per subject.
  const downloadTemplate = () => {
    const data = students.map((s, i) => {
      const o: Record<string, string | number> = { 'Student ID': s.id, 'Roll': s.roll ?? i + 1, 'Name': s.name };
      subjects.forEach((su) => { o[su.name] = ''; });
      return o;
    });
    const ws = XLSX.utils.json_to_sheet(data, { header: ['Student ID', 'Roll', 'Name', ...subjects.map((s) => s.name)] });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Marks');
    XLSX.writeFile(wb, `marks-${className}-${assessmentName}.xlsx`.replace(/\s+/g, '_'));
  };

  const copyPrompt = async () => {
    const header = ['Student ID', 'Name', ...subjects.map((s) => s.name)].join(',');
    const maxes = subjects.map((s) => `${s.name}=${s.max}`).join(', ');
    const text = `You are given a photo/scan of a handwritten marks sheet (${assessmentName}, Class ${className}${sectionName ? ' ' + sectionName : ''}).
Output ONLY a CSV table. The first line must be exactly this header:
${header}
Then one line per student. Rules:
- Copy the Student ID exactly as printed.
- Fill each subject column with that student's mark; write AB if absent; leave blank if no mark is given.
- Max marks per subject: ${maxes}.
- Do not invent students or marks, and add no extra text.
Save the result as a .csv (or Excel) file and upload it.`;
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError(''); setPreview(null); setFileName(f.name);
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (rows.length === 0) throw new Error('The sheet has no rows.');
      const headers = Object.keys(rows[0]);

      // Match each header to id/name/roll or a subject (by name).
      const idCols: string[] = [], nameCols: string[] = [];
      const colToSubject: Record<string, UploadSubject> = {};
      const columnsUnmatched: string[] = [];
      const matchSubject = (h: string): UploadSubject | undefined => {
        const hn = uLetters(h);
        if (!hn) return undefined;
        return (
          subjects.find((s) => uLetters(s.name) === hn) ||
          subjects.find((s) => uLetters(s.name).startsWith(hn) || hn.startsWith(uLetters(s.name))) ||
          subjects.find((s) => uLetters(s.name).slice(0, 4) === hn.slice(0, 4) && hn.length >= 4)
        );
      };
      for (const h of headers) {
        const hn = uNorm(h);
        if (/ADMISSION|ADMNO|ADM|^ID$/.test(hn)) { idCols.push(h); continue; }
        if (/^NAME$|STUDENT/.test(hn)) { nameCols.push(h); continue; }
        if (/^ROLL/.test(hn)) continue;
        const su = matchSubject(h);
        if (su) colToSubject[h] = su; else columnsUnmatched.push(h);
      }

      const byId = new Map(students.map((s) => [s.id, s]));
      const byName = new Map(students.map((s) => [uLetters(s.name), s]));
      const filled: Record<string, Record<string, string>> = {};
      const perSubjectCount: Record<string, number> = {};
      let studentsMatched = 0, rowsUnmatched = 0, cells = 0;

      for (const r of rows) {
        let stu: UploadStudent | undefined;
        for (const c of idCols) { const v = String(r[c] ?? '').trim(); if (v && byId.has(v)) { stu = byId.get(v); break; } }
        if (!stu) for (const c of nameCols) { const v = uLetters(r[c]); if (v && byName.has(v)) { stu = byName.get(v); break; } }
        if (!stu) { rowsUnmatched++; continue; }
        studentsMatched++;
        for (const [col, su] of Object.entries(colToSubject)) {
          const raw = String(r[col] ?? '').trim();
          if (raw === '') continue;
          let cell: string;
          if (/^a/i.test(raw)) cell = 'AB';
          else { const n = Number(raw.replace(/[^0-9.]/g, '')); if (isNaN(n)) continue; cell = String(Math.round(n)); }
          (filled[su.id] ||= {})[stu.id] = cell;
          perSubjectCount[su.name] = (perSubjectCount[su.name] || 0) + 1;
          cells++;
        }
      }

      const matchedSubjectIds = new Set(Object.values(colToSubject).map((s) => s.id));
      setPreview({
        filled,
        perSubject: Object.entries(perSubjectCount).map(([name, count]) => ({ name, count })),
        subjectsMissing: subjects.filter((s) => !matchedSubjectIds.has(s.id)).map((s) => s.name),
        columnsUnmatched,
        studentsMatched,
        rowsUnmatched,
        cells,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the file.');
    }
  };

  const apply = () => {
    if (!preview) return;
    const summary = `Imported ${preview.cells} mark${preview.cells === 1 ? '' : 's'} across ${preview.perSubject.length} subject${preview.perSubject.length === 1 ? '' : 's'} — review and submit.`;
    onFill(preview.filled, summary);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Upload marks"
      subtitle={`${assessmentName} · ${className}${sectionName ? ' ' + sectionName : ''}`}
      width={620}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" icon="Check" onClick={apply} disabled={!preview || preview.cells === 0}>
            {preview ? `Fill grid (${preview.cells})` : 'Fill grid'}
          </Button>
        </div>
      }
    >
      {subjects.length === 0 ? (
        <EmptyState icon="Lock" title="Nothing to upload" body="All subjects here are approved and locked." />
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-xs text-slate-600 space-y-1.5">
            <div className="font-semibold text-slate-700">All subjects in one sheet</div>
            <div>1. <b>Download the template</b> — one row per student, one column per subject ({subjects.map((s) => s.name).join(', ')}).</div>
            <div>2. <b>Handwritten?</b> Give your scan + the <b>copied prompt</b> to Gemini/Claude to get a CSV, then save it.</div>
            <div>3. <b>Upload</b> the filled Excel/CSV — marks are matched by Student ID and fill the grid for you to review &amp; submit.</div>
            <div className="flex gap-2 pt-1">
              <Button size="sm" icon="Download" onClick={downloadTemplate}>Template</Button>
              <Button size="sm" icon={copied ? 'Check' : 'Copy'} onClick={copyPrompt}>{copied ? 'Copied' : 'Copy AI prompt'}</Button>
            </div>
          </div>

          <label className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-dashed border-slate-300 text-sm text-slate-600 cursor-pointer hover:bg-slate-50">
            <Icon name="Upload" size={16} /> {fileName || 'Choose Excel / CSV file'}
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onPick} />
          </label>

          {error && <div className="px-3 py-2.5 bg-danger-50 text-danger-700 rounded-md text-sm">{error}</div>}

          {preview && (
            <div className="space-y-2">
              <div className={`px-3 py-2 rounded-md text-sm ${preview.cells > 0 ? 'bg-success-50 text-success-700' : 'bg-amber-50 text-amber-800'}`}>
                <b>{preview.cells}</b> marks · {preview.studentsMatched} students matched
                {preview.rowsUnmatched > 0 ? ` · ${preview.rowsUnmatched} row(s) unmatched` : ''}.
              </div>
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-50 max-h-40 overflow-y-auto">
                {preview.perSubject.map((s) => (
                  <div key={s.name} className="flex items-center justify-between px-3 py-1.5 text-sm">
                    <span className="text-slate-700">{s.name}</span>
                    <span className="text-slate-500 tabular-nums">{s.count} marks</span>
                  </div>
                ))}
              </div>
              {preview.subjectsMissing.length > 0 && (
                <div className="text-[11px] text-amber-700">No column matched: {preview.subjectsMissing.join(', ')}.</div>
              )}
              {preview.columnsUnmatched.length > 0 && (
                <div className="text-[11px] text-slate-500">Ignored columns: {preview.columnsUnmatched.join(', ')}.</div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ---------------- Approvals (admin) ---------------- */
interface PendingItem { id: string; assessment: string; type: string; className: string; section: string | null; subject: string; teacher: string; entered: number; roster: number; submittedAt: string | null }

export function ApprovalsTab() {
  const [items, setItems] = useState<PendingItem[] | null>(null);
  const [review, setReview] = useState<PendingItem | null>(null);
  const load = useCallback(async () => { const r = await fetch('/api/marks/pending'); setItems(r.ok ? (await r.json()).items : []); }, []);
  useEffect(() => { load(); }, [load]);

  const decide = async (id: string, action: 'approve' | 'return') => {
    const r = await fetch('/api/marks/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sheetId: id, action }) });
    if (!r.ok) alert((await r.json().catch(() => ({}))).error || 'Failed');
    setReview(null); load();
  };

  if (items === null) return <Skeleton height={160} rounded="lg" />;
  if (items.length === 0) return <Card><EmptyState icon="CheckCircle2" title="Nothing to approve" body="Submitted mark sheets from teachers appear here for verification." /></Card>;

  return (
    <>
      <Card padded={false}>
        <div className="divide-y divide-slate-100">
          {items.map((it) => (
            <div key={it.id} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 py-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <Chip tone={it.type === 'SUMMATIVE' ? 'info' : 'neutral'}>{it.type === 'SUMMATIVE' ? 'SA' : 'FA'}</Chip>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900 truncate">{it.assessment} · {shortClass(it.className)}{it.section ? ` ${it.section}` : ''} · {it.subject}</div>
                  <div className="text-xs text-slate-500">By {it.teacher} · {it.entered}/{it.roster} entered</div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 pl-11 sm:pl-0">
                <Button size="sm" onClick={() => setReview(it)}>Review</Button>
                <Button size="sm" onClick={() => decide(it.id, 'return')}>Return</Button>
                <Button size="sm" kind="primary" icon="Check" onClick={() => decide(it.id, 'approve')}>Approve</Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
      {review && <ReviewModal item={review} onClose={() => setReview(null)} onDecide={decide} />}
    </>
  );
}

function ReviewModal({ item, onClose, onDecide }: { item: PendingItem; onClose: () => void; onDecide: (id: string, a: 'approve' | 'return') => void }) {
  const [grid, setGrid] = useState<Grid | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => { const r = await fetch('/api/marks/sheet?sheetId=' + item.id); setGrid(r.ok ? await r.json() : null); setLoading(false); })(); }, [item.id]);
  return (
    <Modal open onClose={onClose} title="Review marks" subtitle={`${item.assessment} · ${shortClass(item.className)}${item.section ? ' ' + item.section : ''} · ${item.subject}`} width={520}
      footer={<div className="flex justify-end gap-2"><Button onClick={() => onDecide(item.id, 'return')}>Return to teacher</Button><Button kind="primary" icon="Check" onClick={() => onDecide(item.id, 'approve')}>Approve</Button></div>}>
      {loading ? <Skeleton height={240} /> : !grid ? <EmptyState icon="AlertCircle" title="Couldn't load" body="Please try again." /> : (
        <div className="space-y-2">
          <div className="text-xs text-slate-500 mb-1">Max {grid.maxMarks} · entered by {grid.enteredBy || '—'}</div>
          <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-[50vh] overflow-y-auto">
            {grid.students.map((s, i) => (
              <div key={s.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                <span className="w-5 text-xs text-slate-400">{i + 1}</span>
                <span className="flex-1 truncate text-slate-800">{s.name}</span>
                <span className={`tabular-nums font-medium ${s.isAbsent ? 'text-slate-400' : 'text-slate-900'}`}>{s.isAbsent ? 'AB' : (s.marksObtained ?? '—')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
