'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { PageHeader, Button, Card, Field, Input, Select, EmptyState } from '@/components/Primitives';

interface StudentHit {
  id: string; name: string; class?: { id: string; name: string } | null;
}

// Fixed legal citation printed on every rural certificate — the Karnataka
// Government Orders that define "rural area" for reservation purposes.
// Same wording on every certificate, not per-student data.
const GOVERNMENT_ORDERS = [
  'ಸರ್ಕಾರದ ಆದೇಶ ಸಂಖ್ಯೆ :ಸಿಆಸುಇ( ಡಿ.ಪಿ.ಏ.ಆರ್ )ಸೇನೆನಿ 08(ಎಸ್.ಆರ್.ಆರ್.)2001 ಬೆಂಗಳೂರು ದಿನಾಂಕ :13-02-2001',
  'ಸರ್ಕಾರದ ಆದೇಶ ಸಂಖ್ಯೆ :ಸಿಆಸುಇ( ಡಿ.ಪಿ.ಏ.ಆರ್ )ಸೇನೆನಿ 06(ಎಸ್.ಆರ್.ಆರ್.)2001 ಬೆಂಗಳೂರು ದಿನಾಂಕ :13-02-2001',
  'ಸರ್ಕಾರದ ಆದೇಶ ಸಂಖ್ಯೆ :ಸಿಆಸುಇ( ಡಿ.ಪಿ.ಏ.ಆರ್ )ಸೇನೆನಿ 97(ಎಸ್.ಆರ್.ಆರ್.)2002 ಬೆಂಗಳೂರು ದಿನಾಂಕ :22-11-2002',
  'ಸರ್ಕಾರದ ಆದೇಶ ಸಂಖ್ಯೆ :ಸಿಆಸುಇ( ಡಿ.ಪಿ.ಏ.ಆರ್ )ಸೇನೆನಿ 96(ಎಸ್.ಆರ್.ಆರ್.)2005 ಬೆಂಗಳೂರು ದಿನಾಂಕ :10-08-2005',
  'ಸಿಆಸುಇ 97 ಸೇನೆನಿ 2002 ದಿನಾಂಕ :22-11-2002 ಮತ್ತು ಸಿಆಸುಇ 53/ ಸೇನೆನಿ 2007 ದಿನಾಂಕ :1-04-2008',
];

// Everything on the printed certificate — pre-filled from the student's
// record, but freely editable here so it can be corrected or completed just
// for this printout without touching the actual student profile.
interface Form {
  name: string; relation: 'S/O' | 'D/O' | 'W/O'; fatherName: string;
  nativeDistrict: string; nativeTaluk: string; village: string;
  fromStd: string; toStd: string;
  schoolDistrict: string; schoolTaluk: string; schoolTown: string; schoolName: string; studiedYear: string;
  feoName: string; headmasterName: string;
}

const emptyForm: Form = {
  name: '', relation: 'S/O', fatherName: '', nativeDistrict: '', nativeTaluk: '', village: '',
  fromStd: '', toStd: '', schoolDistrict: '', schoolTaluk: '', schoolTown: '', schoolName: '', studiedYear: '',
  feoName: '', headmasterName: '',
};

