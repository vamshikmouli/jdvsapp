'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { PageHeader, Button, Card, Modal, Field, Input, Select, Avatar, EmptyState, Donut, Skeleton, TableRowSkeleton } from '@/components/Primitives';
import { Icon } from '@/components/Icon';
import { downloadBackup } from '@/lib/utils';
import * as XLSX from 'xlsx';

type Status = 'PRESENT' | 'ABSENT' | 'LEAVE';

interface SessionDef {
  key: string;
  label: string;
  open: string;
  close: string;
}

interface SchoolClass {
  id: string;
  name: string;
  _count: { students: number };
}

interface RosterStudent {
  id: string;
  name: string;
  roll: string | null;
  gender: 'M' | 'F';
  guardianName: string;
}

// Fallback until Settings load
const DEFAULT_SESSIONS: SessionDef[] = [
  { key: 'MORNING', label: 'Morning', open: '08:30', close: '09:30' },
  { key: 'AFTERNOON', label: 'Afternoon', open: '13:00', close: '14:00' },
];

// Compact P / A / L mark buttons
const MARKS: { value: Status; letter: string; on: string; off: string }[] = [
  { value: 'PRESENT', letter: 'P', on: 'bg-success-500 text-white border-success-500', off: 'bg-white text-slate-500 border-slate-200 hover:border-success-500 hover:text-success-700' },
  { value: 'ABSENT', letter: 'A', on: 'bg-danger-500 text-white border-danger-500', off: 'bg-white text-slate-500 border-slate-200 hover:border-danger-500 hover:text-danger-700' },
  { value: 'LEAVE', letter: 'L', on: 'bg-info-500 text-white border-info-500', off: 'bg-white text-slate-500 border-slate-200 hover:border-info-500 hover:text-info-700' },
];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function shortClassName(name: string) {
  return name.replace(/\s?STD$/, '');
}

function formatHeaderDate(dateStr: string) {
  const d = new Date(dateStr);
  return d
    .toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .toUpperCase();
}

