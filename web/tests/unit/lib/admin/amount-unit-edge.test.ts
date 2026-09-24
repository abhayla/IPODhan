// F-156 / item 11: the admin edge that converts the OD-67 rupee columns to/from the crore-scale
// values field-labels.ts and dynamic-validation-rules.ts show/validate.
//
// Property test (defect-fix-contract.md item 5): feed the edge conversion the min and max REAL
// rupee values actually present in staging for ipos.issue_size, and assert the resulting crore
// value does NOT trip the "exceeds ₹1 lakh crores" warning at web/lib/admin/dynamic-validation-
// rules.ts's issueSize validator threshold (100000), and that the conversion actually changes the
// number (rupees !== crore for every real-scale value) rather than being a no-op that would mask
// the original defect (F-156: the admin thought it was reading crores while the DB held rupees).
import { describe, it, expect } from 'vitest';
import {
  rupeesToDisplayCrore,
  croreToStoredRupees,
  applyCroreEdgeForDisplay,
  applyCroreEdgeForSave,
} from '@/lib/admin/amount-unit-edge';
import { customValidationRules } from '@/lib/admin/dynamic-validation-rules';

// Real staging values for ipos.issue_size measured 2026-09-24 (F-156): min, a mid-range row, and
// the current max.
const REAL_STAGING_RUPEES = [50000.0, 10000000000.0, 265796400000.0, 7329740494.0];

describe('amount-unit-edge (F-156 admin crore/rupee edge)', () => {
  it('converts stored rupees to a materially different display crore value for every real value', () => {
    for (const rupees of REAL_STAGING_RUPEES) {
      const crore = rupeesToDisplayCrore(rupees);
      expect(crore).not.toBeNull();
      // A real edge discriminates: the two representations differ by exactly 1e7, never equal.
      expect(crore).not.toBe(rupees);
      expect(crore! * 10_000_000).toBeCloseTo(rupees, 2);
    }
  });

  it('round-trips every real value exactly (display then save) — no re-save drift', () => {
    for (const rupees of REAL_STAGING_RUPEES) {
      const crore = rupeesToDisplayCrore(rupees);
      const back = croreToStoredRupees(crore);
      expect(back).toBe(rupees);
    }
  });

  it('none of the real rupee values trip the crore-scale "exceeds ₹1 lakh crores" warning once converted', () => {
    const issueSizeValidator = customValidationRules.ipos.issueSize;
    for (const rupees of REAL_STAGING_RUPEES) {
      const crore = rupeesToDisplayCrore(rupees)!;
      const result = issueSizeValidator(crore);
      expect(result.valid).toBe(true);
      expect(result.warning ?? '').not.toMatch(/exceeds ₹1 lakh crores/);
    }
  });

  it('the largest real value WOULD wrongly trip the warning if the raw rupee value were validated unconverted (proves the edge is load-bearing)', () => {
    const issueSizeValidator = customValidationRules.ipos.issueSize;
    const rawRupees = 265796400000.0; // unconverted — what the admin used to see/save
    const result = issueSizeValidator(rawRupees);
    expect(result.warning).toMatch(/exceeds ₹1 lakh crores/);
  });

  it('applyCroreEdgeForDisplay/applyCroreEdgeForSave only touch ipos.issueSize, leaving other fields untouched', () => {
    const displayed = applyCroreEdgeForDisplay('ipos', {
      issueSize: 7329740494.0,
      companyName: 'Acme',
      lotSize: 100,
    });
    expect(displayed.issueSize).toBeCloseTo(732.9740494, 6);
    expect(displayed.companyName).toBe('Acme');
    expect(displayed.lotSize).toBe(100);

    const saved = applyCroreEdgeForSave('ipos', displayed);
    expect(saved.issueSize).toBe(7329740494.0);

    // A different table's data is passed through unchanged.
    const other = applyCroreEdgeForDisplay('financialData', { revenueFy2024: 1800 });
    expect(other.revenueFy2024).toBe(1800);
  });

  it('handles null/undefined/empty without throwing', () => {
    expect(rupeesToDisplayCrore(null)).toBeNull();
    expect(rupeesToDisplayCrore(undefined)).toBeNull();
    expect(rupeesToDisplayCrore('')).toBeNull();
    expect(croreToStoredRupees(null)).toBeNull();
  });
});
