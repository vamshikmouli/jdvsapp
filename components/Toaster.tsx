'use client';

import { useSyncExternalStore } from 'react';
import { Icon } from '@/components/Icon';
import { subscribeToasts, getToasts, dismissToast, type ToastKind } from '@/lib/toast';

const STYLE: Record<ToastKind, { bar: string; badge: string; icon: string }> = {
  success: { bar: 'bg-success-500', badge: 'bg-success-100 text-success-700', icon: 'CheckCircle2' },
  error: { bar: 'bg-danger-500', badge: 'bg-danger-100 text-danger-700', icon: 'AlertCircle' },
  info: { bar: 'bg-info-500', badge: 'bg-info-100 text-info-700', icon: 'Info' },
};

export function Toaster() {
  const items = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  if (!items.length) return null;
  return (
    <div className="fixed z-[100] bottom-4 right-4 flex flex-col gap-2 w-80 max-w-[92vw] no-print" role="status" aria-live="polite">
      {items.map((t) => {
        const s = STYLE[t.kind];
        return (
          <div key={t.id} className="relative flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white pl-4 pr-2 py-3 shadow-lg overflow-hidden animate-in fade-in slide-in-from-bottom-2">
            <span className={`absolute left-0 top-0 bottom-0 w-1 ${s.bar}`} aria-hidden />
            <span className={`mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${s.badge}`}><Icon name={s.icon as any} size={15} /></span>
            <span className="flex-1 text-sm text-slate-700 leading-snug">{t.message}</span>
            <button onClick={() => dismissToast(t.id)} className="text-slate-300 hover:text-slate-600 p-1 flex-shrink-0" aria-label="Dismiss">
              <Icon name="X" size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
