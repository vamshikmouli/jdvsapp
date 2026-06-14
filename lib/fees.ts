/**
 * Fee math — pure helpers (no Prisma). Server + client safe.
 *
 * The ledger is built from FeeCharge rows. Every payable thing — a tuition
 * installment, the van fee, a uniform bundle, an old due — is one charge.
 * Payments allocate rupees onto charges, so a balance is always
 * `charge.amount − Σ allocations`.
 */

export type ChargeStatus = 'paid' | 'partial' | 'due' | 'overdue';

/** A single payable line with its paid/balance resolved. */
export interface ChargeRow {
  id: string;
  feeTypeKey: string;
  feeTypeName: string;
  label: string;
  amount: number;
  paid: number;
  concession: number;
  balance: number;
  dueDate: string | null; // ISO yyyy-mm-dd
  installmentNo: number | null;
  status: ChargeStatus;
}

/** Charges grouped by fee head (fee type). */
export interface HeadRow {
  key: string;
  name: string;
  charged: number;
  paid: number;
  concession: number;
  balance: number;
  status: ChargeStatus;
  charges: ChargeRow[];
}

export interface AccountSummary {
  heads: HeadRow[];
  totalCharged: number;
  totalPaid: number;
  totalBalance: number;
  concession: number;
  status: ChargeStatus;
}

/** Format integer rupees as ₹1,23,456 (Indian grouping, no decimals). */
export function feeMoney(n: number): string {
  return '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(n || 0));
}

function isPast(dueDate: string | null): boolean {
  if (!dueDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dueDate).getTime() < today.getTime();
}

/** Resolve a single charge's status from its amount, paid and due date. */
export function chargeStatus(amount: number, paid: number, dueDate: string | null): ChargeStatus {
  if (paid >= amount && amount > 0) return 'paid';
  if (paid > 0) return 'partial';
  return isPast(dueDate) ? 'overdue' : 'due';
}

/** Roll a list of charge statuses up to a single head/account status. */
function rollupStatus(charged: number, paid: number, anyOverdue: boolean): ChargeStatus {
  if (paid >= charged && charged > 0) return 'paid';
  if (paid > 0) return 'partial';
  return anyOverdue ? 'overdue' : 'due';
}

/**
 * Apply APPROVED concessions (keyed by fee-type key) onto charge rows.
 * A head's concession is spread across its charges (oldest installment first),
 * reducing each charge's balance. Mutates and returns the rows.
 */
export function applyConcessions(rows: ChargeRow[], concessionByKey: Record<string, number>): ChargeRow[] {
  const groups: Record<string, ChargeRow[]> = {};
  for (const r of rows) (groups[r.feeTypeKey] ||= []).push(r);
  for (const key of Object.keys(groups)) {
    let left = Math.max(0, Math.round(concessionByKey[key] || 0));
    const list = groups[key].slice().sort((a, b) => (a.installmentNo ?? 0) - (b.installmentNo ?? 0));
    for (const r of list) {
      const room = Math.max(0, r.amount - r.paid);
      const take = Math.min(room, left);
      r.concession = take;
      r.balance = Math.max(0, r.amount - r.paid - take);
      r.status = r.balance <= 0 && r.amount > 0 ? 'paid' : chargeStatus(r.amount, r.paid, r.dueDate);
      left -= take;
    }
  }
  return rows;
}

/** Group resolved charges into heads and compute grand totals (concession-aware). */
export function aggregateAccount(charges: ChargeRow[], _concession = 0): AccountSummary {
  const byKey = new Map<string, HeadRow>();
  for (const c of charges) {
    let head = byKey.get(c.feeTypeKey);
    if (!head) {
      head = { key: c.feeTypeKey, name: c.feeTypeName, charged: 0, paid: 0, concession: 0, balance: 0, status: 'due', charges: [] };
      byKey.set(c.feeTypeKey, head);
    }
    head.charges.push(c);
    head.charged += c.amount;
    head.paid += c.paid;
    head.concession += c.concession || 0;
    head.balance += c.balance;
  }

  const heads = [...byKey.values()];
  for (const h of heads) {
    h.charges.sort((a, b) => (a.installmentNo ?? 0) - (b.installmentNo ?? 0));
    h.status = rollupStatus(h.charged, h.paid + h.concession, h.charges.some((c) => c.status === 'overdue'));
  }

  const totalCharged = heads.reduce((t, h) => t + h.charged, 0);
  const totalPaid = heads.reduce((t, h) => t + h.paid, 0);
  const concession = heads.reduce((t, h) => t + h.concession, 0);
  const totalBalance = heads.reduce((t, h) => t + h.balance, 0);
  const status = rollupStatus(totalCharged, totalPaid + concession, heads.some((h) => h.status === 'overdue'));

  return { heads, totalCharged, totalPaid, totalBalance, concession, status };
}

/**
 * Auto-allocate a lump-sum payment across outstanding charges.
 * Fills the given order (caller sorts: old-due → oldest installment first).
 * Returns the per-charge split; never over-allocates a charge's balance.
 */
export function autoAllocate(
  outstanding: { id: string; balance: number }[],
  amount: number
): { chargeId: string; amount: number }[] {
  let left = Math.max(0, Math.round(amount));
  const out: { chargeId: string; amount: number }[] = [];
  for (const c of outstanding) {
    if (left <= 0) break;
    if (c.balance <= 0) continue;
    const take = Math.min(c.balance, left);
    out.push({ chargeId: c.id, amount: take });
    left -= take;
  }
  return out;
}

/** Receipt number, e.g. RCPT/2026-27/0042. */
export function formatReceiptNo(yearId: string, seq: number, prefix = 'RCPT'): string {
  return `${prefix}/${yearId}/${String(seq).padStart(4, '0')}`;
}

export const PAY_METHODS = ['CASH', 'UPI', 'CARD', 'BANK', 'CHEQUE'] as const;
export type PayMethodValue = (typeof PAY_METHODS)[number];

export const PAY_METHOD_LABEL: Record<PayMethodValue, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  CARD: 'Card',
  BANK: 'Bank transfer',
  CHEQUE: 'Cheque',
};

/** Tailwind tone for a status chip. */
export function statusTone(s: ChargeStatus): 'success' | 'warn' | 'danger' | 'neutral' {
  if (s === 'paid') return 'success';
  if (s === 'partial') return 'warn';
  if (s === 'overdue') return 'danger';
  return 'neutral';
}

export function statusLabel(s: ChargeStatus): string {
  return s === 'paid' ? 'Paid' : s === 'partial' ? 'Partial' : s === 'overdue' ? 'Overdue' : 'Due';
}
