'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { PageHeader, Button, Card, Field, Input, Select, EmptyState, Skeleton } from '@/components/Primitives';
import { Icon } from '@/components/Icon';

const shortClass = (n: string | null) => (n ? n.replace(/\s?STD$/i, '') : '—');
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');

interface AssessmentOpt { id: string; name: string; type: string; term: string | null }
interface TTRow { date: string; day: string; subject: string; session: string; time: string; custom?: Record<string, string> }
interface Config {
  title: string; examLabel: string; instructions: string;
  fields: { photo: boolean; admissionNo: boolean; class: boolean; section: boolean; roll: boolean; dob: boolean; father: boolean; mother: boolean; address: boolean };
  showTimetable: boolean; timetable: TTRow[];
  // Which timetable columns to print (Subject is always shown).
  ttColumns: { date: boolean; day: boolean; session: boolean; time: boolean; invigilatorSign: boolean };
  // Extra columns the admin adds — printed between Time and Invigilator Sign.
  customColumns: { id: string; label: string }[];
  signatories: string[]; perPage: 1 | 2;
}

const DEFAULT_CONFIG: Config = {
  title: 'HALL TICKET',
  examLabel: '',
  instructions: '1. Bring this hall ticket to every exam.\n2. Reach the exam hall 15 minutes early.\n3. Mobile phones are not allowed.\n4. Clear all dues before the exam.',
  fields: { photo: true, admissionNo: true, class: true, section: true, roll: false, dob: true, father: true, mother: false, address: false },
  showTimetable: true, timetable: [],
  ttColumns: { date: true, day: true, session: true, time: true, invigilatorSign: true },
  customColumns: [],
  signatories: ['Class Teacher', 'Head Master', 'Principal'], perPage: 2,
};

