'use client';

import { toast } from '@/lib/toast';
import React, { useState, useEffect, useCallback } from 'react';
import { PageHeader, Button, Card, Field, Input, Skeleton } from '@/components/Primitives';
import { Icon } from '@/components/Icon';
import { MiniToggle } from '@/app/admin/fees/account-ui';

// Scheduled WhatsApp reports to the office: who receives them, on/off, and a
// one-off test send. The schedule itself is the VM's cron (times below), which
// calls each report's link with CRON_SECRET.

interface Data {
  configured: boolean;
  recipients: string;
  attendanceRecipients?: string;
  dailyEnabled: boolean;
  weeklyEnabled: boolean;
}

const JOBS = [
  { key: 'daily', icon: 'LayoutGrid', title: 'Staff attendance board', when: '10:30 AM & 5:00 PM · Mon–Sat', to: 'Daily digest recipients', path: '/api/staff-attendance/cron/daily-admin-report', cron: ['0 5 * * 1-6', '30 11 * * 1-6'] },
  { key: 'status', icon: 'ClipboardCheck', title: 'Class attendance status (submitted / pending)', when: '11:00 AM · Mon–Sat', to: 'Attendance status recipients', path: '/api/attendance/cron/attendance-status', cron: ['30 5 * * 1-6'] },
  { key: 'weekly', icon: 'CalendarDays', title: 'Weekly staff attendance calendar', when: 'Saturday 6:00 PM', to: 'Daily digest recipients', path: '/api/staff-attendance/cron/weekly-report', cron: ['GitHub Actions (weekly-attendance-report)'] },
] as const;

