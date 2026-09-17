'use client';

import React, { useState, useEffect } from 'react';
import { Button, Card, Field, Input, Skeleton } from '@/components/Primitives';
import { Icon } from '@/components/Icon';

/**
 * Fee-collection preferences: the Collect-screen date default and the
 * auto-allocate priority order. Shared by Settings → Fee collection and
 * Fees → Collection settings. Saving needs SETTINGS_MANAGE (enforced server-side).
 */
export function CollectionSettingsPanel({ canEdit = true }: { canEdit?: boolean }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [dateMode, setDateMode] = useState<'today' | 'empty' | 'fixed'>('today');
  const [fixedDate, setFixedDate] = useState('');
  const [heads, setHeads] = useState<{ key: string; name: string }[]>([]);
  const [order, setOrder] = useState<string[]>([]); // ordered head keys (priority)
  const [waReceipt, setWaReceipt] = useState<'OFF' | 'ASK' | 'AUTO'>('ASK');
  const [waSaving, setWaSaving] = useState(false);
  const [waSaved, setWaSaved] = useState(false);

  useEffect(() => {
    fetch('/api/fees/config').then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d?.feeReceiptWhatsapp) setWaReceipt(d.feeReceiptWhatsapp);
    }).catch(() => {});
    fetch('/api/settings/collection').then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d) {
        setDateMode((d.collectDateMode || 'today') as any);
        setFixedDate(d.collectDateFixed || '');
        const hs: { key: string; name: string }[] = d.heads || [];
        setHeads(hs);
        const saved: string[] = Array.isArray(d.feeAllocPriority) ? d.feeAllocPriority : [];
        const known = new Set(hs.map((h) => h.key));
        const merged = [...saved.filter((k) => known.has(k)), ...hs.map((h) => h.key).filter((k) => !saved.includes(k))];
        setOrder(merged);
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const nameOf = (key: string) => heads.find((h) => h.key === key)?.name || key;
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    setOrder((o) => { const n = [...o]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  };

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const r = await fetch('/api/settings/collection', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collectDateMode: dateMode, collectDateFixed: dateMode === 'fixed' ? (fixedDate || null) : null, feeAllocPriority: order }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || 'Failed to save'); }
      setMsg({ tone: 'ok', text: 'Saved.' });
    } catch (e) { setMsg({ tone: 'err', text: e instanceof Error ? e.message : 'Failed to save' }); }
    finally { setSaving(false); }
  };

  const saveWaReceipt = async (mode: 'OFF' | 'ASK' | 'AUTO') => {
    setWaReceipt(mode); setWaSaving(true); setWaSaved(false);
    try {
      const r = await fetch('/api/fees/config', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'settings', feeReceiptWhatsapp: mode }),
      });
      if (!r.ok) throw new Error();
      setWaSaved(true); setTimeout(() => setWaSaved(false), 2000);
    } catch { setMsg({ tone: 'err', text: 'Could not save the WhatsApp setting.' }); }
    finally { setWaSaving(false); }
  };

  if (loading) return <div className="mt-4 space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={44} />)}</div>;

  return (
    <div className="mt-4 space-y-5 max-w-2xl">
      {msg && <div className={`rounded-md px-3 py-2 text-sm ${msg.tone === 'ok' ? 'bg-success-50 text-success-700 border border-success-100' : 'bg-danger-50 text-danger-700 border border-danger-100'}`}>{msg.text}</div>}

      {/* WhatsApp fee receipt on Collect */}
      <Card title={<div className="flex items-center justify-between w-full"><span className="inline-flex items-center gap-2"><Icon name="MessageCircle" size={16} className="text-success-600" /> WhatsApp fee receipt</span>{waSaving ? <span className="text-xs text-slate-400">Saving…</span> : waSaved ? <span className="text-xs text-success-600">Saved ✓</span> : null}</div>}>
        <p className="text-sm text-slate-500 mb-3">Whether Collect Payment offers to send the parent a fee receipt on WhatsApp.</p>
        <div className="space-y-2">
          {([
            ['ASK', 'Ask each time', 'Show the “Send WhatsApp receipt” option, unticked. The operator decides per payment. (Default)'],
            ['AUTO', 'On by default', 'Show it pre-ticked, so a receipt is sent unless the operator unticks it.'],
            ['OFF', 'Never send', 'Hide the option entirely — no WhatsApp fee receipts are sent. Print instead.'],
          ] as const).map(([val, label, sub]) => (
            <label key={val} className={`flex items-start gap-2.5 ${canEdit ? 'cursor-pointer' : 'opacity-60'}`}>
              <input type="radio" name="wareceipt" disabled={!canEdit || waSaving} className="mt-0.5 h-4 w-4 border-slate-300 text-purple-600 focus:ring-purple-500" checked={waReceipt === val} onChange={() => saveWaReceipt(val)} />
              <span className="text-sm"><span className="font-medium text-slate-800">{label}</span><span className="block text-xs text-slate-500">{sub}</span></span>
            </label>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 mt-2">Note: a student can still be opted out individually in their profile, and receipts only go to the numbers set there.</p>
      </Card>

      {/* Payment date default */}
      <Card title="Payment date on Collect screen">
        <p className="text-sm text-slate-500 mb-3">What the date field shows when you open Collect Payment.</p>
        <div className="space-y-2">
          {([['today', "Today's date", 'Pre-filled with the current date.'], ['empty', 'Empty', 'Blank — the operator types the date (uses today if left blank).'], ['fixed', 'A specific date', 'Always starts on the date you set below.']] as const).map(([val, label, sub]) => (
            <label key={val} className={`flex items-start gap-2.5 ${canEdit ? 'cursor-pointer' : 'opacity-60'}`}>
              <input type="radio" name="datemode" disabled={!canEdit} className="mt-0.5 h-4 w-4 border-slate-300 text-purple-600 focus:ring-purple-500" checked={dateMode === val} onChange={() => setDateMode(val)} />
              <span className="text-sm"><span className="font-medium text-slate-800">{label}</span><span className="block text-xs text-slate-500">{sub}</span></span>
            </label>
          ))}
          {dateMode === 'fixed' && (
            <div className="pl-6 pt-1"><Field label="Fixed date"><Input type="date" value={fixedDate} disabled={!canEdit} onChange={(e) => setFixedDate(e.target.value)} className="w-48" /></Field></div>
          )}
        </div>
      </Card>

      {/* Auto-allocate priority */}
      <Card title="Auto-allocate priority">
        <p className="text-sm text-slate-500 mb-3">When you enter an amount received and tap <b>Auto-allocate</b>, the money fills these fees top-to-bottom. Move the ones to clear first to the top.</p>
        {order.length === 0 ? <p className="text-sm text-slate-400">No fee heads found.</p> : (
          <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
            {order.map((key, i) => (
              <div key={key} className="flex items-center gap-3 px-3 py-2">
                <span className="text-xs font-semibold text-slate-400 tabular-nums w-5 text-right">{i + 1}</span>
                <span className="flex-1 text-sm text-slate-800">{nameOf(key)}</span>
                {canEdit && (
                  <div className="flex flex-col text-slate-300">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="hover:text-purple-600 disabled:opacity-30 leading-none"><Icon name="ChevronUp" size={15} /></button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === order.length - 1} className="hover:text-purple-600 disabled:opacity-30 leading-none"><Icon name="ChevronDown" size={15} /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {canEdit && <div className="flex justify-end"><Button kind="primary" icon="Check" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save collection settings'}</Button></div>}
    </div>
  );
}
