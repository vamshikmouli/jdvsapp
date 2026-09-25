import { prisma } from '@/lib/db';
import type { UniformMatrix } from '@/lib/uniformMatrix';

// ============================================================================
// Uniform stock (inventory) — Phase 1: read-only levels + analytics + the gate.
//
// STOCK ITEMS are their own list, deliberately more granular than the billing
// catalogue: Tie and Bow are separate, and Socks splits into colours. Each stock
// item borrows its class × gender coverage from a matrix source key (`src`) in the
// year's uniform price matrix, so lines only exist where that family is sold.
// A SKU = stock item × class × gender. On-hand lives in UniformStock; every change
// is journalled in UniformStockLedger. Add/adjust + receipt-deduction are later phases.
// ============================================================================

export type StockGender = 'M' | 'F' | 'ANY';
export const GENDER_LABEL: Record<StockGender, string> = { M: 'Boys', F: 'Girls', ANY: 'All' };

// The stock catalogue. `src` = the price-matrix family it takes class/gender coverage
// from (splits like bow/socks colours share their parent family's coverage).
export interface StockItemDef { key: string; name: string; src: string; gendered: boolean }
export const STOCK_ITEMS: StockItemDef[] = [
  { key: 'school',        name: 'School Uniform',    src: 'school', gendered: true },
  { key: 'white',         name: 'White Uniform',     src: 'white',  gendered: true },
  { key: 'tshirt',        name: 'T-Shirt',           src: 'tshirt', gendered: false },
  { key: 'wed',           name: 'Wednesday Uniform', src: 'wed',    gendered: false },
  { key: 'tie',           name: 'Tie',               src: 'tie',    gendered: false },
  { key: 'bow',           name: 'Bow',               src: 'tie',    gendered: false },
  { key: 'belt',          name: 'Belt',              src: 'belt',   gendered: false },
  { key: 'socks_white',   name: 'White Socks',       src: 'socks',  gendered: false },
  { key: 'socks_blue',    name: 'Blue Socks',        src: 'socks',  gendered: false },
  { key: 'socks_maroon',  name: 'Maroon Socks',      src: 'socks',  gendered: false },
  { key: 'socks_purple',  name: 'Purple Socks',      src: 'socks',  gendered: false },
];

const ITEM_NAME: Record<string, string> = Object.fromEntries(STOCK_ITEMS.map((i) => [i.key, i.name]));
const ITEM_ORDER: Record<string, number> = Object.fromEntries(STOCK_ITEMS.map((i, idx) => [i.key, idx]));
const itemName = (key: string) => ITEM_NAME[key] || key;

// ---- Bundle recipes (for Phase 3 receipt-deduction) ------------------------
// Selling a "TBS" bundle to a student deducts these stock components (per unit).
// The 5th sock is Maroon or Purple by the student's class:
//   Purple: Pre-KG, LKG, UKG, 1st, 8th   ·   Maroon: 2nd–7th, 9th, 10th.
export const TBS_PURPLE_CLASSES = new Set(['prekg', 'lkg', 'ukg', '1', '8']);
export function tbsComponents(classId: string): Record<string, number> {
  const sock = TBS_PURPLE_CLASSES.has(classId) ? 'socks_purple' : 'socks_maroon';
  return { tie: 1, belt: 1, socks_white: 1, socks_blue: 1, [sock]: 1 };
}

const IS_GENDERED = new Map(STOCK_ITEMS.map((i) => [i.key, i.gendered]));

// Map a billing uniform item name (as printed on the receipt, e.g. "School Uniform",
// "TBS", "Tie & Bow") to the stock components it consumes. Returns null when the item
// can't be resolved (e.g. a colourless "Socks" line) — that line is skipped, not guessed.
function billingToComponents(name: string, classId: string): { itemKey: string; qty: number }[] | null {
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (n === 'tbs') return Object.entries(tbsComponents(classId)).map(([itemKey, qty]) => ({ itemKey, qty }));
  const M: Record<string, { itemKey: string; qty: number }[]> = {
    schooluniform: [{ itemKey: 'school', qty: 1 }],
    whiteuniform: [{ itemKey: 'white', qty: 1 }],
    tshirt: [{ itemKey: 'tshirt', qty: 1 }],
    wednesdayuniform: [{ itemKey: 'wed', qty: 1 }],
    tiebow: [{ itemKey: 'tie', qty: 1 }, { itemKey: 'bow', qty: 1 }],
    tie: [{ itemKey: 'tie', qty: 1 }],
    bow: [{ itemKey: 'bow', qty: 1 }],
    belt: [{ itemKey: 'belt', qty: 1 }],
    whitesocks: [{ itemKey: 'socks_white', qty: 1 }],
    bluesocks: [{ itemKey: 'socks_blue', qty: 1 }],
    maroonsocks: [{ itemKey: 'socks_maroon', qty: 1 }],
    purplesocks: [{ itemKey: 'socks_purple', qty: 1 }],
  };
  return M[n] || null;
}

