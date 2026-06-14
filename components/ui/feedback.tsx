'use client';

import React from 'react';
import { Icon } from '@/components/Icon';

// ========== Chip ==========
interface ChipProps {
  tone?: 'success' | 'warn' | 'danger' | 'info' | 'neutral';
  children: React.ReactNode;
}

export function Chip({ tone = 'neutral', children }: ChipProps) {
  const bgClasses = {
    success: 'bg-success-50 text-success-700',
    warn: 'bg-warn-50 text-warn-700',
    danger: 'bg-danger-50 text-danger-700',
    info: 'bg-info-50 text-info-700',
    neutral: 'bg-slate-100 text-slate-700',
  };

  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${bgClasses[tone]}`}>
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          tone === 'success'
            ? 'bg-success-500'
            : tone === 'warn'
            ? 'bg-warn-500'
            : tone === 'danger'
            ? 'bg-danger-500'
            : tone === 'info'
            ? 'bg-info-500'
            : 'bg-slate-400'
        }`}
      ></span>
      {children}
    </span>
  );
}

// ========== EmptyState ==========
interface EmptyStateProps {
  icon?: string;
  title: string;
  body?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon = 'Inbox', title, body, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4">
      <div className="text-slate-400 mb-4">
        <Icon name={icon as any} size={48} />
      </div>
      <h3 className="text-lg font-semibold text-slate-900 text-center">{title}</h3>
      {body && <p className="text-sm text-slate-500 mt-1 text-center max-w-xs">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ========== Skeleton ==========
interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  rounded?: 'none' | 'sm' | 'md' | 'lg' | 'full';
  className?: string;
}

export function Skeleton({ width = '100%', height = 20, rounded = 'md', className = '' }: SkeletonProps) {
  const radiusClasses = {
    none: 'rounded-none',
    sm: 'rounded-sm',
    md: 'rounded-md',
    lg: 'rounded-lg',
    full: 'rounded-full',
  };

  return (
    <div
      className={`skeleton ${radiusClasses[rounded]} ${className}`}
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
      }}
    />
  );
}

export function TableRowSkeleton({ cols = 6 }: { cols?: number }) {
  return (
    <tr className="border-b border-slate-100">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="py-3 px-6">
          <Skeleton height={16} width={Math.random() * 60 + 40} />
        </td>
      ))}
    </tr>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-xs px-4 py-3">
      <Skeleton height={14} width="60%" />
      <div className="mt-2 flex items-baseline gap-2">
        <Skeleton height={18} width={60} />
        <Skeleton height={12} width={40} />
      </div>
      <Skeleton height={12} width="70%" className="mt-1" />
    </div>
  );
}
