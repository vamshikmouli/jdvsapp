import { prisma } from '@/lib/db';

// Likely duplicate receipts left by the old fee-sheet re-upload bug (fixed): uploading a
// sheet again created a second "Imported (fee sheet)" receipt for the same student and
// date — same fee heads, often a different split (e.g. ₹500 then ₹400).
//
// For each student + payment date with 2+ live (not cancelled) receipts where at least
// one came from a fee-sheet upload, a LATER uploaded receipt is flagged when every fee
// head on it was already on an earlier receipt that day:
//   'exact'  — same heads and same amounts as an earlier receipt
//   'likely' — same heads, different amounts (the re-upload pattern)
// Receipts for different heads on the same day are normal and not flagged.
// Read-only: nothing is cancelled here — the office reviews and cancels in the app.

export const IMPORT_NOTE = 'Imported (fee sheet)';

export interface DupReceipt {
  id: string;
  receiptNo: string;
  method: string;
  total: number;
  /** Entry order (receipt number sequence) — receipts are numbered as they're recorded. */
  seq: number;
  imported: boolean;
  heads: { name: string; amount: number }[];
  suspect: 'exact' | 'likely' | null;
  /** The earlier receipt this one repeats. */
  repeats: string | null;
}
export interface DupGroup {
  studentId: string;
  studentName: string;
  className: string | null;
  date: string; // YYYY-MM-DD
  receipts: DupReceipt[];
  suspectTotal: number;
}

export async function findDuplicateReceipts(yearId: string): Promise<{ groups: DupGroup[]; suspects: number; suspectTotal: number }> {
  const payments = await prisma.payment.findMany({
    where: { yearId, voided: false },
    select: {
      id: true, receiptNo: true, method: true, total: true, note: true, paidAt: true, studentId: true,
      student: { select: { name: true, class: { select: { name: true } } } },
      allocations: { select: { amount: true, feeCharge: { select: { label: true } } } },
    },
  });

  // Receipt numbers are the true entry sequence ("RCPT/2026-27/0042" → 42).
  const seqOf = (receiptNo: string) => parseInt(receiptNo.split('/').pop() || '0', 10) || 0;
  payments.sort((a, b) => seqOf(a.receiptNo) - seqOf(b.receiptNo) || a.receiptNo.localeCompare(b.receiptNo));
  const byDay = new Map<string, typeof payments>();
  for (const p of payments) {
    const k = `${p.studentId}|${p.paidAt.toISOString().slice(0, 10)}`;
    (byDay.get(k) || byDay.set(k, []).get(k)!).push(p);
  }

  const headsOf = (p: (typeof payments)[number]) => {
    const m = new Map<string, number>();
    for (const a of p.allocations) m.set(a.feeCharge.label, (m.get(a.feeCharge.label) || 0) + a.amount);
    return m;
  };

  const groups: DupGroup[] = [];
  for (const [k, list] of byDay) {
    if (list.length < 2 || !list.some((p) => p.note === IMPORT_NOTE)) continue;
    const heads = list.map(headsOf);
    const receipts: DupReceipt[] = list.map((p, i) => {
      let suspect: DupReceipt['suspect'] = null;
      let repeats: string | null = null;
      if (i > 0 && p.note === IMPORT_NOTE && heads[i].size > 0) {
        for (let j = 0; j < i; j++) {
          const earlier = heads[j];
          const sameHeads = Array.from(heads[i].keys()).every((h) => earlier.has(h));
          if (!sameHeads) continue;
          const sameAmounts = heads[i].size === earlier.size && Array.from(heads[i]).every(([h, amt]) => earlier.get(h) === amt);
          if (sameAmounts) { suspect = 'exact'; repeats = list[j].receiptNo; break; }
          if (!suspect) { suspect = 'likely'; repeats = list[j].receiptNo; }
        }
      }
      return {
        id: p.id, receiptNo: p.receiptNo, method: p.method, total: p.total, seq: seqOf(p.receiptNo),
        imported: p.note === IMPORT_NOTE,
        heads: Array.from(heads[i]).map(([name, amount]) => ({ name, amount })),
        suspect, repeats,
      };
    });
    const flagged = receipts.filter((r) => r.suspect);
    if (!flagged.length) continue;
    const [studentId, date] = k.split('|');
    groups.push({
      studentId, date,
      studentName: list[0].student.name,
      className: list[0].student.class?.name || null,
      receipts,
      suspectTotal: flagged.reduce((t, r) => t + r.total, 0),
    });
  }
  groups.sort((a, b) => a.studentName.localeCompare(b.studentName) || a.date.localeCompare(b.date));
  const suspects = groups.reduce((t, g) => t + g.receipts.filter((r) => r.suspect).length, 0);
  return { groups, suspects, suspectTotal: groups.reduce((t, g) => t + g.suspectTotal, 0) };
}