// ---- Phase 3: deduct/reverse stock on a fee receipt (best-effort, gated) ----

/**
 * Deduct uniform stock for a paid receipt — called AFTER the payment commits, so a
 * stock hiccup can never block fee collection. Only runs when the global gate is on.
 * Idempotent per uniform charge (a split/instalment won't double-deduct); never blocks
 * on shortage (stock may go negative). Unmappable lines (e.g. a colourless "Socks") are
 * skipped. `student.gender` picks the SKU gender for gendered items; others use 'ANY'.
 */
export async function deductUniformStock(paymentId: string): Promise<void> {
  const settings = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { uniformStockDeductionEnabled: true } });
  if (!settings?.uniformStockDeductionEnabled) return;

  const pay = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true, yearId: true, voided: true,
      student: { select: { classId: true, gender: true } },
      allocations: {
        select: {
          feeCharge: {
            select: {
              id: true, label: true, feeType: { select: { key: true } },
              assignment: { select: { uniformSelections: { select: { qty: true, uniformItem: { select: { name: true } } } } } },
            },
          },
        },
      },
    },
  });
  if (!pay || pay.voided || !pay.student?.classId) return;
  const { yearId } = pay;
  const classId = pay.student.classId;
  const gender: StockGender = pay.student.gender === 'F' ? 'F' : 'M';

  // Uniform charges paid on this receipt (deduped by charge id).
  const charges = new Map<string, { label: string; selections: { name: string; qty: number }[] }>();
  for (const a of pay.allocations) {
    const c = a.feeCharge;
    if (c.feeType.key !== 'uniform') continue;
    charges.set(c.id, { label: c.label, selections: c.assignment.uniformSelections.map((s) => ({ name: s.uniformItem.name, qty: s.qty })) });
  }
  if (charges.size === 0) return;

  for (const [chargeId, info] of charges) {
    // Already deducted for this charge and not reversed? Skip (idempotent).
    const prior = await prisma.uniformStockLedger.aggregate({ where: { feeChargeId: chargeId, reason: { in: ['RECEIPT', 'VOID_REVERSAL'] } }, _sum: { delta: true } });
    if ((prior._sum.delta ?? 0) < 0) continue;

    // "Uniform — X" → item X; a plain "Uniform" bundle → the student's selections.
    const m = info.label.match(/^uniform\s*[—-]\s*(.+)$/i);
    const lines = m ? [{ name: m[1].trim(), qty: 1 }] : info.selections;

    const deductions = new Map<string, { itemKey: string; gender: StockGender; qty: number }>();
    for (const line of lines) {
      const comps = billingToComponents(line.name, classId);
      if (!comps) continue; // unmappable line — skip, don't guess
      for (const comp of comps) {
        const g: StockGender = IS_GENDERED.get(comp.itemKey) ? gender : 'ANY';
        const k = `${comp.itemKey}|${g}`;
        const e = deductions.get(k) || { itemKey: comp.itemKey, gender: g, qty: 0 };
        e.qty += comp.qty * line.qty;
        deductions.set(k, e);
      }
    }
    if (deductions.size === 0) continue;

    await prisma.$transaction(async (tx) => {
      for (const d of deductions.values()) {
        await tx.uniformStock.upsert({
          where: { yearId_itemKey_classId_gender: { yearId, itemKey: d.itemKey, classId, gender: d.gender } },
          update: { qty: { decrement: d.qty } },
          create: { yearId, itemKey: d.itemKey, classId, gender: d.gender, qty: -d.qty, lowThreshold: 0 },
        });
        await tx.uniformStockLedger.create({
          data: { yearId, itemKey: d.itemKey, classId, gender: d.gender, delta: -d.qty, reason: 'RECEIPT', paymentId, feeChargeId: chargeId, byId: null },
        });
      }
    });
  }
}

