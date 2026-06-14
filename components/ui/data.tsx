'use client';

import React from 'react';

// ========== StatCard ==========
interface StatCardProps {
  label: string;
  value: React.ReactNode;
  delta?: string;
  deltaTone?: 'up' | 'down' | 'neutral';
  caption?: string;
}

export function StatCard({ label, value, delta, deltaTone = 'neutral', caption }: StatCardProps) {
  const deltaToneClasses = {
    up: 'text-success-600',
    down: 'text-danger-600',
    neutral: 'text-slate-500',
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-xs px-4 py-3">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="flex items-baseline gap-2 mt-1">
        <span className="text-xl font-bold text-slate-900">{value}</span>
        {delta && <span className={`text-xs font-medium ${deltaToneClasses[deltaTone]}`}>{delta}</span>}
      </div>
      {caption && <div className="text-xs text-slate-400 mt-0.5">{caption}</div>}
    </div>
  );
}

// ========== DetailRow (read-only key/value, for detail drawers) ==========
export function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-500 flex-shrink-0">{label}</span>
      <span className="text-sm font-medium text-slate-900 text-right break-words">
        {value === null || value === undefined || value === '' ? '—' : value}
      </span>
    </div>
  );
}

// ========== PageHeader ==========
interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  meta?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ eyebrow, title, meta, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-6 pb-4 border-b border-slate-100">
      <div className="flex-1 min-w-0">
        {eyebrow && <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-2">{eyebrow}</div>}
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{title}</h1>
        {meta && <p className="text-sm text-slate-500 mt-1">{meta}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap sm:flex-shrink-0">{actions}</div>}
    </div>
  );
}

// ========== Avatar ==========
interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
}

export function Avatar({ name, size = 'md' }: AvatarProps) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-12 h-12 text-base',
  };

  const colors = ['bg-purple-100', 'bg-blue-100', 'bg-green-100', 'bg-yellow-100', 'bg-pink-100'];
  const colorIndex = name.charCodeAt(0) % colors.length;

  return (
    <div className={`${sizeClasses[size]} ${colors[colorIndex]} rounded-full flex items-center justify-center font-semibold text-slate-700`}>
      {initials}
    </div>
  );
}

// ========== Donut ==========
interface DonutProps {
  pct: number;
  size?: number;
  stroke?: number;
  color?: string;
  label?: string;
}

export function Donut({ pct, size = 96, stroke = 11, color = 'var(--success-500)', label = 'present' }: DonutProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
  const center = size / 2;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={center} cy={center} r={r} fill="none" stroke="var(--slate-100)" strokeWidth={stroke} />
      <circle
        cx={center}
        cy={center}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={off}
        transform={`rotate(-90 ${center} ${center})`}
        style={{ transition: 'stroke-dashoffset 200ms cubic-bezier(0.2,0.7,0.2,1)' }}
      />
      <text x={center} y={center - size * 0.04} textAnchor="middle" dominantBaseline="central" style={{ font: `700 ${Math.round(size * 0.2)}px var(--font-display)`, fill: 'var(--fg-1)' }}>
        {Math.round(pct)}%
      </text>
      <text x={center} y={center + size * 0.14} textAnchor="middle" dominantBaseline="central" style={{ font: `500 ${Math.round(size * 0.11)}px var(--font-body)`, fill: 'var(--fg-3)' }}>
        {label}
      </text>
    </svg>
  );
}
