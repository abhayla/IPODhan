// #394/#343/#73: spec field 13 ipos.sector ranks DOC then CG. The field is not in switchover.json's
// `flipped` list, so the legacy matrix decides the write; a CHITTORGARH write the matrix does not
// list is refused, which is why the walk's sector answer never landed.
import { describe, it, expect } from 'vitest';
import { getSourcePriority } from '../../../src/config/field-priority-matrix.js';

describe('ipos.sector write priority follows spec field 13 (ADMIN > DOC > CG)', () => {
  it('accepts a CHITTORGARH sector write', () => {
    expect(getSourcePriority('sector', 'CHITTORGARH', 'ipos')).toBeGreaterThanOrEqual(0);
  });

  it('a document (DRHP writer source) outranks CHITTORGARH, and ADMIN outranks both', () => {
    const admin = getSourcePriority('sector', 'ADMIN', 'ipos');
    const doc = getSourcePriority('sector', 'DRHP', 'ipos');
    const cg = getSourcePriority('sector', 'CHITTORGARH', 'ipos');
    expect([admin, doc, cg]).toEqual([0, 1, 2]);
  });

  it('BSE and NSE carry no sector and stay unranked', () => {
    expect(getSourcePriority('sector', 'BSE', 'ipos')).toBe(-1);
    expect(getSourcePriority('sector', 'NSE', 'ipos')).toBe(-1);
  });
});