/** Reverse a receipt's stock deductions when it's voided (adds the units back). Once. */
export async function reverseUniformStock(paymentId: string): Promise<void> {
  const receipts = await prisma.uniformStockLedger.findMany({ where: { paymentId, reason: 'RECEIPT' } });
  if (receipts.length === 0) return;
  const alreadyReversed = await prisma.uniformStockLedger.findFirst({ where: { paymentId, reason: 'VOID_REVERSAL' }, select: { id: true } });
  if (alreadyReversed) return;

  await prisma.$transaction(async (tx) => {
    for (const r of receipts) {
      await tx.uniformStock.upsert({
        where: { yearId_itemKey_classId_gender: { yearId: r.yearId, itemKey: r.itemKey, classId: r.classId, gender: r.gender } },
        update: { qty: { increment: -r.delta } }, // r.delta is negative → add it back
        create: { yearId: r.yearId, itemKey: r.itemKey, classId: r.classId, gender: r.gender, qty: -r.delta, lowThreshold: 0 },
      });
      await tx.uniformStockLedger.create({
        data: { yearId: r.yearId, itemKey: r.itemKey, classId: r.classId, gender: r.gender, delta: -r.delta, reason: 'VOID_REVERSAL', paymentId, feeChargeId: r.feeChargeId, byId: null },
      });
    }
  });
}

export interface StockRow {
  itemKey: string;
  itemName: string;
  classId: string;
  className: string;
  gender: StockGender;
  price: number | null;
  qty: number;          // on-hand
  lowThreshold: number;
  low: boolean;         // qty <= threshold
  negative: boolean;    // qty < 0
}

// Every SKU implied by the price matrix, joined with its on-hand count (0 if none yet).
async function buildSkuRows(yearId: string): Promise<StockRow[]> {
  const [year, classes, stock] = await Promise.all([
    prisma.academicYear.findUnique({ where: { id: yearId }, select: { uniformPrices: true } }),
    prisma.schoolClass.findMany({ where: { archived: false }, orderBy: { order: 'asc' }, select: { id: true, name: true } }),
    prisma.uniformStock.findMany({ where: { yearId } }),
  ]);
  const matrix = (year?.uniformPrices as UniformMatrix | null) || {};
  const className = new Map(classes.map((c) => [c.id, c.name]));
  const onHand = new Map(stock.map((s) => [`${s.itemKey}|${s.classId}|${s.gender}`, s]));

  const rows: StockRow[] = [];
  for (const item of STOCK_ITEMS) {
    const byClass = matrix[item.src]; // coverage from the price-matrix family
    if (!byClass) continue;
    for (const classId of Object.keys(byClass)) {
      if (!className.has(classId)) continue; // stale/removed class
      const cell = byClass[classId] || {};
      // Gendered items expose M and/or F cells; others a single ANY cell.
      const genders: StockGender[] = item.gendered
        ? (['M', 'F'] as StockGender[]).filter((g) => cell[g] != null)
        : (cell.ANY != null ? ['ANY'] : []);
      for (const gender of genders) {
        const s = onHand.get(`${item.key}|${classId}|${gender}`);
        const qty = s?.qty ?? 0;
        const lowThreshold = s?.lowThreshold ?? 0;
        rows.push({
          itemKey: item.key,
          itemName: item.name,
          classId,
          className: className.get(classId) || classId,
          gender,
          price: (cell as any)[gender] ?? null,
          qty,
          lowThreshold,
          // Only "low" once a reorder point is set (else every 0 would flag low).
          low: lowThreshold > 0 && qty <= lowThreshold,
          negative: qty < 0,
        });
      }
    }
  }
  // Item order, then class order (classes already sorted, preserve by re-sorting on className index).
  const classIndex = new Map(classes.map((c, i) => [c.id, i]));
  rows.sort((a, b) =>
    (ITEM_ORDER[a.itemKey] ?? 99) - (ITEM_ORDER[b.itemKey] ?? 99) ||
    (classIndex.get(a.classId) ?? 99) - (classIndex.get(b.classId) ?? 99) ||
    a.gender.localeCompare(b.gender));
  return rows;
}

export interface StockOverview {
  rows: StockRow[];
  matrixConfigured: boolean;   // any priced uniform cells at all
  deductionEnabled: boolean;   // the global gate
}

