'use client';

import React from 'react';
import { Icon } from '@/components/Icon';

// Client-side paging for lists that are loaded once and searched in the browser
// (instant search across ALL rows, only one page rendered). The page size is
// remembered per list in localStorage.
export const PAGE_SIZES = [20, 50, 100, 0] as const; // 0 = All

export function usePaged<T>(rows: T[], storageKey: string, resetKey: unknown) {
  const [pageSize, setPageSizeState] = React.useState<number>(20);
  const [page, setPage] = React.useState(1);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(`pageSize:${storageKey}`);
      const v = Number(raw);
      if (raw !== null && raw !== '' && (PAGE_SIZES as readonly number[]).includes(v)) setPageSizeState(v);
    } catch { /* storage unavailable */ }
  }, [storageKey]);

  const setPageSize = (n: number) => {
    setPageSizeState(n);
    setPage(1);
    try { localStorage.setItem(`pageSize:${storageKey}`, String(n)); } catch { /* ignore */ }
  };

  // New search / filter / sort → back to the first page.
  React.useEffect(() => { setPage(1); }, [resetKey]);

  const total = rows.length;
  const pages = pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const cur = Math.min(page, pages);
  const paged = React.useMemo(
    () => (pageSize ? rows.slice((cur - 1) * pageSize, cur * pageSize) : rows),
    [rows, pageSize, cur]
  );
  return { paged, page: cur, pages, pageSize, total, setPage, setPageSize };
}

export function Pager({ page, pages, pageSize, total, setPage, setPageSize, noun = 'students' }: {
  page: number; pages: number; pageSize: number; total: number;
  setPage: (p: number) => void; setPageSize: (n: number) => void; noun?: string;
}) {
  if (total === 0) return null;
  const from = pageSize ? (page - 1) * pageSize + 1 : 1;
  const to = pageSize ? Math.min(total, page * pageSize) : total;
  const btn = 'inline-flex items-center justify-center w-8 h-8 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent';
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 text-sm text-slate-600">
      <div className="tabular-nums">Showing <b>{from}–{to}</b> of <b>{total}</b> {noun}</div>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          Show
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500/20">
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n || 'All'}</option>)}
          </select>
        </label>
        {pages > 1 && (
          <div className="flex items-center gap-1.5">
            <button className={btn} onClick={() => setPage(page - 1)} disabled={page <= 1} title="Previous page"><Icon name="ChevronLeft" size={16} /></button>
            <span className="tabular-nums text-xs text-slate-500 px-1">Page {page} / {pages}</span>
            <button className={btn} onClick={() => setPage(page + 1)} disabled={page >= pages} title="Next page"><Icon name="ChevronRight" size={16} /></button>
          </div>
        )}
      </div>
    </div>
  );
}
