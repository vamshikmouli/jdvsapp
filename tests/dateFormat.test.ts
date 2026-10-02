import { describe, it, expect } from 'vitest';
import { fmtDate, fmtDateTime, fmtDayMonth, fmtDateWeekday, fmtTime } from '@/lib/dateFormat';

describe('date format 02-Oct-2026', () => {
  it('plain dates (no timezone shift)', () => {
    expect(fmtDate('2026-10-02')).toBe('02-Oct-2026');
    expect(fmtDayMonth('2026-01-05')).toBe('05-Jan');
    expect(fmtDateWeekday('2026-10-02')).toBe('Fri, 02-Oct-2026');
    expect(fmtDateWeekday('2026-10-02', true)).toBe('Friday, 02-Oct-2026');
  });
  it('timestamps are shown in India time', () => {
    // 20:00 UTC on 1 Oct = 01:30 IST on 2 Oct
    expect(fmtDate('2026-10-01T20:00:00.000Z')).toBe('02-Oct-2026');
    expect(fmtDateTime('2026-10-02T16:14:00.000Z')).toBe('02-Oct-2026, 09:44 PM');
    expect(fmtTime('2026-10-02T06:30:00.000Z')).toBe('12:00 PM');
    expect(fmtTime('2026-10-01T18:40:00.000Z')).toBe('12:10 AM');
  });
  it('empty / bad input → empty string', () => {
    expect(fmtDate(null)).toBe('');
    expect(fmtDate('')).toBe('');
    expect(fmtDate('not a date')).toBe('');
  });
});
