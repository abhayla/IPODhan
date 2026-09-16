import { describe, it, expect } from 'vitest';
import { istDayIso } from './ist-day';

describe('istDayIso', () => {
  it('rolls over to the IST day before midnight UTC (23:31 UTC = 05:01 IST next day)', () => {
    expect(istDayIso(new Date('2026-09-15T23:31:00Z'))).toBe('2026-09-16');
  });

  it('stays on the previous IST day right at UTC midnight (00:00 UTC = 05:30 IST same day)', () => {
    expect(istDayIso(new Date('2026-09-16T00:00:00Z'))).toBe('2026-09-16');
  });

  it('is still "yesterday" in IST just before the 5:30am rollover (02:00 UTC = 07:30 IST)', () => {
    // Regression instant for #687 slice 3: 2026-09-15T20:30:00Z is 02:00 IST
    // 16-Sep — the UTC day (`toISOString().split('T')[0]`) reads 2026-09-15,
    // one day behind the real IST calendar day.
    expect(istDayIso(new Date('2026-09-15T20:30:00Z'))).toBe('2026-09-16');
  });
});
