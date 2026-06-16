import { UNIFORM_ITEMS, uniformPrice as staticPrice, CLASS_KEY_BY_ID, type Gender } from '@/lib/feeStructure';

// Editable uniform price matrix, stored on AcademicYear.uniformPrices.
//   { [itemKey]: { [classId]: { M?, F?, ANY? } } }
// Gendered items (school, white) use M/F; the rest use ANY.
export type UniformCell = { M?: number; F?: number; ANY?: number };
export type UniformMatrix = Record<string, Record<string, UniformCell>>;

// Item definitions (key, name, gendered) — the catalogue the matrix prices.
export const UNIFORM_ITEM_DEFS = UNIFORM_ITEMS;

// Build a full matrix from the static file (used to seed the DB the first time).
export function buildDefaultMatrix(classIds: string[]): UniformMatrix {
  const m: UniformMatrix = {};
  for (const it of UNIFORM_ITEMS) {
    m[it.key] = {};
    for (const cid of classIds) {
      if (!CLASS_KEY_BY_ID[cid]) continue;
      if (it.gendered) {
        const M = staticPrice(it.key, cid, 'M');
        const F = staticPrice(it.key, cid, 'F');
        if (M != null || F != null) m[it.key][cid] = { ...(M != null ? { M } : {}), ...(F != null ? { F } : {}) };
      } else {
        const p = staticPrice(it.key, cid, 'M');
        if (p != null) m[it.key][cid] = { ANY: p };
      }
    }
  }
  return m;
}

// Resolve one price: DB matrix first, then the static file as a fallback.
export function priceFromMatrix(
  matrix: UniformMatrix | null | undefined,
  key: string,
  classId: string,
  gender: Gender,
): number | null {
  const item = UNIFORM_ITEMS.find((i) => i.key === key);
  const cell = matrix?.[key]?.[classId];
  if (cell) {
    if (item?.gendered) {
      const v = gender === 'F' ? cell.F : cell.M;
      if (v != null) return v;
    }
    if (cell.ANY != null) return cell.ANY;
  }
  return staticPrice(key, classId, gender);
}

// Applicable items for a student, priced for their class + gender.
export function itemsForFromMatrix(
  matrix: UniformMatrix | null | undefined,
  classId: string,
  gender: Gender,
): { key: string; name: string; gendered: boolean; price: number }[] {
  return UNIFORM_ITEMS
    .map((it) => ({ key: it.key, name: it.name, gendered: it.gendered, price: priceFromMatrix(matrix, it.key, classId, gender) }))
    .filter((it): it is { key: string; name: string; gendered: boolean; price: number } => it.price != null);
}
