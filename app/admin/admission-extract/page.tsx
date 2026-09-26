'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { PageHeader, Button, Card, Field, Input, Select, EmptyState } from '@/components/Primitives';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { toast } from '@/lib/toast';

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-') : '';

const toDateInput = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : '');
const todayInput = () => new Date().toISOString().slice(0, 10);

interface StudentHit {
  id: string; name: string; class?: { id: string; name: string } | null;
}

// Everything on the printed extract — pre-filled from the student's record,
// but freely editable here so a mistake can be fixed for this printout
// without needing a trip to the student's actual profile.
interface Form {
  schoolName: string; admissionNo: string; name: string; gender: 'M' | 'F';
  dob: string; fatherName: string; annualIncome: string; noOfDependents: string;
  castReligion: string; motherTongue: string; fatherAddress: string;
  previousSchool: string; previousStandard: string; tcNumber: string; tcDate: string;
  admittedClass: string; admissionDate: string; place: string; extractDate: string;
  principalName: string;
}

const emptyForm: Form = {
  schoolName: '', admissionNo: '', name: '', gender: 'M', dob: '', fatherName: '',
  annualIncome: '', noOfDependents: '', castReligion: '', motherTongue: '', fatherAddress: '',
  previousSchool: '', previousStandard: '', tcNumber: '', tcDate: '', admittedClass: '',
  admissionDate: '', place: '', extractDate: todayInput(), principalName: '',
};