export default function AttendancePage() {
  const { data: authSession } = useSession();
  const myPerms = ((authSession?.user as any)?.perms as string[]) || [];
  // "isAdmin" here gates the lock/reopen controls — anyone with ATTENDANCE_LOCK.
  const isAdmin = myPerms.includes('ATTENDANCE_LOCK');
  // Whether this user may change marks (view-only otherwise).
  const canMark = myPerms.includes('ATTENDANCE_MARK');
  const canExport = myPerms.includes('REPORTS_EXPORT') || myPerms.includes('SETTINGS_MANAGE');
  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exClass, setExClass] = useState('');
  const [exFrom, setExFrom] = useState('');
  const [exTo, setExTo] = useState('');
  const runExport = async () => {
    setExporting(true);
    try {
      const qs = new URLSearchParams();
      if (exClass) qs.set('classId', exClass);
      if (exFrom) qs.set('from', exFrom);
      if (exTo) qs.set('to', exTo);
      const res = await fetch('/api/attendance/export?' + qs.toString());
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `attendance-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      setExportOpen(false);
    } catch (e) { alert(e instanceof Error ? e.message : 'Export failed'); } finally { setExporting(false); }
  };

  // Friendly attendance upload: a name-based Excel with a Status dropdown fills
  // the grid for review (no IDs). Apply to the currently selected class/date/session.
  const canImport = myPerms.includes('ATTENDANCE_MARK');
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState('');

  const downloadAttTemplate = async () => {
    if (!classId) { alert('Pick a class first.'); return; }
    try {
      const qs = new URLSearchParams({ classId, date, slot });
      const res = await fetch('/api/attendance/template?' + qs.toString());
      if (!res.ok) throw new Error(`Template failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `attendance-${classId}-${date}-${slot}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { alert(e instanceof Error ? e.message : 'Could not download template'); }
  };

  const pickImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!f) return;
    setImportMsg('');
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });

      // Full export (multi-session) → bulk import on the server, matched by
      // Class + Date + Session + Admission No. Otherwise it's a single-session
      // template that just fills the current grid.
      const headers = rows.length ? Object.keys(rows[0]) : [];
      const isFlat = headers.some((h) => /class/i.test(h)) && headers.some((h) => /date/i.test(h));
      if (isFlat) {
        setImportMsg('Importing…');
        const res = await fetch('/api/attendance/bulk-import', { method: 'POST', body: f });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || 'Import failed');
        const summary = `Imported ${d.records} record${d.records === 1 ? '' : 's'} across ${d.sessions} session${d.sessions === 1 ? '' : 's'}${d.skippedLocked ? ` · ${d.skippedLocked} skipped (locked)` : ''}${d.errors?.length ? ` · ${d.errors.length} row(s) unmatched` : ''}.`;
        setImportMsg(d.records === 0 && d.errors?.length ? `${summary} First problem — ${d.errors[0]}` : summary);
        await loadAttendance();
        await loadOverview();
        return;
      }

      if (locked) { setImportMsg('This session is locked — reopen it before importing.'); return; }
      const norm = (s: any) => String(s ?? '').toUpperCase().replace(/[^A-Z]/g, '');
      const statusOf = (t: string): Status | null => {
        const k = norm(t);
        if (k.startsWith('P')) return 'PRESENT';
        if (k.startsWith('A')) return 'ABSENT';
        if (k.startsWith('L') || k.startsWith('ONLEAVE')) return 'LEAVE';
        return null;
      };
      const next: Record<string, Status> = { ...marks };
      let applied = 0, skipped = 0;
      for (const r of rows) {
        const adm = String(r['Admission No'] ?? r['AdmissionNo'] ?? r['Admission'] ?? r['ID'] ?? r['Id'] ?? '').trim();
        const nm = String(r['Name'] ?? r['Student'] ?? '').trim();
        const st = statusOf(String(r['Status'] ?? ''));
        if (!st) continue;
        const stu = roster.find((s) => s.id === adm) || (nm ? roster.find((s) => norm(s.name) === norm(nm)) : undefined);
        if (stu) { next[stu.id] = st; applied++; } else { skipped++; }
      }
      setMarks(next);
      setImportMsg(`Imported ${applied} mark${applied === 1 ? '' : 's'}${skipped ? ` · ${skipped} row(s) didn’t match a student` : ''}. Review below, then Submit.`);
    } catch (err) {
      setImportMsg(err instanceof Error ? err.message : 'Could not read the file.');
    }
  };

  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [classId, setClassId] = useState('');
  const [date, setDate] = useState(todayStr());

  // Configurable sessions (from Settings) + the currently selected one
  const [sessions, setSessions] = useState<SessionDef[]>(DEFAULT_SESSIONS);
  const [slot, setSlot] = useState<string>(DEFAULT_SESSIONS[0].key);

  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [marks, setMarks] = useState<Record<string, Status>>({});
  const [locked, setLocked] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  // Per-class marked status for the selected date: { classId: { [slotKey]: status } }
  const [overview, setOverview] = useState<Record<string, Record<string, string>>>({});

  // Load configured sessions from Settings
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/settings');
        if (!res.ok) return;
        const s = await res.json();
        const list: SessionDef[] = Array.isArray(s.sessions) && s.sessions.length ? s.sessions : DEFAULT_SESSIONS;
        setSessions(list);
        setSlot((cur) => (list.some((x) => x.key === cur) ? cur : list[0].key));
      } catch {
        /* keep defaults */
      }
    })();
  }, []);

  const currentSession = sessions.find((s) => s.key === slot) || sessions[0];
  const windowLabel = currentSession && currentSession.open && currentSession.close
    ? `${currentSession.open} – ${currentSession.close}`
    : '';

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch(`/api/attendance/overview?date=${date}`);
      if (res.ok) setOverview(await res.json());
    } catch {
      /* non-fatal */
    }
  }, [date]);

  // Refresh the pill badges whenever the date changes
  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  // Load classes once
  useEffect(() => {
    (async () => {
      const res = await fetch('/api/classes');
      if (res.ok) {
        const data: SchoolClass[] = await res.json();
        setClasses(data);
        if (data.length && !classId) setClassId(data[0].id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAttendance = useCallback(async () => {
    if (!classId) return;
    setLoading(true);
    setMessage('');
    try {
      const params = new URLSearchParams({ classId, date, slot });
      const res = await fetch(`/api/attendance?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      setRoster(data.roster);
      setMarks(data.marks || {});
      setLocked(data.locked);
      setSessionId(data.sessionId);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to load attendance');
    } finally {
      setLoading(false);
    }
  }, [classId, date, slot]);

  useEffect(() => {
    loadAttendance();
  }, [loadAttendance]);

  const setMark = (studentId: string, status: Status) => {
    if (locked || !canMark) return;
    setMarks((prev) => {
      const next = { ...prev };
      if (next[studentId] === status) delete next[studentId];
      else next[studentId] = status;
      return next;
    });
  };

  const markAllPresent = () => {
    if (locked || !canMark) return;
    const next: Record<string, Status> = {};
    roster.forEach((s) => (next[s.id] = 'PRESENT'));
    setMarks(next);
  };

  const counts = roster.reduce(
    (acc, s) => {
      const v = marks[s.id];
      if (v === 'PRESENT') acc.present++;
      else if (v === 'ABSENT') acc.absent++;
      else if (v === 'LEAVE') acc.leave++;
      else acc.unmarked++;
      return acc;
    },
    { present: 0, absent: 0, leave: 0, unmarked: 0 }
  );

  const total = roster.length;
  const pct = total ? Math.round((counts.present / total) * 1000) / 10 : 0;
  const allMarked = total > 0 && counts.unmarked === 0;
  const canSave = allMarked && !locked;

  const cls = classes.find((c) => c.id === classId);

  const save = async () => {
    setSaving(true);
    setMessage('');
    try {
      const records = roster.map((s) => ({ studentId: s.id, status: marks[s.id] }));
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId, date, slot, records }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Failed (${res.status})`);
      }
      const data = await res.json();
      setSessionId(data.sessionId);

      // Close (lock) the session as part of submitting — anyone who can mark.
      if (data.sessionId && canMark) {
        const lockRes = await fetch(`/api/attendance/${data.sessionId}/lock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locked: true }),
        });
        if (lockRes.ok) setLocked(true);
      }

      setMessage(`Attendance saved · ${counts.present} of ${total} present — ${cls?.name} ${currentSession?.label || ''}`);
      loadOverview();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const reopen = async () => {
    if (!sessionId) return;
    const res = await fetch(`/api/attendance/${sessionId}/lock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locked: false }),
    });
    if (res.ok) {
      setLocked(false);
      setMessage('Session reopened — you can edit marks.');
      loadOverview();
    }
  };

  return (
    <>
      <PageHeader
        title="Mark attendance"
        meta={`${cls ? shortClassName(cls.name) : '—'} · ${currentSession?.label || ''} session${windowLabel ? ` · ${windowLabel}` : ''}`}
        actions={
          <>
            {canExport && (
              <Button icon="Download" onClick={() => setExportOpen(true)}>Export</Button>
            )}
            {canImport && (
              <Button icon="FileSpreadsheet" onClick={downloadAttTemplate} disabled={!classId}>Template</Button>
            )}
            {canImport && (
              <Button icon="Upload" onClick={() => importInputRef.current?.click()}>Import</Button>
            )}
            {canMark && (
              <Button icon="CheckCheck" onClick={markAllPresent} disabled={locked || total === 0}>
                Mark all present
              </Button>
            )}
            {locked ? (
              isAdmin ? (
                <Button kind="primary" icon="LockOpen" onClick={reopen}>
                  Reopen session
                </Button>
              ) : (
                <Button kind="primary" icon="CheckCircle2" disabled>
                  Submitted
                </Button>
              )
            ) : canMark ? (
              <Button kind="primary" icon="Check" onClick={save} disabled={!canSave || saving}>
                {saving ? 'Submitting…' : 'Submit attendance'}
              </Button>
            ) : (
              <span className="text-xs text-slate-500 inline-flex items-center gap-1.5">
                <Icon name="Eye" size={14} /> View only
              </span>
            )}
          </>
        }
      />

      {/* Class pills — dot shows if the SELECTED session is marked */}
      <div className="flex flex-wrap items-center gap-2 mt-3">
        {classes.map((c) => {
          const status = overview[c.id]?.[slot] || 'pending';
          const dotColor =
            status === 'locked'
              ? 'bg-success-500'
              : status === 'taken'
              ? 'bg-warn-500'
              : classId === c.id
              ? 'bg-white/50'
              : 'bg-slate-300';
          const dotTitle =
            status === 'locked' ? 'Submitted' : status === 'taken' ? 'Reopened — not submitted' : 'Not marked yet';
          return (
            <button
              key={c.id}
              onClick={() => setClassId(c.id)}
              title={`${shortClassName(c.name)} · ${dotTitle}`}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-pill text-sm font-medium transition-colors ${
                classId === c.id
                  ? 'bg-purple-500 text-white'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${dotColor}`} />
              {shortClassName(c.name)}
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${classId === c.id ? 'bg-white/20' : 'bg-slate-100 text-slate-600'}`}>
                {c._count.students}
              </span>
            </button>
          );
        })}
      </div>

      {/* Compact control row: legend (left) + date & session (right) */}
      <div className="flex items-center justify-between mt-3 gap-4 flex-wrap">
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-slate-300" /> Not marked</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-success-500" /> Submitted</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-warn-500" /> Reopened</span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="px-2.5 py-1.5 rounded-md border border-slate-200 text-sm text-slate-900 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 focus:outline-none"
          />
          <div className="flex rounded-md border border-slate-200 overflow-hidden flex-wrap">
            {sessions.map((s) => (
              <button
                key={s.key}
                onClick={() => setSlot(s.key)}
                title={s.open && s.close ? `${s.open} – ${s.close}` : undefined}
                className={`px-3 py-1.5 text-sm font-medium transition-colors border-l border-slate-200 first:border-l-0 ${
                  slot === s.key ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Compact summary strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 mt-3 bg-white rounded-lg border border-slate-200 shadow-xs px-4 py-2">
        <div className="flex items-center gap-3">
          <Donut pct={pct} size={48} stroke={8} label="" />
          <div>
            <div className="text-base font-semibold text-slate-900 leading-tight">
              {counts.present} of {total} present
            </div>
            <div className={`flex items-center gap-1.5 text-xs font-medium ${allMarked ? 'text-success-700' : 'text-slate-500'}`}>
              <Icon name={allMarked ? 'CheckCircle2' : 'CircleDashed'} size={13} />
              {locked ? 'Submitted' : allMarked ? 'Ready to submit' : `${counts.unmarked} unmarked`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {[
            { label: 'Present', value: counts.present, color: 'text-success-700' },
            { label: 'Absent', value: counts.absent, color: 'text-danger-700' },
            { label: 'Leave', value: counts.leave, color: 'text-info-700' },
          ].map((s) => (
            <div key={s.label} className="px-2.5 py-1 rounded-md bg-slate-50 text-center min-w-[52px]">
              <span className={`font-semibold ${s.color}`}>{s.value}</span>
              <span className="text-[11px] text-slate-500 ml-1">{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {message && (
        <div className="mt-3 px-4 py-2.5 bg-slate-100 text-slate-700 rounded-md text-sm">{message}</div>
      )}
      {importMsg && (
        <div className="mt-3 px-4 py-2.5 bg-info-50 text-info-700 rounded-md text-sm flex items-center justify-between">
          <span>{importMsg}</span>
          <button onClick={() => setImportMsg('')}><Icon name="X" size={15} /></button>
        </div>
      )}

      {/* Roster table */}
      <Card className="mt-4" padded={false}>
        {loading ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left py-3 px-6 font-semibold text-slate-500 text-xs uppercase tracking-wide">Student</th>
                  <th className="text-left py-3 px-6 font-semibold text-slate-500 text-xs uppercase tracking-wide w-24">Roll</th>
                  <th className="text-left py-3 px-6 font-semibold text-slate-500 text-xs uppercase tracking-wide w-40">Mark</th>
                  <th className="text-left py-3 px-6 font-semibold text-slate-500 text-xs uppercase tracking-wide">Guardian</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 10 }).map((_, i) => (
                  <TableRowSkeleton key={i} cols={4} />
                ))}
              </tbody>
            </table>
          </div>
        ) : total === 0 ? (
          <div className="py-12">
            <EmptyState icon="Users" title="No students in this class" body="Assign students to this class first." />
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full sm:min-w-[520px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left py-3 px-4 sm:px-6 font-semibold text-slate-500 text-xs uppercase tracking-wide">Student</th>
                <th className="hidden sm:table-cell text-left py-3 px-6 font-semibold text-slate-500 text-xs uppercase tracking-wide w-24">Roll</th>
                <th className="text-left py-3 px-4 sm:px-6 font-semibold text-slate-500 text-xs uppercase tracking-wide w-40">Mark</th>
                <th className="hidden sm:table-cell text-left py-3 px-6 font-semibold text-slate-500 text-xs uppercase tracking-wide">Guardian</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((student) => (
                <tr key={student.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-3 px-4 sm:px-6">
                    <div className="flex items-center gap-3">
                      <Avatar name={student.name} size="sm" />
                      <span className="font-medium text-slate-900">{student.name}</span>
                    </div>
                  </td>
                  <td className="hidden sm:table-cell py-3 px-6 text-sm text-slate-600">{student.roll || '—'}</td>
                  <td className="py-3 px-4 sm:px-6">
                    <div className="flex items-center gap-1.5">
                      {MARKS.map((m) => {
                        const active = marks[student.id] === m.value;
                        return (
                          <button
                            key={m.value}
                            onClick={() => setMark(student.id, m.value)}
                            disabled={locked || !canMark}
                            className={`w-9 h-9 rounded-md border text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                              active ? m.on : m.off
                            }`}
                            title={m.value}
                          >
                            {m.letter}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                  <td className="hidden sm:table-cell py-3 px-6 text-sm text-slate-600">{student.guardianName}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Card>

      {/* Hidden file picker for the friendly attendance import */}
      <input ref={importInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={pickImport} />

      {/* Export scope */}
      <Modal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export attendance"
        subtitle="Readable Excel (no IDs) — edit and re-upload to update"
        width={460}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setExportOpen(false)}>Cancel</Button>
            <Button kind="primary" icon="Download" onClick={runExport} disabled={exporting}>{exporting ? 'Preparing…' : 'Download'}</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-slate-500">Leave the filters blank to export all attendance.</p>
          <Field label="Class">
            <Select value={exClass} onChange={(e) => setExClass(e.target.value)}>
              <option value="">All classes</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{shortClassName(c.name)}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From"><Input type="date" value={exFrom} onChange={(e) => setExFrom(e.target.value)} /></Field>
            <Field label="To"><Input type="date" value={exTo} onChange={(e) => setExTo(e.target.value)} /></Field>
          </div>
        </div>
      </Modal>
    </>
  );
}
