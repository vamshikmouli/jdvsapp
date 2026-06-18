// Pure presentation helpers shared by the staff + admin attendance screens.
// No server imports — safe to use in client components.

export type ChipTone = 'success' | 'warn' | 'danger' | 'info' | 'neutral';

export const STATUS_LABEL: Record<string, string> = {
  PRESENT: 'Present',
  HALF_DAY: 'Half day',
  ABSENT: 'Absent',
  LEAVE: 'Leave',
  HOLIDAY: 'Holiday',
  WEEKLY_OFF: 'Weekly off',
};

export function statusTone(status: string): ChipTone {
  switch (status) {
    case 'PRESENT': return 'success';
    case 'HALF_DAY': return 'warn';
    case 'ABSENT': return 'danger';
    case 'LEAVE':
    case 'HOLIDAY':
    case 'WEEKLY_OFF': return 'info';
    default: return 'neutral';
  }
}

/** Minutes → "7h 05m" / "45m". */
export function fmtMins(mins: number): string {
  if (!mins || mins <= 0) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/** ISO timestamp → local "hh:mm AM" in the given timezone. */
export function fmtTime(iso: string | Date | null, tz = 'Asia/Kolkata'): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: tz,
  });
}

/**
 * Get a GPS fix, waiting for it to converge. The first reading a phone returns
 * is usually a coarse Wi-Fi/network location (accuracy ~1–2 km); real GPS sharpens
 * over a few seconds. We watch and keep the best fix, resolving early once it's
 * good enough (<= targetAccuracy m) or returning the best one by the deadline.
 */
export function getPosition(
  targetAccuracy = 80,
  maxWaitMs = 20000
): Promise<{ lat: number; lng: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Location is not available on this device.'));
      return;
    }
    let best: { lat: number; lng: number; accuracy: number } | null = null;
    let watchId: number | null = null;
    const cleanup = () => { if (watchId != null) navigator.geolocation.clearWatch(watchId); clearTimeout(timer); };

    const timer = setTimeout(() => {
      cleanup();
      if (best) resolve(best);
      else reject(new Error('Could not get a GPS fix. Move to an open area / near a window and try again.'));
    }, maxWaitMs);

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const fix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
        if (!best || fix.accuracy < best.accuracy) best = fix;
        if (fix.accuracy <= targetAccuracy) { cleanup(); resolve(best); }
      },
      (err) => {
        // Permission denial is terminal; transient errors wait for the deadline.
        if (err.code === err.PERMISSION_DENIED) {
          cleanup();
          reject(new Error('Location permission denied. Enable precise location for the browser to punch.'));
        }
      },
      { enableHighAccuracy: true, timeout: maxWaitMs, maximumAge: 0 }
    );
  });
}
