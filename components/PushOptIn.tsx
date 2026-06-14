'use client';

import { useEffect, useState, useCallback } from 'react';
import { Icon } from '@/components/Icon';

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

type State = 'unsupported' | 'default' | 'granted' | 'denied' | 'busy';

/**
 * Lets a parent turn on phone push notifications (PWA / Web Push).
 * Renders a small banner on the parent Home; hides itself once enabled.
 */
export function PushOptIn() {
  const [state, setState] = useState<State>('default');
  const [subscribed, setSubscribed] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState('');

  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  useEffect(() => {
    if (!supported || !VAPID_PUBLIC) { setState('unsupported'); return; }
    setState(Notification.permission as State);
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscribed(!!sub))
      .catch(() => {});
  }, [supported]);

  const enable = useCallback(async () => {
    setError('');
    setState('busy');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState(perm as State); return; }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
        });
      }
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub),
      });
      if (!res.ok) throw new Error('Could not register this device');
      setSubscribed(true);
      setState('granted');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not turn on notifications');
      setState((Notification.permission as State) || 'default');
    }
  }, []);

  // Nothing to show: unsupported, already on, or user dismissed.
  if (state === 'unsupported' || hidden) return null;
  if (state === 'granted' && subscribed) return null;

  if (state === 'denied') {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center flex-shrink-0"><Icon name="BellOff" size={18} /></div>
        <div className="text-sm text-amber-800">
          <div className="font-semibold">Notifications are blocked</div>
          <div className="text-xs mt-0.5">To get fee reminders & circulars on your phone, allow notifications for this site in your browser settings.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-purple-200 bg-gradient-to-br from-purple-50 to-white px-4 py-3.5 flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center flex-shrink-0"><Icon name="Bell" size={20} /></div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-slate-900">Get alerts on your phone</div>
        <div className="text-xs text-slate-500 mt-0.5">Fee reminders, circulars & notices — delivered like an app notification.</div>
        {error && <div className="text-xs text-danger-600 mt-1">{error}</div>}
      </div>
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        <button onClick={enable} disabled={state === 'busy'}
          className="rounded-lg bg-purple-600 text-white text-xs font-semibold px-3 py-2 hover:bg-purple-700 disabled:opacity-60">
          {state === 'busy' ? 'Turning on…' : 'Turn on'}
        </button>
        <button onClick={() => setHidden(true)} className="text-[11px] text-slate-400 hover:text-slate-600">Not now</button>
      </div>
    </div>
  );
}
