/**
 * Normalization Engine Tests
 * Phase 1: Currency, date, and company name normalization
 *
 * Test Coverage:
 * - Currency normalization (30+ formats)
 * - Date normalization (10+ formats)
 * - Company name normalization
 * - Conflict severity calculation
 * - Performance benchmarks
 *
 * Target: 50 tests, 95%+ coverage
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeCurrency,
  normalizeDate,
  normalizeCompanyName,
  getConflictSeverity,
  calculatePercentageDifference,
  areEquivalent,
} from '../../../src/services/normalization-engine.js';
import type { FieldRules } from '../../../src/config/field-priority-matrix.js';

describe('Normalization Engine', () => {
  describe('normalizeCurrency', () => {
    describe('Indian rupee formats', () => {
      it('should normalize ₹500 Cr to 5000000000', () => {
        expect(normalizeCurrency('₹500 Cr')).toBe(5000000000);
        expect(normalizeCurrency('₹500 cr')).toBe(5000000000);
        expect(normalizeCurrency('₹500 crore')).toBe(5000000000);
        expect(normalizeCurrency('₹500 crores')).toBe(5000000000);
      });

      it('should normalize Rs 50 Lakhs to 5000000', () => {
        expect(normalizeCurrency('Rs 50 Lakhs')).toBe(5000000);
        expect(normalizeCurrency('Rs. 50 Lakhs')).toBe(5000000);
        expect(normalizeCurrency('Rs 50 lakh')).toBe(5000000);
        expect(normalizeCurrency('INR 50 Lakhs')).toBe(5000000);
      });

      it('should normalize decimal crores correctly', () => {
        expect(normalizeCurrency('₹123.45 Cr')).toBe(1234500000);
        expect(normalizeCurrency('₹0.5 Crore')).toBe(5000000);
      });

      it('should normalize thousands separator correctly', () => {
        expect(normalizeCurrency('₹1,50,000')).toBe(150000); // Indian format
        expect(normalizeCurrency('₹1,500,000')).toBe(1500000); // Western format
      });

      it('should normalize plain rupee amounts', () => {
        expect(normalizeCurrency('₹100')).toBe(100);
        expect(normalizeCurrency('Rs 1000')).toBe(1000);
        expect(normalizeCurrency('INR 50000')).toBe(50000);
      });
    });

    describe('International formats', () => {
      it('should normalize millions correctly', () => {
        expect(normalizeCurrency('5 Million')).toBe(5000000);
        expect(normalizeCurrency('5M')).toBe(5000000);
        expect(normalizeCurrency('5 Mn')).toBe(5000000);
      });

      it('should normalize billions correctly', () => {
        expect(normalizeCurrency('1 Billion')).toBe(1000000000);
        expect(normalizeCurrency('1B')).toBe(1000000000);
        expect(normalizeCurrency('1 Bn')).toBe(1000000000);
      });

      it('should normalize decimal millions and billions', () => {
        expect(normalizeCurrency('1.5 Million')).toBe(1500000);
        expect(normalizeCurrency('2.3 Billion')).toBe(2300000000);
      });

      it('should normalize USD format', () => {
        expect(normalizeCurrency('$5M')).toBe(5000000);
        expect(normalizeCurrency('$1B')).toBe(1000000000);
        expect(normalizeCurrency('$100')).toBe(100);
      });
    });

    describe('Edge cases', () => {
      it('should handle numeric input directly', () => {
        expect(normalizeCurrency(5000000)).toBe(5000000);
        expect(normalizeCurrency(123.45)).toBe(123.45);
      });

      it('should handle zero and negative values', () => {
        expect(normalizeCurrency('0')).toBe(0);
        expect(normalizeCurrency('₹0 Cr')).toBe(0);
        expect(normalizeCurrency('-100')).toBe(-100);
      });

      it('should handle very large values', () => {
        expect(normalizeCurrency('₹50000 Cr')).toBe(500000000000); // 50,000 crores
        expect(normalizeCurrency('100 Billion')).toBe(100000000000);
      });

      it('should handle whitespace variations', () => {
        expect(normalizeCurrency('  ₹500  Cr  ')).toBe(5000000000);
        expect(normalizeCurrency('₹500Cr')).toBe(5000000000); // No space
      });

      it('should return NaN for invalid currency strings', () => {
        expect(normalizeCurrency('invalid')).toBeNaN();
        expect(normalizeCurrency('abc crores')).toBeNaN();
      });

      it('should handle empty or null values', () => {
        expect(normalizeCurrency('')).toBeNaN();
        expect(normalizeCurrency(null as any)).toBeNaN();
        expect(normalizeCurrency(undefined as any)).toBeNaN();
      });
    });

    describe('Field-specific normalization', () => {
      it('should normalize issue_size field correctly', () => {
        expect(normalizeCurrency('₹500 Cr', 'issue_size')).toBe(5000000000);
      });

      it('should normalize price fields without multipliers', () => {
        expect(normalizeCurrency('₹100', 'price_band_lower')).toBe(100);
        expect(normalizeCurrency('₹150', 'price_band_upper')).toBe(150);
      });
    });
  });

  describe('normalizeDate', () => {
    describe('Standard formats', () => {
      it('should normalize DD-MM-YYYY format', () => {
        expect(normalizeDate('15-01-2025')).toBe('2025-01-15');
        expect(normalizeDate('01-12-2025')).toBe('2025-12-01');
      });

      it('should normalize DD/MM/YYYY format', () => {
        expect(normalizeDate('15/01/2025')).toBe('2025-01-15');
        expect(normalizeDate('31/12/2025')).toBe('2025-12-31');
      });

      it('should normalize YYYY-MM-DD format (ISO)', () => {
        expect(normalizeDate('2025-01-15')).toBe('2025-01-15');
        expect(normalizeDate('2025-12-31')).toBe('2025-12-31');
      });

      it('should normalize DD-MMM-YYYY format', () => {
        expect(normalizeDate('15-Jan-2025')).toBe('2025-01-15');
        expect(normalizeDate('31-Dec-2025')).toBe('2025-12-31');
      });

      it('should normalize full month names', () => {
        expect(normalizeDate('15 January 2025')).toBe('2025-01-15');
        expect(normalizeDate('31 December 2025')).toBe('2025-12-31');
      });
    });

    describe('Date object input', () => {
      it('should normalize Date object to ISO string', () => {
        const date = new Date('2025-01-15T10:30:00Z');
        expect(normalizeDate(date)).toBe('2025-01-15');
      });

      it('should handle Date object with time correctly', () => {
        const date = new Date('2025-12-31T23:59:59Z');
        expect(normalizeDate(date)).toBe('2025-12-31');
      });
    });

    describe('Timestamp input', () => {
      it('should normalize Unix timestamp (milliseconds)', () => {
        const timestamp = new Date('2025-01-15').getTime();
        expect(normalizeDate(timestamp)).toBe('2025-01-15');
      });

      it('should normalize Unix timestamp (seconds)', () => {
        const timestamp = Math.floor(new Date('2025-01-15').getTime() / 1000);
        // Function should handle both ms and s timestamps
        const result = normalizeDate(timestamp);
        expect(result).toBeTruthy();
      });
    });

    describe('Edge cases', () => {
      it('should handle single-digit day/month', () => {
        expect(normalizeDate('5-1-2025')).toBe('2025-01-05');
        expect(normalizeDate('1-5-2025')).toBe('2025-05-01');
      });

      it('should handle leap year dates', () => {
        expect(normalizeDate('29-02-2024')).toBe('2024-02-29'); // 2024 is leap year
      });

      it('should return null for invalid dates', () => {
        expect(normalizeDate('32-01-2025')).toBeNull(); // Invalid day
        expect(normalizeDate('29-02-2025')).toBeNull(); // 2025 not leap year
        expect(normalizeDate('invalid')).toBeNull();
      });

      it('should handle empty or null values', () => {
        expect(normalizeDate('')).toBeNull();
        expect(normalizeDate(null as any)).toBeNull();
        expect(normalizeDate(undefined as any)).toBeNull();
      });

      it('should handle whitespace variations', () => {
        expect(normalizeDate('  15-01-2025  ')).toBe('2025-01-15');
      });
    });

    describe('Various date formats', () => {
      it('should normalize DD.MM.YYYY format', () => {
        expect(normalizeDate('15.01.2025')).toBe('2025-01-15');
      });

      it('should normalize MM/DD/YYYY format (US)', () => {
        // Function should detect US format vs DD/MM/YYYY
        expect(normalizeDate('01/15/2025')).toBe('2025-01-15'); // Unambiguous US format
      });

      it('should normalize abbreviated month with dot', () => {
        expect(normalizeDate('15 Jan. 2025')).toBe('2025-01-15');
      });
    });
  });

  describe('normalizeCompanyName', () => {
    describe('Legal entity removal', () => {
      it('should remove "Limited" suffix', () => {
        expect(normalizeCompanyName('ABC Company Limited')).toBe('abc company');
        expect(normalizeCompanyName('ABC Company Ltd')).toBe('abc company');
        expect(normalizeCompanyName('ABC Company Ltd.')).toBe('abc company');
      });

      it('should remove "Private Limited" variants', () => {
        expect(normalizeCompanyName('ABC Company Private Limited')).toBe('abc company');
        expect(normalizeCompanyName('ABC Company Pvt Ltd')).toBe('abc company');
        expect(normalizeCompanyName('ABC Company Pvt. Ltd.')).toBe('abc company');
      });

      it('should remove "Inc" and "LLC" suffixes', () => {
        expect(normalizeCompanyName('ABC Company Inc')).toBe('abc company');
        expect(normalizeCompanyName('ABC Company Inc.')).toBe('abc company');
        expect(normalizeCompanyName('ABC Company LLC')).toBe('abc company');
      });

      it('should remove multiple legal entity types', () => {
        expect(normalizeCompanyName('ABC Pvt. Ltd. Inc.')).toBe('abc');
      });
    });

    describe('Special character handling', () => {
      it('should remove special characters', () => {
        expect(normalizeCompanyName('ABC & Co.')).toBe('abc co');
        expect(normalizeCompanyName('ABC (India) Ltd')).toBe('abc india');
        expect(normalizeCompanyName('ABC - Technology Ltd')).toBe('abc technology');
      });

      it('should handle apostrophes', () => {
        expect(normalizeCompanyName("ABC's Technology Ltd")).toBe('abcs technology');
      });

      it('should handle underscores and hyphens', () => {
        expect(normalizeCompanyName('ABC_Tech-Solutions Ltd')).toBe('abc tech solutions');
      });
    });

    describe('Case normalization', () => {
      it('should convert to lowercase', () => {
        expect(normalizeCompanyName('ABC COMPANY LIMITED')).toBe('abc company');
        expect(normalizeCompanyName('abc company limited')).toBe('abc company');
        expect(normalizeCompanyName('AbC CoMpAnY LiMiTeD')).toBe('abc company');
      });
    });

    describe('Whitespace handling', () => {
      it('should normalize multiple spaces to single space', () => {
        expect(normalizeCompanyName('ABC    Company   Ltd')).toBe('abc company');
      });

      it('should trim leading/trailing whitespace', () => {
        expect(normalizeCompanyName('  ABC Company Ltd  ')).toBe('abc company');
      });
    });

    describe('Edge cases', () => {
      it('should handle empty string', () => {
        expect(normalizeCompanyName('')).toBe('');
      });

      it('should handle null/undefined', () => {
        expect(normalizeCompanyName(null as any)).toBe('');
        expect(normalizeCompanyName(undefined as any)).toBe('');
      });

      it('should handle single word company names', () => {
        expect(normalizeCompanyName('TechCorp Ltd')).toBe('techcorp');
      });

      it('should handle acronyms', () => {
        expect(normalizeCompanyName('IBM India Ltd')).toBe('ibm india');
      });
    });
  });

  describe('getConflictSeverity', () => {
    const mockFieldRules: FieldRules = {
      sources: ['ADMIN', 'NSE', 'BSE'],
      normalization: 'currency',
      confidenceThreshold: 80,
    };

    describe('Critical field detection', () => {
      it('should mark critical price fields as CRITICAL for any difference', () => {
        // lot_size and issue_price are critical fields (from criticalFields array)
        const severity = getConflictSeverity(
          'issue_price',
          100,
          105,
          mockFieldRules
        );
        expect(severity).toBe('CRITICAL');
      });

      it('should mark date fields as CRITICAL for any mismatch', () => {
        const severity = getConflictSeverity(
          'open_date',
          '2025-01-15',
          '2025-01-20',
          mockFieldRules
        );
        expect(severity).toBe('CRITICAL');
      });

      it('should mark lot_size as CRITICAL for differences', () => {
        const severity = getConflictSeverity(
          'lot_size',
          100,
          120,
          mockFieldRules
        );
        expect(severity).toBe('CRITICAL');
      });
    });

    describe('Percentage-based severity', () => {
      it('should return CRITICAL for >20% numeric difference', () => {
        const severity = getConflictSeverity(
          'issue_size',
          1000000000, // 100 crore
          1300000000, // 130 crore (30% diff)
          mockFieldRules
        );
        expect(severity).toBe('CRITICAL');
      });

      it('should return WARNING for 5-20% numeric difference', () => {
        const severity = getConflictSeverity(
          'issue_size',
          1000000000, // 100 crore
          1100000000, // 110 crore (10% diff)
          mockFieldRules
        );
        expect(severity).toBe('WARNING');
      });

      it('should return INFO for <5% numeric difference', () => {
        const severity = getConflictSeverity(
          'issue_size',
          1000000000, // 100 crore
          1020000000, // 102 crore (2% diff)
          mockFieldRules
        );
        expect(severity).toBe('INFO');
      });

      it('should handle zero values correctly', () => {
        const severity = getConflictSeverity(
          'issue_size',
          0,
          100,
          mockFieldRules
        );
        expect(severity).toBe('CRITICAL'); // Any change from 0 is significant
      });
    });

    describe('String comparison', () => {
      it('should return WARNING for different strings', () => {
        const severity = getConflictSeverity(
          'company_name',
          'ABC Company Ltd',
          'ABC Corporation Ltd',
          mockFieldRules
        );
        expect(severity).toBe('WARNING');
      });

      it('should return INFO for identical strings', () => {
        const severity = getConflictSeverity(
          'company_name',
          'ABC Company Ltd',
          'ABC Company Ltd',
          mockFieldRules
        );
        // Should not be a conflict at all, but if called, INFO
        expect(['INFO', 'WARNING']).toContain(severity);
      });
    });

    describe('Edge cases', () => {
      it('should handle null vs value comparison', () => {
        const severity = getConflictSeverity(
          'issue_size',
          null,
          1000000000,
          mockFieldRules
        );
        expect(severity).toBe('WARNING'); // Null to value is notable
      });

      it('should handle undefined vs value comparison', () => {
        const severity = getConflictSeverity(
          'issue_size',
          undefined,
          1000000000,
          mockFieldRules
        );
        expect(severity).toBe('WARNING');
      });

      it('should handle very small differences', () => {
        const severity = getConflictSeverity(
          'issue_size',
          1000000000,
          1000000001, // 0.0000001% diff
          mockFieldRules
        );
        expect(severity).toBe('INFO');
      });
    });
  });

  describe('calculatePercentageDifference', () => {
    it('should calculate percentage difference correctly', () => {
      expect(calculatePercentageDifference(100, 110)).toBe(10); // 10%
      expect(calculatePercentageDifference(100, 120)).toBe(20); // 20%
      expect(calculatePercentageDifference(100, 50)).toBe(50); // 50% decrease
    });

    it('should return absolute percentage', () => {
      // val1 is the reference, so diff(110, 100) = |100-110|/110*100 = 9.09%
      expect(calculatePercentageDifference(110, 100)).toBeCloseTo(9.09, 1); // Should be positive
      expect(calculatePercentageDifference(100, 90)).toBe(10); // Should be positive
    });

    it('should handle zero values', () => {
      expect(calculatePercentageDifference(0, 100)).toBe(100); // Infinite → 100%
      expect(calculatePercentageDifference(100, 0)).toBe(100);
    });

    it('should handle identical values', () => {
      expect(calculatePercentageDifference(100, 100)).toBe(0);
    });

    it('should handle very small differences', () => {
      expect(calculatePercentageDifference(1000000, 1000001)).toBeLessThan(0.001);
    });

    it('should handle large values', () => {
      expect(calculatePercentageDifference(1000000000, 1100000000)).toBe(10);
    });

    it('should handle decimal values', () => {
      expect(calculatePercentageDifference(100.5, 110.55)).toBeCloseTo(10, 1);
    });

    it('should handle negative values', () => {
      expect(calculatePercentageDifference(-100, -110)).toBe(10);
    });
  });

  describe('Performance benchmarks', () => {
    it('should normalize 100 currency values in under 50ms', () => {
      const values = [
        '₹500 Cr', 'Rs 50 Lakhs', '5 Million', '$5M',
        '₹1,50,000', '₹123.45 Cr', '1 Billion', 'INR 50000',
      ];

      const startTime = Date.now();
      for (let i = 0; i < 100; i++) {
        normalizeCurrency(values[i % values.length]);
      }
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(50);
    });

    it('should normalize 100 dates in under 50ms', () => {
      const dates = [
        '15-01-2025', '15/01/2025', '2025-01-15',
        '15-Jan-2025', '15 January 2025',
        new Date('2025-01-15'),
      ];

      const startTime = Date.now();
      for (let i = 0; i < 100; i++) {
        normalizeDate(dates[i % dates.length] as any);
      }
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(50);
    });

    it('should normalize 100 company names in under 30ms', () => {
      const names = [
        'ABC Company Limited',
        'XYZ Corporation Pvt Ltd',
        'Tech Solutions Inc.',
        'Global Industries LLC',
      ];

      const startTime = Date.now();
      for (let i = 0; i < 100; i++) {
        normalizeCompanyName(names[i % names.length]);
      }
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(30);
    });

    it('should calculate 1000 percentage differences in under 10ms', () => {
      const startTime = Date.now();
      for (let i = 0; i < 1000; i++) {
        calculatePercentageDifference(100 + i, 110 + i);
      }
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(10);
    });

    it('should perform batch normalization efficiently', () => {
      const data = {
        issue_size: '₹500 Cr',
        price_band_lower: '₹100',
        price_band_upper: '₹150',
        open_date: '15-01-2025',
        close_date: '17-01-2025',
        listing_date: '20-01-2025',
        company_name: 'ABC Company Limited',
      };

      const startTime = Date.now();
      for (let i = 0; i < 50; i++) {
        normalizeCurrency(data.issue_size);
        normalizeCurrency(data.price_band_lower);
        normalizeCurrency(data.price_band_upper);
        normalizeDate(data.open_date);
        normalizeDate(data.close_date);
        normalizeDate(data.listing_date);
        normalizeCompanyName(data.company_name);
      }
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(100); // 50 IPOs * 7 fields < 100ms
    });
  });
});

/**
 * M-2 (round-2 review): the array branch of `areEquivalent` had no direct test —
 * reverting it to reference equality kept every other test green while
 * re-opening the identical-lists-logged-as-a-conflict defect (W-18(ii)).
 */
