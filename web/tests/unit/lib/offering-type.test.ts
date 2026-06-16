import { describe, it, expect } from 'vitest';
import { isRealIPO, REAL_IPO_OFFERING_TYPES } from '@ipodhan/shared/utils/offering-type';
import { offeringTypeEnum } from '@ipodhan/shared/db/schema';

// A1 — the shared genuine-IPO predicate. The de-pollution invariant for every IPO
// surface (listings + detail) depends on this being correct for ALL enum values,
// not just the happy 'IPO' case (load-bearing completeness — dod-verbs.md).
describe('isRealIPO / REAL_IPO_OFFERING_TYPES', () => {
  it('treats IPO as the genuine offering type', () => {
    expect(isRealIPO('IPO')).toBe(true);
  });

  it('excludes EVERY non-IPO offering type in the enum (corporate actions + other offerings)', () => {
    const nonIpoTypes = offeringTypeEnum.enumValues.filter((t) => t !== 'IPO');
    // sanity: the enum really does carry the corporate-action + other-offering types
    expect(nonIpoTypes).toEqual(
      expect.arrayContaining(['FPO', 'RIGHTS', 'OFS', 'NCD', 'INVITS', 'REITS', 'BUYBACK', 'DELISTING', 'TENDER', 'QIP', 'IPP', 'PREFERENTIAL', 'BONDS'])
    );
    for (const t of nonIpoTypes) {
      expect(isRealIPO(t), `${t} must NOT be a real IPO`).toBe(false);
    }
  });

  it('treats null / undefined / empty / unknown as NOT a real IPO (unknown never pollutes IPO surfaces)', () => {
    expect(isRealIPO(null)).toBe(false);
    expect(isRealIPO(undefined)).toBe(false);
    expect(isRealIPO('')).toBe(false);
    expect(isRealIPO('SOMETHING_ELSE')).toBe(false);
  });

  it('REAL_IPO_OFFERING_TYPES is exactly [IPO] (SME IPOs are offering_type=IPO, segment=SME — covered)', () => {
    expect([...REAL_IPO_OFFERING_TYPES]).toEqual(['IPO']);
  });
});
