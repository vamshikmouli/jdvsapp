'use client';

import React from 'react';
import { createPortal } from 'react-dom';

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

// ========== ZoomPhoto ==========
/** A student photo that opens large when tapped (Esc / tap outside / ✕ closes). */
export function ZoomPhoto({ src, name, className = '', round = true, onError }: { src: string; name: string; className?: string; round?: boolean; onError?: () => void }) {
  const [big, setBig] = React.useState(false);
  React.useEffect(() => {
    if (!big) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setBig(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [big]);
  // stopPropagation everywhere: the photo usually sits inside a clickable row, and
  // dropdowns (global search) close on outside mousedown — the viewer must not trigger either.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <>
      <span role="button" tabIndex={0} title="View photo" aria-label={`View photo of ${name}`}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setBig(true); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setBig(true); } }}
        className={`inline-flex flex-shrink-0 cursor-zoom-in ${round ? 'rounded-full' : 'rounded-xl'} ring-1 ring-slate-200 hover:ring-2 hover:ring-purple-400 transition-shadow`}>
        <img src={src} alt={name} loading="lazy" className={className} onError={onError} />
      </span>
      {big && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 p-4" onMouseDown={stop} onClick={(e) => { stop(e); setBig(false); }} role="dialog" aria-modal="true" aria-label={name}>
          <div className="relative flex flex-col items-center" onClick={stop}>
            <img src={src} alt={name} className="max-h-[78vh] max-w-[90vw] w-auto rounded-2xl object-contain bg-white shadow-2xl" />
            <div className="mt-3 text-center text-sm font-semibold text-white">{name}</div>
            <button type="button" onClick={() => setBig(false)} aria-label="Close"
              className="absolute -top-3 -right-3 grid h-9 w-9 place-items-center rounded-full bg-white text-slate-700 shadow-lg hover:bg-slate-100">✕</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// ========== Avatar ==========
interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  /** When set, the photo is shown instead of initials (falls back to initials if it fails to load). */
  src?: string | null;
  /** Tap the photo to see it large (default on). */
  zoom?: boolean;
}

export function Avatar({ name, size = 'md', src, zoom = true }: AvatarProps) {
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

  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [src]);

  if (src && !failed) {
    const cls = `${sizeClasses[size]} flex-shrink-0 rounded-full object-cover bg-slate-100`;
    if (!zoom) return <img src={src} alt={name} loading="lazy" className={cls} onError={() => setFailed(true)} />;
    return <ZoomPhoto src={src} name={name} className={cls} onError={() => setFailed(true)} />;
  }

  return (
    <div className={`${sizeClasses[size]} ${colors[colorIndex]} flex-shrink-0 rounded-full flex items-center justify-center font-semibold text-slate-700`}>
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