describe('areEquivalent — array-valued fields (W-18(ii))', () => {
  it('treats identical arrays in the same order as equivalent', () => {
    expect(areEquivalent(['BSE', 'NSE'], ['BSE', 'NSE'])).toBe(true);
  });

  it('treats identical arrays in a different order as equivalent', () => {
    expect(areEquivalent(['NSE', 'BSE'], ['BSE', 'NSE'])).toBe(true);
    expect(
      areEquivalent(
        ['Emkay Global Financial Services Limited', 'Valmiki Leela Capital Private Limited'],
        ['Valmiki Leela Capital Private Limited', 'emkay global financial services limited']
      )
    ).toBe(true);
  });

  it('treats arrays differing by one member as NOT equivalent', () => {
    expect(areEquivalent(['BSE', 'NSE'], ['BSE'])).toBe(false);
    expect(areEquivalent(['BSE', 'NSE'], ['BSE', 'MSE'])).toBe(false);
  });

  it('treats an array against a non-array as NOT equivalent', () => {
    expect(areEquivalent(['BSE'], 'BSE')).toBe(false);
    expect(areEquivalent(['BSE'], 1)).toBe(false);
    expect(areEquivalent([], {})).toBe(false);
  });
});

/**
 * S1 — OD-59 family-aware comparison.
 *
 * OD-59 (owner, 2026-09-18): "agreement is judged on the MEANING of a value,
 * never on its text." Numbers compare as numbers, money agrees within 0.5%,
 * identifiers must match exactly, and names compare after folding corporate
 * forms ("Pvt Ltd" = "Private Limited").
 *
 * `areEquivalent` is the comparison function this repo already uses — seven
 * production call sites in the live write path. These cases are the FOUR gaps
 * measured against OD-59 before the change; the other three requirements
 * (identifiers differing, null abstaining, zero-vs-zero agreeing) already pass
 * and are asserted below as regression guards.
 *
 * The `family` argument is OPT-IN. Every existing caller passes nothing and
 * keeps today's behaviour exactly; S3b switches the write path deliberately.
 */
