'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { PageHeader, Button, Card, Modal, Avatar, EmptyState, Donut, Skeleton, TableRowSkeleton } from '@/components/Primitives';
import { Icon } from '@/components/Icon';
import { downloadBackup } from '@/lib/utils';

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
  const doExport = async () => {
    setExporting(true);
    try { await downloadBackup('attendance'); } catch (e) { alert(e instanceof Error ? e.message : 'Export failed'); } finally { setExporting(false); }
  };

  // Restore attendance from a previously exported workbook (upsert by id).
  const canImport = myPerms.includes('ATTENDANCE_MARK') || myPerms.includes('ATTENDANCE_LOCK') || myPerms.includes('SETTINGS_MANAGE');
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<
    { ok: boolean; totals: { upserted: number; failed: number }; results: { sheet: string; total: number; upserted: number; failed: number; errors: string[] }[]; error?: string } | null
  >(null);

  const pickImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (f) setPendingImport(f);
  };
  const doImport = async () => {
    if (!pendingImport) return;
    const file = pendingImport;
    setPendingImport(null);
    setImporting(true);
    try {
      const res = await fetch('/api/backup/import?group=attendance', { method: 'POST', body: file });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Import failed (${res.status})`);
      setImportResult(data);
      await loadAttendance();
      await loadOverview();
    } catch (err) {
      setImportResult({ ok: false, totals: { upserted: 0, failed: 0 }, results: [], error: err instanceof Error ? err.message : 'Import failed' });
    } finally {
      setImporting(false);
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
              <Button icon="Download" onClick={doExport} disabled={exporting}>
                {exporting ? 'Exporting…' : 'Export'}
              </Button>
            )}
            {canImport && (
              <Button icon="Upload" onClick={() => importInputRef.current?.click()} disabled={importing}>
                {importing ? 'Importing…' : 'Import'}
              </Button>
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

      {/* Hidden file picker for attendance import */}
      <input ref={importInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={pickImport} />

      {/* Confirm before overwriting */}
      <Modal
        open={!!pendingImport}
        onClose={() => setPendingImport(null)}
        title="Import attendance?"
        subtitle={pendingImport?.name || ''}
        width={440}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setPendingImport(null)}>Cancel</Button>
            <Button kind="primary" icon="Upload" onClick={doImport} disabled={importing}>
              {importing ? 'Importing…' : 'Restore attendance'}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-600">
          This reads the <b>AttendanceSessions</b> and <b>AttendanceRecords</b> sheets from a previously
          exported workbook and restores each row by its id — updating existing sessions and re-creating
          any that are missing. Other data is left untouched.
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
                  No attendance rows found in this file. Make sure you uploaded an attendance export.
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
