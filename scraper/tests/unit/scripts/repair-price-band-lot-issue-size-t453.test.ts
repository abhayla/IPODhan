import { describe, it, expect } from 'vitest';
import { deriveIssueSizeRupees } from '../../../scripts/repair-price-band-lot-issue-size-t453.js';

/**
 * #453: Manika Plastech's issue_size was frozen at a pre-band draft value
 * (fresh amount + OFS shares x the price-band FLOOR) instead of the
 * market-convention headline figure (fresh amount + OFS shares x the
 * price-band CAP). This is the pure derivation the repair tool uses to
 * compute the corrected value — unit-tested in isolation so a future class
 * member's re-derivation trigger can reuse it without re-deriving the
 * arithmetic from memory.
 */
describe('deriveIssueSizeRupees — fresh amount + OFS shares x band cap', () => {
  it('matches the stale stored value when driven at the band FLOOR (regression check on real numbers)', () => {
    // Manika Plastech's actual stored issue_size (1,231,976,720.00) was
    // derived at the band floor (Rs 40) — reproducing it here proves the
    // formula, not just a made-up example.
    const freshIssueRupees = 925_000_000; // Rs 92.5 Cr
    const ofsShares = 7_674_418;
    const bandFloor = 40;
    expect(deriveIssueSizeRupees(freshIssueRupees, ofsShares, bandFloor)).toBe(1_231_976_720);
  });

  it('derives the corrected value at the band CAP (the market-convention headline figure)', () => {
    const freshIssueRupees = 925_000_000; // Rs 92.5 Cr
    const ofsShares = 7_674_418; // NSE ipo-detail: OFS of up to 7,674,418 equity shares
    const bandCap = 43;
    // 925,000,000 + 7,674,418 * 43 = 925,000,000 + 329,999,974 = 1,254,999,974
    expect(deriveIssueSizeRupees(freshIssueRupees, ofsShares, bandCap)).toBe(1_254_999_974);
  });

  it('throws on a non-finite or non-positive input rather than silently returning NaN/0', () => {
    expect(() => deriveIssueSizeRupees(Number.NaN, 100, 40)).toThrow();
    expect(() => deriveIssueSizeRupees(100, 0, 40)).toThrow();
    expect(() => deriveIssueSizeRupees(100, 100, 0)).toThrow();
  });
});
