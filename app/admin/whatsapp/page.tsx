'use client';

import { toast } from '@/lib/toast';
import React, { useState, useEffect, useCallback } from 'react';
import { PageHeader, Button, Card, Field, Input, Select, Chip, Skeleton } from '@/components/Primitives';
import { Icon } from '@/components/Icon';
import { WA_TEMPLATE_PRESETS } from '@/lib/waTemplatePresets';

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

  // create-template form
  const [tName, setTName] = useState('');
  const [tCat, setTCat] = useState('UTILITY');
  const [tBody, setTBody] = useState('');
  const [tFooter, setTFooter] = useState('Jnana Deepika Vidhya Samsthe');
  const [creating, setCreating] = useState(false);
  const [presetBusy, setPresetBusy] = useState('');

  const createPreset = async (key: string) => {
    setPresetBusy(key);
    const res = await fetch('/api/admin/whatsapp/template', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: key }) });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.ok) { toast.success(`Submitted to Meta as Utility — status: ${j.status}. Approval usually takes a few minutes to a few hours.`); load(); }
    else toast.error(`Could not create: ${j.error || 'error'}`);
    setPresetBusy('');
  };

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/whatsapp');
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const createTemplate = async () => {
    setCreating(true);
    const res = await fetch('/api/admin/whatsapp/template', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: tName, category: tCat, body: tBody, footer: tFooter }) });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.ok) { toast.success(`Template submitted — status: ${j.status}. It will show below once Meta reviews it.`); setTName(''); setTBody(''); load(); }
    else toast.error(`Could not create: ${j.error || 'error'}`);
    setCreating(false);
  };

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
      <PageHeader eyebrow="Administration" title="WhatsApp" meta="Manage message templates and the WhatsApp connection." />

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

          {/* Ready-made UTILITY templates */}
          <Card>
            <h2 className="font-semibold text-slate-800">Recommended templates (Utility)</h2>
            <p className="text-xs text-slate-500 mt-0.5">Factual updates about the parent&apos;s own child — no praise or promotional wording, so Meta keeps them as <b>Utility</b> (not Marketing). Create once; the app uses them automatically.</p>
            <div className="mt-3 space-y-3">
              {WA_TEMPLATE_PRESETS.map((p) => {
                const existing = data.templates.find((t) => t.name === p.name);
                return (
                  <div key={p.key} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="font-medium text-slate-800 text-sm">{p.title} <span className="font-mono text-xs text-slate-400">{p.name}</span></div>
                        <div className="text-xs text-slate-500">Used by: {p.usedFor}</div>
                      </div>
                      {existing ? (
                        <div className="flex items-center gap-1.5">
                          <Chip tone={existing.category === 'MARKETING' ? 'danger' : 'neutral'}>{existing.category}</Chip>
                          <Chip tone={statusTone(existing.status)}>{existing.status}</Chip>
                        </div>
                      ) : (
                        <Button size="sm" kind="primary" icon="Send" disabled={!!presetBusy || !data.configured} onClick={() => createPreset(p.key)}>{presetBusy === p.key ? 'Submitting…' : 'Create in Meta'}</Button>
                      )}
                    </div>
                    <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 border border-slate-100 p-2.5 text-[12.5px] text-slate-700 font-sans">{p.header === 'MONTHLY_CALENDAR' ? '[Image: month calendar]\n' : ''}{p.body}</pre>
                    {existing?.category === 'MARKETING' && <p className="mt-1.5 text-xs text-danger-700">Meta has put this one in Marketing. Delete it in WhatsApp Manager and create it again, or create a new name.</p>}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Icon name="Clock" size={16} className="text-purple-500" />
              Recipients and test sends for the daily reports are in <a href="/admin/schedulers" className="font-semibold text-purple-700 hover:underline">Administration → Schedulers</a>.
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