export async function getStockOverview(yearId: string): Promise<StockOverview> {
  const [rows, settings] = await Promise.all([
    buildSkuRows(yearId),
    prisma.settings.findUnique({ where: { id: 'singleton' }, select: { uniformStockDeductionEnabled: true } }),
  ]);
  return {
    rows,
    matrixConfigured: rows.length > 0,
    deductionEnabled: !!settings?.uniformStockDeductionEnabled,
  };
}

// ---- Phase 2: editing ------------------------------------------------------

// The SKUs that legitimately exist (item × class × gender) for this year — a manual
// edit is only allowed on one of these, so we never create bogus stock rows.
async function validSkus(yearId: string): Promise<Map<string, StockRow>> {
  const rows = await buildSkuRows(yearId);
  return new Map(rows.map((r) => [`${r.itemKey}|${r.classId}|${r.gender}`, r]));
}

const clampInt = (v: unknown, min: number) => Math.max(min, Math.round(Number(v) || 0));

/**
 * Set one SKU's on-hand count and/or reorder point. Setting qty writes a ledger
 * entry for the delta (ADD if it went up, ADJUST if down). Only valid SKUs allowed.
 */
export async function setStockCell(
  yearId: string,
  input: { itemKey: string; classId: string; gender: StockGender; qty?: number; lowThreshold?: number; note?: string | null },
  userId: string | null,
): Promise<{ qty: number; lowThreshold: number }> {
  const key = `${input.itemKey}|${input.classId}|${input.gender}`;
  const valid = await validSkus(yearId);
  if (!valid.has(key)) throw new Error('That uniform / class / gender is not a valid stock line.');

  const existing = await prisma.uniformStock.findUnique({
    where: { yearId_itemKey_classId_gender: { yearId, itemKey: input.itemKey, classId: input.classId, gender: input.gender } },
  });
  const oldQty = existing?.qty ?? 0;
  const newQty = input.qty != null ? clampInt(input.qty, 0) : oldQty; // manual counts never go negative
  const newThreshold = input.lowThreshold != null ? clampInt(input.lowThreshold, 0) : (existing?.lowThreshold ?? 0);

  await prisma.$transaction(async (tx) => {
    await tx.uniformStock.upsert({
      where: { yearId_itemKey_classId_gender: { yearId, itemKey: input.itemKey, classId: input.classId, gender: input.gender } },
      update: { qty: newQty, lowThreshold: newThreshold },
      create: { yearId, itemKey: input.itemKey, classId: input.classId, gender: input.gender, qty: newQty, lowThreshold: newThreshold },
    });
    if (input.qty != null && newQty !== oldQty) {
      await tx.uniformStockLedger.create({
        data: {
          yearId, itemKey: input.itemKey, classId: input.classId, gender: input.gender,
          delta: newQty - oldQty, reason: newQty > oldQty ? 'ADD' : 'ADJUST',
          note: input.note || null, byId: userId,
        },
      });
    }
  });
  return { qty: newQty, lowThreshold: newThreshold };
}

/**
 * Bulk-set a value across every class for one item (optionally one gender). Used to
 * seed counts fast (e.g. "all White Socks = 20"). `field` picks qty or the reorder point.
 */
export async function bulkSetStock(
  yearId: string,
  input: { itemKey: string; gender?: StockGender | 'ALL'; field: 'qty' | 'lowThreshold'; value: number },
  userId: string | null,
): Promise<{ updated: number }> {
  const rows = await buildSkuRows(yearId); // targets are already valid SKUs
  const targets = rows.filter((r) => r.itemKey === input.itemKey && (!input.gender || input.gender === 'ALL' || r.gender === input.gender));
  const value = clampInt(input.value, 0);
  await prisma.$transaction(async (tx) => {
    for (const r of targets) {
      const oldQty = r.qty;
      await tx.uniformStock.upsert({
        where: { yearId_itemKey_classId_gender: { yearId, itemKey: r.itemKey, classId: r.classId, gender: r.gender } },
        update: input.field === 'qty' ? { qty: value } : { lowThreshold: value },
        create: { yearId, itemKey: r.itemKey, classId: r.classId, gender: r.gender, qty: input.field === 'qty' ? value : 0, lowThreshold: input.field === 'lowThreshold' ? value : 0 },
      });
      if (input.field === 'qty' && value !== oldQty) {
        await tx.uniformStockLedger.create({
          data: { yearId, itemKey: r.itemKey, classId: r.classId, gender: r.gender, delta: value - oldQty, reason: value > oldQty ? 'ADD' : 'ADJUST', note: 'Bulk fill', byId: userId },
        });
      }
    }
  });
  return { updated: targets.length };
}