export default function AdmissionExtractPage() {
  const [schoolDefault, setSchoolDefault] = useState({ schoolName: '', principalName: '' });
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StudentHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  // Full student record, so "Save to student" merges edits in without wiping other fields.
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
    const addressLine = [s.village, s.taluk ? `${s.taluk} (T)` : '', s.district ? `${s.district} (D)` : ''].filter(Boolean).join(', ');
    setForm({
      schoolName: schoolDefault.schoolName,
      admissionNo: s.admissionNo || '',
      name: s.name,
      gender: s.gender,
      dob: toDateInput(s.dob),
      fatherName: s.fatherName || '',
      annualIncome: s.annualIncome != null ? String(s.annualIncome) : '',
      noOfDependents: s.noOfDependents != null ? String(s.noOfDependents) : '',
      castReligion: [s.religion, s.caste].filter(Boolean).join(', '),
      motherTongue: s.motherTongue || '',
      fatherAddress: [s.fatherName, addressLine || s.address].filter(Boolean).join('\n'),
      previousSchool: s.previousSchool || '',
      // "Study of last classes" — the standard range from the student's study record
      // (e.g. "8th to 10th"). Falls back to a single standard, then the current class.
      previousStandard: [s.studyFromStandard, s.studyToStandard].filter(Boolean).join(' to ') || s.studyToStandard || '',
      tcNumber: s.tcNo || '',
      tcDate: toDateInput(s.tcDate),
      admittedClass: s.class?.name || '',
      admissionDate: toDateInput(s.joinedDate),
      place: 'Kyalanur',
      extractDate: todayInput(),
      principalName: schoolDefault.principalName,
    });
    setSelected(true);
  };

  // Save the fields that map to real student columns back to the student record.
  // Combined display fields (cast & religion, father address) are left as-is; the
  // "Study of last classes" range is split back into From/To standard.
  const saveToStudent = async () => {
    if (!studentRaw) return;
    setSaving(true);
    try {
      // "8th to 10th" → From = 8th, To = 10th; a single value → To standard.
      let studyFromStandard = studentRaw.studyFromStandard ?? null;
      let studyToStandard = studentRaw.studyToStandard ?? null;
      const ps = form.previousStandard.trim();
      if (ps) {
        const parts = ps.split(/\s+to\s+/i);
        if (parts.length === 2) { studyFromStandard = parts[0].trim() || null; studyToStandard = parts[1].trim() || null; }
        else { studyToStandard = ps; }
      }
      const body = {
        ...studentRaw,
        name: form.name.trim(),
        gender: form.gender,
        dob: form.dob || null,
        fatherName: form.fatherName.trim() || null,
        annualIncome: form.annualIncome,
        noOfDependents: form.noOfDependents,
        motherTongue: form.motherTongue.trim() || null,
        previousSchool: form.previousSchool.trim() || null,
        studyFromStandard, studyToStandard,
        tcNo: form.tcNumber.trim() || null,
        tcDate: form.tcDate || null,
        joinedDate: form.admissionDate || null,
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
        @page { size: A4 portrait; margin: 8mm; }
        @media print {
          body { visibility: hidden; }
          #extract, #extract * { visibility: visible; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          #extract { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>

      <PageHeader eyebrow="Students" title="Admission extract" meta="Generate a printable admission extract in the school register's format."
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
            <Card title="Extract fields">
              <div className="space-y-3">
                <p className="text-xs text-slate-500 -mt-1">Pre-filled from the student's record — edit anything that's wrong or missing, just for this printout.</p>
                <Field label="School name"><Input value={form.schoolName} onChange={(e) => set('schoolName', e.target.value)} /></Field>
                <Field label="Admission no."><Input value={form.admissionNo} onChange={(e) => set('admissionNo', e.target.value)} /></Field>
                <Field label="Name"><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
                <Field label="Boy or girl">
                  <Select value={form.gender} onChange={(e) => set('gender', e.target.value as 'M' | 'F')}>
                    <option value="M">Boy</option>
                    <option value="F">Girl</option>
                  </Select>
                </Field>
                <Field label="Date of birth"><Input type="date" value={form.dob} onChange={(e) => set('dob', e.target.value)} /></Field>
                <Field label="Father name"><Input value={form.fatherName} onChange={(e) => set('fatherName', e.target.value)} /></Field>
                <Field label="Annual income"><Input type="number" value={form.annualIncome} onChange={(e) => set('annualIncome', e.target.value)} /></Field>
                <Field label="No. of dependents"><Input type="number" value={form.noOfDependents} onChange={(e) => set('noOfDependents', e.target.value)} /></Field>
                <Field label="Cast & religion"><Input value={form.castReligion} onChange={(e) => set('castReligion', e.target.value)} /></Field>
                <Field label="Mother tongue"><Input value={form.motherTongue} onChange={(e) => set('motherTongue', e.target.value)} /></Field>
                <Field label="Father address">
                  <textarea value={form.fatherAddress} onChange={(e) => set('fatherAddress', e.target.value)} rows={2}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 focus:outline-none" />
                </Field>
                <Field label="Study of last school"><Input value={form.previousSchool} onChange={(e) => set('previousSchool', e.target.value)} /></Field>
                <Field label="Study of last classes"><Input value={form.previousStandard} onChange={(e) => set('previousStandard', e.target.value)} placeholder="e.g. 7th STD" /></Field>
                <Field label="T.C. No."><Input value={form.tcNumber} onChange={(e) => set('tcNumber', e.target.value)} /></Field>
                <Field label="T.C. Date"><Input type="date" value={form.tcDate} onChange={(e) => set('tcDate', e.target.value)} /></Field>
                <Field label="Admission class"><Input value={form.admittedClass} onChange={(e) => set('admittedClass', e.target.value)} placeholder="e.g. 8th STD" /></Field>
                <Field label="Admission date"><Input type="date" value={form.admissionDate} onChange={(e) => set('admissionDate', e.target.value)} /></Field>
                <Field label="Place"><Input value={form.place} onChange={(e) => set('place', e.target.value)} placeholder="e.g. Kyalanur" /></Field>
                <Field label="Extract date"><Input type="date" value={form.extractDate} onChange={(e) => set('extractDate', e.target.value)} /></Field>
                <Field label="Headmaster name"><Input value={form.principalName} onChange={(e) => set('principalName', e.target.value)} /></Field>
              </div>
            </Card>
          )}
        </div>

        <div className="lg:col-span-2">
          <Card title="Preview">
            {!selected ? (
              <EmptyState icon="FileText" title="Search for a student" body="Find the student on the left to generate their admission extract." />
            ) : (
              <div className="bg-slate-100 rounded-lg p-4 overflow-x-auto">
                <div className="scale-90 origin-top-left" style={{ width: '175mm' }}>
                  <Extract form={form} />
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>

      {selected && (
        <div id="extract" className="mt-6">
          <Extract form={form} />
        </div>
      )}
    </>
  );
}

function Row({ no, kn, en, value }: { no: number; kn: string; en: string; value: React.ReactNode }) {
  return (
    <tr>
      <td className="border border-red-700 px-2 py-1.5 align-top w-8 text-sm text-red-800">{no}.</td>
      <td className="border border-red-700 px-2 py-1.5 align-top w-52">
        <div className="text-sm text-slate-900 leading-tight">{kn}</div>
        <div className="text-sm font-semibold text-red-800 leading-tight">{en}</div>
      </td>
      <td className="border border-red-700 px-3 py-1.5 align-top text-sm font-medium text-blue-900">{value || ' '}</td>
    </tr>
  );
}

function Extract({ form }: { form: Form }) {
  return (
    <div className="bg-white border-2 border-red-700 p-4" style={{ width: '194mm' }}>
      <div className="text-center border-b-2 border-red-700 pb-2 mb-3">
        <div className="text-xl font-bold uppercase text-red-800">ADMISSION EXTRACT (ದಾಖಲಾತಿ ನಕಲು)</div>
      </div>

      <table className="w-full border-collapse">
        <tbody>
          <Row no={1} kn="ಶಾಲೆಯ ಹೆಸರು" en="School Name" value={form.schoolName} />
          <Row no={2} kn="ದಾಖಲಾತಿ ಸಂಖ್ಯೆ" en="Admission No." value={form.admissionNo} />
          <Row no={3} kn="ಹೆಸರು" en="Name" value={form.name} />
          <Row no={4} kn="ಹುಡುಗ / ಹುಡುಗಿ" en="Boy or Girl" value={form.gender === 'F' ? 'Girl' : 'Boy'} />
          <Row no={5} kn="ಹುಟ್ಟಿದ ದಿನಾಂಕ" en="Date of Birth" value={fmtDate(form.dob)} />
          <Row no={6} kn="ತಂದೆಯ ಹೆಸರು" en="Father Name" value={form.fatherName} />
          <Row no={7} kn="ವಾರ್ಷಿಕ ವರಮಾನ" en="Annual Income" value={form.annualIncome ? Number(form.annualIncome).toLocaleString('en-IN') : ''} />
          <Row no={8} kn="ಆಶ್ರಿತರ ಸಂಖ್ಯೆ" en="No. of Dependents" value={form.noOfDependents} />
          <Row no={9} kn="ಜಾತಿ ಮತ್ತು ಮತ" en="Cast & Religion" value={form.castReligion} />
          <Row no={10} kn="ಮಾತೃ ಭಾಷೆ" en="Mother Tongue" value={form.motherTongue} />
          <Row no={11} kn="ತಂದೆಯ ವಿಳಾಸ" en="Father Address" value={<span className="whitespace-pre-line">{form.fatherAddress}</span>} />
          <Row no={12} kn="ಓದುತ್ತಿದ್ದ ಹಿಂದಿನ ಶಾಲೆ" en="Study of Last School" value={form.previousSchool} />
          <Row no={13} kn="ಓದುತ್ತಿದ್ದ ಹಿಂದಿನ ತರಗತಿ" en="Study of Last Classes" value={form.previousStandard} />
          <Row no={14} kn="ವರ್ಗಾವಣೆ ಚೀಟಿ ಸಂಖ್ಯೆ ಮತ್ತು ದಿನಾಂಕ" en="T.C. No. & Date" value={[form.tcNumber, fmtDate(form.tcDate)].filter(Boolean).join(' · ')} />
          <Row no={15} kn="ದಾಖಲಾತಿ ತರಗತಿ" en="Admission Classes" value={form.admittedClass} />
          <Row no={16} kn="ದಾಖಲಾತಿ ತಾರೀಖು" en="Admission Date" value={fmtDate(form.admissionDate)} />
        </tbody>
      </table>

      <div className="flex justify-between items-end mt-5">
        <div className="text-sm">
          <div>ಸ್ಥಳ / Place: <span className="font-semibold">{form.place}</span></div>
          <div>ದಿನಾಂಕ / Date: <span className="font-semibold">{fmtDate(form.extractDate)}</span></div>
        </div>
        <div className="text-center text-sm">
          <div className="w-48 border-t-2 border-red-700 pt-1">
            ಮುಖ್ಯೋಪಾಧ್ಯಾಯರ ಸಹಿ / Signature of the Headmaster
            {form.principalName && <div className="text-xs text-slate-500 mt-0.5">{form.principalName}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
