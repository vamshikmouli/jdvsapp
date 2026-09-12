'use client';

// Friendly error screen for any page that throws — shown in place of the raw
// "Internal Server Error". Keeps the school's warm, on-brand tone.
import { useEffect } from 'react';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-6 py-12">
      <div className="max-w-md w-full text-center bg-white border border-slate-200 rounded-2xl shadow-sm p-8">
        <div className="text-6xl mb-3" aria-hidden>🪔</div>
        <h1 className="text-xl font-bold text-slate-900">Oops — the lamp flickered</h1>
        <p className="text-sm text-slate-500 mt-2">
          Something on our side tripped up for a moment. Your data is safe — nothing was lost.
          Give it another try; if it keeps happening, tell the office and we&apos;ll fix it fast.
        </p>
        <div className="flex items-center justify-center gap-2 mt-6">
          <button onClick={() => reset()}
            className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-purple-700">
            Try again
          </button>
          <a href="/admin/dashboard"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Back to home
          </a>
        </div>
        {error?.digest && <p className="text-[11px] text-slate-300 mt-4 font-mono">ref: {error.digest}</p>}
      </div>
    </div>
  );
}