export default function HallTicketsPage() {
  const [assessments, setAssessments] = useState<AssessmentOpt[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [csMap, setCsMap] = useState<Record<string, string[]>>({});
  const [subjects, setSubjects] = useState<{ id: string; name: string }[]>([]);
  const [school, setSchool] = useState<{ schoolName: string; address: string | null; phone: string | null } | null>(null);

  const [aId, setAId] = useState(''); const [cId, setCId] = useState(''); const [secId, setSecId] = useState('');
  const [students, setStudents] = useState<any[] | null>(null);
  const [loadingRoster, setLoadingRoster] = useState(false);

  const [cfg, setCfg] = useState<Config>(DEFAULT_CONFIG);

  // Load saved config (per device).
  useEffect(() => {
    try { const s = localStorage.getItem('hallTicketConfig'); if (s) setCfg({ ...DEFAULT_CONFIG, ...JSON.parse(s) }); } catch {}
  }, []);
  const save = (next: Config) => { setCfg(next); try { localStorage.setItem('hallTicketConfig', JSON.stringify(next)); } catch {} };
  const set = <K extends keyof Config>(k: K, v: Config[K]) => save({ ...cfg, [k]: v });
  const setField = (k: keyof Config['fields'], v: boolean) => save({ ...cfg, fields: { ...cfg.fields, [k]: v } });

  useEffect(() => {
    (async () => {
      const [a, c, s, m, st] = await Promise.all([
        fetch('/api/assessments'), fetch('/api/classes'), fetch('/api/subjects'), fetch('/api/class-subjects'), fetch('/api/settings'),
      ]);
      setAssessments(a.ok ? (await a.json()).items : []);
      setClasses(c.ok ? await c.json() : []);
      setSubjects((s.ok ? await s.json() : []).filter((x: any) => x.active).map((x: any) => ({ id: x.id, name: x.name })));
      setCsMap(m.ok ? (await m.json()).map : {});
      if (st.ok) { const d = await st.json(); setSchool({ schoolName: d.schoolName, address: d.address, phone: d.phone }); }
    })();
  }, []);

  const cls = classes.find((c) => c.id === cId);
  const sections = cls?.sections || [];
  const classSubjects = useMemo(() => { const ids = csMap[cId] || []; return subjects.filter((s) => ids.includes(s.id)); }, [csMap, cId, subjects]);

  const loadRoster = useCallback(async () => {
    if (!cId) { setStudents(null); return; }
    setLoadingRoster(true);
    const r = await fetch(`/api/students?classId=${cId}&status=ACTIVE`);
    let list: any[] = r.ok ? await r.json() : [];
    if (secId) list = list.filter((s) => s.sectionId === secId);
    list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    setStudents(list); setLoadingRoster(false);
  }, [cId, secId]);
  useEffect(() => { loadRoster(); }, [loadRoster]);

  const assessment = assessments.find((a) => a.id === aId);
  const examTitle = cfg.examLabel || (assessment ? assessment.name + (assessment.term ? ` · ${assessment.term}` : '') : '');

  const loadTimetableSubjects = () => set('timetable', classSubjects.map((s) => ({ date: '', day: '', subject: s.name, session: '', time: '' })));
  const addTT = () => set('timetable', [...cfg.timetable, { date: '', day: '', subject: '', session: '', time: '' }]);
  const setTT = (i: number, key: 'date' | 'day' | 'subject' | 'session' | 'time', v: string) => set('timetable', cfg.timetable.map((r, j) => (j === i ? { ...r, [key]: v } : r)));
  const delTT = (i: number) => set('timetable', cfg.timetable.filter((_, j) => j !== i));
  // Admin-added custom columns.
  const setTTCustom = (i: number, colId: string, v: string) => set('timetable', cfg.timetable.map((r, j) => (j === i ? { ...r, custom: { ...(r.custom || {}), [colId]: v } } : r)));
  const addCol = () => set('customColumns', [...cfg.customColumns, { id: `col${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, label: '' }]);
  const renameCol = (ci: number, label: string) => set('customColumns', cfg.customColumns.map((c, j) => (j === ci ? { ...c, label } : c)));
  const removeCol = (ci: number) => set('customColumns', cfg.customColumns.filter((_, j) => j !== ci));

  const ready = aId && cId && students && students.length > 0;

  return (
    <>
      <style>{`
        @page { size: A4 portrait; margin: 8mm; }
        @media print {
          body { visibility: hidden; }
          #tickets, #tickets * { visibility: visible; }
          /* Single vertical column: tickets stack top-to-bottom, never side by side.
             display/width/float/column-count are pinned so no stray rule can lay
             the cards out horizontally. */
          #tickets { position: absolute; left: 0; top: 0; width: 100%; display: block; column-count: 1; }
          .no-print { display: none !important; }
          .ht-card {
            box-shadow: none !important;
            display: block; width: 100%; float: none; clear: both;
            break-inside: avoid; page-break-inside: avoid;
            margin: 0 0 5mm 0;
          }
          /* 2-up sizing, but the card GROWS with content instead of clipping it —
             a tall ticket just pushes its partner to the next page (page-break-inside
             is avoided), so nothing is ever cut off the sheet. */
          .ht-2up { min-height: 130mm; }
        }
      `}</style>

      <PageHeader eyebrow="Academics" title="Hall tickets" meta="Generate and print exam admit cards — fully customisable."
        actions={ready ? <Button kind="primary" icon="Printer" onClick={() => window.print()}>Print {students!.length} tickets</Button> : undefined} />

      <div className="no-print mt-6 grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Controls */}
        <div className="lg:col-span-1 space-y-4">
          <Card title="Exam & class">
            <div className="space-y-3">
              <Field label="Exam (assessment)"><Select value={aId} onChange={(e) => setAId(e.target.value)}><option value="">Select…</option>{assessments.map((a) => <option key={a.id} value={a.id}>{a.name}{a.term ? ` · ${a.term}` : ''}</option>)}</Select></Field>
              <Field label="Class"><Select value={cId} onChange={(e) => { setCId(e.target.value); setSecId(''); }}><option value="">Select…</option>{classes.map((c) => <option key={c.id} value={c.id}>{shortClass(c.name)}</option>)}</Select></Field>
              <Field label="Section"><Select value={secId} onChange={(e) => setSecId(e.target.value)} disabled={sections.length === 0}>{sections.length === 0 ? <option value="">All / whole class</option> : <><option value="">All sections</option>{sections.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</>}</Select></Field>
            </div>
          </Card>

          <Card title="Header & text">
            <div className="space-y-3">
              <Field label="Title"><Input value={cfg.title} onChange={(e) => set('title', e.target.value)} /></Field>
              <Field label="Exam label" hint="Blank = uses the assessment name"><Input value={cfg.examLabel} onChange={(e) => set('examLabel', e.target.value)} placeholder={assessment?.name || 'e.g. Term 1 Examination'} /></Field>
              <Field label="Instructions"><textarea value={cfg.instructions} onChange={(e) => set('instructions', e.target.value)} rows={5} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none resize-y" /></Field>
              <Field label="Signature labels" hint="Comma-separated"><Input value={cfg.signatories.join(', ')} onChange={(e) => set('signatories', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} /></Field>
              <Field label="Tickets per page"><Select value={String(cfg.perPage)} onChange={(e) => set('perPage', Number(e.target.value) as 1 | 2)}><option value="2">2 per page</option><option value="1">1 per page</option></Select></Field>
            </div>
          </Card>

          <Card title="Student fields">
            <div className="grid grid-cols-2 gap-2">
              {([
                ['photo', 'Photo box'], ['admissionNo', 'Student ID'], ['class', 'Class'], ['section', 'Section'],
                ['roll', 'Roll no'], ['dob', 'Date of birth'], ['father', "Father's name"], ['mother', "Mother's name"], ['address', 'Address'],
              ] as [keyof Config['fields'], string][]).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={cfg.fields[k]} onChange={(e) => setField(k, e.target.checked)} className="rounded border-slate-300 text-purple-600 focus:ring-purple-500/20" />{label}
                </label>
              ))}
            </div>
          </Card>

          <Card title="Exam timetable" action={<label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer"><input type="checkbox" checked={cfg.showTimetable} onChange={(e) => set('showTimetable', e.target.checked)} className="rounded border-slate-300 text-purple-600 focus:ring-purple-500/20" />Show</label>}>
            {cfg.showTimetable && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Button size="sm" onClick={loadTimetableSubjects} disabled={!cId}>Load class subjects</Button>
                  <Button size="sm" icon="Plus" onClick={addTT}>Add row</Button>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 border-t border-slate-100 pt-2">
                  <span className="text-slate-400">Columns:</span>
                  {([['date', 'Date'], ['day', 'Day'], ['session', 'Session'], ['time', 'Time'], ['invigilatorSign', 'Invigilator sign']] as [keyof Config['ttColumns'], string][]).map(([k, label]) => (
                    <label key={k} className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={cfg.ttColumns[k]} onChange={(e) => set('ttColumns', { ...cfg.ttColumns, [k]: e.target.checked })} className="rounded border-slate-300 text-purple-600 focus:ring-purple-500/20" />{label}
                    </label>
                  ))}
                </div>
                <div className="border-t border-slate-100 pt-2 space-y-1.5">
                  <div className="text-xs text-slate-400">Custom columns</div>
                  {cfg.customColumns.map((col, ci) => (
                    <div key={col.id} className="flex items-center gap-1.5">
                      <Input value={col.label} onChange={(e) => renameCol(ci, e.target.value)} placeholder="Column name (e.g. Room, Marks, Portion)" className="flex-1" />
                      <button onClick={() => removeCol(ci)} className="text-slate-300 hover:text-danger-600 p-1" title="Remove column"><Icon name="X" size={15} /></button>
                    </div>
                  ))}
                  <Button size="sm" icon="Plus" onClick={addCol}>Add column</Button>
                </div>
                {cfg.timetable.length === 0 ? <p className="text-xs text-slate-400">Add the subjects with their date & time.</p> : (
                  <div className="space-y-1.5">
                    {cfg.timetable.map((r, i) => (
                      <div key={i} className="flex flex-wrap items-center gap-1.5">
                        {cfg.ttColumns.date && <Input value={r.date} onChange={(e) => setTT(i, 'date', e.target.value)} placeholder="Date" className="w-20" />}
                        {cfg.ttColumns.day && <Input value={r.day ?? ''} onChange={(e) => setTT(i, 'day', e.target.value)} placeholder="Day" className="w-16" />}
                        <Input value={r.subject} onChange={(e) => setTT(i, 'subject', e.target.value)} placeholder="Subject" className="flex-1 min-w-[7rem]" />
                        {cfg.ttColumns.session && <Input value={r.session ?? ''} onChange={(e) => setTT(i, 'session', e.target.value)} placeholder="FN/AN" className="w-16" />}
                        {cfg.ttColumns.time && <Input value={r.time} onChange={(e) => setTT(i, 'time', e.target.value)} placeholder="Time" className="w-20" />}
                        {cfg.customColumns.map((col) => (
                          <Input key={col.id} value={r.custom?.[col.id] ?? ''} onChange={(e) => setTTCustom(i, col.id, e.target.value)} placeholder={col.label || 'Value'} className="w-24" />
                        ))}
                        <button onClick={() => delTT(i)} className="text-slate-300 hover:text-danger-600 p-1"><Icon name="X" size={15} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>

        {/* Live preview hint */}
        <div className="lg:col-span-2">
          <Card title="Preview" action={ready ? <span className="text-xs text-slate-500">{students!.length} students</span> : undefined}>
            {!aId || !cId ? (
              <EmptyState icon="Ticket" title="Pick an exam and class" body="Choose an assessment and class on the left to generate hall tickets." />
            ) : loadingRoster ? <Skeleton height={300} /> : !students || students.length === 0 ? (
              <EmptyState icon="Users" title="No students" body="This class/section has no active students." />
            ) : (
              <div className="bg-slate-100 rounded-lg p-3 max-h-[600px] overflow-y-auto">
                <HallTicket student={students[0]} cfg={cfg} school={school} examTitle={examTitle} year={assessment ? '' : ''} preview />
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Print area */}
      {ready && (
        <div id="tickets" className="mt-6 space-y-4">
          {students!.map((s, i) => (
            <div key={s.id} className={`ht-card ${cfg.perPage === 2 ? 'ht-2up' : ''}`} style={{ pageBreakAfter: (i + 1) % cfg.perPage === 0 ? 'always' : 'auto' }}>
              <HallTicket student={s} cfg={cfg} school={school} examTitle={examTitle} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function HallTicket({ student, cfg, school, examTitle, preview }: { student: any; cfg: Config; school: any; examTitle: string; year?: string; preview?: boolean }) {
  const F = cfg.fields;
  const rows: [string, string][] = [];
  if (F.admissionNo) rows.push(['Student ID', student.id]);
  if (F.class) rows.push(['Class', shortClass(student.class?.name || null) + (F.section && student.class ? '' : '')]);
  if (F.section && student.section?.name) rows.push(['Section', student.section.name]);
  if (F.roll && student.roll) rows.push(['Roll No', String(student.roll)]);
  if (F.dob && student.dob) rows.push(['Date of Birth', fmtDate(student.dob)]);
  if (F.father && student.fatherName) rows.push(["Father's Name", student.fatherName]);
  if (F.mother && student.motherName) rows.push(["Mother's Name", student.motherName]);
  if (F.address && student.address) rows.push(['Address', student.address]);

  return (
    <div className="bg-white border-2 border-slate-800 rounded-lg p-4 h-full flex flex-col">
      {/* header */}
      <div className="text-center border-b-2 border-slate-800 pb-2">
        <div className="text-lg font-bold uppercase text-slate-900">{school?.schoolName || 'School Name'}</div>
        {school?.address && <div className="text-[11px] text-slate-600">{school.address}</div>}
        {school?.phone && <div className="text-[11px] text-slate-600">Ph: {school.phone}</div>}
        <div className="mt-1.5 inline-block bg-slate-800 text-white text-sm font-bold uppercase tracking-wide px-4 py-0.5 rounded">{cfg.title}</div>
      </div>

      {/* exam */}
      {examTitle && <div className="text-center text-sm font-semibold text-slate-800 mt-2">{examTitle}</div>}

      {/* student + photo */}
      <div className="flex gap-4 mt-3">
        <div className="flex-1">
          <div className="text-base font-bold text-slate-900 mb-1.5">{student.name}</div>
          <table className="text-[13px]">
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k}><td className="text-slate-500 pr-3 py-0.5 align-top whitespace-nowrap">{k}</td><td className="text-slate-900 font-medium py-0.5">: {v}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        {F.photo && (
          <div className="w-24 h-28 border border-slate-400 rounded flex items-center justify-center flex-shrink-0 overflow-hidden bg-slate-50">
            {student.photoUrl ? <img src={student.photoUrl} alt="" className="w-full h-full object-cover" /> : <span className="text-[10px] text-slate-400 text-center">Affix<br />Photo</span>}
          </div>
        )}
      </div>

      {/* timetable */}
      {cfg.showTimetable && cfg.timetable.length > 0 && (
        <div className="mt-3">
          <table className="w-full text-[12px] border border-slate-400 border-collapse">
            <thead><tr className="bg-slate-100">
              {cfg.ttColumns.date && <th className="border border-slate-400 px-2 py-1 text-left whitespace-nowrap">Date</th>}
              {cfg.ttColumns.day && <th className="border border-slate-400 px-2 py-1 text-left">Day</th>}
              <th className="border border-slate-400 px-2 py-1 text-left">Subject</th>
              {cfg.ttColumns.session && <th className="border border-slate-400 px-2 py-1 text-left">Session</th>}
              {cfg.ttColumns.time && <th className="border border-slate-400 px-2 py-1 text-left whitespace-nowrap">Time</th>}
              {cfg.customColumns.map((col) => <th key={col.id} className="border border-slate-400 px-2 py-1 text-left">{col.label}</th>)}
              {cfg.ttColumns.invigilatorSign && <th className="border border-slate-400 px-2 py-1 text-left whitespace-nowrap w-24">Invigilator Sign</th>}
            </tr></thead>
            <tbody>
              {cfg.timetable.map((r, i) => (
                <tr key={i}>
                  {cfg.ttColumns.date && <td className="border border-slate-400 px-2 py-1 whitespace-nowrap">{r.date}</td>}
                  {cfg.ttColumns.day && <td className="border border-slate-400 px-2 py-1">{r.day}</td>}
                  <td className="border border-slate-400 px-2 py-1">{r.subject}</td>
                  {cfg.ttColumns.session && <td className="border border-slate-400 px-2 py-1">{r.session}</td>}
                  {cfg.ttColumns.time && <td className="border border-slate-400 px-2 py-1 whitespace-nowrap">{r.time}</td>}
                  {cfg.customColumns.map((col) => <td key={col.id} className="border border-slate-400 px-2 py-1">{r.custom?.[col.id] || ''}</td>)}
                  {/* blank cell — the invigilator signs here per exam */}
                  {cfg.ttColumns.invigilatorSign && <td className="border border-slate-400 px-2 py-1"></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* instructions */}
      {cfg.instructions.trim() && (
        <div className="mt-3">
          <div className="text-[11px] font-semibold text-slate-700 uppercase">Instructions</div>
          <div className="text-[11px] text-slate-600 whitespace-pre-line">{cfg.instructions}</div>
        </div>
      )}

      {/* signatures */}
      <div className="flex justify-between items-end mt-auto pt-5">
        {cfg.signatories.map((s, i) => (
          <div key={i} className="text-center text-[11px] text-slate-600"><div className="border-t border-slate-500 w-28 pt-0.5">{s}</div></div>
        ))}
      </div>
    </div>
  );
}
