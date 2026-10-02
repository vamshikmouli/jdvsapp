'use client';

import { OopsPuppy } from '@/components/OopsPuppy';

// Catches errors in the root layout itself — this replaces the whole document,
// so it can't rely on the app's CSS. Self-contained, on-brand, and friendly.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F4F5F8', fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif', color: '#1C222B', padding: 24 }}>
        <div style={{ maxWidth: 440, width: '100%', textAlign: 'center', background: '#fff', border: '1px solid #E6EAF0', borderRadius: 16, boxShadow: '0 1px 3px rgba(16,24,40,.06)', padding: 32 }}>
          <OopsPuppy />
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: '8px 0 0' }}>Oops! Someone pulled the plug 🐶</h1>
          <p style={{ fontSize: 14, color: '#6B7785', marginTop: 8, lineHeight: 1.5 }}>
            Our puppy got a little too excited with the wires. Don&apos;t worry — your data is safe and
            nothing was lost. Tap <b>Try again</b> while we plug it back in. If it keeps happening, let the school office know.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 24 }}>
            <button onClick={() => reset()} style={{ border: 'none', cursor: 'pointer', background: '#7C3AED', color: '#fff', borderRadius: 12, padding: '10px 16px', fontSize: 14, fontWeight: 600 }}>Try again</button>
            <a href="/" style={{ textDecoration: 'none', border: '1px solid #E6EAF0', color: '#334155', borderRadius: 12, padding: '10px 16px', fontSize: 14, fontWeight: 600 }}>Back to sign in</a>
          </div>
          {error?.digest && <p style={{ fontSize: 11, color: '#CBD5E1', marginTop: 16, fontFamily: 'monospace' }}>ref: {error.digest}</p>}
        </div>
      </body>
    </html>
  );
}
