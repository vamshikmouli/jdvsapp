'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/Icon';

// ========== Card ==========
interface CardProps {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  padded?: boolean;
  className?: string;
}

export function Card({ title, action, children, padded = true, className = '' }: CardProps) {
  return (
    <section className={`bg-white rounded-lg border border-slate-200 shadow-xs ${className}`}>
      {(title || action) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
          <h3 className="text-lg font-semibold text-slate-900 min-w-0">{title}</h3>
          {action && <div className="flex-shrink-0">{action}</div>}
        </div>
      )}
      <div className={padded ? 'p-6' : ''}>{children}</div>
    </section>
  );
}

// ========== Modal (confirmations / small dialogs) ==========
export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  footer?: React.ReactNode;
  headerRight?: React.ReactNode; // optional content in the header, left of the close button (Drawer only)
  children: React.ReactNode;
  width?: number;
}

export function Modal({ open, onClose, title, subtitle, footer, children, width = 500 }: ModalProps) {
  if (!open || typeof document === 'undefined') return null;

  // Portalled to <body> and stacked above drawers (z-60), so a dialog opened from a
  // drawer — e.g. the photo cropper in the student form — is on top and clickable.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}></div>
      <div
        className="relative bg-white rounded-2xl shadow-xl p-6 max-h-[90vh] overflow-y-auto w-full"
        style={{ maxWidth: `${width}px` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <Icon name="X" size={20} />
          </button>
        </div>
        <div className="py-6">{children}</div>
        {footer && <div className="border-t border-slate-100 pt-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ========== Drawer (right-side slide-over) ==========
// Use this for multi-field add/edit forms. Keep Modal for confirmations.
export function Drawer({ open, onClose, title, subtitle, footer, headerRight, children, width = 480 }: ModalProps) {
  const [show, setShow] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setShow(false);
      return;
    }
    const t = setTimeout(() => setShow(true), 10);
    return () => clearTimeout(t);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  // Portalled to <body> so a drawer opened from inside the top bar (e.g. the
  // student search) isn't trapped under the sidebar by the top bar's stacking context.
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${show ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <div
        className={`absolute top-0 right-0 h-full supports-[height:100dvh]:h-[100dvh] bg-white shadow-xl flex flex-col transition-transform duration-300 ease-out ${
          show ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ width: `${width}px`, maxWidth: '100vw' }}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-4 px-4 py-3 sm:px-6 sm:py-4 border-b border-slate-100 flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="text-xs sm:text-sm text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {headerRight}
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
              <Icon name="X" size={20} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">{children}</div>
        {footer && <div className="border-t border-slate-100 px-4 py-3 sm:px-6 sm:py-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-4 flex-shrink-0 shadow-[0_-4px_12px_-6px_rgba(15,23,42,0.12)]">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
