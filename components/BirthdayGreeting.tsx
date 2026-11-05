'use client';

import React, { useEffect, useState } from 'react';
import { Drawer, Button } from '@/components/Primitives';

interface Wish { kind: 'STUDENT' | 'STAFF'; id: string; name: string; firstName: string; age: number | null; title: string; body: string }
interface BirthdayResp { todayKey: string; schoolName: string; wishes: Wish[] }

/**
 * On a staff member's (or a parent's child's) birthday, greets them once that day in
 * a right-side drawer. Shown once per device per day; renders nothing otherwise.
 */
export function BirthdayGreeting() {
  const [data, setData] = useState<BirthdayResp | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/birthdays/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: BirthdayResp | null) => {
        if (!alive || !d?.wishes?.length) return;
        let seen = false;
        try { seen = localStorage.getItem(`bday-seen-${d.todayKey}`) === '1'; } catch {}
        setData(d);
        if (!seen) setOpen(true);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const close = () => {
    setOpen(false);
    try { if (data) localStorage.setItem(`bday-seen-${data.todayKey}`, '1'); } catch {}
  };

  if (!data) return null;
  const title = data.wishes.length === 1 ? data.wishes[0].title : '🎂 Happy Birthday!';

  return (
    <Drawer open={open} onClose={close} title={title} subtitle={data.schoolName}
      footer={<div className="flex justify-end"><Button kind="primary" onClick={close}>Thank you! 🎉</Button></div>}>
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-50 via-rose-50 to-purple-50 p-6 text-center">
        <div aria-hidden className="pointer-events-none absolute inset-0 text-2xl">
          <span className="absolute left-4 top-3 animate-bounce">🎈</span>
          <span className="absolute right-5 top-6 animate-bounce [animation-delay:300ms]">🎉</span>
          <span className="absolute left-8 bottom-4 animate-bounce [animation-delay:600ms]">✨</span>
          <span className="absolute right-8 bottom-3 animate-bounce [animation-delay:150ms]">🎊</span>
        </div>
        <div className="text-6xl mb-2">🎂</div>
        <div className="text-lg font-bold text-slate-900">Happy Birthday{data.wishes.length === 1 ? `, ${data.wishes[0].firstName}` : ''}!</div>
      </div>
      <div className="mt-4 space-y-3">
        {data.wishes.map((w) => (
          <div key={`${w.kind}-${w.id}`} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="font-semibold text-slate-900">
              {w.name}{w.kind === 'STUDENT' && w.age ? <span className="ml-1.5 text-sm font-medium text-purple-700">turns {w.age} today</span> : null}
            </div>
            <p className="mt-1 text-sm text-slate-600">{w.body}</p>
          </div>
        ))}
      </div>
    </Drawer>
  );
}
