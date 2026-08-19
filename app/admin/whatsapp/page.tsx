'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { PageHeader, Button, Card, Field, Input, Select, Chip, Skeleton } from '@/components/Primitives';
import { Icon } from '@/components/Icon';

interface Template { name: string; status: string; category: string; language: string; }
interface Data {
  configured: boolean;
  phone: any;
  templates: Template[];
  recipients: string;
  dailyEnabled: boolean;
  weeklyEnabled: boolean;
  weeklyTemplate: string;
  dailyTemplate: string;
}

function statusTone(s: string): 'success' | 'warn' | 'danger' | 'neutral' {
  if (s === 'APPROVED') return 'success';
  if (s === 'REJECTED' || s === 'DISABLED' || s === 'PAUSED') return 'danger';
  if (s === 'PENDING' || s === 'IN_APPEAL' || s === 'PENDING_DELETION') return 'warn';
  return 'neutral';
}

export default function WhatsAppAdminPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [recipients, setRecipients] = useState('');
  const [savingR, setSavingR] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState('');

  // create-template form
  const [tName, setTName] = useState('');
  const [tCat, setTCat] = useState('UTILITY');
  const [tBody, setTBody] = useState('');
  const [tFooter, setTFooter] = useState('Jnana Deepika Vidhya Samsthe');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/whatsapp');
    if (res.ok) { const d = await res.json(); setData(d); setRecipients(d.recipients || ''); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveRecipients = async () => {
    setSavingR(true);
    const res = await fetch('/api/admin/whatsapp', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipients }) });
    if (res.ok) { const j = await res.json(); setRecipients(j.recipients || ''); alert('Saved recipients.'); }
    else alert('Could not save.');
    setSavingR(false);
  };

  const createTemplate = async () => {
    setCreating(true);
    const res = await fetch('/api/admin/whatsapp/template', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: tName, category: tCat, body: tBody, footer: tFooter }) });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.ok) { alert(`Template submitted — status: ${j.status}. It will show below once Meta reviews it.`); setTName(''); setTBody(''); load(); }
    else alert(`Could not create: ${j.error || 'error'}`);
    setCreating(false);
  };

  const test = async (kind: 'daily' | 'weekly') => {
    if (!testTo.trim()) { alert('Enter a test number first.'); return; }
    setBusy(kind);
    const url = kind === 'daily'
      ? `/api/staff-attendance/cron/daily-admin-report?to=${encodeURIComponent(testTo)}`
      : `/api/staff-attendance/cron/weekly-report?to=${encodeURIComponent(testTo)}`;
    const res = await fetch(url, { method: 'POST' });
    const j = await res.json().catch(() => ({}));
    if (res.ok) alert(`Test ${kind}: ${j.sent ?? 0} sent, ${j.failed ?? 0} failed.`);
    else alert(`Test failed: ${j.error || 'error'}`);
    setBusy('');
  };

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
      <PageHeader eyebrow="Administration" title="WhatsApp" meta="Manage message templates, recipients, and connection." />

      {loading ? <Skeleton height={120} /> : !data ? (
        <Card><p className="text-sm text-slate-500">Could not load.</p></Card>
      ) : (
        <>
          {/* Connection */}
          <Card>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-800">Connection</h2>
              <Button size="sm" kind="tertiary" icon="RefreshCw" onClick={load}>Refresh</Button>
            </div>
            {!data.configured || data.phone?.error ? (
              <p className="mt-2 text-sm text-danger-700">{data.phone?.error || 'WhatsApp not configured on the server.'}</p>
            ) : (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div><div className="text-slate-400 text-xs">Number</div><div className="font-medium text-slate-700">{data.phone.display_phone_number || '—'}</div></div>
                <div><div className="text-slate-400 text-xs">Name</div><div className="font-medium text-slate-700">{data.phone.verified_name || '—'}</div></div>
                <div><div className="text-slate-400 text-xs">Status</div><div className="font-medium text-slate-700">{data.phone.status || '—'}</div></div>
                <div><div className="text-slate-400 text-xs">Daily limit</div><div className="font-medium text-slate-700">{(data.phone.messaging_limit_tier || '').replace('TIER_', '') || '—'}</div></div>
              </div>
            )}
          </Card>

          {/* Templates */}
          <Card>
            <h2 className="font-semibold text-slate-800">Message templates</h2>
            <p className="text-xs text-slate-500 mt-0.5">Approval is by Meta and usually takes a few hours.</p>
            <div className="mt-3 divide-y divide-slate-100">
              {data.templates.length === 0 && <p className="text-sm text-slate-400 py-2">No templates yet.</p>}
              {data.templates.map((t) => (
                <div key={t.name + t.language} className="flex items-center justify-between py-2">
                  <div>
                    <div className="font-medium text-slate-800 text-sm">{t.name}</div>
                    <div className="text-xs text-slate-400">{t.category} · {t.language}</div>
                  </div>
                  <Chip tone={statusTone(t.status)}>{t.status}</Chip>
                </div>
              ))}
            </div>
          </Card>

          {/* Create template */}
          <Card>
            <h2 className="font-semibold text-slate-800">Create a template</h2>
            <p className="text-xs text-slate-500 mt-0.5">Adds an image-header template (the app supplies a sample image). Use <code>{'{{1}}'}</code>, <code>{'{{2}}'}</code> for variables — but not at the very start or end of the text.</p>
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Name (lowercase, no spaces)"><Input value={tName} onChange={(e) => setTName(e.target.value)} placeholder="e.g. monthly_notice" /></Field>
                <Field label="Category"><Select value={tCat} onChange={(e) => setTCat(e.target.value)}><option value="UTILITY">Utility (recommended)</option><option value="MARKETING">Marketing</option></Select></Field>
              </div>
              <Field label="Body"><textarea className="w-full rounded-lg border border-slate-300 p-2 text-sm min-h-[90px]" value={tBody} onChange={(e) => setTBody(e.target.value)} placeholder="Hi {{1}}, here is the update for {{2}}. Please see the attached image." /></Field>
              <Field label="Footer (optional)"><Input value={tFooter} onChange={(e) => setTFooter(e.target.value)} /></Field>
              <Button kind="primary" icon="Plus" disabled={creating} onClick={createTemplate}>{creating ? 'Submitting…' : 'Submit for approval'}</Button>
            </div>
          </Card>

          {/* Recipients */}
          <Card>
            <h2 className="font-semibold text-slate-800">Daily digest recipients</h2>
            <p className="text-xs text-slate-500 mt-0.5">Admin numbers that receive the twice-daily all-staff board (10:30 AM &amp; 5 PM). Comma-separated, with country code.</p>
            <div className="mt-3 space-y-2">
              <Input value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="919742417262, 919632465456" />
              <Button kind="primary" icon="Save" disabled={savingR} onClick={saveRecipients}>{savingR ? 'Saving…' : 'Save recipients'}</Button>
            </div>
          </Card>

          {/* Test */}
          <Card>
            <h2 className="font-semibold text-slate-800">Send a test</h2>
            <p className="text-xs text-slate-500 mt-0.5">Send a one-off to a single number to check delivery.</p>
            <div className="mt-3 flex flex-col sm:flex-row gap-2 sm:items-end">
              <div className="flex-1"><Field label="Test number (with country code)"><Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="919742417262" /></Field></div>
              <Button disabled={!!busy} onClick={() => test('daily')} icon="Send">{busy === 'daily' ? 'Sending…' : 'Daily board'}</Button>
              <Button disabled={!!busy} onClick={() => test('weekly')} icon="Send">{busy === 'weekly' ? 'Sending…' : 'Weekly calendar'}</Button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