export default function SchedulersPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [recipients, setRecipients] = useState('');
  const [savingR, setSavingR] = useState(false);
  const [attNums, setAttNums] = useState<string[]>([]);
  const [attInput, setAttInput] = useState('');
  const [savingAtt, setSavingAtt] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState('');
  const [showCron, setShowCron] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/whatsapp');
    if (res.ok) {
      const d = await res.json();
      setData(d);
      setRecipients(d.recipients || '');
      setAttNums((d.attendanceRecipients || '').split(',').map((x: string) => x.trim()).filter(Boolean));
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const patch = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/admin/whatsapp', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return res.ok ? res.json() : null;
  };

  const saveRecipients = async () => {
    setSavingR(true);
    const j = await patch({ recipients });
    if (j) { setRecipients(j.recipients || ''); toast.success('Saved recipients.'); } else toast.error('Could not save.');
    setSavingR(false);
  };

  // Attendance-status recipients: add / remove numbers, auto-saved.
  const saveAtt = async (nums: string[]) => {
    setSavingAtt(true);
    const j = await patch({ attendanceRecipients: nums.join(',') });
    if (j) setAttNums((j.attendanceRecipients || '').split(',').map((x: string) => x.trim()).filter(Boolean));
    else toast.error('Could not save.');
    setSavingAtt(false);
  };
  const addAtt = () => {
    const n = attInput.replace(/[^\d+]/g, '');
    if (n.length < 10 || attNums.includes(n)) { setAttInput(''); return; }
    const next = [...attNums, n]; setAttNums(next); setAttInput(''); saveAtt(next);
  };
  const removeAtt = (n: string) => { const next = attNums.filter((x) => x !== n); setAttNums(next); saveAtt(next); };

  const toggle = async (key: 'dailyEnabled' | 'weeklyEnabled', v: boolean) => {
    setData((d) => (d ? { ...d, [key]: v } : d));
    if (!(await patch({ [key]: v }))) { toast.error('Could not save.'); load(); }
  };

  const test = async (job: (typeof JOBS)[number]) => {
    if (!testTo.trim()) { toast.error('Enter a test number first.'); return; }
    setBusy(job.key);
    const res = await fetch(`${job.path}?to=${encodeURIComponent(testTo.trim())}`, { method: 'POST' });
    const j = await res.json().catch(() => ({}));
    if (res.ok && (j.sent ?? 0) > 0) toast.success(`${job.title}: sent to ${testTo.trim()}.`);
    else if (res.ok) toast.error(`${job.title}: not sent (${j.failed ? 'WhatsApp rejected it — see Communications → Analytics for the reason' : j.skipped || j.error || 'nothing to send'}).`);
    else toast.error(`${job.title}: ${j.error || 'failed'}`);
    setBusy('');
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://your-domain';

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
      <PageHeader eyebrow="Administration" title="Schedulers" meta="Daily WhatsApp reports to the office — who gets them, and a test send." />

      {loading ? <Skeleton height={160} /> : !data ? (
        <Card><p className="text-sm text-slate-500">Could not load.</p></Card>
      ) : (
        <>
          {!data.configured && (
            <div className="rounded-lg border border-marigold-100 bg-marigold-50 px-3 py-2.5 text-sm text-marigold-700">WhatsApp isn&apos;t configured on the server, so nothing can be sent yet.</div>
          )}

          {/* Overview */}
          <Card padded={false}>
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
              <h2 className="font-semibold text-slate-800">Scheduled reports</h2>
              <button onClick={() => setShowCron((v) => !v)} className="text-xs font-medium text-purple-600 hover:text-purple-700 inline-flex items-center gap-1">
                <Icon name="Terminal" size={13} /> {showCron ? 'Hide' : 'Show'} server schedule
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {JOBS.map((j) => {
                const toggleKey = j.key === 'daily' ? 'dailyEnabled' : j.key === 'weekly' ? 'weeklyEnabled' : null;
                return (
                  <div key={j.key} className="flex items-center gap-3 px-4 py-3">
                    <div className="w-9 h-9 rounded-lg bg-purple-50 text-purple-600 grid place-items-center flex-shrink-0"><Icon name={j.icon as any} size={17} /></div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-900">{j.title}</div>
                      <div className="text-xs text-slate-500">{j.when} · to {j.to}</div>
                    </div>
                    {toggleKey ? (
                      <label className="flex items-center gap-2 text-xs text-slate-500 flex-shrink-0">
                        {data[toggleKey] ? 'On' : 'Off'}
                        <MiniToggle on={!!data[toggleKey]} onChange={(v) => toggle(toggleKey, v)} />
                      </label>
                    ) : <span className="text-xs text-slate-400 flex-shrink-0">{attNums.length ? 'On' : 'No recipients'}</span>}
                  </div>
                );
              })}
            </div>
            {showCron && (
              <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/60 text-xs text-slate-600 space-y-2">
                <p>These run from the server&apos;s <b>crontab</b> (<code>crontab -e</code> on the VM). Times are UTC — IST is UTC + 5:30. Replace <code>YOUR_CRON_SECRET</code> with <code>CRON_SECRET</code> from the server&apos;s <code>.env</code>.</p>
                <pre className="whitespace-pre-wrap break-all rounded-md bg-white border border-slate-200 p-2.5 font-mono text-[11px] leading-relaxed">{JOBS.filter((j) => !j.cron[0].startsWith('GitHub')).flatMap((j) => j.cron.map((c) => `${c}  curl -s -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" ${origin}${j.path} > /dev/null`)).join('\n')}</pre>
                <p>The weekly calendar runs from GitHub Actions (repo secrets <code>WEEKLY_REPORT_URL</code> and <code>CRON_SECRET</code>).</p>
              </div>
            )}
          </Card>

          {/* Daily digest recipients */}
          <Card>
            <h2 className="font-semibold text-slate-800">Daily digest recipients</h2>
            <p className="text-xs text-slate-500 mt-0.5">Admin numbers that receive the twice-daily all-staff board (10:30 AM &amp; 5 PM) and the weekly calendar. Comma-separated, with country code.</p>
            <div className="mt-3 space-y-2">
              <Input value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="919742417262, 919632465456" />
              <Button kind="primary" icon="Save" disabled={savingR} onClick={saveRecipients}>{savingR ? 'Saving…' : 'Save recipients'}</Button>
            </div>
          </Card>

          {/* Attendance-status recipients (add/remove) */}
          <Card>
            <h2 className="font-semibold text-slate-800">Attendance status recipients</h2>
            <p className="text-xs text-slate-500 mt-0.5">Numbers that get the daily <b>11 AM</b> class-attendance status (which classes submitted / pending). Add or remove numbers below — saved automatically.</p>
            <div className="mt-3 flex gap-2">
              <Input value={attInput} onChange={(e) => setAttInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAtt(); } }} placeholder="9198XXXXXXXX (with or without 91)" className="flex-1" />
              <Button icon="Plus" disabled={savingAtt || attInput.replace(/[^\d]/g, '').length < 10} onClick={addAtt}>Add</Button>
            </div>
            {attNums.length === 0 ? (
              <p className="text-[13px] text-slate-400 mt-3">No recipients yet — add the numbers that should get the 11 AM report.</p>
            ) : (
              <div className="flex flex-wrap gap-2 mt-3">
                {attNums.map((n) => (
                  <span key={n} className="inline-flex items-center gap-1.5 bg-slate-100 border border-slate-200 rounded-full pl-3 pr-1.5 py-1 text-[13px] text-slate-700">
                    {n}
                    <button onClick={() => removeAtt(n)} disabled={savingAtt} className="text-slate-400 hover:text-danger-600 rounded-full p-0.5" title="Remove"><Icon name="X" size={13} /></button>
                  </span>
                ))}
              </div>
            )}
          </Card>

          {/* Test */}
          <Card>
            <h2 className="font-semibold text-slate-800">Send a test</h2>
            <p className="text-xs text-slate-500 mt-0.5">Send one report now to a single number, to check the template and delivery.</p>
            <div className="mt-3 space-y-2">
              <Field label="Test number (with country code)"><Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="919742417262" /></Field>
              <div className="flex flex-wrap gap-2">
                {JOBS.map((j) => (
                  <Button key={j.key} disabled={!!busy || !data.configured} onClick={() => test(j)} icon="Send">
                    {busy === j.key ? 'Sending…' : j.key === 'daily' ? 'Staff board' : j.key === 'status' ? 'Attendance status' : 'Weekly calendar'}
                  </Button>
                ))}
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
