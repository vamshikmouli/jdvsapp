// Leave quota / balance logic. Quotas reset each "leave year" (start month is
// configurable, default June for the Indian school year). Entitlement resolves
// from a per-staff override, falling back to the school-wide default.
import { prisma } from '@/lib/db';
import type { LeaveType } from '@prisma/client';

// Selectable leave types. CASUAL/OTHER are retired (kept in the DB enum only so
// existing records still resolve), so they no longer appear in forms, quotas, or
// balances.
export const LEAVE_TYPES: LeaveType[] = ['EARNED', 'SICK', 'UNPAID'];

// Keys for all enum values (retired ones default to 0 = no limit) — the Record
// type requires every LeaveType, but only LEAVE_TYPES are surfaced.
export const DEFAULT_QUOTAS: Record<LeaveType, number> = {
  EARNED: 15, SICK: 10, UNPAID: 0, CASUAL: 0, OTHER: 0, // 0 = no limit
};

export interface LeaveYear {
  startYear: number;   // identifies the leave year
  from: Date;          // inclusive (UTC date)
  to: Date;            // inclusive (UTC date)
  label: string;       // "2025-26" or "2025"
}

/** Which leave year does a date fall in, given the start month (1..12)? */
export function leaveYearOf(date: Date, startMonth: number): LeaveYear {
  const m = date.getUTCMonth() + 1; // 1..12
  const startYear = m >= startMonth ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  const from = new Date(Date.UTC(startYear, startMonth - 1, 1));
  const to = new Date(Date.UTC(startYear + 1, startMonth - 1, 1) - 24 * 3600_000);
  const label = startMonth === 1 ? `${startYear}` : `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
  return { startYear, from, to, label };
}

export function parseQuotas(raw: unknown): Record<LeaveType, number> {
  const out = { ...DEFAULT_QUOTAS };
  if (raw && typeof raw === 'object') {
    for (const t of LEAVE_TYPES) {
      const v = (raw as any)[t];
      if (typeof v === 'number' && v >= 0) out[t] = v;
    }
  }
  return out;
}

export interface TypeBalance {
  type: LeaveType;
  entitlement: number; // 0 = unlimited
  unlimited: boolean;
  used: number;        // approved days in the year
  pending: number;     // pending days in the year
  remaining: number;   // entitlement - used (Infinity-ish shown as null on unlimited)
}

/** Compute per-type balances for a staff member in a given leave year. */
export async function getBalances(staffId: string, ly: LeaveYear): Promise<TypeBalance[]> {
  const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
  const defaults = parseQuotas(settings?.leaveQuotas);

  const [overrides, requests] = await Promise.all([
    prisma.leaveEntitlement.findMany({ where: { staffId, leaveYear: ly.startYear } }),
    prisma.leaveRequest.findMany({
      where: { staffId, status: { in: ['APPROVED', 'PENDING'] }, fromDate: { gte: ly.from, lte: ly.to } },
      select: { type: true, days: true, status: true },
    }),
  ]);
  const overrideMap = new Map(overrides.map((o) => [o.type, o.days]));

  return LEAVE_TYPES.map((type) => {
    const entitlement = overrideMap.has(type) ? (overrideMap.get(type) as number) : defaults[type];
    const used = requests.filter((r) => r.type === type && r.status === 'APPROVED').reduce((s, r) => s + r.days, 0);
    const pending = requests.filter((r) => r.type === type && r.status === 'PENDING').reduce((s, r) => s + r.days, 0);
    const unlimited = entitlement <= 0;
    return { type, entitlement, unlimited, used, pending, remaining: unlimited ? 0 : entitlement - used };
  });
}

/** Resolve the school's leave-year start month from settings (default 6). */
export async function getLeaveYearStartMonth(): Promise<number> {
  const s = await prisma.settings.findUnique({ where: { id: 'singleton' } });
  const m = s?.leaveYearStartMonth ?? 6;
  return m >= 1 && m <= 12 ? m : 6;
}
