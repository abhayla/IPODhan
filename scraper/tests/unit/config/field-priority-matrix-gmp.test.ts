import { describe, it, expect } from 'vitest';
import {
  getFieldRules,
  getSourcePriority,
  isTimeBased,
  ignoresDRHP,
} from '../../../src/config/field-priority-matrix.js';

/**
 * A7/G8 — InvestorGain is the real live-GMP source and MUST be registered in the
 * priority matrix for every GMP field, time-based, DRHP-ignoring, range-validated,
 * and ranked above Chittorgarh (which was abandoned as unscrapeable).
 */
const GMP_FIELDS = ['gmp_price', 'gmp_percentage', 'gmpPrice', 'gmpPercentageHistorical'];

describe('GMP field priority matrix — InvestorGain registered', () => {
  for (const field of GMP_FIELDS) {
    it(`${field} lists INVESTORGAIN_GMP as a source`, () => {
      expect(getFieldRules(field).sources).toContain('INVESTORGAIN_GMP');
      expect(getSourcePriority(field, 'INVESTORGAIN_GMP')).toBeGreaterThanOrEqual(0);
    });

    it(`${field} is time-based and ignores DRHP`, () => {
      expect(isTimeBased(field)).toBe(true);
      expect(ignoresDRHP(field)).toBe(true);
    });

    it(`${field} has a numeric validation range`, () => {
      const v = getFieldRules(field).validation;
      expect(v).toBeDefined();
      expect(typeof v!.min).toBe('number');
      expect(typeof v!.max).toBe('number');
    });
  }

  it('InvestorGain ranks above Chittorgarh for gmp_price (real specialist)', () => {
    expect(getSourcePriority('gmp_price', 'INVESTORGAIN_GMP')).toBeLessThan(
      getSourcePriority('gmp_price', 'CHITTORGARH'),
    );
  });
});
