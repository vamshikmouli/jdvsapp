import { describe, it, expect } from 'vitest';
import { classifyNet, fmtMbps } from '@/lib/netSpeed';

describe('net speed', () => {
  it('rates the connection', () => {
    expect(classifyNet(20, 60).label).toBe('Fast');
    expect(classifyNet(3, 120).label).toBe('OK');
    expect(classifyNet(20, 450).label).toBe('OK');
    expect(classifyNet(0.4, 200).label).toBe('Slow');
    expect(classifyNet(null, 1200).label).toBe('Slow');
  });
  it('formats speed', () => {
    expect(fmtMbps(0.35)).toBe('350 Kbps');
    expect(fmtMbps(4.27)).toBe('4.3 Mbps');
    expect(fmtMbps(48.6)).toBe('49 Mbps');
  });
});
