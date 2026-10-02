// Map a percentage to a configured grade band label.
export interface GradeBandLite { label: string; minPercent: number; maxPercent: number }

export function gradeFor(percent: number | null | undefined, bands: GradeBandLite[]): string | null {
  if (percent == null || !bands.length) return null;
  const p = Math.round(percent * 100) / 100;
  const band = bands.find((b) => p >= b.minPercent && p <= b.maxPercent);
  return band?.label || null;
}

/** Grade label for marks out of max (null when not gradable). */
export function gradeOfMarks(marks: number | null | undefined, max: number, bands: GradeBandLite[]): string | null {
  if (marks == null || !(max > 0)) return null;
  return gradeFor((marks / max) * 100, bands);
}

/**
 * Grade-only subjects are entered as a grade but stored as marks: the lowest whole
 * mark (out of max) that falls in that grade's band, so reports derive exactly the
 * grade that was entered. null when the label isn't on the scale.
 */
export function marksForGrade(label: string, max: number, bands: GradeBandLite[]): number | null {
  const want = normGrade(label);
  const band = bands.find((b) => normGrade(b.label) === want);
  if (!band || !(max > 0)) return null;
  for (let m = Math.max(0, Math.floor((band.minPercent * max) / 100) - 1); m <= max; m++) {
    if (normGrade(gradeOfMarks(m, max, bands) || '') === want) return m;
  }
  return null;
}

/** Compare grade labels ignoring case / spaces ("a 1" = "A1", "a+" = "A+"). */
export function normGrade(s: string): string {
  return s.toUpperCase().replace(/\s+/g, '');
}
