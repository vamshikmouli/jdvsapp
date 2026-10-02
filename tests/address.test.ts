import { describe, it, expect } from 'vitest';
import { buildAddress } from '@/lib/address';

describe('buildAddress — Aadhaar style', () => {
  it('son / daughter of father, village, taluk, district, state', () => {
    expect(buildAddress({ gender: 'M', fatherName: 'Ramesh Kumar', village: 'Hosahalli', taluk: 'Kunigal', district: 'Tumakuru' }))
      .toBe('S/O: Ramesh Kumar,\nHosahalli, Kunigal (T),\nTumakuru (D), Karnataka');
    expect(buildAddress({ gender: 'F', fatherName: 'Ramesh', village: 'Hosahalli' }))
      .toBe('D/O: Ramesh,\nHosahalli,\nKarnataka');
  });
  it('falls back to guardian as C/O, skips empty parts, nothing without a place', () => {
    expect(buildAddress({ gender: 'M', guardianName: 'Suma', district: 'Tumakuru' })).toBe('C/O: Suma,\nTumakuru (D), Karnataka');
    expect(buildAddress({ gender: 'M', fatherName: 'Ramesh' })).toBe('');
  });
});
