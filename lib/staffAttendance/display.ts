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

/** Read the device GPS once, with high accuracy. */
export function getPosition(): Promise<{ lat: number; lng: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Location is not available on this device.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }),
      (err) => {
        const msg =
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied. Enable it to punch.'
            : 'Could not get your location. Try again.';
        reject(new Error(msg));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}
