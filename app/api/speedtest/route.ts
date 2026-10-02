import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

// Tiny endpoint for the in-app internet speed check.
//   GET ?ping=1      → empty reply (round-trip time)
//   GET ?bytes=N     → N random bytes (capped at 1 MB) to time the download
// Random bytes so nothing on the way can compress or cache them.
const MAX = 1_000_000;
let blob: Buffer | null = null;
const noStore = { 'Cache-Control': 'no-store, no-cache, must-revalidate', Pragma: 'no-cache' };

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  if (q.has('ping')) return new NextResponse(null, { status: 204, headers: noStore });
  const n = Math.max(1, Math.min(MAX, Number(q.get('bytes')) || 250_000));
  if (!blob) blob = randomBytes(MAX);
  return new NextResponse(new Uint8Array(blob.subarray(0, n)), {
    headers: { ...noStore, 'Content-Type': 'application/octet-stream', 'Content-Length': String(n) },
  });
}
