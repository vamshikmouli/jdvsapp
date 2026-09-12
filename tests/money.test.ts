import { describe, it, expect } from 'vitest';
import {
  feeMoney, chargeStatus, applyConcessions, aggregateAccount, autoAllocate, formatReceiptNo,
  type ChargeRow,
} from '@/lib/fees';
import { toWaNumber, feeWaRecipients } from '@/lib/services/whatsapp';

// Small helper to build a charge row with sensible defaults.
function charge(p: Partial<ChargeRow> & { id: string; feeTypeKey: string; amount: number }): ChargeRow {
  const paid = p.paid ?? 0;
  const concession = p.concession ?? 0;
  return {
    id: p.id, feeTypeKey: p.feeTypeKey, feeTypeName: p.feeTypeName ?? p.feeTypeKey,
    label: p.label ?? p.feeTypeKey, amount: p.amount, paid, concession,
    balance: p.balance ?? Math.max(0, p.amount - paid - concession),
    dueDate: p.dueDate ?? null, installmentNo: p.installmentNo ?? null,
    status: p.status ?? chargeStatus(p.amount, paid, p.dueDate ?? null),
  };
}

const past = '2000-01-01';
const future = '2999-01-01';

describe('feeMoney', () => {
  it('formats integer rupees with Indian grouping, no decimals', () => {
    expect(feeMoney(0)).toBe('₹0');
    expect(feeMoney(1234)).toBe('₹1,234');
    expect(feeMoney(123456)).toBe('₹1,23,456');
    expect(feeMoney(1234.6)).toBe('₹1,235'); // rounds
    expect(feeMoney(NaN as any)).toBe('₹0');
  });
});

describe('chargeStatus', () => {
  it('paid when fully covered', () => expect(chargeStatus(1000, 1000, null)).toBe('paid'));
  it('paid when overpaid', () => expect(chargeStatus(1000, 1200, null)).toBe('paid'));
  it('partial when some paid', () => expect(chargeStatus(1000, 400, null)).toBe('partial'));
  it('due when nothing paid and not past due', () => expect(chargeStatus(1000, 0, future)).toBe('due'));
  it('overdue when nothing paid and past due', () => expect(chargeStatus(1000, 0, past)).toBe('overdue'));
  it('zero-amount charge is never "paid"', () => expect(chargeStatus(0, 0, null)).toBe('due'));
});

describe('applyConcessions', () => {
  it('reduces balance and pays off a head when concession covers it', () => {
    const rows = [charge({ id: 'a', feeTypeKey: 'tuition', amount: 12000 })];
    applyConcessions(rows, { tuition: 12000 });
    expect(rows[0].concession).toBe(12000);
    expect(rows[0].balance).toBe(0);
    expect(rows[0].status).toBe('paid');
  });

  it('spreads across installments oldest-first and caps at remaining room', () => {
    const rows = [
      charge({ id: 'i2', feeTypeKey: 'tuition', amount: 5000, installmentNo: 2 }),
      charge({ id: 'i1', feeTypeKey: 'tuition', amount: 5000, installmentNo: 1, paid: 1000 }),
    ];
    applyConcessions(rows, { tuition: 6000 });
    const i1 = rows.find((r) => r.id === 'i1')!;
    const i2 = rows.find((r) => r.id === 'i2')!;
    expect(i1.concession).toBe(4000); // room was 5000-1000=4000, filled first
    expect(i2.concession).toBe(2000); // remaining 2000
    expect(i1.balance).toBe(0);
    expect(i2.balance).toBe(3000);
  });

  it('never gives more concession than the outstanding amount', () => {
    const rows = [charge({ id: 'a', feeTypeKey: 'van', amount: 1000, paid: 400 })];
    applyConcessions(rows, { van: 5000 });
    expect(rows[0].concession).toBe(600); // capped at 1000-400
    expect(rows[0].balance).toBe(0);
  });

  it('only touches the keyed head', () => {
    const rows = [
      charge({ id: 't', feeTypeKey: 'tuition', amount: 1000 }),
      charge({ id: 'v', feeTypeKey: 'van', amount: 1000 }),
    ];
    applyConcessions(rows, { tuition: 1000 });
    expect(rows.find((r) => r.id === 'v')!.concession).toBe(0);
  });
});

