import { prisma } from '@/lib/db';
import { UNIFORM_ITEMS, type Gender } from '@/lib/feeStructure';
import { priceFromMatrix, type UniformMatrix } from '@/lib/uniformMatrix';
import type { PayMethod } from '@prisma/client';

// ============================================================================
// Wide fee sheet — round-trippable (export ↔ import).
// Identity columns: Name | Father Name | Student ID | Class
// Then THREE columns per fee head, laid out horizontally:
//     "<Head> — Assigned" | "<Head> — Paid" | "<Head> — Date"
// Every configured fee head gets a group; the Uniform head is split into one
// group per uniform item.
//   • Assigned sets the charge (blank → configured fee; blank on an existing
//     charge leaves it unchanged).
//   • Paid + Date reproduce receipts. Heads paid on the SAME date become one
//     receipt. A student paying a head on several dates spans several rows
//     (identity repeated; Assigned only on the first row).
// Re-uploading is safe — duplicate receipts are skipped.
// ============================================================================

const norm = (s: any) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const money = (v: any) => Math.max(0, Math.round(Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0));
const stripUni = (label: string) => String(label || '').replace(/^\s*(uniform|misc(ellaneous)?)\s*[—\-:]\s*/i, '').trim();
const iso = (d: Date) => d.toISOString().slice(0, 10);

function parseDate(v: any, fallback: Date | null): Date | null {
  if (v == null || v === '') return fallback;
  if (typeof v === 'number' && v > 0) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000); // excel serial
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/); // dd/mm/yyyy
  if (m) { let yy = +m[3]; if (yy < 100) yy += 2000; const d = new Date(Date.UTC(yy, +m[2] - 1, +m[1])); if (!isNaN(d.getTime())) return d; }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); // iso
  if (m) { const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); if (!isNaN(d.getTime())) return d; }
  const d = new Date(s); return isNaN(d.getTime()) ? fallback : d;
}

const isUniformHead = (key: string | null, name: string | null) => {
  const k = (key || '').toLowerCase(), n = (name || '').toLowerCase();
  return k === 'uniform' || /uniform|miscellaneous/.test(n);
};

// Split a header like "Tuition Fee — Paid" into base ("Tuition Fee") + kind ("paid").
function splitHeader(h: string): { base: string; kind: 'assigned' | 'paid' | 'date' } | null {
  const m = String(h).match(/^(.*?)\s*[—\-]\s*(assigned|paid|date)\s*$/i);
  if (!m) return null;
  return { base: m[1].trim(), kind: m[2].toLowerCase() as 'assigned' | 'paid' | 'date' };
}

