import { describe, it, expect } from 'vitest';
import { checkUpdateApplied } from '../../../scripts/repair-segment-hygiene-t287';

/**
 * T-287C checker finding (BLOCKING): the original apply loop assigned the
 * UPDATE result and never read it, so `written++` and `'segment corrected'`
 * fired unconditionally even when rowCount=0 — a silent failure that
 * reported 8/8 written while only 5 rows actually landed. This locks in the
 * rowCount-checked guard so the class cannot regress silently again.
 */
describe('checkUpdateApplied', () => {
  const context = { id: 'ipo-1', companyName: 'Cube Highways Trust', field: 'segment' };

  it('returns null (no error) when the UPDATE matched exactly one row', () => {
    expect(checkUpdateApplied({ rowCount: 1 }, context)).toBeNull();
  });

  it('returns null when the UPDATE matched more than one row', () => {
    expect(checkUpdateApplied({ rowCount: 2 }, context)).toBeNull();
  });

  it('returns an error string when rowCount is 0 — the exact silent-failure case from T-287C', () => {
    const error = checkUpdateApplied({ rowCount: 0 }, context);
    expect(error).not.toBeNull();
    expect(error).toContain('matched 0 rows');
    expect(error).toContain(context.companyName);
    expect(error).toContain(context.id);
  });

  it('treats a null rowCount (driver did not report one) as a failure, not a silent pass', () => {
    const error = checkUpdateApplied({ rowCount: null }, context);
    expect(error).not.toBeNull();
  });

  it('treats an undefined rowCount as a failure, not a silent pass', () => {
    const error = checkUpdateApplied({ rowCount: undefined }, context);
    expect(error).not.toBeNull();
  });
});