export default function RuralCertificatePage() {
  const [schoolDefault, setSchoolDefault] = useState({ schoolName: '', principalName: '' });
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StudentHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

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
    setForm({
      name: s.name,
      relation: s.gender === 'F' ? 'D/O' : 'S/O',
      fatherName: s.fatherName || '',
      nativeDistrict: s.district || '',
      nativeTaluk: s.taluk || '',
      village: s.village || '',
      fromStd: '',
      toStd: s.class?.name || '',
      schoolDistrict: s.district || '',
      schoolTaluk: s.taluk || '',
      schoolTown: '',
      schoolName: schoolDefault.schoolName,
      studiedYear: '',
      feoName: '',
      headmasterName: schoolDefault.principalName,
    });
    setSelected(true);
  };

  return (
    <>
      <style>{`
        @page { size: A4 portrait; margin: 10mm; }
        @media print {
          body { visibility: hidden; }
          #rural-cert, #rural-cert * { visibility: visible; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          #rural-cert { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>

      <PageHeader eyebrow="Students" title="Rural certificate" meta="Generate a printable rural candidate certificate (ನಮೂನೆ-2)."
        actions={selected ? <Button kind="primary" icon="Printer" onClick={() => window.print()}>Print</Button> : undefined} />

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
                <Field label="Name"><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
                <Field label="Relation">
                  <Select value={form.relation} onChange={(e) => set('relation', e.target.value as Form['relation'])}>
                    <option value="S/O">S/O (Son of)</option>
                    <option value="D/O">D/O (Daughter of)</option>
                    <option value="W/O">W/O (Wife of)</option>
                  </Select>
                </Field>
                <Field label="Father / husband name"><Input value={form.fatherName} onChange={(e) => set('fatherName', e.target.value)} /></Field>
                <Field label="Native district"><Input value={form.nativeDistrict} onChange={(e) => set('nativeDistrict', e.target.value)} /></Field>
                <Field label="Native taluk"><Input value={form.nativeTaluk} onChange={(e) => set('nativeTaluk', e.target.value)} /></Field>
                <Field label="Village"><Input value={form.village} onChange={(e) => set('village', e.target.value)} /></Field>
                <Field label="From standard"><Input value={form.fromStd} onChange={(e) => set('fromStd', e.target.value)} placeholder="e.g. 9th" /></Field>
                <Field label="To standard"><Input value={form.toStd} onChange={(e) => set('toStd', e.target.value)} placeholder="e.g. 10th" /></Field>
                <Field label="School district"><Input value={form.schoolDistrict} onChange={(e) => set('schoolDistrict', e.target.value)} /></Field>
                <Field label="School taluk"><Input value={form.schoolTaluk} onChange={(e) => set('schoolTaluk', e.target.value)} /></Field>
                <Field label="Town"><Input value={form.schoolTown} onChange={(e) => set('schoolTown', e.target.value)} placeholder="e.g. Kyalanur" /></Field>
                <Field label="School name"><Input value={form.schoolName} onChange={(e) => set('schoolName', e.target.value)} /></Field>
                <Field label="Studied year"><Input value={form.studiedYear} onChange={(e) => set('studiedYear', e.target.value)} placeholder="e.g. 2024" /></Field>
                <Field label="Field Education Officer name"><Input value={form.feoName} onChange={(e) => set('feoName', e.target.value)} /></Field>
                <Field label="Headmaster name"><Input value={form.headmasterName} onChange={(e) => set('headmasterName', e.target.value)} /></Field>
              </div>
            </Card>
          )}
        </div>

        <div className="lg:col-span-2">
          <Card title="Preview">
            {!selected ? (
              <EmptyState icon="FileText" title="Search for a student" body="Find the student on the left to generate their rural certificate." />
            ) : (
              <div className="bg-slate-100 rounded-lg p-4 overflow-x-auto">
                <div className="scale-90 origin-top-left" style={{ width: '175mm' }}>
                  <RuralCertificate form={form} />
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>

      {selected && (
        <div id="rural-cert" className="mt-6">
          <RuralCertificate form={form} />
        </div>
      )}
    </>
  );
}

function Line({ children, className = '', minWidth = 140 }: { children: React.ReactNode; className?: string; minWidth?: number }) {
  return (
    <span className={`inline-block border-b border-slate-800 px-1 pb-0.5 font-bold text-slate-900 text-center ${className}`} style={{ minWidth }}>
      {children || ' '}
    </span>
  );
}

function RuralCertificate({ form }: { form: Form }) {
  return (
    <div className="bg-white border-4 border-dotted border-red-600 p-8" style={{ width: '190mm' }}>
      <div className="text-xs text-slate-600 leading-snug mb-2 space-y-0.5">
        {GOVERNMENT_ORDERS.map((line, i) => (<div key={i}>{line}</div>))}
      </div>

      <div className="flex items-center justify-between mb-4">
        <img src="/certificates/rural-certificate-header.jpg" alt="" className="h-20 w-auto" />
        <span className="border border-slate-800 rounded-full px-6 py-2 text-red-700 font-semibold">ನಮೂನೆ - 2</span>
      </div>

      <div className="text-center mb-6">
        <div className="text-2xl font-bold underline text-blue-800">ಗ್ರಾಮೀಣ ಅಭ್ಯರ್ಥಿ ಪ್ರಮಾಣ ಪತ್ರ</div>
      </div>

      <div className="space-y-4 text-base leading-relaxed">
        <div className="flex items-center flex-wrap gap-2">
          <span>ಶ್ರೀ</span>
          <Line className="flex-1" minWidth={280}>{form.fatherName}</Line>
        </div>
        <div className="flex items-center flex-wrap gap-2">
          <span>ರವರ ಮಗ/ ಮಗಳು/ ಪತ್ನಿ ಶ್ರೀ/ ಶ್ರೀಮತಿ/ ಕುಮಾರಿ</span>
          <Line minWidth={280}>{form.name}</Line>
        </div>
        <div className="flex items-center flex-wrap gap-2">
          <span>ಜಿಲ್ಲೆ</span>
          <Line>{form.nativeDistrict}</Line>
          <span>ತಾಲೂಕು</span>
          <Line>{form.nativeTaluk}</Line>
          <span>ಗ್ರಾಮದಲ್ಲಿ</span>
        </div>
        <div className="flex items-center flex-wrap gap-2">
          <Line minWidth={180}>{form.village}</Line>
          <span>ವಾಸವಾಗಿರುವ ಇವರು</span>
          <Line minWidth={70}>{form.fromStd}</Line>
          <span>ನೇ ತರಗತಿಯಿಂದ</span>
          <Line minWidth={70}>{form.toStd}</Line>
        </div>
        <div className="flex items-center flex-wrap gap-2">
          <span>ತರಗತಿಯವರೆಗೆ</span>
          <Line>{form.schoolDistrict}</Line>
          <span>ಜಿಲ್ಲೆ</span>
          <Line>{form.schoolTaluk}</Line>
          <span>ತಾಲೂಕು</span>
          <Line minWidth={120}>{form.schoolTown}</Line>
          <span>ಪಟ್ಟಣ</span>
          <Line minWidth={260}>{form.schoolName}</Line>
          <span>ಶಾಲೆಯಲ್ಲಿ ವ್ಯಾಸಂಗ</span>
        </div>
        <div className="flex items-center flex-wrap gap-2">
          <span>ಮಾಡಿ</span>
          <Line minWidth={70}>{form.studiedYear}</Line>
          <span>ವರ್ಷ ನಡೆದ ಪರೀಕ್ಷೆಯಲ್ಲಿ ಉತ್ತೀರ್ಣರಾಗಿರುತ್ತಾರೆ.</span>
        </div>

        <p className="text-base pt-2 leading-loose text-slate-700">
          ಈ ಶಾಲೆಯ ಕರ್ನಾಟಕ ಪೌರ ನಿಗಮಗಳ ಅಧಿನಿಯಮ 1976 ಅಥವಾ ಕರ್ನಾಟಕ ಪೌರಸಭೆಗಳ ಅಧಿನಿಯಮ 1964 ರ ಅಡಿಯಲ್ಲಿ ನಿರ್ದಿಷ್ಟ ಪಡಿಸಿದ
          ಒಂದು ದೊಡ್ಡ ನಗರ ಪ್ರದೇಶ ನಗರ ಪ್ರದೇಶ ಅಥವಾ ಪರಿವರ್ತನೆ ಹಂತದಲ್ಲಿರುವ ಪ್ರದೇಶಗಳ ಹೊರತಾದ ಪ್ರದೇಶದಲ್ಲಿದೆ.
        </p>
      </div>

      <div className="flex justify-between items-end mt-14 text-base">
        <div className="text-center">
          <div>(ಸಹಿ )</div>
          <div className="font-semibold mt-10 border-t border-slate-800 pt-1 w-56">ಕ್ಷೇತ್ರ ಶಿಕ್ಷಣ ಅಧಿಕಾರಿ</div>
          <div className="text-sm">ಮೇಲು ರುಜು</div>
          {form.feoName && <div className="text-xs text-slate-500">{form.feoName}</div>}
        </div>
        <div className="text-center">
          <div>(ಸಹಿ )</div>
          <div className="font-semibold mt-10 border-t border-slate-800 pt-1 w-56">ಮುಖ್ಯೋಪಾಧ್ಯಾಯ</div>
          <div className="text-sm">ಮೇಲು ರುಜು</div>
          {form.headmasterName && <div className="text-xs text-slate-500">{form.headmasterName}</div>}
        </div>
      </div>
    </div>
  );
}
