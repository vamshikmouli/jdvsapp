/**
 * Utility functions for Jnana Deepika ERP
 */

export function initials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function getAvatarTone(name: string): 'purple' | 'blue' | 'green' | 'yellow' | 'pink' {
  const tones = ['purple', 'blue', 'green', 'yellow', 'pink'] as const;
  const hash = name.charCodeAt(0);
  return tones[hash % tones.length];
}

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-IN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(d);
}

export function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

export function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
  }).format(amount);
}

export function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

export function getClassGroup(classId: string): 'PRE' | 'PRIMARY' | 'SECONDARY' {
  const preKg = ['prekg', 'lkg', 'ukg'];
  const primary = ['1', '2', '3', '4', '5'];
  const secondary = ['6', '7', '8', '9', '10'];

  if (preKg.includes(classId)) return 'PRE';
  if (primary.includes(classId)) return 'PRIMARY';
  if (secondary.includes(classId)) return 'SECONDARY';
  return 'PRIMARY';
}

export function getGenderKey(gender: 'M' | 'F'): 'B' | 'G' {
  return gender === 'F' ? 'G' : 'B';
}

export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function titleCase(str: string): string {
  return str
    .toLowerCase()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
