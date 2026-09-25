import { VILLAGE_VAN_FEES } from '@/lib/feeStructure';

// Van fee lookup by village name (kept for reference reporting).
export const VILLAGE_FEE_MAP: Record<string, number> = Object.fromEntries(
  VILLAGE_VAN_FEES.map((v) => [v.village, v.fee]),
);

// Drop the trailing " STD" so class labels read "1" not "1 STD".
export function shortClass(name: string | null) {
  return name ? name.replace(/\s?STD$/, '') : '—';
}