describe('aggregateAccount', () => {
  it('groups by head and computes totals + balance', () => {
    const rows = [
      charge({ id: 't1', feeTypeKey: 'tuition', feeTypeName: 'Tuition', amount: 12000, paid: 5000 }),
      charge({ id: 'v1', feeTypeKey: 'van', feeTypeName: 'Van', amount: 8000 }),
    ];
    const s = aggregateAccount(rows);
    expect(s.totalCharged).toBe(20000);
    expect(s.totalPaid).toBe(5000);
    expect(s.totalBalance).toBe(15000);
    expect(s.heads).toHaveLength(2);
    expect(s.status).toBe('partial');
  });

  it('a concession-cleared head counts as paid in the rollup', () => {
    const rows = applyConcessions(
      [charge({ id: 't', feeTypeKey: 'tuition', amount: 10000 })],
      { tuition: 10000 },
    );
    const s = aggregateAccount(rows);
    expect(s.totalBalance).toBe(0);
    expect(s.concession).toBe(10000);
    expect(s.status).toBe('paid');
  });

  it('is overdue when an unpaid charge is past its due date', () => {
    const s = aggregateAccount([charge({ id: 'x', feeTypeKey: 'tuition', amount: 1000, dueDate: past })]);
    expect(s.status).toBe('overdue');
  });

  it('empty account is "due" with zero totals', () => {
    const s = aggregateAccount([]);
    expect(s).toMatchObject({ totalCharged: 0, totalPaid: 0, totalBalance: 0, status: 'due' });
  });
});

describe('autoAllocate — money must never over- or mis-allocate', () => {
  const out = [
    { id: 'a', balance: 5000 },
    { id: 'b', balance: 3000 },
    { id: 'c', balance: 2000 },
  ];

  it('fills in the given order and stops when the money runs out', () => {
    const r = autoAllocate(out, 6000);
    expect(r).toEqual([{ chargeId: 'a', amount: 5000 }, { chargeId: 'b', amount: 1000 }]);
  });

  it('never allocates more than a charge balance', () => {
    const r = autoAllocate(out, 100000);
    const total = r.reduce((t, x) => t + x.amount, 0);
    expect(total).toBe(10000); // sum of balances, not the 100000 tendered
    for (const x of r) expect(x.amount).toBeLessThanOrEqual(out.find((o) => o.id === x.chargeId)!.balance);
  });

  it('skips zero/negative balances', () => {
    const r = autoAllocate([{ id: 'z', balance: 0 }, { id: 'a', balance: 1000 }], 1000);
    expect(r).toEqual([{ chargeId: 'a', amount: 1000 }]);
  });

  it('rounds the tendered amount and never goes negative', () => {
    expect(autoAllocate(out, 999.6)).toEqual([{ chargeId: 'a', amount: 1000 }]);
    expect(autoAllocate(out, -50)).toEqual([]);
    expect(autoAllocate(out, 0)).toEqual([]);
  });

  it('the split exactly equals the tendered amount when funds are sufficient', () => {
    const amt = 7000;
    const r = autoAllocate(out, amt);
    expect(r.reduce((t, x) => t + x.amount, 0)).toBe(amt);
  });
});

describe('formatReceiptNo', () => {
  it('zero-pads the sequence to 4 digits', () => {
    expect(formatReceiptNo('2026-27', 42)).toBe('RCPT/2026-27/0042');
    expect(formatReceiptNo('2026-27', 12345)).toBe('RCPT/2026-27/12345');
  });
});

describe('toWaNumber', () => {
  it('normalizes Indian numbers to 91XXXXXXXXXX', () => {
    expect(toWaNumber('9876543210')).toBe('919876543210');
    expect(toWaNumber('+91 98765 43210')).toBe('919876543210');
    expect(toWaNumber('098765 43210')).toBe('919876543210');
    expect(toWaNumber('919876543210')).toBe('919876543210');
  });
  it('rejects too-short / empty', () => {
    expect(toWaNumber('12345')).toBeNull();
    expect(toWaNumber('')).toBeNull();
    expect(toWaNumber(null)).toBeNull();
  });
});

describe('feeWaRecipients — both parents + fee contact, deduped', () => {
  it('includes father, mother and fee-contact, deduping repeats', () => {
    const r = feeWaRecipients({
      fatherName: 'RAJU', fatherPhone: '9000000001',
      motherName: 'SITA', motherPhone: '9000000002',
      feeContactPhone: '9000000003',
      guardianName: 'RAJU', guardianPhone: '9000000001',
    });
    expect(r.map((x) => x.to)).toEqual(['919000000001', '919000000002', '919000000003']);
    expect(r[0].name).toBe('RAJU');
    expect(r[1].name).toBe('SITA');
  });

  it('collapses duplicate numbers to one message', () => {
    const r = feeWaRecipients({ fatherName: 'A', fatherPhone: '9000000001', motherName: 'B', motherPhone: '9000000001' });
    expect(r).toHaveLength(1);
  });

  it('falls back to the guardian number when no parent numbers exist', () => {
    const r = feeWaRecipients({ guardianName: 'GUARD', guardianPhone: '9000000009' });
    expect(r).toEqual([{ name: 'GUARD', to: '919000000009' }]);
  });

  it('returns nothing when there is no valid number anywhere', () => {
    expect(feeWaRecipients({ fatherPhone: '', motherPhone: null, guardianPhone: '123' })).toEqual([]);
  });
});
