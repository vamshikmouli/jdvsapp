'use client';

import React from 'react';
import { OfflineCat } from '@/components/OfflineCat';

// Full-screen "no internet" screen with the sleeping Wi-Fi cat. Appears when the
// phone / computer goes offline and disappears by itself when it's back, with a short
// "Back online" note. Nothing typed on the page underneath is lost.
export function OfflineOverlay() {
  const [offline, setOffline] = React.useState(false);
  const [back, setBack] = React.useState(false);

  React.useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    // A brief blip shouldn't flash the screen — wait a moment before showing it.
    let pending: ReturnType<typeof setTimeout> | undefined;
    const goOffline = () => { clearTimeout(pending); pending = setTimeout(() => { if (!navigator.onLine) setOffline(true); }, 1500); };
    const goOnline = () => {
      clearTimeout(pending);
      setOffline((was) => {
        if (was) { setBack(true); clearTimeout(t); t = setTimeout(() => setBack(false), 2500); }
        return false;
      });
    };
    if (!navigator.onLine) goOffline();
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => { window.removeEventListener('offline', goOffline); window.removeEventListener('online', goOnline); clearTimeout(t); clearTimeout(pending); };
  }, []);

  if (back) {
    return (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[300] rounded-full bg-success-600 px-4 py-2 text-sm font-semibold text-white shadow-lg" role="status">
        ✓ Back online
      </div>
    );
  }
  if (!offline) return null;
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-50/95 backdrop-blur-sm px-6" role="alertdialog" aria-modal="true" aria-label="No internet connection">
      <div className="max-w-sm w-full text-center bg-white border border-slate-200 rounded-2xl shadow-sm p-7">
        <OfflineCat />
        <h1 className="text-xl font-bold text-slate-900 mt-1">No internet 😴</h1>
        <p className="text-sm text-slate-500 mt-2">
          Our Wi-Fi cat fell asleep on the router. Check your mobile data or Wi-Fi —
          this screen goes away by itself as soon as you&apos;re back online. Nothing you typed is lost.
        </p>
        <div className="mt-5 inline-flex items-center gap-2 text-xs font-medium text-slate-400">
          <span className="h-2 w-2 rounded-full bg-marigold-500 animate-pulse" /> Waiting for the connection…
        </div>
        <div className="mt-4">
          <button onClick={() => { if (navigator.onLine) { setOffline(false); } else { location.reload(); } }}
            className="rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-purple-700">
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
