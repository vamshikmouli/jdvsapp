'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { PageHeader, Button, Card, Field, Input, Select, EmptyState } from '@/components/Primitives';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { toast } from '@/lib/toast';

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-') : '';

const toDateInput = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : '');
const todayInput = () => new Date().toISOString().slice(0, 10);

// Institution name printed on the study certificate (editable per printout).
const SCHOOL_NAME = 'Jnana Deepika School,Kyalanur';

interface StudentHit {
  id: string; name: string; class?: { id: string; name: string } | null;
}

// Everything on the printed certificate — pre-filled from the student's
// record, but freely editable here so it can be corrected or completed just
// for this printout without touching the actual student profile.
interface Form {
  schoolName: string; admissionNo: string; name: string; relation: 'S/O' | 'D/O' | 'W/O';
  fatherName: string; village: string; taluk: string; district: string;
  studiedAt: string; fromYear: string; toYear: string; fromStd: string; toStd: string;
  passStd: string; dob: string; recordDate: string; leavingDate: string;
  place: string; issueDate: string; principalName: string; tcNo: string; tcDate: string;
}

const emptyForm: Form = {
  schoolName: '', admissionNo: '', name: '', relation: 'S/O', fatherName: '',
  village: '', taluk: '', district: '', studiedAt: '', fromYear: '', toYear: '',
  fromStd: '', toStd: '', passStd: '', dob: '', recordDate: '', leavingDate: '',
  place: 'Kyalanur', issueDate: todayInput(), principalName: '', tcNo: '', tcDate: '',
};

