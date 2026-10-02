'use client';

import React from 'react';
import { Icon } from '@/components/Icon';
import { usePathname } from 'next/navigation';
import { detectBrowser, browserIssues, voiceProblem } from '@/lib/browserCheck';
import { getSpeechRecognition } from '@/lib/marksVoice';

// Thin notice under the top bar when this browser is too old or blocks a feature.
// Says the browser + version and exactly what to do. Dismissed per problem, per device.
export function BrowserNotice() {
  const [issues, setIssues] = React.useState<{ key: string; text: string }[]>([]);
  const [label, setLabel] = React.useState('');
  const onMarks = (usePathname() || '').startsWith('/admin/marks');

  React.useEffect(() => {
    const b = detectBrowser(navigator.userAgent, navigator.maxTouchPoints || 0);
    const env = { secure: window.isSecureContext || location.hostname === 'localhost', hasVoice: !!getSpeechRecognition(), online: true };
    const all = browserIssues(b, env);
    // Marks page: also say up front if voice entry won't work in this browser.
    const vp = onMarks && env.secure ? voiceProblem(b, env) : null;
    if (vp) all.push({ key: 'voice', text: vp });
    const key = (k: string) => `browserNotice:${k}:${b.name}${b.version ?? ''}`;
    let hidden: string[] = [];
    try { hidden = all.filter((i) => localStorage.getItem(key(i.key)) === '1').map((i) => i.key); } catch { /* storage blocked */ }
    setLabel(b.label);
    setIssues(all.filter((i) => !hidden.includes(i.key)).map((i) => ({ ...i, key: key(i.key) })));
  }, [onMarks]);

  if (!issues.length) return null;
  const dismiss = () => {
    try { issues.forEach((i) => localStorage.setItem(i.key, '1')); } catch { /* storage blocked */ }
    setIssues([]);
  };
  return (
    <div className="mb-4 rounded-xl border border-marigold-300 bg-marigold-50 px-4 py-3 text-sm text-slate-800 flex items-start gap-3" role="status">
      <Icon name="AlertTriangle" size={18} className="mt-0.5 flex-shrink-0 text-marigold-600" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">Browser check — {label}</div>
        <ul className="mt-1 space-y-1 text-[13px] leading-snug">
          {issues.map((i) => <li key={i.key}>{i.text}</li>)}
        </ul>
      </div>
      <button onClick={dismiss} className="flex-shrink-0 text-marigold-700 hover:text-slate-800" aria-label="Dismiss" title="Hide this notice">
        <Icon name="X" size={16} />
      </button>
    </div>
  );
}
