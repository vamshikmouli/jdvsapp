'use client';

import { toast } from '@/lib/toast';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { parseVoice, getSpeechRecognition } from '@/lib/marksVoice';
import { detectBrowser, voiceProblem } from '@/lib/browserCheck';
import { gradeOfMarks, marksForGrade, normGrade, type GradeBandLite } from '@/lib/grades';
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
// grades: the grade-scale labels when this is a grade-only subject (PE, Drawing…) — entered as a grade.
interface ClassGridSubject { id: string; name: string; gradeOnly?: boolean; grades?: string[]; max: number; status: 'DRAFT' | 'SUBMITTED' | 'APPROVED'; sheetId: string | null; canEdit: boolean; marks: Record<string, { marksObtained: number | null; isAbsent: boolean }> }
interface ClassGrid {
  assessment: { id: string; name: string; type: string; defaultMax: number };
  class: { id: string; name: string }; section: { id: string; name: string } | null;
  students: { id: string; name: string; roll: string | null }[];
  subjects: ClassGridSubject[]; isAdmin: boolean;
  bands?: GradeBandLite[];
}

function StatusPill({ s }: { s: string }) {
  const map: Record<string, string> = { DRAFT: 'bg-slate-100 text-slate-500', SUBMITTED: 'bg-amber-100 text-amber-700', APPROVED: 'bg-green-100 text-green-700' };
  return <span className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded ${map[s] || map.DRAFT}`}>{s}</span>;
}

// Absent: on number subjects any "A…" means AB; on grade subjects only "AB" (grades may start with A).
const isAbsentText = (t: string, grades?: string[]) => (grades ? /^(ab|absent)$/i : /^a/i).test((t || '').trim());
const cellInvalid = (t: string, max: number, grades?: string[]) => {
  const s = (t || '').trim();
  if (s === '' || isAbsentText(s, grades)) return false;
  if (grades) return !grades.some((g) => normGrade(g) === normGrade(s));
  const n = Number(s); return isNaN(n) || n < 0 || n > max;
};

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
  // Full-screen, one-subject-at-a-time entry (the phone-friendly view). Holds the subject shown.
  const [fullSubject, setFullSubject] = useState<string | null>(null);
  const [fullMode, setFullMode] = useState<EntryMode>('subject');
  const openFull = (subjectId: string, mode: EntryMode) => { setFullMode(mode); setFullSubject(subjectId); };
  const [dirty, setDirty] = useState(false);

  useEffect(() => { (async () => {
    const [a, c] = await Promise.all([fetch('/api/assessments'), fetch('/api/classes')]);
    setAssessments(a.ok ? (await a.json()).items : []);
    setClasses(c.ok ? await c.json() : []);
  })(); }, []);

  const cls = classes.find((c) => c.id === cId);
  const sections = cls?.sections || [];
  useEffect(() => { setSecId(''); setGrid(null); }, [cId]);

  const canLoad = !!(aId && cId && (sections.length === 0 || secId));

  // `refresh` = reload after a save: keep the current grid on screen (so the
  // full-screen entry stays open) instead of blanking it to a skeleton.
  const loadGrid = useCallback(async (refresh = false) => {
    if (!refresh) { setLoading(true); setGrid(null); }
    setError('');
    const qs = new URLSearchParams({ assessmentId: aId, classId: cId });
    if (secId) qs.set('sectionId', secId);
    const r = await fetch('/api/marks/grid?' + qs);
    if (r.ok) {
      const g: ClassGrid = await r.json();
      const bands = g.bands || [];
      for (const su of g.subjects) if (su.gradeOnly && bands.length) su.grades = bands.map((b) => b.label);
      setGrid(g);
      const v: Record<string, Record<string, string>> = {};
      for (const su of g.subjects) {
        v[su.id] = {};
        for (const st of g.students) {
          const m = su.marks[st.id];
          v[su.id][st.id] = !m ? '' : m.isAbsent ? 'AB' : m.marksObtained == null ? ''
            : su.grades ? (gradeOfMarks(m.marksObtained, su.max, bands) || String(m.marksObtained)) : String(m.marksObtained);
        }
      }
      setVals(v);
      setDirty(false);
    } else setError((await r.json().catch(() => ({}))).error || 'Failed to load');
    if (!refresh) setLoading(false);
  }, [aId, cId, secId]);
  useEffect(() => { if (canLoad) loadGrid(); }, [canLoad, loadGrid]);
  useEffect(() => { setFullSubject(null); }, [aId, cId, secId]);

  const setCell = (subId: string, stId: string, val: string) => { setVals((v) => ({ ...v, [subId]: { ...v[subId], [stId]: val } })); setDirty(true); };
  const filledCount = (subId: string) => grid ? grid.students.filter((st) => (vals[subId]?.[st.id] ?? '').trim() !== '').length : 0;

  const anyInvalid = grid ? grid.subjects.some((su) => grid.students.some((st) => cellInvalid(vals[su.id]?.[st.id] ?? '', su.max, su.grades))) : false;
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
          if (isAbsentText(t, su.grades)) return { studentId: st.id, isAbsent: true, marksObtained: null };
          // Grade-only subject: store the lowest mark of that grade's band (reports show the grade).
          if (su.grades) return { studentId: st.id, marksObtained: marksForGrade(t, su.max, grid.bands || []), isAbsent: false };
          return { studentId: st.id, marksObtained: Number(t), isAbsent: false };
        }),
      }));
      const r = await fetch('/api/marks/grid', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assessmentId: aId, classId: cId, sectionId: secId || null, action, subjects }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Failed');
      setToast(action === 'submit' ? 'Submitted for approval' : 'Saved'); await loadGrid(true); setTimeout(() => setToast(''), 2500);
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
            {/* Phones: pick a subject → full-screen entry (the table is too cramped to type into). */}
            <div className="sm:hidden divide-y divide-slate-100">
              <div className="p-3">
                <button onClick={() => openFull((editableSubjects[0] || grid.subjects[0]).id, 'student')}
                  className="w-full rounded-xl border-2 border-purple-200 bg-purple-50 text-purple-700 py-3 text-sm font-semibold inline-flex items-center justify-center gap-2">
                  <Icon name="User" size={16} /> Enter by student (all subjects)
                </button>
              </div>
              <div className="px-4 pb-2 text-[12px] text-slate-500">Or tap a subject to enter it for every student:</div>
              {grid.subjects.map((su) => {
                const n = filledCount(su.id);
                return (
                  <button key={su.id} onClick={() => openFull(su.id, 'subject')} className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-purple-50">
                    <div className="flex-1 min-w-0">
                      <div className="text-[15px] font-semibold text-slate-900 flex items-center gap-1.5">{su.name}{!su.canEdit && <Icon name="Lock" size={13} className="text-slate-400" />}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{su.grades ? "grade" : `max ${su.max}`} · <span className={n === grid.students.length ? 'text-success-700 font-semibold' : ''}>{n}/{grid.students.length} entered</span></div>
                    </div>
                    <StatusPill s={su.status} />
                    <Icon name="ChevronRight" size={18} className="text-slate-300" />
                  </button>
                );
              })}
            </div>
            <div className="hidden sm:block overflow-x-auto">
              <table className="text-sm border-collapse min-w-full">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-semibold text-slate-600 border-b border-slate-200 min-w-[130px] sm:min-w-[180px]">Student</th>
                    {grid.subjects.map((su) => (
                      <th key={su.id} className="px-2 py-2 text-center border-b border-l border-slate-200 min-w-[76px] align-top">
                        <div className="text-xs font-semibold text-slate-700 whitespace-nowrap flex items-center justify-center gap-1">{su.name}{!su.canEdit && <Icon name="Lock" size={11} className="text-slate-400" />}</div>
                        <div className="text-[10px] text-slate-400">{su.grades ? "grade" : `max ${su.max}`}</div>
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
                        const bad = cellInvalid(t, su.max, su.grades);
                        return (
                          <td key={su.id} className="px-1 py-1 text-center border-b border-l border-slate-100">
                            <input value={t} disabled={!su.canEdit} onChange={(e) => setCell(su.id, st.id, su.grades ? e.target.value.toUpperCase() : e.target.value)}
                              title={su.grades ? `Grade: ${su.grades.join(' / ')} or AB` : undefined}
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
            <div className="text-xs text-slate-500">Type a mark, or <b>A</b> for absent. {anyInvalid && <span className="text-danger-600 font-medium">Some marks exceed the max.</span>}
              {grid.subjects.some((s) => s.canEdit && s.status === 'APPROVED') && <div className="mt-0.5 text-success-700">Approved subjects you change stay approved — parents see the corrected marks straight away.</div>}</div>
            <div className="flex items-center gap-2">
              {toast && <span className="text-xs text-success-600 inline-flex items-center gap-1"><Icon name="Check" size={14} />{toast}</span>}
              {grid.subjects.length > 0 && grid.students.length > 0 && <span className="hidden sm:inline-flex"><Button icon="Maximize2" onClick={() => openFull((editableSubjects[0] || grid.subjects[0]).id, savedEntryMode())}>Full-screen entry</Button></span>}
              {editableSubjects.length > 0 && <Button icon="Upload" onClick={() => setUploadOpen(true)}>Upload marks</Button>}
              {editableSubjects.length > 0 ? (<>
                <Button onClick={() => save('save')} disabled={busy || anyInvalid}>Save draft</Button>
                <Button kind="primary" icon="Send" onClick={() => save('submit')} disabled={busy || anyInvalid}>Submit for approval</Button>
              </>) : <span className="text-xs text-slate-400">All subjects approved &amp; locked.</span>}
            </div>
          </div>
        </Card>
      )}

      {fullSubject && grid && (
        <FullScreenEntry grid={grid} vals={vals} subjectId={fullSubject} onSubject={setFullSubject} startMode={fullMode}
          setCell={setCell} filledCount={filledCount} dirty={dirty} busy={busy} anyInvalid={anyInvalid} toast={toast} error={error}
          canSave={editableSubjects.length > 0} onSave={save} onClose={() => setFullSubject(null)} />
      )}

      {uploadOpen && grid && (
        <UploadMarksModal
          assessmentName={grid.assessment.name}
          className={shortClass(grid.class.name)}
          sectionName={grid.section?.name || null}
          subjects={grid.subjects.filter((s) => s.canEdit).map((s) => ({ id: s.id, name: s.name, max: s.max, grades: s.grades }))}
          bands={grid.bands || []}
          students={grid.students}
          onClose={() => setUploadOpen(false)}
          onFill={(filled, summary) => {
            setVals((v) => {
              const nv = { ...v };
              for (const subId of Object.keys(filled)) nv[subId] = { ...(nv[subId] || {}), ...filled[subId] };
              return nv;
            });
            setUploadOpen(false);
            setDirty(true);
            setToast(summary);
            setTimeout(() => setToast(''), 4500);
          }}
        />
      )}
    </div>
  );
}

/* ---------------- Full-screen entry (phone-friendly) ---------------- */
// Two ways to work through the same marks:
//  • By subject — one subject, every student down the list (marking a pile of answer scripts).
//  • By student — one student, every subject (copying from a student's mark card).
// The last mode used is remembered on the device.
type EntryMode = 'subject' | 'student';
const MODE_KEY = 'marksEntryMode';
export const savedEntryMode = (): EntryMode => { try { return localStorage.getItem(MODE_KEY) === 'student' ? 'student' : 'subject'; } catch { return 'subject'; } };

// One big-box row: label on the left, mark box + AB on the right.
function MarkRow({ num, label, sub, value, max, grades, canEdit, last, active, flash, inputRef, onChange, onNext, onFocusRow }: {
  num: number; label: string; sub?: React.ReactNode; value: string; max: number; grades?: string[]; canEdit: boolean; last: boolean; active?: boolean; flash?: boolean;
  inputRef: (el: HTMLInputElement | null) => void; onChange: (v: string) => void; onNext: () => void; onFocusRow?: () => void;
}) {
  const ab = isAbsentText(value, grades);
  const bad = cellInvalid(value, max, grades);
  // Grade-only subject (PE, Drawing…): one tap on a grade button instead of typing a number.
  if (grades) {
    inputRef(null);
    const pick = (g: string) => { onFocusRow?.(); onChange(normGrade(value) === normGrade(g) ? '' : g); if (normGrade(value) !== normGrade(g)) onNext(); };
    return (
      <div data-active={active ? '1' : undefined} className={`px-4 py-2.5 border-b border-slate-100 ${bad ? 'bg-danger-50' : active ? 'bg-purple-50 shadow-[inset_4px_0_0_theme(colors.purple.500)]' : ''}`}>
        <div className="flex items-baseline gap-3">
          <span className="w-6 text-right text-xs text-slate-400 tabular-nums flex-shrink-0">{num}</span>
          <div className="flex-1 min-w-0 text-[15px] leading-snug text-slate-900 break-words flex items-center gap-1.5">{label}{!canEdit && <Icon name="Lock" size={12} className="text-slate-400 flex-shrink-0" />}</div>
          <span className="text-[11px] text-slate-400 flex-shrink-0">{sub || 'grade'}</span>
        </div>
        <div className={`mt-2 ml-9 flex flex-wrap gap-1.5 ${flash ? 'scale-[1.02]' : ''} transition-transform`}>
          {[...grades, 'AB'].map((g) => {
            const on = g === 'AB' ? ab : normGrade(value) === normGrade(g);
            return (
              <button key={g} type="button" disabled={!canEdit} onClick={() => pick(g)}
                className={`min-w-[44px] h-10 px-2.5 rounded-lg border-2 text-[14px] font-bold disabled:opacity-40 ${on ? (g === 'AB' ? 'border-slate-700 bg-slate-700 text-white' : 'border-purple-600 bg-purple-600 text-white') : 'border-slate-200 text-slate-600 bg-white'}`}>
                {g}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  const type = (raw: string) => {
    const v = raw.replace(/[^0-9.]/g, '').slice(0, 5);
    onChange(v);
    // Auto-advance once another digit could only exceed the max (max 50: "4" waits, "45" / "6" move on).
    const n = Number(v);
    if (v !== '' && !v.endsWith('.') && !isNaN(n) && n <= max && n * 10 > max) onNext();
  };
  return (
    <div data-active={active ? '1' : undefined} className={`flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 ${bad ? 'bg-danger-50' : active ? 'bg-purple-50 shadow-[inset_4px_0_0_theme(colors.purple.500)]' : ''}`}>
      <span className="w-6 text-right text-xs text-slate-400 tabular-nums flex-shrink-0">{num}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[15px] leading-snug text-slate-900 break-words flex items-center gap-1.5">{label}{!canEdit && <Icon name="Lock" size={12} className="text-slate-400 flex-shrink-0" />}</div>
        {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
      </div>
      <input
        ref={inputRef}
        value={ab ? 'AB' : value}
        readOnly={ab || !canEdit}
        disabled={!canEdit}
        inputMode="decimal" enterKeyHint={last ? 'done' : 'next'} autoComplete="off"
        onFocus={(e) => { e.currentTarget.select(); onFocusRow?.(); }}
        onChange={(e) => type(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onNext(); } }}
        placeholder="—"
        className={`w-[72px] h-12 flex-shrink-0 rounded-xl border-2 text-center text-xl font-bold tabular-nums outline-none focus:border-purple-500 focus:ring-4 focus:ring-purple-500/15
          ${flash ? '!border-success-500 !bg-success-50 scale-110' : ''} transition-transform duration-150
          ${bad ? 'border-danger-400 text-danger-700 bg-white' : ab ? 'border-slate-200 bg-slate-100 text-slate-500 text-base' : 'border-slate-200 text-slate-900'} ${!canEdit ? 'bg-slate-50 text-slate-400' : ''}`} />
      <button type="button" disabled={!canEdit}
        onClick={() => { onChange(ab ? '' : 'AB'); if (!ab) onNext(); }}
        className={`w-12 h-12 flex-shrink-0 rounded-xl border-2 text-[13px] font-bold ${ab ? 'border-slate-700 bg-slate-700 text-white' : 'border-slate-200 text-slate-500'} disabled:opacity-40`}
        title="Absent">AB</button>
    </div>
  );
}

function FullScreenEntry({ grid, vals, subjectId, onSubject, startMode, setCell, filledCount, dirty, busy, anyInvalid, toast, error, canSave, onSave, onClose }: {
  grid: ClassGrid; vals: Record<string, Record<string, string>>; subjectId: string; onSubject: (id: string) => void; startMode: EntryMode;
  setCell: (subId: string, stId: string, v: string) => void; filledCount: (subId: string) => number;
  dirty: boolean; busy: boolean; anyInvalid: boolean; toast: string; error: string;
  canSave: boolean; onSave: (a: 'save' | 'submit') => void; onClose: () => void;
}) {
  const [mode, setModeState] = useState<EntryMode>(startMode);
  const setMode = (m: EntryMode) => { setModeState(m); try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ } };
  const [stIdx, setStIdx] = useState(0);
  const su = grid.subjects.find((s) => s.id === subjectId) || grid.subjects[0];
  const subIdx = grid.subjects.findIndex((s) => s.id === su.id);
  const nextSubject = grid.subjects[subIdx + 1];
  const total = grid.students.length;
  const st = grid.students[Math.min(stIdx, total - 1)];
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const tabsRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef(false);
  const cell = (subId: string, stId: string) => vals[subId]?.[stId] ?? '';

  // ---- Voice entry: the current row (highlighted) gets the next spoken mark ----
  const [cur, setCur] = useState(0);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [voiceMsg, setVoiceMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const recRef = useRef<any>(null);
  const wantRef = useRef(false);
  const voiceMoved = useRef(false);
  const handleRef = useRef<(text: string, final?: boolean, key?: string, settle?: boolean) => void>(() => {});
  const sessRef = useRef(0); // recogniser restarts — keeps result keys unique
  type VRow = { subId: string; stId: string; max: number; grades?: string[]; canEdit: boolean; label: string; roll?: string | null };
  const rowsFor = (m: EntryMode, sIdx: number): VRow[] => m === 'subject'
    ? grid.students.map((x) => ({ subId: su.id, stId: x.id, max: su.max, grades: su.grades, canEdit: su.canEdit, label: x.name, roll: x.roll }))
    : grid.subjects.map((x) => ({ subId: x.id, stId: grid.students[sIdx].id, max: x.max, grades: x.grades, canEdit: x.canEdit, label: x.name }));
  const allGrades = (grid.bands || []).map((b) => b.label);

  // Position as of the last spoken mark — read/written synchronously, because live
  // (interim) results can arrive faster than React re-renders.
  const posRef = useRef({ cur: 0, st: 0 });
  useEffect(() => { posRef.current = { cur, st: stIdx }; }, [cur, stIdx]);
  // How many actions of each in-progress phrase were already applied from live results.
  const appliedRef = useRef(new Map<string, number>());
  // A trailing number that might still grow ("4" → "45") is entered after a short pause
  // instead of waiting 1–2 s for the speech service to close the phrase.
  const SETTLE_MS = 450;
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The mark entered on a pause, so it can be corrected if the phrase then grows.
  const settledRef = useRef<{ key: string; i: number; subId: string; stId: string; n: number } | null>(null);
  const [flashKey, setFlashKey] = useState('');
  const flash = (subId: string, stId: string) => {
    setFlashKey(`${subId}|${stId}`);
    try { navigator.vibrate?.(25); } catch { /* not supported */ }
    setTimeout(() => setFlashKey((k) => (k === `${subId}|${stId}` ? '' : k)), 450);
  };

  // Always the latest render's view of state (the recogniser's callbacks are created once).
  // `final` = the speech service has finished this phrase. Live (non-final) results are
  // applied straight away for everything that can't change any more — so "45" is
  // entered while the teacher is still talking, not after a pause.
  // `settle` = the teacher paused: apply the trailing number now, but keep the phrase open.
  handleRef.current = (text: string, final = true, key = '', settle = false) => {
    if (settleTimer.current) { clearTimeout(settleTimer.current); settleTimer.current = null; }
    if (!settle) setHeard(final ? text.trim() : text.trim() + '…');
    const acts = parseVoice(text, mode === 'student' ? grid.subjects : [], allGrades);
    const done = appliedRef.current.get(key) || 0;
    // A mark entered on a pause, then the phrase grew ("4" → "45"): fix that cell.
    const st = settledRef.current;
    if (st && st.key === key) {
      const a = acts[st.i];
      if (a && a.type === 'num' && a.n !== st.n) {
        const row = rowsFor(mode, posRef.current.st).find((r) => r.subId === st.subId && r.stId === st.stId) || null;
        const max = row ? row.max : Infinity;
        if (a.n <= max) { setCell(st.subId, st.stId, String(a.n)); flash(st.subId, st.stId); setVoiceMsg({ ok: true, text: `Corrected to ${a.n}` }); st.n = a.n; }
      }
      if (final) settledRef.current = null;
    }
    let held = false;
    let s = posRef.current.st;
    let rows = rowsFor(mode, s);
    const skipLocked = (j: number) => { while (j < rows.length && !rows[j].canEdit) j++; return j; };
    let idx = skipLocked(Math.min(posRef.current.cur, rows.length));
    let msg: { ok: boolean; text: string } | null = null;
    let applied = done;
    const advance = () => {
      idx = skipLocked(idx + 1);
      if (idx >= rows.length && mode === 'student' && s < total - 1) { s++; rows = rowsFor(mode, s); idx = skipLocked(0); }
    };
    for (let i = done; i < acts.length; i++) {
      const a = acts[i];
      const last = i === acts.length - 1;
      // A live grade at the end might still grow ("A" → "A1"): wait (briefly) for the phrase.
      if (!final && !settle && last && a.type === 'grade') { held = true; break; }
      // A live number at the end might still grow ("4" → "45", "forty" → "forty five"): wait briefly.
      if (!final && !settle && last && a.type === 'num') {
        const max = idx < rows.length ? rows[idx].max : 100;
        if (a.n * 10 <= max || (a.n >= 20 && a.n % 10 === 0)) { held = true; break; }
      }
      applied = i + 1;
      if (a.type === 'stop') { stopVoice(); break; }
      if (a.type === 'back') {
        if (idx > 0) idx--;
        else if (mode === 'student' && s > 0) { s--; rows = rowsFor(mode, s); idx = rows.length - 1; }
        continue;
      }
      if (a.type === 'roll') {
        if (mode !== 'subject') continue;
        const want = String(a.n);
        let j = rows.findIndex((x) => (x.roll || '').replace(/\D/g, '').replace(/^0+/, '') === want);
        if (j < 0 && a.n >= 1 && a.n <= rows.length) j = a.n - 1; // no roll numbers → list position
        if (j >= 0) idx = j; else msg = { ok: false, text: `No roll ${a.n} in this list.` };
        continue;
      }
      if (a.type === 'subject') { const j = rows.findIndex((x) => x.subId === a.id); if (j >= 0) idx = j; continue; }
      if (a.type === 'clear' && idx >= rows.length && rows.length) idx = rows.length - 1; // undo the last row of the list
      if (idx >= rows.length) { msg = { ok: false, text: 'End of the list.' }; break; }
      const row = rows[idx];
      if (a.type === 'next') { advance(); continue; }
      if (a.type === 'clear') {
        // Undo: if the current row is still empty, step back to the mark just entered.
        let target = row;
        if (!cell(row.subId, row.stId).trim() && idx > 0) { idx--; target = rows[idx]; }
        setCell(target.subId, target.stId, '');
        msg = { ok: true, text: `${target.label}: cleared — say the correct mark` };
        continue;
      }
      if (a.type === 'ab') { setCell(row.subId, row.stId, 'AB'); flash(row.subId, row.stId); msg = { ok: true, text: `${row.label}: AB` }; advance(); continue; }
      if (a.type === 'grade') {
        if (!row.grades) { msg = { ok: false, text: `${row.label} needs a mark (max ${row.max}), not a grade.` }; break; }
        setCell(row.subId, row.stId, a.label); flash(row.subId, row.stId); msg = { ok: true, text: `${row.label}: ${a.label}` }; advance(); continue;
      }
      if (a.type === 'num') {
        if (row.grades) { msg = { ok: false, text: `${row.label} needs a grade (${row.grades.slice(0, 4).join(', ')}…), not a number.` }; break; }
        if (a.n < 0 || a.n > row.max) { msg = { ok: false, text: `Heard ${a.n} for ${row.label} — over max ${row.max}. Say it again.` }; break; }
        setCell(row.subId, row.stId, String(a.n)); flash(row.subId, row.stId); msg = { ok: true, text: `${row.label}: ${a.n}` };
        if (settle && last) settledRef.current = { key, i, subId: row.subId, stId: row.stId, n: a.n };
        advance();
      }
    }
    if (final) appliedRef.current.delete(key); else appliedRef.current.set(key, applied);
    if (held && !final) settleTimer.current = setTimeout(() => handleRef.current(text, false, key, true), SETTLE_MS);
    if (final && !acts.length) msg = { ok: false, text: `Didn't catch a mark in "${text.trim()}".` };
    posRef.current = { cur: idx, st: s };
    if (s !== stIdx) { voiceMoved.current = true; setStIdx(s); }
    setCur(idx);
    if (msg) setVoiceMsg(msg);
  };

  const stopVoice = () => {
    wantRef.current = false;
    if (settleTimer.current) { clearTimeout(settleTimer.current); settleTimer.current = null; }
    try { recRef.current?.stop(); } catch { /* already stopped */ }
    setListening(false);
  };
  const startVoice = () => {
    const SR = getSpeechRecognition();
    // Tell the teacher exactly why voice can't start here (browser / https / offline).
    const browser = detectBrowser(navigator.userAgent, navigator.maxTouchPoints || 0);
    const problem = voiceProblem(browser, { secure: window.isSecureContext, hasVoice: !!SR, online: navigator.onLine });
    if (problem || !SR) { setVoiceMsg({ ok: false, text: `${problem || 'Voice entry is not available here.'} (You are using ${browser.label}.)` }); return; }
    const rec = new SR();
    rec.lang = 'en-IN';
    // Android Chrome's continuous mode repeats / merges results; there, listen phrase
    // by phrase and restart at once (onend). Elsewhere stay in continuous mode.
    rec.continuous = !/Android/i.test(navigator.userAgent);
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onstart = () => { sessRef.current++; appliedRef.current.clear(); };
    rec.onresult = (e: any) => {
      for (let k = e.resultIndex; k < e.results.length; k++) {
        const res = e.results[k];
        handleRef.current(res[0].transcript, res.isFinal, `${sessRef.current}-${k}`);
      }
    };
    rec.onerror = (e: any) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        wantRef.current = false; setListening(false);
        const ios = /iPhone|iPad/i.test(navigator.userAgent);
        setVoiceMsg({ ok: false, text: ios
          ? 'Microphone is blocked. On iPhone: Settings → Safari → Microphone → Allow (and Settings → Privacy → Speech Recognition → Safari on), then try again.'
          : 'Microphone is blocked. Tap the lock icon next to the web address → Permissions → Microphone → Allow, then try again.' });
      } else if (e.error === 'network') {
        setVoiceMsg({ ok: false, text: 'Voice needs an internet connection (speech is turned into text online).' });
      } else if (e.error === 'audio-capture') {
        wantRef.current = false; setListening(false);
        setVoiceMsg({ ok: false, text: 'No microphone found, or another app is using it. Close other apps using the mic and try again.' });
      } else if (e.error === 'language-not-supported') {
        wantRef.current = false; setListening(false);
        setVoiceMsg({ ok: false, text: 'English (India) speech isn\'t installed. On Android, update the "Google" and "Speech Services by Google" apps in the Play Store.' });
      }
    };
    // Browsers stop listening after a pause — keep going until the teacher says "stop".
    rec.onend = () => { if (wantRef.current) { try { rec.start(); } catch { /* restarting */ } } else setListening(false); };
    recRef.current = rec;
    wantRef.current = true;
    (document.activeElement as HTMLElement | null)?.blur(); // keep the on-screen keyboard closed while dictating
    setVoiceMsg(null); setHeard('');
    try { rec.start(); setListening(true); } catch { setVoiceMsg({ ok: false, text: 'Could not start the microphone.' }); }
  };
  useEffect(() => () => { wantRef.current = false; try { recRef.current?.stop(); } catch { /* ignore */ } }, []);
  // Keep the row being dictated in view.
  useEffect(() => { if (listening) listRef.current?.querySelector('[data-active="1"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [cur, listening, stIdx, su.id]);
  const studentFilled = (stId: string) => grid.subjects.filter((s) => cell(s.id, stId).trim() !== '').length;

  // Lock the page behind.
  useEffect(() => { const o = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = o; }; }, []);
  // Row refs are re-registered by index on every render; drop any left over from a longer list.
  inputs.current.length = mode === 'subject' ? total : grid.subjects.length;
  // New subject / student / mode → list back to the top, active chip in view.
  useEffect(() => {
    if (voiceMoved.current) voiceMoved.current = false; else setCur(0);
    if (!listening) listRef.current?.scrollTo({ top: 0 });
    tabsRef.current?.querySelector('[data-on="1"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
    if (pendingFocus.current) { pendingFocus.current = false; setTimeout(() => focusRow(0), 50); }
  }, [su.id, stIdx, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const focusRow = (i: number) => {
    const el = inputs.current[i];
    if (el && !el.disabled) { el.focus(); el.select(); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    if (el?.disabled) return focusRow(i + 1); // skip locked subjects
    const rowCount = mode === 'subject' ? total : grid.subjects.length;
    if (!el && i < rowCount) return focusRow(i + 1); // grade rows have buttons, not a box
    // Past the last row: in "by student", carry on with the next student.
    if (mode === 'student' && stIdx < total - 1) { pendingFocus.current = true; setStIdx(stIdx + 1); return; }
    (document.activeElement as HTMLElement | null)?.blur();
  };
  const goStudent = (i: number) => setStIdx(Math.max(0, Math.min(total - 1, i)));
  const close = () => {
    stopVoice();
    if (dirty && !window.confirm('You have unsaved marks. Close anyway? (They stay on the page until you leave it — tap Save draft to keep them.)')) return;
    onClose();
  };

  const nSub = filledCount(su.id);
  const badSub = grid.students.filter((x) => cellInvalid(cell(su.id, x.id), su.max, su.grades)).length;
  const nSt = st ? studentFilled(st.id) : 0;

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-white flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-2 px-3 pt-3 pb-2">
          <button onClick={close} className="p-2 -ml-1 rounded-lg text-slate-500 hover:bg-slate-100" title="Close"><Icon name="ArrowLeft" size={20} /></button>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-bold text-slate-900 truncate">{grid.assessment.name} · {shortClass(grid.class.name)}{grid.section ? ` ${grid.section.name}` : ''}</div>
            {mode === 'subject'
              ? <div className="text-xs text-slate-500">{su.name} · {su.grades ? <b>grade</b> : <>max <b>{su.max}</b></>} · <span className={nSub === total ? 'text-success-700 font-semibold' : ''}>{nSub}/{total} entered</span>{badSub > 0 && <span className="text-danger-600 font-semibold"> · {badSub} {su.grades ? 'not a valid grade' : 'over max'}</span>}</div>
              : <div className="text-xs text-slate-500">Student {stIdx + 1} of {total} · <span className={nSt === grid.subjects.length ? 'text-success-700 font-semibold' : ''}>{nSt}/{grid.subjects.length} subjects entered</span></div>}
          </div>
          {mode === 'subject' && <StatusPill s={su.status} />}
          <button onClick={listening ? stopVoice : startVoice} title={listening ? 'Stop voice entry' : 'Enter marks by voice'}
            className={`w-11 h-11 flex-shrink-0 rounded-full grid place-items-center border-2 ${listening ? 'bg-danger-500 border-danger-500 text-white animate-pulse' : 'border-purple-200 text-purple-700 bg-purple-50'}`}>
            <Icon name={listening ? 'MicOff' : 'Mic'} size={20} />
          </button>
        </div>
        {/* Mode switch */}
        <div className="px-3 pb-2">
          <div className="grid grid-cols-2 rounded-lg bg-slate-100 p-1 text-[13px] font-semibold">
            {([['subject', 'By subject', 'BookOpen'], ['student', 'By student', 'User']] as const).map(([m, label, icon]) => (
              <button key={m} onClick={() => setMode(m)}
                className={`inline-flex items-center justify-center gap-1.5 rounded-md py-1.5 ${mode === m ? 'bg-white text-purple-700 shadow-sm' : 'text-slate-500'}`}>
                <Icon name={icon} size={14} />{label}
              </button>
            ))}
          </div>
        </div>
        {(listening || voiceMsg) && (
          <div className="mx-3 mb-2 rounded-lg border border-purple-200 bg-purple-50/60 px-3 py-2 text-[12.5px]">
            {listening && (
              <div className="flex items-center gap-2 text-purple-800 font-semibold">
                <span className="w-2.5 h-2.5 rounded-full bg-danger-500 animate-pulse flex-shrink-0" />
                <span className="truncate">Listening{heard ? <span className="font-normal text-slate-600"> · heard “{heard}”</span> : '…'}</span>
              </div>
            )}
            {voiceMsg && <div className={`mt-0.5 font-semibold ${voiceMsg.ok ? 'text-success-700' : 'text-danger-700'}`}>{voiceMsg.ok ? '✓ ' : ''}{voiceMsg.text}</div>}
            {listening && <div className="mt-0.5 text-[11px] text-slate-500">Say marks one after another{allGrades.length ? ` · grades like “${allGrades[0]}”` : ''} · “absent” · “next” · “back” · “clear” · {mode === 'subject' ? '“roll 12”' : '“English 42”'} · “stop”</div>}
          </div>
        )}
        {mode === 'subject' ? (
          <div ref={tabsRef} className="flex gap-1.5 overflow-x-auto px-3 pb-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {grid.subjects.map((s) => {
              const c = filledCount(s.id);
              const on = s.id === su.id;
              return (
                <button key={s.id} data-on={on ? '1' : '0'} onClick={() => onSubject(s.id)}
                  className={`flex-shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-semibold ${on ? 'border-purple-500 bg-purple-600 text-white' : 'border-slate-200 text-slate-600 bg-white'}`}>
                  {!s.canEdit && <Icon name="Lock" size={12} />}{s.name}
                  <span className={`text-[11px] font-medium ${on ? 'text-white/80' : c === total ? 'text-success-600' : 'text-slate-400'}`}>{c}/{total}</span>
                </button>
              );
            })}
          </div>
        ) : st && (
          <div className="flex items-center gap-2 px-3 pb-2.5">
            <button onClick={() => goStudent(stIdx - 1)} disabled={stIdx === 0} className="w-11 h-11 flex-shrink-0 rounded-xl border-2 border-slate-200 grid place-items-center text-slate-600 disabled:opacity-30" title="Previous student"><Icon name="ChevronLeft" size={20} /></button>
            <select value={stIdx} onChange={(e) => goStudent(Number(e.target.value))}
              className="flex-1 min-w-0 h-11 rounded-xl border-2 border-purple-200 bg-purple-50/50 px-3 text-[15px] font-bold text-slate-900 truncate">
              {grid.students.map((x, i) => {
                const f = studentFilled(x.id);
                return <option key={x.id} value={i}>{i + 1}. {x.name}{x.roll ? ` (#${x.roll})` : ''} — {f === grid.subjects.length ? '✓' : `${f}/${grid.subjects.length}`}</option>;
              })}
            </select>
            <button onClick={() => goStudent(stIdx + 1)} disabled={stIdx >= total - 1} className="w-11 h-11 flex-shrink-0 rounded-xl border-2 border-slate-200 grid place-items-center text-slate-600 disabled:opacity-30" title="Next student"><Icon name="ChevronRight" size={20} /></button>
          </div>
        )}
      </div>

      {mode === 'subject' && !su.canEdit && <div className="flex-shrink-0 px-4 py-2 bg-slate-50 text-xs text-slate-500 flex items-center gap-1.5"><Icon name="Lock" size={13} /> {su.status === 'APPROVED' ? 'Approved — locked.' : 'You can view these marks but not change them.'}</div>}

      {/* Rows */}
      <div ref={listRef} className="flex-1 overflow-y-auto overscroll-contain">
        {mode === 'subject' ? (
          <>
            {grid.students.map((x, i) => (
              <MarkRow key={x.id} num={i + 1} label={x.name} sub={x.roll ? `Roll ${x.roll}` : undefined}
                value={cell(su.id, x.id)} max={su.max} grades={su.grades} canEdit={su.canEdit} last={i === total - 1}
                inputRef={(el) => { inputs.current[i] = el; }} active={listening && cur === i} onFocusRow={() => setCur(i)}
                flash={flashKey === `${su.id}|${x.id}`}
                onChange={(v) => setCell(su.id, x.id, v)} onNext={() => focusRow(i + 1)} />
            ))}
            {nextSubject && (
              <div className="p-4">
                <button onClick={() => onSubject(nextSubject.id)} className="w-full rounded-xl border-2 border-dashed border-purple-300 text-purple-700 py-3 text-sm font-semibold inline-flex items-center justify-center gap-1.5">
                  Next subject: {nextSubject.name} <Icon name="ArrowRight" size={16} />
                </button>
              </div>
            )}
          </>
        ) : st && (
          <>
            {grid.subjects.map((s, i) => (
              <MarkRow key={s.id} num={i + 1} label={s.name} sub={<>{s.grades ? 'grade' : `max ${s.max}`}{s.status !== 'DRAFT' ? ` · ${s.status.toLowerCase()}` : ''}</>}
                value={cell(s.id, st.id)} max={s.max} grades={s.grades} canEdit={s.canEdit} last={i === grid.subjects.length - 1 && stIdx === total - 1}
                inputRef={(el) => { inputs.current[i] = el; }} active={listening && cur === i} onFocusRow={() => setCur(i)}
                flash={flashKey === `${s.id}|${st.id}`}
                onChange={(v) => setCell(s.id, st.id, v)} onNext={() => focusRow(i + 1)} />
            ))}
            {stIdx < total - 1 && (
              <div className="p-4">
                <button onClick={() => { pendingFocus.current = true; goStudent(stIdx + 1); }} className="w-full rounded-xl border-2 border-dashed border-purple-300 text-purple-700 py-3 text-sm font-semibold inline-flex items-center justify-center gap-1.5">
                  Next student: {grid.students[stIdx + 1].name} <Icon name="ArrowRight" size={16} />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 border-t border-slate-200 bg-white px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
        {error && <div className="mb-2 text-xs text-danger-700">{error}</div>}
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 text-[11px] leading-tight">
            {toast ? <span className="text-success-600 font-semibold inline-flex items-center gap-1"><Icon name="Check" size={13} />{toast}</span>
              : anyInvalid ? <span className="text-danger-600 font-semibold">Fix marks above the max to save.</span>
              : dirty ? <span className="text-marigold-700 font-semibold">Unsaved changes</span>
              : <span className="text-slate-400">All saved</span>}
          </div>
          {canSave && <>
            <Button onClick={() => onSave('save')} disabled={busy || anyInvalid || !dirty}>{busy ? 'Saving…' : 'Save draft'}</Button>
            <Button kind="primary" icon="Send" onClick={() => onSave('submit')} disabled={busy || anyInvalid}>Submit</Button>
          </>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ---------------- Upload marks (all-subjects Excel/CSV → grid) ---------------- */
// One collapsible warning section in the upload preview. Renders nothing when empty.
function IssueBlock({ tone, title, items }: { tone: 'danger' | 'amber'; title: string; items: string[] }) {
  if (items.length === 0) return null;
  const c = tone === 'danger'
    ? { box: 'bg-danger-50 border-danger-100', head: 'text-danger-700', body: 'text-danger-600' }
    : { box: 'bg-amber-50 border-amber-100', head: 'text-amber-800', body: 'text-amber-700' };
  return (
    <details className={`rounded-md border px-3 py-2 text-sm ${c.box}`}>
      <summary className={`cursor-pointer font-medium ${c.head}`}>{title}</summary>
      <ul className={`mt-1.5 space-y-0.5 text-[12px] ${c.body} max-h-40 overflow-y-auto list-disc pl-4`}>
        {items.map((t, i) => <li key={i}>{t}</li>)}
      </ul>
    </details>
  );
}

interface UploadSubject { id: string; name: string; max: number; grades?: string[] }
interface UploadStudent { id: string; name: string; roll: string | null }

const uNorm = (s: any) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const uLetters = (s: any) => String(s ?? '').toUpperCase().replace(/[^A-Z]/g, '');
const uRoll = (s: any) => String(s ?? '').replace(/[^0-9]/g, '').replace(/^0+/, ''); // digits, no leading zeros

// Cheap edit-distance, used only to suggest the closest roster student for an
// unmatched row (a hint for the teacher — never used to auto-fill a mark).
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prevDiag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, prevDiag + (a[i - 1] === b[j - 1] ? 0 : 1));
      prevDiag = tmp;
    }
  }
  return prev[b.length];
}

function UploadMarksModal({
  assessmentName, className, sectionName, subjects, students, bands, onClose, onFill,
}: {
  assessmentName: string; className: string; sectionName: string | null;
  subjects: UploadSubject[]; students: UploadStudent[]; bands: GradeBandLite[];
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
    cells: number;
    // Accuracy report — everything the teacher must eyeball before filling.
    unmatchedRows: string[];    // CSV rows that matched no student (+ closest-name hint)
    outOfRange: string[];       // cells outside 0..max, or unreadable — NOT filled
    ambiguous: string[];        // a row's name matched more than one student
    conflicts: string[];        // same student+subject given two different marks
    missingStudents: string[];  // roster students with no mark at all
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
    const header = ['Student ID', 'Roll', 'Name', ...subjects.map((s) => s.name)].join(',');
    const maxes = subjects.map((s) => `${s.name}=${s.max}`).join(', ');
    const text = `You are transcribing a photo/scan of a handwritten marks sheet (${assessmentName}, Class ${className}${sectionName ? ' ' + sectionName : ''}). Accuracy is critical.
Output ONLY a CSV table — nothing else, no explanation, no markdown fences. The first line must be exactly this header:
${header}
Then one line per student. Rules:
- Copy the Student ID and Roll EXACTLY as printed — these are how each mark is matched to the right child. If a digit is unclear, transcribe your best single reading (do not guess a different student).
- Fill each subject column with that student's number only. Write AB if absent. Leave the cell blank if no mark is written.
- A mark must be within its subject's range: ${maxes}. Never output a mark above the maximum. If a value looks impossible (e.g. above the max), leave it blank rather than guessing.
- One row per student, in the same order as the sheet. Do NOT invent, merge, reorder, or skip students, and do not add totals or extra rows.
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
      const idCols: string[] = [], nameCols: string[] = [], rollCols: string[] = [];
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
        if (/ADMISSION|ADMNO|ADM|^ID$|STUDENTID/.test(hn)) { idCols.push(h); continue; }
        if (/^ROLL|SLNO|^SL$|^SNO$/.test(hn)) { rollCols.push(h); continue; }
        if (/^NAME$|STUDENT/.test(hn)) { nameCols.push(h); continue; }
        const su = matchSubject(h);
        if (su) colToSubject[h] = su; else columnsUnmatched.push(h);
      }

      // Lookup keys. Names/rolls that map to 2+ students are AMBIGUOUS — never
      // auto-matched by that weaker key (we don't want to guess the wrong child).
      const byId = new Map(students.map((s) => [s.id, s]));
      const nameCount = new Map<string, number>();
      const rollCount = new Map<string, number>();
      for (const s of students) {
        const nk = uLetters(s.name); if (nk) nameCount.set(nk, (nameCount.get(nk) || 0) + 1);
        const rk = uRoll(s.roll); if (rk) rollCount.set(rk, (rollCount.get(rk) || 0) + 1);
      }
      const byName = new Map<string, UploadStudent>();
      const byRoll = new Map<string, UploadStudent>();
      for (const s of students) {
        const nk = uLetters(s.name); if (nk && nameCount.get(nk) === 1) byName.set(nk, s);
        const rk = uRoll(s.roll); if (rk && rollCount.get(rk) === 1) byRoll.set(rk, s);
      }
      const rosterLetters = students.map((s) => ({ s, nk: uLetters(s.name) }));

      const filled: Record<string, Record<string, string>> = {};
      const perSubjectCount: Record<string, number> = {};
      const filledStudents = new Set<string>();
      const matchedRowFor = new Map<string, number>(); // studentId → first row index that claimed them
      const unmatchedRows: string[] = [], outOfRange: string[] = [], ambiguous: string[] = [], conflicts: string[] = [];
      let cells = 0;

      // A readable label for a raw CSV row (for the report).
      const rowLabel = (r: any, idx: number) => {
        const id = idCols.map((c) => String(r[c] ?? '').trim()).find(Boolean);
        const roll = rollCols.map((c) => String(r[c] ?? '').trim()).find(Boolean);
        const name = nameCols.map((c) => String(r[c] ?? '').trim()).find(Boolean);
        return [name || `Row ${idx + 2}`, id ? `ID ${id}` : '', roll ? `Roll ${roll}` : ''].filter(Boolean).join(' · ');
      };

      rows.forEach((r, idx) => {
        // Match: Student ID (exact) → Roll (exact, unique) → Name (exact, unique).
        let stu: UploadStudent | undefined;
        for (const c of idCols) { const v = String(r[c] ?? '').trim(); if (v && byId.has(v)) { stu = byId.get(v); break; } }
        if (!stu) for (const c of rollCols) { const v = uRoll(r[c]); if (v && byRoll.has(v)) { stu = byRoll.get(v); break; } }
        if (!stu) for (const c of nameCols) { const v = uLetters(r[c]); if (v && byName.has(v)) { stu = byName.get(v); break; } }

        if (!stu) {
          // Flag ambiguous vs. truly unmatched, with a closest-name hint.
          const nk = nameCols.map((c) => uLetters(r[c])).find(Boolean) || '';
          if (nk && nameCount.get(nk)! > 1) {
            ambiguous.push(`${rowLabel(r, idx)} — name matches ${nameCount.get(nk)} students; fill by Student ID.`);
          } else {
            let hint = '';
            if (nk) {
              let best = Infinity, bestName = '';
              for (const { s, nk: rn } of rosterLetters) { if (!rn) continue; const d = editDistance(nk, rn); if (d < best) { best = d; bestName = s.name; } }
              if (bestName && best <= Math.max(2, Math.floor(nk.length * 0.25))) hint = ` — did you mean ${bestName}?`;
            }
            unmatchedRows.push(`${rowLabel(r, idx)}${hint}`);
          }
          return;
        }

        // Same student claimed by an earlier row → don't overwrite; flag it.
        if (matchedRowFor.has(stu.id) && matchedRowFor.get(stu.id) !== idx) {
          conflicts.push(`${stu.name} appears in more than one row — kept the first.`);
          return;
        }
        matchedRowFor.set(stu.id, idx);

        for (const [col, su] of Object.entries(colToSubject)) {
          const raw = String(r[col] ?? '').trim();
          if (raw === '' || raw === '-' || raw === '—') continue; // no mark given
          if (su.grades) {
            // Grade-only subject: a grade label ("A1"), AB, or a number converted to its grade.
            const lbl = su.grades.find((g) => normGrade(g) === normGrade(raw));
            const asNum = Number(raw.replace(/[^0-9.]/g, ''));
            const cell = /^(AB|ABS|ABSENT)$/i.test(raw) ? 'AB' : lbl || (raw.match(/^[0-9.]+$/) && !isNaN(asNum) && asNum <= su.max ? gradeOfMarks(Math.round(asNum), su.max, bands) : null);
            if (!cell) { outOfRange.push(`${stu.name} · ${su.name}: "${raw}" is not a grade (${su.grades.join(', ')})`); continue; }
            (filled[su.id] ||= {})[stu.id] = cell; filledStudents.add(stu.id); perSubjectCount[su.name] = (perSubjectCount[su.name] || 0) + 1; cells++;
            continue;
          }
          if (/^(AB|ABS|ABSENT|A)$/i.test(raw)) { (filled[su.id] ||= {})[stu.id] = 'AB'; filledStudents.add(stu.id); perSubjectCount[su.name] = (perSubjectCount[su.name] || 0) + 1; cells++; continue; }
          const n = Number(raw.replace(/[^0-9.]/g, ''));
          if (isNaN(n)) { outOfRange.push(`${stu.name} · ${su.name}: "${raw}" is not a number`); continue; }
          const rounded = Math.round(n);
          if (rounded < 0 || rounded > su.max) { outOfRange.push(`${stu.name} · ${su.name}: ${raw} (allowed 0–${su.max})`); continue; }
          const cell = String(rounded);
          const existing = filled[su.id]?.[stu.id];
          if (existing != null && existing !== cell) { conflicts.push(`${stu.name} · ${su.name}: two different marks (${existing} vs ${cell}) — kept ${existing}.`); continue; }
          (filled[su.id] ||= {})[stu.id] = cell;
          filledStudents.add(stu.id);
          perSubjectCount[su.name] = (perSubjectCount[su.name] || 0) + 1;
          cells++;
        }
      });

      const matchedSubjectIds = new Set(Object.values(colToSubject).map((s) => s.id));
      const missingStudents = students.filter((s) => !filledStudents.has(s.id)).map((s) => `${s.roll ? s.roll + '. ' : ''}${s.name}`);
      setPreview({
        filled,
        perSubject: Object.entries(perSubjectCount).map(([name, count]) => ({ name, count })),
        subjectsMissing: subjects.filter((s) => !matchedSubjectIds.has(s.id)).map((s) => s.name),
        columnsUnmatched,
        studentsMatched: filledStudents.size,
        cells,
        unmatchedRows,
        outOfRange,
        ambiguous,
        conflicts,
        missingStudents,
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
            <div>3. <b>Upload</b> the filled Excel/CSV — marks are matched by Student ID (then Roll, then Name) and fill the grid. Anything unmatched or out of range is flagged for you to fix before submitting.</div>
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
                <b>{preview.cells}</b> marks · {preview.studentsMatched} of {students.length} students matched.
              </div>
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-50 max-h-40 overflow-y-auto">
                {preview.perSubject.map((s) => (
                  <div key={s.name} className="flex items-center justify-between px-3 py-1.5 text-sm">
                    <span className="text-slate-700">{s.name}</span>
                    <span className="text-slate-500 tabular-nums">{s.count} marks</span>
                  </div>
                ))}
              </div>

              {/* Accuracy report — anything that could be wrong is shown, not hidden. */}
              <IssueBlock tone="danger" title={`${preview.outOfRange.length} mark(s) out of range / unreadable — not filled`} items={preview.outOfRange} />
              <IssueBlock tone="danger" title={`${preview.unmatchedRows.length} row(s) matched no student — their marks are dropped`} items={preview.unmatchedRows} />
              <IssueBlock tone="amber" title={`${preview.conflicts.length} conflict(s)`} items={preview.conflicts} />
              <IssueBlock tone="amber" title={`${preview.ambiguous.length} ambiguous name(s)`} items={preview.ambiguous} />
              <IssueBlock tone="amber" title={`${preview.missingStudents.length} student(s) with no mark`} items={preview.missingStudents} />

              {preview.subjectsMissing.length > 0 && (
                <div className="text-[11px] text-amber-700">No column matched: {preview.subjectsMissing.join(', ')}.</div>
              )}
              {preview.columnsUnmatched.length > 0 && (
                <div className="text-[11px] text-slate-500">Ignored columns: {preview.columnsUnmatched.join(', ')}.</div>
              )}
              <p className="text-[11px] text-slate-400">Marks fill the grid as a draft — review every value, fix anything flagged above, then submit.</p>
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
    if (!r.ok) toast.error((await r.json().catch(() => ({}))).error || 'Failed');
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
