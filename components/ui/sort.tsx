'use client';

import React from 'react';
import { Icon } from '@/components/Icon';

export type SortState = { key: string; dir: 'asc' | 'desc' } | null;

/** Toggle sort: same column flips asc/desc, new column starts asc. */
export function nextSort(cur: SortState, key: string): SortState {
  if (cur?.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: 'asc' };
}

/** Sort rows by a key, using a value accessor. Numbers numeric, strings natural. */
export function sortRows<T>(rows: T[], sort: SortState, get: (row: T, key: string) => unknown): T[] {
  if (!sort) return rows;
  const mul = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = get(a, sort.key);
    const bv = get(b, sort.key);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mul;
    return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * mul;
  });
}

/** Sortable table header cell. Pass `sortKey` to make it clickable. */
export function Th({
  label, sortKey, sort, onSort, align = 'left', className = '',
}: {
  label: React.ReactNode;
  sortKey?: string;
  sort?: SortState;
  onSort?: (key: string) => void;
  align?: 'left' | 'right' | 'center';
  className?: string;
}) {
  const active = !!sortKey && sort?.key === sortKey;
  const clickable = !!sortKey && !!onSort;
  const alignCls = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <th className={`py-2.5 px-6 font-semibold text-xs uppercase tracking-wide text-slate-600 ${alignCls} ${className}`}>
      {clickable ? (
        <button
          type="button"
          onClick={() => onSort!(sortKey!)}
          className={`inline-flex items-center gap-1 hover:text-slate-900 transition-colors ${align === 'right' ? 'flex-row-reverse' : ''}`}
        >
          <span>{label}</span>
          <Icon
            name={active ? (sort!.dir === 'asc' ? 'ArrowUp' : 'ArrowDown') : 'ChevronsUpDown'}
            size={13}
            className={active ? 'text-purple-600' : 'text-slate-300'}
          />
        </button>
      ) : (
        label
      )}
    </th>
  );
}
