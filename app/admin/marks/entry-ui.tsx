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
          assessmentId={aId}
          classId={cId}
          sectionId={secId || null}
          assessmentName={grid.assessment.name}
          className={shortClass(grid.class.name)}
          sectionName={grid.section?.name || null}
          subjects={grid.subjects.filter((s) => s.canEdit).map((s) => ({ id: s.id, name: s.name, max: s.max }))}
          students={grid.students}
          onClose={() => setUploadOpen(false)}
          onApplied={() => { setUploadOpen(false); setToast('Marks imported as draft — review and submit'); loadGrid(); setTimeout(() => setToast(''), 3500); }}
        />
      )}
    </div>
  );
}

/* ---------------- Upload marks (typed PDF / Excel → draft) ---------------- */
interface UploadSubject { id: string; name: string; max: number }
interface UploadStudent { id: string; name: string; roll: string | null }
interface UploadPreview {
  roster: number; matched: number; maxMarks: number;
  rows: { studentId: string; name: string; roll: string | null; marks: number | null; isAbsent: boolean; matchedBy: 'admission' | 'roll' | 'name' | null }[];
  extraneous: string[];
}

function UploadMarksModal({
  assessmentId, classId, sectionId, assessmentName, className, sectionName, subjects, students, onClose, onApplied,
}: {
  assessmentId: string; classId: string; sectionId: string | null;
  assessmentName: string; className: string; sectionName: string | null;
  subjects: UploadSubject[]; students: UploadStudent[];
  onClose: () => void; onApplied: () => void;
}) {
  const [subjectId, setSubjectId] = useState(subjects[0]?.id || '');
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState<UploadPreview | null>(null);

  const sub = subjects.find((s) => s.id === subjectId);

  const downloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet(students.map((s, i) => ({ 'Admission No': s.id, 'Roll': s.roll ?? i + 1, 'Name': s.name, 'Marks': '' })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Marks');
    XLSX.writeFile(wb, `marks-${className}-${(sub?.name || 'subject').replace(/\s+/g, '_')}.xlsx`);
  };

  const copyPrompt = async () => {
    const text = `You are given a photo or scan of a handwritten marks sheet for "${sub?.name}" (${assessmentName}), Class ${className}${sectionName ? ' ' + sectionName : ''}, maximum marks ${sub?.max}.
Transcribe it into a plain text table with ONE LINE PER STUDENT in exactly this format (no extra text, no markdown):
Admission No | Name | Marks
Rules:
- Copy the Admission No exactly as printed.
- Put the handwritten mark in the Marks column. Write AB if the student was absent.
- Do not invent students or marks.
Then export or print the result as a PDF and upload that PDF.`;
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };

  const send = async (apply: boolean, f: File | null) => {
    if (!f || !subjectId) return;
    if (apply) setApplying(true); else setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('assessmentId', assessmentId);
      fd.append('classId', classId);
      if (sectionId) fd.append('sectionId', sectionId);
      fd.append('subjectId', subjectId);
      fd.append('apply', apply ? 'true' : 'false');
      const r = await fetch('/api/marks/upload', { method: 'POST', body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Upload failed');
      if (apply) { onApplied(); return; }
      setPreview(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
      setPreview(null);
    } finally {
      setBusy(false); setApplying(false);
    }
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    e.target.value = '';
    setPreview(null); setError('');
    setFile(f); setFileName(f?.name || '');
    if (f) send(false, f);
  };

  const blanks = preview ? preview.rows.filter((r) => !r.matchedBy).map((r) => r.name) : [];

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
          <Button kind="primary" icon="Check" onClick={() => send(true, file)} disabled={!preview || applying || preview.matched === 0}>
            {applying ? 'Importing…' : `Import ${preview?.matched || 0} as draft`}
          </Button>
        </div>
      }
    >
      {subjects.length === 0 ? (
        <EmptyState icon="Lock" title="Nothing to upload" body="All subjects here are approved and locked." />
      ) : (
        <div className="space-y-4">
          <Field label="Subject">
            <Select value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setPreview(null); }}>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name} (max {s.max})</option>)}
            </Select>
          </Field>

          <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-xs text-slate-600 space-y-1.5">
            <div className="font-semibold text-slate-700">How it works</div>
            <div>1. <b>Download the template</b> (or write marks on the printed sheet).</div>
            <div>2. <b>Handwritten?</b> Give your scan + the <b>copied prompt</b> to Gemini or Claude to get a clean typed PDF.</div>
            <div>3. <b>Upload</b> the typed PDF (or the filled Excel). Marks are matched by Admission No and saved as a draft for you to review.</div>
            <div className="flex gap-2 pt-1">
              <Button size="sm" icon="Download" onClick={downloadTemplate}>Template</Button>
              <Button size="sm" icon={copied ? 'Check' : 'Copy'} onClick={copyPrompt}>{copied ? 'Copied' : 'Copy AI prompt'}</Button>
            </div>
          </div>

          <label className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-dashed border-slate-300 text-sm text-slate-600 cursor-pointer hover:bg-slate-50">
            <Icon name="Upload" size={16} /> {busy ? 'Reading…' : fileName || 'Choose PDF / Excel file'}
            <input type="file" accept=".pdf,.xlsx,.xls,.csv" className="hidden" onChange={onPick} disabled={busy || applying} />
          </label>

          {error && <div className="px-3 py-2.5 bg-danger-50 text-danger-700 rounded-md text-sm">{error}</div>}

          {preview && (
            <div>
              <div className={`px-3 py-2 rounded-md text-sm mb-2 ${preview.matched > 0 ? 'bg-success-50 text-success-700' : 'bg-amber-50 text-amber-800'}`}>
                Matched <b>{preview.matched}</b> of {preview.roster} students (max {preview.maxMarks}).
              </div>
              <div className="max-h-52 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-50">
                {preview.rows.map((r) => (
                  <div key={r.studentId} className="flex items-center justify-between px-3 py-1.5 text-sm">
                    <span className="text-slate-700 truncate">{r.name}</span>
                    <span className="flex items-center gap-2 flex-shrink-0">
                      {r.matchedBy
                        ? <span className="tabular-nums font-medium text-slate-900">{r.isAbsent ? 'AB' : r.marks}</span>
                        : <span className="text-[11px] text-amber-600">no mark</span>}
                      {r.matchedBy && r.matchedBy !== 'admission' && <span className="text-[10px] text-slate-400">by {r.matchedBy}</span>}
                    </span>
                  </div>
                ))}
              </div>
              {blanks.length > 0 && <div className="text-[11px] text-amber-700 mt-2">{blanks.length} student{blanks.length === 1 ? '' : 's'} got no mark — fill them in the grid after importing.</div>}
              {preview.extraneous.length > 0 && (
                <div className="text-[11px] text-slate-500 mt-1">{preview.extraneous.length} line(s) in the file didn’t match any student.</div>
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
