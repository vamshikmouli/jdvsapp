import { prisma } from '@/lib/db';
import type { PayMethod } from '@prisma/client';

// ---- Excel fee bulk-upload ----
// One row per (student, fee head). Columns (header names, case-insensitive):
//   Admission No | Student Name | Phone | Class | Academic Year | Fee Head | Assigned | Concession | Paid | Date | Payment Mode
// A student may span multiple rows (one per head / per year). Due = Assigned − Concession − Paid.

const norm = (s: any) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const dig = (s: any) => String(s ?? '').replace(/\D/g, '').slice(-10);
const money = (v: any) => Math.max(0, Math.round(Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0));

function parseDate(v: any, fallback: Date): Date {
  if (v == null || v === '') return fallback;
  if (typeof v === 'number' && v > 0) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000); // excel serial
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/); // dd/mm/yyyy
  if (m) { let yy = +m[3]; if (yy < 100) yy += 2000; const d = new Date(Date.UTC(yy, +m[2] - 1, +m[1])); if (!isNaN(d.getTime())) return d; }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); // iso
  if (m) { const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); if (!isNaN(d.getTime())) return d; }
  const d = new Date(s); return isNaN(d.getTime()) ? fallback : d;
}

function parseMode(v: any): PayMethod {
  const s = String(v ?? '').toUpperCase();
  if (s.includes('UPI') || s.includes('GPAY') || s.includes('PHONEPE')) return 'UPI';
  if (s.includes('CARD')) return 'CARD';
  if (s.includes('CHEQ') || s.includes('CHECK')) return 'CHEQUE';
  if (s.includes('BANK') || s.includes('NEFT') || s.includes('IMPS') || s.includes('TRANSFER') || s.includes('RTGS')) return 'BANK';
  return 'CASH';
}

interface MatchedStudent { id: string; name: string; className: string | null }