// Traffic-light health of one SKU: red = out (<=0), yellow = low (at/under reorder
// point), green = ok. Out includes negative stock.
export type StockStatus = 'ok' | 'low' | 'out';
export const stockStatus = (r: { qty: number; lowThreshold: number }): StockStatus =>
  r.qty <= 0 ? 'out' : (r.lowThreshold > 0 && r.qty <= r.lowThreshold ? 'low' : 'ok');

export interface StockAnalytics {
  totalOnHand: number;
  skuCount: number;
  lowCount: number;
  negativeCount: number;
  health: { ok: number; low: number; out: number };  // SKU counts by traffic-light state
  byItem: { itemKey: string; itemName: string; onHand: number; sold: number; ok: number; low: number; out: number }[];
  lowStock: StockRow[];        // low or negative, worst first
  sold: { itemKey: string; itemName: string; className: string; gender: StockGender; units: number }[];
  soldTotal: number;
  from: string;
  to: string;
}

// `from`/`to` are yyyy-mm-dd (inclusive). Defaults to the last 90 days.
export async function getStockAnalytics(yearId: string, opts: { from?: string; to?: string } = {}): Promise<StockAnalytics> {
  const rows = await buildSkuRows(yearId);

  const to = opts.to ? new Date(opts.to + 'T23:59:59') : new Date();
  const from = opts.from ? new Date(opts.from + 'T00:00:00') : new Date(Date.now() - 90 * 86400000);

  // Units sold = negative RECEIPT ledger deltas in range.
  const ledger = await prisma.uniformStockLedger.findMany({
    where: { yearId, reason: 'RECEIPT', createdAt: { gte: from, lte: to } },
    select: { itemKey: true, classId: true, gender: true, delta: true },
  });
  const classNameByRow = new Map(rows.map((r) => [`${r.itemKey}|${r.classId}|${r.gender}`, r.className]));
  const soldMap = new Map<string, number>();
  const soldByItem = new Map<string, number>();
  for (const l of ledger) {
    const units = Math.max(0, -l.delta);
    if (!units) continue;
    soldMap.set(`${l.itemKey}|${l.classId}|${l.gender}`, (soldMap.get(`${l.itemKey}|${l.classId}|${l.gender}`) || 0) + units);
    soldByItem.set(l.itemKey, (soldByItem.get(l.itemKey) || 0) + units);
  }

  const byItemMap = new Map<string, { onHand: number; ok: number; low: number; out: number }>();
  const health = { ok: 0, low: 0, out: 0 };
  for (const r of rows) {
    const e = byItemMap.get(r.itemKey) || { onHand: 0, ok: 0, low: 0, out: 0 };
    e.onHand += r.qty;
    const st = stockStatus(r);
    e[st] += 1; health[st] += 1;
    byItemMap.set(r.itemKey, e);
  }
  const byItem = [...new Set([...byItemMap.keys(), ...soldByItem.keys()])]
    .map((itemKey) => {
      const e = byItemMap.get(itemKey);
      return { itemKey, itemName: itemName(itemKey), onHand: e?.onHand ?? 0, sold: soldByItem.get(itemKey) || 0, ok: e?.ok ?? 0, low: e?.low ?? 0, out: e?.out ?? 0 };
    })
    .sort((a, b) => (ITEM_ORDER[a.itemKey] ?? 99) - (ITEM_ORDER[b.itemKey] ?? 99));

  const sold = [...soldMap.entries()]
    .map(([k, units]) => {
      const [itemKey, , gender] = k.split('|');
      return { itemKey, itemName: itemName(itemKey), className: classNameByRow.get(k) || '—', gender: gender as StockGender, units };
    })
    .sort((a, b) => b.units - a.units);

  return {
    totalOnHand: rows.reduce((t, r) => t + r.qty, 0),
    skuCount: rows.length,
    lowCount: rows.filter((r) => r.low && !r.negative).length,
    negativeCount: rows.filter((r) => r.negative).length,
    health,
    byItem,
    lowStock: rows.filter((r) => r.low).sort((a, b) => a.qty - b.qty),
    sold,
    soldTotal: sold.reduce((t, s) => t + s.units, 0),
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}
