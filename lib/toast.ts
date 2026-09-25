'use client';

/**
 * Tiny app-wide toast store — no dependency, callable from anywhere (even outside
 * React / inside async handlers), matching the old `alert()` ergonomics:
 *
 *   import { toast } from '@/lib/toast';
 *   toast.success('Saved');
 *   toast.error('Could not save');
 *
 * <Toaster/> (mounted once in Providers) subscribes and renders the stack.
 */
export type ToastKind = 'success' | 'error' | 'info';
export interface ToastItem { id: number; kind: ToastKind; message: string }

let items: ToastItem[] = [];
const listeners = new Set<() => void>();
let seq = 0;
const emit = () => listeners.forEach((l) => l());

export function subscribeToasts(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
export function getToasts() { return items; }

export function dismissToast(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

function push(kind: ToastKind, message: string, ms: number) {
  const msg = String(message || '').trim();
  if (!msg) return -1;
  const id = ++seq;
  items = [...items, { id, kind, message: msg }];
  emit();
  if (ms > 0 && typeof window !== 'undefined') window.setTimeout(() => dismissToast(id), ms);
  return id;
}

// Errors linger a little longer than success/info.
export const toast = Object.assign(
  (message: string) => push('info', message, 4000),
  {
    success: (message: string) => push('success', message, 4000),
    error: (message: string) => push('error', message, 6000),
    info: (message: string) => push('info', message, 4000),
  },
);
