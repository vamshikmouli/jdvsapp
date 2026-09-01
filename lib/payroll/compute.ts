// Payroll computation — pure functions, no DB. The salary period is the
// PREVIOUS calendar month; salary is credited on the 10th of the next month.
//
// Locked rules (see memory jnana_payroll_module):
//   per-day rate = gross / 30
//   LOP days     = ABSENT + UNPAID-leave + 0.5 * HALF_DAY   (paid leave/holiday/off = paid)
//   PF (optional)= 12% of pfWage (falls back to gross)
//   net          = gross − LOP − PF − otherDeductions + bonus
// All money is whole rupees.

export interface AttendanceCounts {
  presentDays: number;   // PRESENT + LATE
  halfDays: number;      // HALF_DAY with no leaveType (short attendance) — 0.5 LOP each
  earnedDays: number;    // EARNED leave this month (HALF_DAY counts 0.5) — balance-checked
  sickDays: number;      // SICK leave this month — balance-checked
  otherPaidDays: number; // LEAVE with no leaveType — paid, not balance-checked
  paidLeaveDays: number; // earned + sick + otherPaid (display; before balance check)
  unpaidLeaveDays: number; // UNPAID leave (LOP; HALF_DAY counts 0.5)
  absentDays: number;    // ABSENT
  holidayDays: number;   // HOLIDAY
  weeklyOffDays: number; // WEEKLY_OFF
}

export interface DayRow { status: string; leaveType: string | null }

/** Days of a single leave type in a set of rows (HALF_DAY = 0.5), matching the
 *  leave-balance "used" counting. Used to total year-to-date usage per type. */
export function usedByType(rows: DayRow[], type: string): number {
  return rows.reduce((s, r) => (r.leaveType === type ? s + (r.status === 'HALF_DAY' ? 0.5 : 1) : s), 0);
}

/** "2026-06" → { label: "June 2026", from, to (UTC date-only), creditOn (10th of next month) }. */
export function periodInfo(periodMonth: string) {
  const [y, m] = periodMonth.split('-').map(Number); // m is 1-12
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0)); // last day of the month
  const creditOn = new Date(Date.UTC(m === 12 ? y + 1 : y, m % 12, 10)); // 10th of next month
  const label = from.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { from, to, creditOn, label };
}

/** The month before `ref` (default now) as "YYYY-MM" — the default period to pay. */
export function previousMonthKey(ref = new Date()): string {
  const y = ref.getUTCFullYear();
  const m = ref.getUTCMonth(); // 0-11; previous month index = m-1
  const d = new Date(Date.UTC(y, m - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Aggregate stored attendance-day rows into payroll buckets. */
export function countDays(rows: DayRow[]): AttendanceCounts {
  const c: AttendanceCounts = { presentDays: 0, halfDays: 0, earnedDays: 0, sickDays: 0, otherPaidDays: 0, paidLeaveDays: 0, unpaidLeaveDays: 0, absentDays: 0, holidayDays: 0, weeklyOffDays: 0 };
  for (const r of rows) {
    const w = r.status === 'HALF_DAY' ? 0.5 : 1;
    switch (r.status) {
      case 'PRESENT':
      case 'LATE': c.presentDays++; break;
      case 'ABSENT': c.absentDays++; break;
      case 'HOLIDAY': c.holidayDays++; break;
      case 'WEEKLY_OFF': c.weeklyOffDays++; break;
      case 'LEAVE':
      case 'HALF_DAY':
        if (r.leaveType === 'UNPAID') c.unpaidLeaveDays += w;
        else if (r.leaveType === 'EARNED') c.earnedDays += w;
        else if (r.leaveType === 'SICK') c.sickDays += w;
        else if (r.status === 'HALF_DAY' && !r.leaveType) c.halfDays += 1; // half-day short attendance (no leave type) = 0.5 LOP
        else c.otherPaidDays += w;  // EMERGENCY / other paid leave (full or half) — always paid
        break;
    }
  }
  c.paidLeaveDays = c.earnedDays + c.sickDays + c.otherPaidDays;
  return c;
}

export interface SalaryInput {
  grossSalary: number;
  pfApplicable: boolean;
  pfWage: number | null;
  esiApplicable?: boolean;   // ESI is optional per staff
  otherDeductions?: number;
  bonus?: number;
  overBalanceLeaveDays?: number; // paid-leave days beyond the yearly quota → LOP
}

export interface SalaryResult {
  lopDays: number;
  lopAmount: number;
  otherDeductions: number;
  bonus: number;
  netBeforeStatutory: number; // gross − LOP − other + bonus  (the "Net")
  pfAmount: number;
  esiAmount: number;          // 0.75% of Net (after LOP/other/bonus)
  netSalary: number;          // Net − PF − ESI  (the payable, "after ESI")
}

const ESI_RATE = 0.0075; // employee ESI contribution = 0.75% of wages

/** The Net on which ESI is charged: gross − LOP − other deductions + bonus. */
export function netBeforeStatutory(gross: number, lopAmount: number, otherDeductions: number, bonus: number): number {
  return Math.max(0, gross - lopAmount - otherDeductions + bonus);
}

/** Compute money from attendance counts + salary settings. */
export function computeSalary(counts: AttendanceCounts, s: SalaryInput): SalaryResult {
  const gross = Math.max(0, Math.round(s.grossSalary || 0));
  // LOP = absent + unpaid leave + half-day short attendance + leave taken beyond the yearly balance.
  const lopDays = counts.absentDays + counts.unpaidLeaveDays + 0.5 * counts.halfDays + Math.max(0, s.overBalanceLeaveDays || 0);
  const lopAmount = Math.round((gross / 30) * lopDays);
  const otherDeductions = Math.max(0, Math.round(s.otherDeductions || 0));
  const bonus = Math.max(0, Math.round(s.bonus || 0));
  const net = netBeforeStatutory(gross, lopAmount, otherDeductions, bonus);
  const pfAmount = s.pfApplicable ? Math.round(0.12 * (s.pfWage ?? gross)) : 0;
  const esiAmount = s.esiApplicable ? Math.round(ESI_RATE * net) : 0; // ESI on Net, per policy
  const netSalary = Math.max(0, net - pfAmount - esiAmount);
  return { lopDays, lopAmount, otherDeductions, bonus, netBeforeStatutory: net, pfAmount, esiAmount, netSalary };
}