export default function StudyCertificatePage() {
  const [schoolDefault, setSchoolDefault] = useState({ schoolName: '', principalName: '' });
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StudentHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  // Full student record for the selected student, so "Save to student" can merge the
  // edited fields into it without wiping everything else (the PATCH is a full replace).
  const [studentRaw, setStudentRaw] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const { can } = usePermissions();

  useEffect(() => {
    (async () => {
      const r = await fetch('/api/settings');
      if (r.ok) { const d = await r.json(); setSchoolDefault({ schoolName: d.schoolName || '', principalName: d.principalName || '' }); }
    })();
  }, []);

  const search = useCallback(async (q: string) => {
    setQuery(q);
    if (!q.trim()) { setResults([]); return; }
    setSearching(true);
    try {
      const r = await fetch(`/api/students?q=${encodeURIComponent(q)}`);
      setResults(r.ok ? await r.json() : []);
    } finally {
      setSearching(false);
    }
  }, []);

  const selectStudent = async (hit: StudentHit) => {
    setResults([]);
    setQuery(hit.name);
    const r = await fetch(`/api/students/${hit.id}`);
    if (!r.ok) return;
    const s = await r.json();
    setStudentRaw(s);
    setPhotoUrl(s.photoUrl || null);
    setForm({
      schoolName: SCHOOL_NAME,
      admissionNo: s.admissionNo || '',
      name: s.name,
      relation: s.gender === 'F' ? 'D/O' : 'S/O',
      fatherName: s.fatherName || '',
      village: s.village || '',
      taluk: s.taluk || '',
      district: s.district || '',
      studiedAt: SCHOOL_NAME,
      fromYear: s.studyFromYear || '',
      toYear: s.studyToYear || '',
      fromStd: s.studyFromStandard || '',
      toStd: s.studyToStandard || s.class?.name || '',
      passStd: s.studyToStandard || '',
      dob: toDateInput(s.dob),
      recordDate: toDateInput(s.joinedDate),
      leavingDate: toDateInput(s.schoolLeavingDate),
      place: 'Kyalanur',
      issueDate: todayInput(),
      principalName: schoolDefault.principalName,
      tcNo: s.tcNo || '',
      tcDate: toDateInput(s.tcDate),
    });
    setSelected(true);
  };

  // Push the fields that map to real student columns back onto the student record.
  // Everything else on the student is preserved (we send the full record + overrides).
  const saveToStudent = async () => {
    if (!studentRaw) return;
    setSaving(true);
    try {
      const body = {
        ...studentRaw,
        name: form.name.trim(),
        fatherName: form.fatherName.trim() || null,
        village: form.village.trim() || null,
        taluk: form.taluk.trim() || null,
        district: form.district.trim() || null,
        dob: form.dob || null,
        joinedDate: form.recordDate || null,
        schoolLeavingDate: form.leavingDate || null,
        studyFromYear: form.fromYear.trim() || null,
        studyToYear: form.toYear.trim() || null,
        studyFromStandard: form.fromStd.trim() || null,
        studyToStandard: form.toStd.trim() || null,
      };
      const r = await fetch(`/api/students/${studentRaw.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Failed to save');
      setStudentRaw(d);
      toast.success('Student record updated.');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not update the student'); }
    finally { setSaving(false); }
  };

  return (
    <>
      <style>{`
        @page { size: A4 portrait; margin: 10mm; }
        @media print {
          body { visibility: hidden; }
          #certificate, #certificate * { visibility: visible; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          #certificate { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>

      <PageHeader eyebrow="Students" title="Study certificate" meta="Generate a printable study certificate in the school's format."
        actions={selected ? (
          <div className="flex items-center gap-2">
            {can('STUDENTS_UPDATE') && <Button icon="Save" onClick={saveToStudent} disabled={saving}>{saving ? 'Saving…' : 'Save to student'}</Button>}
            <Button kind="primary" icon="Printer" onClick={() => window.print()}>Print</Button>
          </div>
        ) : undefined} />

      <div className="no-print mt-6 grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-1 space-y-4">
          <Card title="Select student">
            <div className="relative">
              <Input value={query} onChange={(e) => search(e.target.value)} placeholder="Search by name or admission no…" />
              {results.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                  {results.map((s) => (
                    <button key={s.id} onClick={() => selectStudent(s)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-100 last:border-0">
                      <div className="font-medium text-slate-900">{s.name}</div>
                      <div className="text-xs text-slate-400">{s.id} · {s.class?.name || 'Unassigned'}</div>
                    </button>
                  ))}
                </div>
              )}
              {searching && <p className="text-xs text-slate-400 mt-1">Searching…</p>}
            </div>
          </Card>

          {selected && (
            <Card title="Certificate fields">
              <div className="space-y-3">
                <p className="text-xs text-slate-500 -mt-1">Pre-filled from the student's record — edit anything that's wrong or missing, just for this printout.</p>
                <Field label="Institution name"><Input value={form.schoolName} onChange={(e) => set('schoolName', e.target.value)} /></Field>
                <Field label="Admission no."><Input value={form.admissionNo} onChange={(e) => set('admissionNo', e.target.value)} /></Field>
                <Field label="Name"><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
                <Field label="Relation">
                  <Select value={form.relation} onChange={(e) => set('relation', e.target.value as Form['relation'])}>
                    <option value="S/O">S/O (Son of)</option>
                    <option value="D/O">D/O (Daughter of)</option>
                    <option value="W/O">W/O (Wife of)</option>
                  </Select>
                </Field>
                <Field label="Father / guardian name"><Input value={form.fatherName} onChange={(e) => set('fatherName', e.target.value)} /></Field>
                <Field label="Village"><Input value={form.village} onChange={(e) => set('village', e.target.value)} /></Field>
                <Field label="Taluk"><Input value={form.taluk} onChange={(e) => set('taluk', e.target.value)} /></Field>
                <Field label="District"><Input value={form.district} onChange={(e) => set('district', e.target.value)} /></Field>
                <Field label="Studied at (school/college)"><Input value={form.studiedAt} onChange={(e) => set('studiedAt', e.target.value)} /></Field>
                <Field label="Studied from (year)"><Input value={form.fromYear} onChange={(e) => set('fromYear', e.target.value)} placeholder="e.g. 2026-27" /></Field>
                <Field label="Studied to (year)"><Input value={form.toYear} onChange={(e) => set('toYear', e.target.value)} placeholder="e.g. 2029-30" /></Field>
                <Field label="From standard"><Input value={form.fromStd} onChange={(e) => set('fromStd', e.target.value)} placeholder="e.g. 8th" /></Field>
                <Field label="To standard"><Input value={form.toStd} onChange={(e) => set('toStd', e.target.value)} placeholder="e.g. 10th" /></Field>
                <Field label="Passed standard"><Input value={form.passStd} onChange={(e) => set('passStd', e.target.value)} placeholder="e.g. 10th" /></Field>
                <Field label="Date of birth"><Input type="date" value={form.dob} onChange={(e) => set('dob', e.target.value)} /></Field>
                <Field label="Record date"><Input type="date" value={form.recordDate} onChange={(e) => set('recordDate', e.target.value)} /></Field>
                <Field label="Date of leaving"><Input type="date" value={form.leavingDate} onChange={(e) => set('leavingDate', e.target.value)} /></Field>
                <Field label="Place"><Input value={form.place} onChange={(e) => set('place', e.target.value)} placeholder="e.g. Kyalanur" /></Field>
                <Field label="Issue date"><Input type="date" value={form.issueDate} onChange={(e) => set('issueDate', e.target.value)} /></Field>
                <Field label="Headmaster / Principal name"><Input value={form.principalName} onChange={(e) => set('principalName', e.target.value)} /></Field>
              </div>
            </Card>
          )}
        </div>

        <div className="lg:col-span-2">
          <Card title="Preview">
            {!selected ? (
              <EmptyState icon="FileText" title="Search for a student" body="Find the student on the left to generate their study certificate." />
            ) : (
              <div className="bg-slate-100 rounded-lg p-4 overflow-x-auto">
                <div className="scale-90 origin-top-left" style={{ width: '175mm' }}>
                  <Certificate form={form} photoUrl={photoUrl} />
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>

      {selected && (
        <div id="certificate" className="mt-6">
          <Certificate form={form} photoUrl={photoUrl} />
        </div>
      )}
    </>
  );
}

function Box({ children, className = '', red = false }: { children: React.ReactNode; className?: string; red?: boolean }) {
  return (
    <span className={`inline-block border-b border-slate-800 px-1 pb-0.5 font-bold ${red ? 'text-red-700' : 'text-slate-900'} ${className}`}>
      {children || ' '}
    </span>
  );
}

function Certificate({ form, photoUrl }: { form: Form; photoUrl: string | null }) {
  return (
    <div className="bg-white border-4 border-dotted border-red-600 p-8" style={{ width: '190mm' }}>
      <div className="flex justify-between items-start gap-4">
        <div className="flex-1 space-y-3">
          <div className="text-base">Admission No: <span className="font-bold text-red-700">{form.admissionNo}</span></div>
          <div className="text-base">Name of the Institution: <span className="font-semibold border-b border-slate-800">{form.schoolName}</span></div>
        </div>
        <div className="w-28 h-32 border border-slate-400 flex items-center justify-center text-center text-xs text-red-600 font-semibold flex-shrink-0 overflow-hidden">
          {photoUrl ? <img src={photoUrl} alt="" className="w-full h-full object-cover" /> : <span>STICK<br />PHOTO</span>}
        </div>
      </div>

      <div className="my-6 flex justify-center">
        <div className="bg-red-700 text-white text-4xl font-bold uppercase text-center py-4 rounded-sm" style={{ width: '78%' }}>
          Study Certificate
        </div>
      </div>

      <div className="space-y-4 text-base leading-relaxed">
        <div>This is to certify that Shri/Smt/Kum <Box className="ml-1 min-w-[260px] text-center">{form.name}</Box></div>
        <div className="flex items-start gap-2">
          <span className="whitespace-nowrap">s/o d/o w/o</span>
          <Box className="min-w-[400px] text-center">{form.fatherName}</Box>
        </div>
        <div className="flex items-center flex-wrap gap-2">
          <span>belongs to</span>
          <Box className="min-w-[180px] text-center">{form.village}</Box>
          <span>village</span>
          <Box className="min-w-[140px] text-center">{form.taluk}</Box>
          <span>Taluk</span>
        </div>
        <div className="flex items-center flex-wrap gap-2">
          <Box className="min-w-[140px] text-center">{form.district}</Box>
          <span>District. He/ She has studied in</span>
          <Box className="min-w-[200px] text-center">{form.studiedAt}</Box>
        </div>
        <div className="flex items-center flex-wrap gap-2">
          <span>School / College from</span>
          <Box className="min-w-[110px] text-center font-normal">{form.fromYear}</Box>
          <span>to</span>
          <Box className="min-w-[110px] text-center font-normal">{form.toYear}</Box>
          <span>from</span>
          <Box className="min-w-[80px] text-center">{form.fromStd}</Box>
        </div>
        <div className="flex items-center flex-wrap gap-2">
          <span>Standard to</span>
          <Box className="min-w-[80px] text-center">{form.toStd}</Box>
          <span>Standard and passed</span>
          <Box className="min-w-[100px] text-center">{form.passStd}</Box>
          <span>Standard in the Year.</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap">His/Her Date of Birth:</span>
          <Box className="min-w-[300px] text-center font-normal" red>{fmtDate(form.dob)}</Box>
        </div>
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap">His/Her Record No. & Date:</span>
          <Box className="min-w-[300px] text-center" red>{[form.admissionNo, fmtDate(form.recordDate)].filter(Boolean).join(' · ')}</Box>
        </div>
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap">Date of leaving School/College:</span>
          <Box className="min-w-[220px] text-center font-normal">{fmtDate(form.leavingDate)}</Box>
        </div>
        <div className="text-sm pt-1">This certificate issued according to records of our School/ College</div>
      </div>

      <div className="flex justify-between items-end mt-10 text-base">
        <div>Date : <span className="font-semibold">{fmtDate(form.issueDate)}</span></div>
        <div className="text-center">
          <div className="font-semibold">Signature &amp; Seal of the</div>
        </div>
      </div>
      <div className="flex justify-between items-end mt-3 text-base">
        <div>Place : <span className="font-semibold">{form.place}</span></div>
        <div className="text-center">
          <div className="font-semibold">Headmaster / Principal</div>
          {form.principalName && <div className="text-xs text-slate-500">{form.principalName}</div>}
        </div>
      </div>

      <div className="text-center text-sm mt-8 pt-4 border-t border-slate-300">
        Signature of AEO/ DDPI. with Seal
      </div>
    </div>
  );
}