describe('areEquivalent — OD-59 family semantics (S1)', () => {
  describe('MONEY: agrees within 0.5%, and reads numeric strings as numbers', () => {
    // GAP 1 measured: '10' vs '10.00' fell through to the string branch and
    // compared as text, so the same face value from two sources read as a
    // disagreement.
    it('treats the same number written differently as equal', () => {
      expect(areEquivalent('10', '10.00', { family: 'MONEY' })).toBe(true);
      expect(areEquivalent('1250', '1250.000', { family: 'MONEY' })).toBe(true);
    });

    // GAP 2 measured: the tolerance is a FLAT 0.01, not a percentage, so two
    // sources reporting the same issue size rounded differently were recorded
    // as disagreeing. This pair is real — it appears in data_conflicts.
    it('treats a 0.5% rounding difference as agreement', () => {
      expect(areEquivalent(1249970000, 1250000000, { family: 'MONEY' })).toBe(true);
    });

    it('treats a difference beyond 0.5% as a real disagreement', () => {
      // 17,570,000,000 vs 12,967,429,852 — a measured pair, 26% apart.
      expect(areEquivalent(17570000000, 12967429852, { family: 'MONEY' })).toBe(false);
    });

    // GAP 3 measured: the typeof gate blocked a string/number pair entirely.
    it('compares a numeric string against a number', () => {
      expect(areEquivalent('10', 10, { family: 'MONEY' })).toBe(true);
      expect(areEquivalent(1250000000, '1249970000', { family: 'MONEY' })).toBe(true);
    });

    // S0's finding: zero is a REAL value (ipo_valuation.ofs_shares = 0 on a
    // pure fresh issue). It is never an abstention.
    it('treats zero against zero as agreement, not two abstentions', () => {
      expect(areEquivalent(0, 0, { family: 'MONEY' })).toBe(true);
      expect(areEquivalent('0', 0, { family: 'MONEY' })).toBe(true);
    });

    it('does not let the percentage tolerance swallow a real zero', () => {
      // 0 vs 8,250,000,000 is the measured Moneycontrol shape. Not equal.
      expect(areEquivalent(0, 8250000000, { family: 'MONEY' })).toBe(false);
    });
  });

  describe('IDENTITY: folds corporate forms, but identifiers match exactly', () => {
    // GAP 4 measured: foldCompanyIdentity exists but was never called from the
    // comparison path, so a formatting difference read as a disagreement.
    it('treats Pvt Ltd and Private Limited as the same company', () => {
      expect(
        areEquivalent('Mudra RTA Ventures Pvt Ltd', 'Mudra RTA Ventures Private Limited', {
          family: 'IDENTITY',
        })
      ).toBe(true);
    });

    it('still reports two genuinely different names as different', () => {
      expect(
        areEquivalent('Mudra RTA Ventures', 'Bigshare Services', { family: 'IDENTITY' })
      ).toBe(false);
    });

    // OD-59: "identifiers (ISIN, CIN, symbol) must match EXACTLY" — there is
    // no close-enough for an identifier.
    it('compares identifiers exactly, with no folding', () => {
      expect(areEquivalent('INE001A01036', 'INE002A01018', { family: 'IDENTIFIER' })).toBe(false);
      expect(areEquivalent('INE001A01036', 'INE001A01036', { family: 'IDENTIFIER' })).toBe(true);
    });

    it('does not fold or trim an identifier into a false match', () => {
      expect(areEquivalent('INE001A01036', 'ine001a01036', { family: 'IDENTIFIER' })).toBe(false);
    });
  });

  describe('RATIO: exact to 2 decimal places, because 0.5% hides a real gap', () => {
    // A PE of 24.0 vs 24.1 is 0.4% — inside the money tolerance — but for a
    // derived ratio that gap usually means the two sources used different
    // denominators (pre- vs post-issue EPS), which is the disagreement most
    // worth catching.
    it('treats PE 24.0 against 24.1 as a disagreement', () => {
      expect(areEquivalent(24.0, 24.1, { family: 'RATIO' })).toBe(false);
    });

    it('treats the same ratio written to different precision as equal', () => {
      expect(areEquivalent(24.1, 24.1, { family: 'RATIO' })).toBe(true);
      expect(areEquivalent('24.10', 24.1, { family: 'RATIO' })).toBe(true);
    });
  });

  /**
   * OD-59: "dates compare as dates". OD-57 makes dates a family in their own
   * right, with the exchange as the tie-break winner.
   *
   * Dates are the LARGEST disagreement family in the measured data: 12,719 of
   * 28,946 across 44 IPOs, against money's 8,938 and names' 6,344. Without
   * this family the comparator falls through to the string branch below, so
   * "15 September 2026" and "2026-09-15" -- one date written two ways -- are
   * recorded as a disagreement. See #773.
   */
  describe('DATE (OD-57, OD-59)', () => {
    it('reads the same day written in different formats as one date', () => {
      expect(areEquivalent('2026-09-15', '15 September 2026', { family: 'DATE' })).toBe(true);
      expect(areEquivalent('15/09/2026', '2026-09-15', { family: 'DATE' })).toBe(true);
      expect(areEquivalent('2026-09-15', new Date('2026-09-15T00:00:00Z'), { family: 'DATE' })).toBe(true);
    });

    it('separates two genuinely different days', () => {
      expect(areEquivalent('2026-09-15', '2026-09-16', { family: 'DATE' })).toBe(false);
    });

    it('compares the DAY, not the time of day', () => {
      // Two sources record the same listing date with different timestamps.
      // The day is the value; the hour is noise the sources never agreed on.
      expect(
        areEquivalent('2026-09-15T00:00:00Z', '2026-09-15T09:30:00Z', { family: 'DATE' })
      ).toBe(true);
    });

    // OD-60: an empty answer abstains, exactly as the other families treat it.
    it('treats an absent date as an abstention, not a disagreement', () => {
      expect(areEquivalent(null, '2026-09-15', { family: 'DATE' })).toBe(false);
      expect(areEquivalent(null, null, { family: 'DATE' })).toBe(true);
      expect(areEquivalent('', '  ', { family: 'DATE' })).toBe(true);
    });

    /**
     * A value that will not parse as a date is NOT silently called equal or
     * unequal on a guess -- it falls through to the generic rules, the same
     * way MONEY does when a value is not numeric.
     *
     * This is the case that MATTERS, and the first version of this test
     * missed it: `normalizeDate` returns null for EVERY unparseable value, so
     * without the `d1 !== null && d2 !== null` guard, "TBA" and "not a date"
     * -- two genuinely different non-dates -- both become null and compare
     * EQUAL. That is a false CONFIRMED verdict on the admin queue. A mutation
     * test that removed the guard passed 96/96 against the weaker assertion.
     */
    it('does not call two different unparseable values the same date', () => {
      expect(areEquivalent('TBA', 'not a date', { family: 'DATE' })).toBe(false);
      expect(areEquivalent('To be announced', 'TBA', { family: 'DATE' })).toBe(false);
    });

    it('falls through rather than guessing when a value is not a date', () => {
      expect(areEquivalent('not a date', 'not a date', { family: 'DATE' })).toBe(true);
      expect(areEquivalent('not a date', '2026-09-15', { family: 'DATE' })).toBe(false);
    });
  });

  /**
   * #783: the manifest's comparisonFamily enum allows 8 values but this
   * comparator implemented 5, so SET, BOOLEAN and ABSTAIN (24 of 190 fields)
   * fell straight through to the generic STRING comparison below -- the exact
   * behaviour OD-59 exists to remove. SET and BOOLEAN are implemented here.
   *
   * ABSTAIN is deliberately NOT a branch: it is not an instruction about HOW
   * to compare, it is an instruction to the verdict writer NOT to compare at
   * all. Calling areEquivalent with it is a caller bug, and the test below
   * pins that it is rejected rather than silently treated as "equal".
   */
  describe('SET (#783)', () => {
    it('reads the same members in a different order as one value', () => {
      expect(areEquivalent(['NSE', 'BSE'], ['BSE', 'NSE'], { family: 'SET' })).toBe(true);
    });

    it('normalises each element before comparing, like unionSetValues keys them', () => {
      expect(areEquivalent(['NSE', 'bse'], [' BSE ', 'nse'], { family: 'SET' })).toBe(true);
    });

    it('separates genuinely different membership', () => {
      expect(areEquivalent(['NSE'], ['NSE', 'BSE'], { family: 'SET' })).toBe(false);
      expect(areEquivalent(['NSE'], ['BSE'], { family: 'SET' })).toBe(false);
    });

    // A duplicate is not a new member: ["NSE","NSE"] is the same SET as ["NSE"].
    it('ignores duplicates -- it is a set, not a list', () => {
      expect(areEquivalent(['NSE', 'NSE'], ['NSE'], { family: 'SET' })).toBe(true);
    });

    it('treats an empty or absent set as an abstention (OD-60)', () => {
      expect(areEquivalent(null, ['NSE'], { family: 'SET' })).toBe(false);
      expect(areEquivalent([], [], { family: 'SET' })).toBe(true);
    });

    // Not both arrays -> do not guess. A SET field holding a scalar is a
    // normalisation problem, not a comparison one (same shape MONEY uses).
    it('falls through rather than guessing when a side is not an array', () => {
      expect(areEquivalent('NSE', ['NSE'], { family: 'SET' })).toBe(false);
    });
  });

  describe('BOOLEAN (#783)', () => {
    it('compares booleans exactly', () => {
      expect(areEquivalent(true, true, { family: 'BOOLEAN' })).toBe(true);
      expect(areEquivalent(true, false, { family: 'BOOLEAN' })).toBe(false);
    });

    // false is a VALUE a source supplied, never an abstention (OD-60's rule
    // that only null/undefined/'' abstain, never 0 and never false).
    it('treats false as a real answer, not an abstention', () => {
      expect(areEquivalent(false, false, { family: 'BOOLEAN' })).toBe(true);
      expect(areEquivalent(null, false, { family: 'BOOLEAN' })).toBe(false);
    });

    // The string "true" from a scraped page is the same answer as true.
    it('reads a stringified boolean as the boolean', () => {
      expect(areEquivalent('true', true, { family: 'BOOLEAN' })).toBe(true);
      expect(areEquivalent('false', false, { family: 'BOOLEAN' })).toBe(true);
      expect(areEquivalent('true', false, { family: 'BOOLEAN' })).toBe(false);
    });
  });

  /**
   * #782: three count fields (brlm_track_record.issues_3y,
   * .closed_below_issue_price, anchor_investors.anchor_investors_count) were
   * mapped to MONEY "for the same tolerant-numeric treatment as SHARE_COUNT".
   * MONEY agrees within 0.5% RELATIVE, which is right for money -- two sources
   * genuinely round the same rupee figure differently -- and wrong for a COUNT,
   * which has no rounding. 200 vs 201 anchor investors is a real disagreement
   * about a discrete thing.
   *
   * Where the borrowed tolerance starts hiding an off-by-one, computed:
   *     3 vs 4      diff/scale 0.2500  correctly differs
   *   100 vs 101               0.0099  correctly differs
   *   199 vs 200               0.0050  PASSES AS EQUAL   <- threshold
   *  1000 vs 1001              0.0010  PASSES AS EQUAL
   *
   * Real maxima today are 17, 4 and 19, so it is safe BY ACCIDENT, not by
   * design -- a 200+ anchor book is not absurd, and the failure is silent.
   */
  describe('COUNT (#782)', () => {
    it('is exact -- an off-by-one is a disagreement at ANY magnitude', () => {
      expect(areEquivalent(3, 4, { family: 'COUNT' })).toBe(false);
      // The cases MONEY's 0.5% would have swallowed:
      expect(areEquivalent(199, 200, { family: 'COUNT' })).toBe(false);
      expect(areEquivalent(1000, 1001, { family: 'COUNT' })).toBe(false);
    });

    it('reads the same count written as a string or a number as one value', () => {
      expect(areEquivalent('20', 20, { family: 'COUNT' })).toBe(true);
      expect(areEquivalent('20', '20', { family: 'COUNT' })).toBe(true);
    });

    // Zero is a real count a source supplied (nobody on the anchor book), never
    // an abstention -- OD-60's rule that only null/undefined/'' abstain.
    it('treats zero as a real count, not an abstention', () => {
      expect(areEquivalent(0, 0, { family: 'COUNT' })).toBe(true);
      expect(areEquivalent(0, 1, { family: 'COUNT' })).toBe(false);
      expect(areEquivalent(null, 0, { family: 'COUNT' })).toBe(false);
    });

    // Contrast, so the difference from MONEY is pinned rather than implied.
    it('differs from MONEY on exactly the case that motivated it', () => {
      expect(areEquivalent(199, 200, { family: 'MONEY' })).toBe(true);
      expect(areEquivalent(199, 200, { family: 'COUNT' })).toBe(false);
    });
  });

  describe('abstention (OD-60) and backwards compatibility', () => {
    it('treats null against a real value as NOT equivalent', () => {
      expect(areEquivalent(null, 8250000000, { family: 'MONEY' })).toBe(false);
    });

    // The load-bearing guarantee: the seven existing production callers pass
    // no family and must behave exactly as before. If this fails, S1 has
    // changed the live write path, which it must not.
    it('is unchanged when no family is given', () => {
      expect(areEquivalent('10', '10.00')).toBe(false);
      expect(areEquivalent(1249970000, 1250000000)).toBe(false);
      expect(areEquivalent(['NSE', 'BSE'], ['BSE', 'NSE'])).toBe(true);
      expect(areEquivalent(0.01, 0.015)).toBe(true);
    });
  });
});
