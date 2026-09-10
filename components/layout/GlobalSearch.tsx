'use client';

// Universal student search in the top bar. Type a name / ID / class / phone;
// results show the student's details, with a "Fee receive" action (for users
// who can collect) that opens the Collect Payment drawer.
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Primitives';
import { PaymentTimeline } from '@/app/admin/fees/account-ui';

interface Stu {
  id: string;
  name: string;
  admissionNo: string | null;
  gender: 'M' | 'F';
  className: string | null;
  fatherName: string | null;
  guardianName: string;
  fatherPhone: string | null;
  guardianPhone: string;
  village: string | null;
}

const shortClass = (name: string | null) => (name ? name.replace(/\s?STD$/i, '') : '—');

export function GlobalSearch() {
  const { data: session } = useSession();
  const perms = ((session?.user as any)?.perms as string[]) || [];
  const roleKey = (session?.user as any)?.roleKey as string | undefined;
  const canCollect = perms.includes('FEES_COLLECT');
  // Universal student search is for the Accountant and Admin roles (either the
  // built-in roleKey, or any custom role granted fee collection).
  const canUse = roleKey === 'admin' || roleKey === 'accountant' || canCollect;

  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Stu[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [timeline, setTimeline] = useState<{ id: string; name: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const runSearch = useCallback((query: string) => {
    if (timer.current) clearTimeout(timer.current);
    const term = query.trim();
    if (term.length < 1) { setRows([]); setLoading(false); return; }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/students?status=ACTIVE&q=${encodeURIComponent(term)}`);
        const data = res.ok ? await res.json() : [];
        const list: Stu[] = (Array.isArray(data) ? data : []).slice(0, 12).map((s: any) => ({
          id: s.id, name: s.name, admissionNo: s.admissionNo ?? null, gender: s.gender,
          className: s.class?.name ?? null, fatherName: s.fatherName ?? null, guardianName: s.guardianName,
          fatherPhone: s.fatherPhone ?? null, guardianPhone: s.guardianPhone, village: s.village ?? null,
        }));
        setRows(list);
      } catch { setRows([]); } finally { setLoading(false); }
    }, 250);
  }, []);

  // Close the desktop dropdown on outside click.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setFocused(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  if (!canUse) return null;

  const onChange = (v: string) => { setQ(v); runSearch(v); };
  const clear = () => { setQ(''); setRows([]); };

  const results = (
    <div className="max-h-[70vh] overflow-auto">
      {loading && <div className="px-3 py-6 text-center text-sm text-slate-400">Searching…</div>}
      {!loading && q.trim().length >= 1 && rows.length === 0 && <div className="px-3 py-6 text-center text-sm text-slate-400">No students match “{q.trim()}”.</div>}
      {!loading && rows.map((s) => {
        const parent = s.fatherName || s.guardianName;
        const phone = s.guardianPhone || s.fatherPhone;
        return (
          <div key={s.id} className="flex items-start gap-3 px-3 py-2.5 border-b border-slate-100 last:border-0 hover:bg-slate-50">
            <Avatar name={s.name} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-slate-900 truncate">{s.name}</div>
              <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                <span className="font-medium text-slate-600">{shortClass(s.className)} · {s.gender === 'F' ? 'Girl' : 'Boy'}</span>
                <span className="font-mono">{s.id}</span>
                {s.admissionNo && <span>Adm {s.admissionNo}</span>}
                {parent && <span>S/o {parent}</span>}
                {s.village && <span className="inline-flex items-center gap-1"><Icon name="MapPin" size={10} className="text-slate-400" /> {s.village}</span>}
                {phone && <a href={`tel:${phone}`} className="inline-flex items-center gap-1 text-purple-700"><Icon name="Phone" size={10} /> {phone}</a>}
              </div>
            </div>
            <button onClick={() => { setTimeline({ id: s.id, name: s.name }); setFocused(false); setMobileOpen(false); }}
              title="Payment history"
              className="inline-flex items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-semibold text-purple-700 hover:bg-purple-100 whitespace-nowrap flex-shrink-0">
              <Icon name="Eye" size={14} /> History
            </button>
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      {/* Desktop: inline search with dropdown */}
      <div ref={wrapRef} className="relative hidden lg:block">
        <div className="flex items-center gap-2 bg-slate-50 rounded-md px-3 py-2 w-56 border border-transparent focus-within:border-purple-300 focus-within:bg-white">
          <Icon name="Search" size={16} className="text-slate-400 flex-shrink-0" />
          <input
            type="text"
            autoComplete="off"
            placeholder="Search students…"
            value={q}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setFocused(true)}
            className="bg-transparent border-0 outline-none text-sm flex-1 min-w-0"
          />
          {q && <button onClick={clear} className="text-slate-300 hover:text-slate-500" title="Clear"><Icon name="X" size={15} /></button>}
        </div>
        {focused && q.trim().length >= 1 && (
          <div className="absolute right-0 mt-2 w-[26rem] bg-white border border-slate-200 rounded-xl shadow-lg z-40 overflow-hidden">
            {results}
          </div>
        )}
      </div>

      {/* Mobile/tablet: icon button that opens a search sheet */}
      <button onClick={() => setMobileOpen(true)} className="lg:hidden p-2 hover:bg-slate-100 rounded-md text-slate-500" title="Search students">
        <Icon name="Search" size={20} />
      </button>
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/30" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-x-0 top-0 bg-white p-3 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 flex-1 bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-200">
                <Icon name="Search" size={18} className="text-slate-400 flex-shrink-0" />
                <input
                  autoFocus type="text" autoComplete="off" placeholder="Search students…"
                  value={q} onChange={(e) => onChange(e.target.value)}
                  className="bg-transparent border-0 outline-none text-sm flex-1 min-w-0"
                />
                {q && <button onClick={clear} className="text-slate-300"><Icon name="X" size={16} /></button>}
              </div>
              <button onClick={() => setMobileOpen(false)} className="text-sm font-medium text-slate-500 px-2">Cancel</button>
            </div>
            <div className="mt-2 border-t border-slate-100 -mx-3">{results}</div>
          </div>
        </div>
      )}

      {timeline && <PaymentTimeline studentId={timeline.id} name={timeline.name} onClose={() => setTimeline(null)} />}
    </>
  );
}
