// In-app internet speed check: ping (round-trip to our own server) and download
// speed (time to fetch a block of random bytes). Small on purpose — a full test
// is ~0.5 MB and only runs when someone taps "Test speed".

export type NetLevel = 'good' | 'ok' | 'slow' | 'offline';

export interface NetReading { mbps: number | null; pingMs: number | null; at: number; source: 'test' | 'estimate' | 'ping' }

/** Fast / OK / Slow from download speed and ping (either may be unknown). */
export function classifyNet(mbps: number | null, pingMs: number | null): { level: NetLevel; label: string; bars: number } {
  const slowPing = pingMs !== null && pingMs >= 800;
  const okPing = pingMs !== null && pingMs >= 300;
  if ((mbps !== null && mbps < 1) || slowPing) return { level: 'slow', label: 'Slow', bars: 1 };
  if ((mbps !== null && mbps < 5) || okPing) return { level: 'ok', label: 'OK', bars: 2 };
  if (mbps === null && pingMs === null) return { level: 'ok', label: 'Checking…', bars: 2 };
  return { level: 'good', label: 'Fast', bars: 3 };
}

export function fmtMbps(mbps: number | null): string {
  if (mbps === null) return '—';
  if (mbps < 1) return `${Math.round(mbps * 1000)} Kbps`;
  return `${mbps < 10 ? mbps.toFixed(1) : Math.round(mbps)} Mbps`;
}

const url = (q: string) => `/api/speedtest?${q}&t=${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Median of a few tiny round-trips, in ms. */
export async function measurePing(tries = 3): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < tries; i++) {
    const t0 = performance.now();
    await fetch(url('ping=1'), { cache: 'no-store' });
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return Math.round(times[Math.floor(times.length / 2)]);
}

/** Download speed in Mbps (starts small; only fetches more on a fast line). */
export async function measureDownload(): Promise<number> {
  let best = 0;
  for (const bytes of [100_000, 400_000]) {
    const t0 = performance.now();
    const res = await fetch(url(`bytes=${bytes}`), { cache: 'no-store' });
    const buf = await res.arrayBuffer();
    const secs = Math.max(0.001, (performance.now() - t0) / 1000);
    best = Math.max(best, (buf.byteLength * 8) / secs / 1e6);
    if (secs > 2) break; // slow line — don't spend more of their data
  }
  return best;
}

/** Chrome's own (free, no data used) estimate, where available. */
export function browserEstimate(): { mbps: number | null; pingMs: number | null; type: string | null } {
  const c = (typeof navigator !== 'undefined' ? (navigator as any).connection : null) || null;
  if (!c) return { mbps: null, pingMs: null, type: null };
  return { mbps: typeof c.downlink === 'number' && c.downlink > 0 ? c.downlink : null, pingMs: typeof c.rtt === 'number' && c.rtt > 0 ? c.rtt : null, type: c.type || c.effectiveType || null };
}