export async function importFees(rawRows: any[], opts: { dryRun: boolean; yearId: string; userId: string | null }) {
  const today = new Date();
  const feeTypes = await prisma.feeType.findMany({ where: { active: true }, select: { id: true, name: true } });
  const headByName = new Map(feeTypes.map((f) => [norm(f.name), f]));
  const validHeads = feeTypes.map((f) => f.name);

  const yearsList = await prisma.academicYear.findMany({ select: { id: true, label: true } });
  const yearByDigits = new Map<string, { id: string; label: string }>();
  for (const y of yearsList) { yearByDigits.set(y.id.replace(/\D/g, ''), y); yearByDigits.set(y.label.replace(/\D/g, ''), y); }
  const resolveYear = (s: string): { id: string; label: string } | null => {
    if (!String(s || '').trim()) return yearsList.find((y) => y.id === opts.yearId) || null;
    return yearByDigits.get(String(s).replace(/\D/g, '')) || null;
  };

  const students = await prisma.student.findMany({ select: { id: true, name: true, fatherPhone: true, motherPhone: true, guardianPhone: true, class: { select: { name: true } } } });
  const byId = new Map(students.map((s) => [s.id, s]));
  const byNamePhone = new Map<string, typeof students>();
  const byName = new Map<string, typeof students>();
  for (const s of students) {
    const nk = norm(s.name);
    (byName.get(nk) || byName.set(nk, []).get(nk)!).push(s);
    const phones = new Set([s.fatherPhone, s.motherPhone, s.guardianPhone].map(dig).filter(Boolean));
    for (const d of phones) { const k = nk + '|' + d; (byNamePhone.get(k) || byNamePhone.set(k, []).get(k)!).push(s); }
  }

  interface PRow { rowNo: number; admissionNo: string; name: string; phone: string; className: string; yearStr: string; feeHead: string; assigned: number; concession: number; paid: number; date: any; mode: any }
  const rows: PRow[] = [];
  const errors: { rowNo: number; reason: string }[] = [];
  rawRows.forEach((r, i) => {
    const rowNo = i + 2;
    const g = (...keys: string[]) => { for (const k of keys) { const v = r[k]; if (v !== undefined && v !== '') return v; } return ''; };
    const feeHead = String(g('feeHead', 'Fee Head')).trim();
    const name = String(g('name', 'Student Name', 'Name')).trim();
    const admissionNo = String(g('admissionNo', 'Admission No')).trim();
    if (!feeHead && !name && !admissionNo) return;
    if (!feeHead) { errors.push({ rowNo, reason: 'Missing Fee Head' }); return; }
    if (!headByName.has(norm(feeHead))) { errors.push({ rowNo, reason: `Unknown Fee Head "${feeHead}". Valid: ${validHeads.join(', ')}` }); return; }
    rows.push({
      rowNo, admissionNo, name, phone: String(g('phone', 'Phone')).trim(),
      className: String(g('className', 'Class')).trim(), yearStr: String(g('yearStr', 'Academic Year', 'Year')).trim(),
      feeHead, assigned: money(g('assigned', 'Assigned')), concession: money(g('concession', 'Concession')), paid: money(g('paid', 'Paid')),
      date: g('date', 'Date'), mode: g('mode', 'Payment Mode', 'Mode'),
    });
  });

  const matchOf = (row: PRow): { student?: MatchedStudent; reason?: string } => {
    if (row.admissionNo && byId.has(row.admissionNo)) { const s = byId.get(row.admissionNo)!; return { student: { id: s.id, name: s.name, className: s.class?.name || null } }; }
    const nk = norm(row.name); const d = dig(row.phone); const ck = norm(row.className);
    const pick = (cands: typeof students) => {
      let c = cands;
      if (c.length > 1 && ck) { const f = c.filter((s) => norm(s.class?.name) === ck); if (f.length) c = f; }
      return c;
    };
    if (nk && d) { let m = byNamePhone.get(nk + '|' + d); if (m) { m = pick(m); if (m.length === 1) return { student: { id: m[0].id, name: m[0].name, className: m[0].class?.name || null } }; if (m.length > 1) return { reason: 'Name + phone matches multiple students' }; } }
    if (nk) { let m = byName.get(nk); if (m) { m = pick(m); if (m.length === 1) return { student: { id: m[0].id, name: m[0].name, className: m[0].class?.name || null } }; if (m.length > 1) return { reason: 'Name matches multiple — add phone or admission no' }; } }
    return { reason: row.admissionNo ? `Admission no "${row.admissionNo}" not found` : 'No student matched (check name/phone/admission no)' };
  };

  // Group by (student, year). Each fee head is consolidated once (assigned/concession),
  // and every row with a Paid amount is collected as a separate dated payment — so you
  // can list one row per payment date and they all get recorded.
  interface PayEntry { paid: number; date: Date; mode: PayMethod }
  interface Head { feeTypeId: string; headName: string; assigned: number; concession: number; payments: PayEntry[] }
  const groups = new Map<string, { student: MatchedStudent; yearId: string; yearLabel: string; heads: Map<string, Head> }>();
  const unmatched: { rowNo: number; name: string; phone: string; reason: string }[] = [];
  for (const row of rows) {
    const m = matchOf(row);
    if (!m.student) { unmatched.push({ rowNo: row.rowNo, name: row.name || '', phone: row.phone || '', reason: m.reason || 'Unmatched' }); continue; }
    const year = resolveYear(row.yearStr);
    if (!year) { errors.push({ rowNo: row.rowNo, reason: `Unknown Academic Year "${row.yearStr}"` }); continue; }
    const ft = headByName.get(norm(row.feeHead))!;
    const key = m.student.id + '|' + year.id;
    if (!groups.has(key)) groups.set(key, { student: m.student, yearId: year.id, yearLabel: year.label, heads: new Map() });
    const heads = groups.get(key)!.heads;
    const h = heads.get(ft.id) || { feeTypeId: ft.id, headName: ft.name, assigned: 0, concession: 0, payments: [] };
    h.assigned = Math.max(h.assigned, row.assigned);     // assigned counted once per head
    h.concession = Math.max(h.concession, row.concession);
    if (row.paid > 0) h.payments.push({ paid: row.paid, date: parseDate(row.date, today), mode: parseMode(row.mode) });
    heads.set(ft.id, h);
  }

  // Paid per head is capped at its payable (assigned − concession).
  const headPaid = (h: Head) => Math.min(h.payments.reduce((t, p) => t + p.paid, 0), Math.max(0, h.assigned - h.concession));

  let tAssigned = 0, tConcession = 0, tPaid = 0;
  for (const { heads } of groups.values()) for (const h of heads.values()) { tAssigned += h.assigned; tConcession += h.concession; tPaid += headPaid(h); }
  const totals = { assigned: tAssigned, concession: tConcession, paid: tPaid, due: tAssigned - tConcession - tPaid };
  const studentIds = new Set(Array.from(groups.values()).map((g) => g.student.id));
  const totalPayments = Array.from(groups.values()).reduce((t, g) => t + Array.from(g.heads.values()).reduce((s, h) => s + h.payments.length, 0), 0);

  const preview = {
    totalRows: rows.length,
    matchedStudents: studentIds.size,
    matchedGroups: groups.size,
    totalPayments,
    totals,
    unmatched,
    errors,
    sample: Array.from(groups.values()).slice(0, 8).map((x) => ({ name: x.student.name, year: x.yearLabel, heads: x.heads.size, assigned: Array.from(x.heads.values()).reduce((t, h) => t + h.assigned, 0), paid: Array.from(x.heads.values()).reduce((t, h) => t + headPaid(h), 0) })),
  };

  if (opts.dryRun) return { dryRun: true, ...preview };

  // ---- Apply: MERGE into each (student, year). Never deletes existing fees:
  // creates a charge/concession only if that head has none, and adds the sheet's
  // dated payments — skipping any that already exist (so re-uploads are safe). ----
  const seqByYear = new Map<string, number>();
  const nextSeq = async (yearId: string) => {
    if (!seqByYear.has(yearId)) {
      const ex = await prisma.payment.findMany({ where: { yearId }, select: { receiptNo: true } });
      seqByYear.set(yearId, ex.reduce((m, p) => Math.max(m, parseInt(p.receiptNo.split('/').pop() || '0', 10) || 0), 0));
    }
    const n = seqByYear.get(yearId)! + 1; seqByYear.set(yearId, n); return n;
  };

  let appliedGroups = 0, paymentsCreated = 0;
  for (const { student, yearId, heads } of groups.values()) {
    const headList = Array.from(heads.values()).filter((h) => h.assigned > 0 || h.payments.length > 0 || h.concession > 0);
    if (headList.length === 0) continue;

    // Existing state for this student+year.
    const existing = await prisma.studentFeeAssignment.findUnique({
      where: { studentId_yearId: { studentId: student.id, yearId } },
      include: { charges: { include: { allocations: { select: { amount: true } } } }, concessions: true },
    });
    const existPays = await prisma.payment.findMany({ where: { studentId: student.id, yearId }, select: { paidAt: true, method: true, total: true } });
    const existKeys = new Set(existPays.map((p) => p.paidAt.toISOString().slice(0, 10) + '|' + p.method + '|' + p.total));

    // Per-head plan: keep existing charge/concession; only create what's missing.
    interface Plan { feeTypeId: string; headName: string; createCharge: boolean; createAmount: number; createConcession: number; remaining: number; existSlots: { id: string; free: number }[] }
    const plans: Plan[] = headList.map((h) => {
      const ex = (existing?.charges || []).filter((c) => c.feeTypeId === h.feeTypeId);
      const grossEx = ex.reduce((t, c) => t + c.amount, 0);
      const paidEx = ex.reduce((t, c) => t + c.allocations.reduce((s, a) => s + a.amount, 0), 0);
      const concEx = (existing?.concessions || []).filter((c) => c.feeTypeId === h.feeTypeId && c.status === 'APPROVED').reduce((t, c) => t + c.amount, 0);
      const createCharge = ex.length === 0 && h.assigned > 0;
      const createAmount = createCharge ? h.assigned : 0;
      const gross = grossEx + createAmount;
      const createConcession = concEx === 0 && h.concession > 0 ? Math.min(h.concession, gross || h.concession) : 0;
      const remaining = Math.max(0, gross - (concEx + createConcession) - paidEx);
      const existSlots = ex.map((c) => ({ id: c.id, free: Math.max(0, c.amount - c.allocations.reduce((s, a) => s + a.amount, 0)) }));
      return { feeTypeId: h.feeTypeId, headName: h.headName, createCharge, createAmount, createConcession, remaining, existSlots };
    });

    // Raw payment events grouped by (date, mode). Dedupe against existing payments
    // by (date|mode|rawTotal) so the same row isn't recorded twice on re-upload.
    const evMap = new Map<string, { date: Date; mode: PayMethod; raw: Map<string, number> }>();
    for (const h of headList) for (const p of h.payments) {
      if (p.paid <= 0) continue;
      const k = p.date.toISOString().slice(0, 10) + '|' + p.mode;
      if (!evMap.has(k)) evMap.set(k, { date: p.date, mode: p.mode, raw: new Map() });
      const ev = evMap.get(k)!; ev.raw.set(h.feeTypeId, (ev.raw.get(h.feeTypeId) || 0) + p.paid);
    }
    const fresh = Array.from(evMap.values())
      .filter((ev) => !existKeys.has(ev.date.toISOString().slice(0, 10) + '|' + ev.mode + '|' + Array.from(ev.raw.values()).reduce((t, v) => t + v, 0)))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    // Clamp each head's new payments to its remaining payable (date order).
    const remain = new Map(plans.map((p) => [p.feeTypeId, p.remaining]));
    const finalEvents: { date: Date; mode: PayMethod; alloc: Map<string, number> }[] = [];
    for (const ev of fresh) {
      const alloc = new Map<string, number>();
      for (const [ft, amt] of ev.raw) { const rem = remain.get(ft) || 0; const give = Math.min(amt, rem); if (give > 0) { alloc.set(ft, give); remain.set(ft, rem - give); } }
      if (alloc.size) finalEvents.push({ date: ev.date, mode: ev.mode, alloc });
    }
    const receiptNos: string[] = [];
    for (let i = 0; i < finalEvents.length; i++) receiptNos.push(`RCPT/${yearId}/${String(await nextSeq(yearId)).padStart(4, '0')}`);

    const needsWork = finalEvents.length > 0 || plans.some((p) => p.createCharge || p.createConcession > 0);
    if (!needsWork) { appliedGroups += 1; continue; }

    await prisma.$transaction(async (tx) => {
      const assignmentId = existing?.id ?? (await tx.studentFeeAssignment.create({ data: { studentId: student.id, yearId } })).id;
      const slots = new Map<string, { id: string; free: number }[]>();
      for (const pl of plans) {
        const list = [...pl.existSlots];
        if (pl.createCharge) { const charge = await tx.feeCharge.create({ data: { assignmentId, feeTypeId: pl.feeTypeId, label: pl.headName, amount: pl.createAmount } }); list.push({ id: charge.id, free: pl.createAmount }); }
        if (pl.createConcession > 0) await tx.concession.create({ data: { assignmentId, feeTypeId: pl.feeTypeId, amount: pl.createConcession, reason: 'Imported (opening)', status: 'APPROVED', approvedById: opts.userId, decidedAt: new Date() } });
        slots.set(pl.feeTypeId, list);
      }
      let pi = 0;
      for (const ev of finalEvents) {
        const allocations: { feeChargeId: string; amount: number }[] = [];
        for (const [ft, amt] of ev.alloc) {
          let left = amt; for (const s of (slots.get(ft) || [])) { if (left <= 0) break; const take = Math.min(left, s.free); if (take > 0) { allocations.push({ feeChargeId: s.id, amount: take }); s.free -= take; left -= take; } }
        }
        if (!allocations.length) continue;
        const total = allocations.reduce((t, a) => t + a.amount, 0);
        await tx.payment.create({ data: { studentId: student.id, yearId, receiptNo: receiptNos[pi], method: ev.mode, total, paidAt: ev.date, note: 'Imported payment', collectedById: opts.userId, allocations: { create: allocations } } });
        paymentsCreated += 1; pi += 1;
      }
      appliedGroups += 1;
    });
  }

  return { dryRun: false, appliedStudents: studentIds.size, appliedGroups, paymentsCreated, totals, unmatched, errors };
}
