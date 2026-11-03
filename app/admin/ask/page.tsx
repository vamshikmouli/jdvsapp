'use client';

import React, { useState } from 'react';
import { Card, Button, Input, Skeleton } from '@/components/Primitives';
import { Icon } from '@/components/Icon';

interface AskResult { answer: string; rows?: { label: string; value?: string }[]; intent?: string }

const EXAMPLES = [
  'How much fee collected today?',
  'Pending fees for 5th',
  'Who is absent today?',
  'Collected this month',
  'Who hasn’t paid in 3rd?',
  'Attendance today',
];

export default function AskPage() {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState('');

  const ask = async (question: string) => {
    const term = question.trim();
    if (!term) return;
    setQ(term);
    setLoading(true); setError(''); setResult(null);
    try {
      const res = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: term }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `Failed (${res.status})`);
      setResult(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-bold font-display text-slate-900 flex items-center gap-2"><Icon name="Sparkles" size={20} className="text-purple-600" /> Ask</h1>
        <p className="text-sm text-slate-500 mt-0.5">Ask about fees & attendance in plain words.</p>
      </div>

      <div className="flex items-center gap-2">
        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') ask(q); }}
          placeholder="e.g. Pending fees for 5th"
          className="flex-1"
        />
        <Button kind="primary" icon="Search" onClick={() => ask(q)} disabled={loading || !q.trim()}>{loading ? 'Asking…' : 'Ask'}</Button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {EXAMPLES.map((ex) => (
          <button key={ex} onClick={() => ask(ex)} disabled={loading}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:border-purple-300 hover:text-purple-700 disabled:opacity-50">
            {ex}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {loading && <Card><Skeleton height={20} width="70%" /><div className="mt-3 space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={16} />)}</div></Card>}
        {error && <Card><div className="flex items-start gap-2 text-sm text-danger-700"><Icon name="AlertCircle" size={16} className="mt-0.5" />{error}</div></Card>}
        {result && !loading && (
          <Card>
            <div className="text-sm text-slate-900 font-medium">{result.answer}</div>
            {result.rows && result.rows.length > 0 && (
              <div className="mt-3 border border-slate-100 rounded-lg divide-y divide-slate-100 overflow-hidden">
                {result.rows.map((r, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="text-slate-600 truncate">{r.label}</span>
                    {r.value != null && <span className="font-medium text-slate-900 tabular-nums flex-shrink-0 ml-3">{r.value}</span>}
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>

      <p className="mt-4 text-[11px] text-slate-400">Answers respect your access — you only see fees/attendance you’re allowed to. For exact records, open the Fees or Attendance pages.</p>
    </div>
  );
}