// ---------------------------------------------------------------------------
// EXPORT — one row per (student, payment date); a student with no payments
// gets a single row carrying just the Assigned amounts.
// ---------------------------------------------------------------------------
export async function buildFeeSheet(yearId: string, classId?: string): Promise<{ header: string[]; rows: (string | number)[][] }> {
  const feeTypes = await prisma.feeType.findMany({ select: { id: true, key: true, name: true, order: true }, orderBy: { order: 'asc' } });
  const uniformTypeIds = new Set(feeTypes.filter((f) => isUniformHead(f.key, f.name)).map((f) => f.id));
  const headTypes = feeTypes.filter((f) => !uniformTypeIds.has(f.id));

  const custom = await prisma.uniformItem.findMany({ where: { yearId }, orderBy: { order: 'asc' }, select: { name: true } });
  const uniformDisplay = new Map<string, string>(); // normName -> display
  for (const d of UNIFORM_ITEMS) uniformDisplay.set(norm(d.name), d.name);
  for (const c of custom) if (!uniformDisplay.has(norm(c.name))) uniformDisplay.set(norm(c.name), c.name);

  const assignments = await prisma.studentFeeAssignment.findMany({
    where: { yearId, ...(classId ? { student: { classId } } : {}) },
    include: {
      student: { select: { id: true, name: true, fatherName: true, class: { select: { name: true } } } },
      charges: { include: { allocations: { include: { payment: { select: { paidAt: true, voided: true } } } } } },
    },
    orderBy: { student: { name: 'asc' } },
  });

  interface Grp { assigned: number; pays: Map<string, number> } // pays: isoDate -> amount
  interface Acc { name: string; father: string; id: string; cls: string; heads: Map<string, Grp>; items: Map<string, Grp> }
  const accs: Acc[] = [];
  for (const a of assignments) {
    const acc: Acc = { name: a.student.name, father: a.student.fatherName || '', id: a.student.id, cls: a.student.class?.name || '', heads: new Map(), items: new Map() };
    for (const c of a.charges) {
      const isUni = uniformTypeIds.has(c.feeTypeId);
      const target = isUni ? acc.items : acc.heads;
      const key = isUni ? (() => { const it = stripUni(c.label) || 'Uniform'; const nk = norm(it); if (!uniformDisplay.has(nk)) uniformDisplay.set(nk, it); return nk; })() : c.feeTypeId;
      const grp = target.get(key) || { assigned: 0, pays: new Map<string, number>() };
      grp.assigned += c.amount;
      for (const al of c.allocations) { if (al.payment.voided) continue; const d = iso(al.payment.paidAt); grp.pays.set(d, (grp.pays.get(d) || 0) + al.amount); }
      target.set(key, grp);
    }
    accs.push(acc);
  }

  const uniformKeys = Array.from(uniformDisplay.keys());
  const header = ['Name', 'Father Name', 'Student ID', 'Class'];
  for (const ft of headTypes) header.push(`${ft.name} — Assigned`, `${ft.name} — Paid`, `${ft.name} — Date`);
  for (const k of uniformKeys) { const n = uniformDisplay.get(k)!; header.push(`${n} — Assigned`, `${n} — Paid`, `${n} — Date`); }

  const groupList = [...headTypes.map((ft) => ({ k: ft.id, uni: false })), ...uniformKeys.map((k) => ({ k, uni: true }))];
  const rows: (string | number)[][] = [];
  for (const acc of accs) {
    const grpOf = (g: { k: string; uni: boolean }) => (g.uni ? acc.items : acc.heads).get(g.k);
    const dateSet = new Set<string>();
    for (const g of groupList) { const grp = grpOf(g); if (grp) for (const d of grp.pays.keys()) dateSet.add(d); }
    const dates = Array.from(dateSet).sort();
    const emit = (date: string | null, isFirst: boolean) => {
      const r: (string | number)[] = [acc.name, acc.father, acc.id, acc.cls];
      for (const g of groupList) {
        const grp = grpOf(g);
        const assignedCell: string | number = isFirst ? (grp?.assigned || 0) : '';
        const paidCell = date ? (grp?.pays.get(date) || 0) : 0;
        const dateCell = date && paidCell > 0 ? date : '';
        r.push(assignedCell, paidCell, dateCell);
      }
      rows.push(r);
    };
    if (dates.length === 0) emit(null, true);
    else dates.forEach((d, i) => emit(d, i === 0));
  }
  return { header, rows };
}

// ---------------------------------------------------------------------------
// IMPORT
// ---------------------------------------------------------------------------
interface MatchedStudent { id: string; name: string; classId: string | null; className: string | null; gender: Gender }
interface Line { feeTypeId: string; label: string; isUniform: boolean; assigned: number; assignedGiven: boolean; paid: number; date: Date }

