'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/Icon';

interface Notif {
  id: string;
  type: string;
  title: string;
  body: string;
  url?: string | null;
  read: boolean;
  createdAt: string;
}

const POLL_MS = 30_000;

function timeAgo(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

/**
 * Top-bar bell: shows the signed-in user's notifications with an unread badge.
 * Polls every 30s (and on tab focus). Opening the panel marks everything read.
 */
export function NotificationBell() {
  const router = useRouter();
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.items || []);
      setUnread(data.unread || 0);
    } catch {
      /* best-effort */
    }
  }, []);

  // Initial load + poll + refresh when the tab regains focus.
  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const markAllRead = useCallback(async () => {
    if (unread === 0) return;
    setUnread(0);
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await fetch('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    } catch {
      /* best-effort; next poll reconciles */
    }
  }, [unread]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) markAllRead();
  };

  const openItem = (n: Notif) => {
    setOpen(false);
    if (n.url) router.push(n.url);
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={toggle}
        aria-label="Notifications"
        className="relative p-2 rounded-md hover:bg-slate-100 text-slate-600"
      >
        <Icon name="Bell" size={20} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-danger-500 text-white text-[10px] font-bold leading-[18px] text-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden z-30">
          <div className="px-4 py-3 border-b border-slate-100">
            <span className="text-sm font-semibold text-slate-900">Notifications</span>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-400">
                <Icon name="Inbox" size={24} className="text-slate-300 mb-1" />
                <div>You're all caught up</div>
              </div>
            ) : (
              <ul className="divide-y divide-slate-50">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={() => openItem(n)}
                      className={`w-full text-left px-4 py-3 hover:bg-slate-50 flex gap-3 ${n.read ? '' : 'bg-purple-50/40'}`}
                    >
                      <span className="mt-0.5 w-8 h-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center flex-shrink-0">
                        <Icon name="Fingerprint" size={16} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-slate-900 truncate">{n.title}</span>
                        <span className="block text-xs text-slate-500 truncate">{n.body}</span>
                        <span className="block text-[11px] text-slate-400 mt-0.5">{timeAgo(n.createdAt)}</span>
                      </span>
                      {!n.read && <span className="mt-1.5 w-2 h-2 rounded-full bg-purple-500 flex-shrink-0" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
