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

// Many South Indian names lead with initials ("R N Santhosh", "R Ramesh") where
// the actual given name is a later word. A word counts as an initial if it's a
// single letter, optionally with a dot ("R", "N.", "S").
function isInitialWord(w: string): boolean {
  return w.replace(/\./g, '').length <= 1;
}

/**
 * The name a person actually goes by — skips leading/standalone initials.
 * "R N Santhosh" → "Santhosh", "R Ramesh" → "Ramesh", "Aarav Sharma" → "Aarav".
 * Falls back to the first word if the whole name is initials.
 */
export function givenName(name: string | null | undefined): string {
  if (!name) return '';
  const words = name.trim().split(/\s+/).filter(Boolean);
  const real = words.find((w) => !isInitialWord(w));
  return (real ?? words[0] ?? '').replace(/\.$/, '');
}

export function initials(name: string): string {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  const real = words.filter((w) => !isInitialWord(w));
  const src = real.length ? real : words; // ignore leading initials when we can
  return src.map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

// Solid fill colours for calendar day cells / strips (hex, for inline styles).
export const CELL_COLOR: Record<string, string> = {
  PRESENT: '#1F8A4C',
  LATE: '#C97A0A',
  LEAVE: '#3b82f6',
  ABSENT: '#C7322E',
  none: '#f1f5f9',
};

