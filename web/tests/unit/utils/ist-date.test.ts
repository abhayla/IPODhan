import { describe, it, expect } from 'vitest';
import { istDateIso } from '@/lib/utils/ist-date';

/**
 * GitHub #682 — the IST calendar-day helper the status updater now uses
 * instead of `now.toISOString().split('T')[0]` (the UTC calendar day).
 */
describe('istDateIso', () => {
  it('23:59:59Z rolls to the NEXT IST day (UTC day end is deep into the next IST day)', () => {
    // 2026-09-15T23:59:59Z = 2026-09-16 05:29:59 IST
    expect(istDateIso(new Date('2026-09-15T23:59:59Z'))).toBe('2026-09-16');
  });

  it('18:29:59Z is still the SAME UTC day (one second before the IST midnight boundary)', () => {
    // 2026-09-15T18:29:59Z = 2026-09-15 23:59:59 IST
    expect(istDateIso(new Date('2026-09-15T18:29:59Z'))).toBe('2026-09-15');
  });

  it('18:30:00Z crosses to the NEXT IST day (IST midnight)', () => {
    // 2026-09-15T18:30:00Z = 2026-09-16 00:00:00 IST
    expect(istDateIso(new Date('2026-09-15T18:30:00Z'))).toBe('2026-09-16');
  });
});
