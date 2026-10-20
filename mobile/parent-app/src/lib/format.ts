// Indian-rupee formatting, mirrors the web app's feeMoney.
export function money(n: number | null | undefined): string {
  if (n == null) return '—';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export const STATUS_META: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  PRESENT: { label: 'Present', bg: 'bg-success-50', text: 'text-success-700', dot: 'bg-success-500' },
  LATE: { label: 'Delayed arrival', bg: 'bg-marigold-50', text: 'text-marigold-700', dot: 'bg-marigold-500' },
  LEAVE: { label: 'On leave', bg: 'bg-info-50', text: 'text-info-700', dot: 'bg-info-500' },
  ABSENT: { label: 'Absent', bg: 'bg-danger-50', text: 'text-danger-700', dot: 'bg-danger-500' },
  none: { label: 'Not marked', bg: 'bg-slate-100', text: 'text-slate-500', dot: 'bg-slate-300' },
};

export function initials(name: string): string {
  return name.split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

// Solid fill colours for calendar day cells / strips (hex, for inline styles).
export const CELL_COLOR: Record<string, string> = {
  PRESENT: '#1F8A4C',
  LATE: '#C97A0A',
  LEAVE: '#3b82f6',
  ABSENT: '#C7322E',
  none: '#f1f5f9',
};