export async function importFeeSheet(rawRows: any[], opts: { dryRun: boolean; yearId: string; userId: string | null }) {
  const today = new Date();
  const feeTypes = await prisma.feeType.findMany({ where: { active: true }, select: { id: true, key: true, name: true } });
  const uniformType = feeTypes.find((f) => isUniformHead(f.key, f.name)) || null;
  const headByName = new Map(feeTypes.filter((f) => !isUniformHead(f.key, f.name)).map((f) => [norm(f.name), f]));

  const students = await prisma.student.findMany({ select: { id: true, name: true, gender: true, class: { select: { id: true, name: true } } } });
  const byId = new Map(students.map((s) => [s.id, s]));
  const byName = new Map<string, typeof students>();
  for (const s of students) { const nk = norm(s.name); (byName.get(nk) || byName.set(nk, []).get(nk)!).push(s); }

  const classFees = await prisma.classFee.findMany({ where: { yearId: opts.yearId }, select: { classId: true, feeTypeId: true, amount: true } });
  const cf = new Map(classFees.map((c) => [c.classId + '|' + c.feeTypeId, c.amount]));
  const yearRow = await prisma.academicYear.findUnique({ where: { id: opts.yearId }, select: { uniformPrices: true } });
  const matrix = (yearRow?.uniformPrices as UniformMatrix | null) ?? null;
  const customItems = await prisma.uniformItem.findMany({ where: { yearId: opts.yearId }, select: { id: true, name: true } });
  const nameToKey = new Map<string, string>();
  for (const d of UNIFORM_ITEMS) nameToKey.set(norm(d.name), d.key);
  for (const c of customItems) if (!nameToKey.has(norm(c.name))) nameToKey.set(norm(c.name), c.id);

  // Discover the fee-head groups from the sheet headers.
  const sampleKeys = rawRows.length ? Object.keys(rawRows[0]) : [];
  interface Group { base: string; feeTypeId: string; isUniform: boolean; label: string; aKey?: string; pKey?: string; dKey?: string }
  const groups = new Map<string, Group>();
  for (const key of sampleKeys) {
    const parsed = splitHeader(key);
    if (!parsed) continue;
    const bk = norm(parsed.base);
    if (!groups.has(bk)) {
      const head = headByName.get(bk);
      if (head) groups.set(bk, { base: parsed.base, feeTypeId: head.id, isUniform: false, label: head.name });
      else if (uniformType) groups.set(bk, { base: parsed.base, feeTypeId: uniformType.id, isUniform: true, label: `Uniform — ${parsed.base}` });
      else continue;
    }
    const g = groups.get(bk)!;
    if (parsed.kind === 'assigned') g.aKey = key; else if (parsed.kind === 'paid') g.pKey = key; else g.dKey = key;
  }

  const get = (r: any, k?: string) => (k && r[k] !== undefined ? r[k] : '');
  const idOf = (r: any) => String(r['Student ID'] ?? r['StudentID'] ?? r['studentId'] ?? '').trim();
  const nameOf = (r: any) => String(r['Name'] ?? r['Student Name'] ?? r['name'] ?? '').trim();
  const matchOf = (r: any): { student?: MatchedStudent; reason?: string } => {
    const id = idOf(r);
    if (id && byId.has(id)) { const s = byId.get(id)!; return { student: { id: s.id, name: s.name, classId: s.class?.id || null, className: s.class?.name || null, gender: s.gender } }; }
    const nk = norm(nameOf(r)); const ck = norm(r['Class'] ?? r['class']);
    if (nk) {
      let m = byName.get(nk);
      if (m) {
        if (m.length > 1 && ck) { const f = m.filter((s) => norm(s.class?.name) === ck); if (f.length) m = f; }
        if (m.length === 1) return { student: { id: m[0].id, name: m[0].name, classId: m[0].class?.id || null, className: m[0].class?.name || null, gender: m[0].gender } };
        if (m.length > 1) return { reason: 'Name matches multiple — add Student ID' };
      }
    }
    return { reason: id ? `Student ID "${id}" not found` : 'No student matched (check Name / Student ID)' };
  };

  const configAssigned = (stu: MatchedStudent, g: Group): number => {
    if (g.isUniform) { const key = nameToKey.get(norm(g.base)); const p = key ? priceFromMatrix(matrix, key, stu.classId || '', stu.gender) : null; return p ?? 0; }
    return cf.get((stu.classId || '') + '|' + g.feeTypeId) || 0;
  };

  // One parsed entry PER ROW (a student can appear on several rows — one per date).
  interface Row { student: MatchedStudent; lines: Line[] }
  const parsedRows: Row[] = [];
  const unmatched: { rowNo: number; name: string; phone: string; reason: string }[] = [];
  const errors: { rowNo: number; reason: string }[] = [];

  rawRows.forEach((r, i) => {
    const rowNo = i + 2;
    if (!Object.values(r).some((v) => v !== undefined && v !== '')) return;
    const m = matchOf(r);
    if (!m.student) { unmatched.push({ rowNo, name: nameOf(r), phone: '', reason: m.reason || 'Unmatched' }); return; }
    const lines: Line[] = [];
    for (const g of groups.values()) {
      const assignedCell = money(get(r, g.aKey));
      const paid = money(get(r, g.pKey));
      if (assignedCell <= 0 && paid <= 0) continue;
      const assignedGiven = assignedCell > 0;
      const assigned = assignedGiven ? assignedCell : configAssigned(m.student, g);
      const date = parseDate(get(r, g.dKey), today) || today;
      lines.push({ feeTypeId: g.feeTypeId, label: g.label, isUniform: g.isUniform, assigned, assignedGiven, paid, date });
    }
    if (lines.length === 0) return;
    parsedRows.push({ student: m.student, lines });
  });

  let tAssigned = 0, tPaid = 0;
  for (const row of parsedRows) for (const l of row.lines) { if (l.assignedGiven) tAssigned += l.assigned; tPaid += l.paid; }
  const matchedIds = new Set(parsedRows.map((r) => r.student.id));
  const totals = { assigned: tAssigned, concession: 0, paid: tPaid, due: Math.max(0, tAssigned - tPaid) };
  const preview = { totalRows: rawRows.length, matchedStudents: matchedIds.size, matchedGroups: parsedRows.length, totals, unmatched, errors };
  if (opts.dryRun) return { dryRun: true, ...preview };

  // ---- Apply — process rows in sheet order (Export writes earliest date first,
  // so charges from the first row exist before later dated rows). Idempotent. ----
  const seqByYear = new Map<string, number>();
  const nextSeq = async (yearId: string) => {
    if (!seqByYear.has(yearId)) {
      const ex = await prisma.payment.findMany({ where: { yearId }, select: { receiptNo: true } });
      seqByYear.set(yearId, ex.reduce((mx, p) => Math.max(mx, parseInt(p.receiptNo.split('/').pop() || '0', 10) || 0), 0));
    }
    const n = seqByYear.get(yearId)! + 1; seqByYear.set(yearId, n); return n;
  };

  let paymentsCreated = 0;
  const yearId = opts.yearId;
  for (const row of parsedRows) {
    const existing = await prisma.studentFeeAssignment.findUnique({
      where: { studentId_yearId: { studentId: row.student.id, yearId } },
      include: { charges: { include: { allocations: { select: { amount: true } } } } },
    });
    const existPays = await prisma.payment.findMany({ where: { studentId: row.student.id, yearId }, select: { paidAt: true, method: true, total: true } });
    const existKeys = new Set(existPays.map((p) => iso(p.paidAt) + '|' + p.method + '|' + p.total));

    interface Slot { line: Line; chargeId?: string; existAmount: number; setAmount: number; free: number }
    const slots: Slot[] = row.lines.map((l) => {
      const cands = (existing?.charges || []).filter((c) => c.feeTypeId === l.feeTypeId);
      const ex = l.isUniform ? cands.find((c) => norm(stripUni(c.label)) === norm(stripUni(l.label))) : cands[0];
      const paidAlready = ex ? ex.allocations.reduce((t, a) => t + a.amount, 0) : 0;
      // Assigned given → set the charge (never below what's paid). Blank on an
      // existing charge → keep it; blank when creating → use configured amount.
      const setAmount = ex
        ? (l.assignedGiven ? Math.max(l.assigned, paidAlready) : ex.amount)
        : Math.max(l.assigned, l.paid);
      return { line: l, chargeId: ex?.id, existAmount: ex?.amount ?? 0, setAmount, free: Math.max(0, setAmount - paidAlready) };
    });

    // Receipts: one per distinct payment date on this row (normally just one).
    const byDate = new Map<string, Slot[]>();
    for (const s of slots) { if (s.line.paid <= 0) continue; const k = iso(s.line.date); (byDate.get(k) || byDate.set(k, []).get(k)!).push(s); }
    const receipts: { date: Date; allocs: { slot: Slot; amount: number }[] }[] = [];
    for (const [k, ss] of byDate) {
      const allocs: { slot: Slot; amount: number }[] = [];
      for (const s of ss) { const give = Math.min(s.line.paid, s.free); if (give > 0) { allocs.push({ slot: s, amount: give }); s.free -= give; } }
      const total = allocs.reduce((t, a) => t + a.amount, 0);
      if (total > 0 && !existKeys.has(k + '|CASH|' + total)) receipts.push({ date: new Date(k + 'T00:00:00.000Z'), allocs });
    }

    const chargeCreates = slots.some((s) => !s.chargeId && s.setAmount > 0);
    const chargeUpdates = slots.some((s) => s.chargeId && s.setAmount !== s.existAmount);
    if (receipts.length === 0 && !chargeCreates && !chargeUpdates) continue;

    const receiptNos: string[] = [];
    for (let i = 0; i < receipts.length; i++) receiptNos.push(`RCPT/${yearId}/${String(await nextSeq(yearId)).padStart(4, '0')}`);

    await prisma.$transaction(async (tx) => {
      const assignmentId = existing?.id ?? (await tx.studentFeeAssignment.create({ data: { studentId: row.student.id, yearId } })).id;
      for (const s of slots) {
        if (!s.chargeId) { if (s.setAmount > 0) { const c = await tx.feeCharge.create({ data: { assignmentId, feeTypeId: s.line.feeTypeId, label: s.line.label, amount: s.setAmount } }); s.chargeId = c.id; } }
        else if (s.setAmount !== s.existAmount) await tx.feeCharge.update({ where: { id: s.chargeId }, data: { amount: s.setAmount } });
      }
      for (let i = 0; i < receipts.length; i++) {
        const rc = receipts[i];
        const allocations = rc.allocs.filter((a) => a.slot.chargeId).map((a) => ({ feeChargeId: a.slot.chargeId!, amount: a.amount }));
        if (!allocations.length) continue;
        const total = allocations.reduce((t, a) => t + a.amount, 0);
        await tx.payment.create({ data: { studentId: row.student.id, yearId, receiptNo: receiptNos[i], method: 'CASH' as PayMethod, total, paidAt: rc.date, note: 'Imported (fee sheet)', collectedById: opts.userId, allocations: { create: allocations } } });
        paymentsCreated += 1;
      }
    });
  }

  return { dryRun: false, appliedStudents: matchedIds.size, appliedGroups: parsedRows.length, paymentsCreated, totals, unmatched, errors };
}
