// Map a percentage to a configured grade band label.
export interface GradeBandLite { label: string; minPercent: number; maxPercent: number }

export function gradeFor(percent: number | null | undefined, bands: GradeBandLite[]): string | null {
  if (percent == null || !bands.length) return null;
  const p = Math.round(percent * 100) / 100;
  const band = bands.find((b) => p >= b.minPercent && p <= b.maxPercent);
  return band?.label || null;
}
