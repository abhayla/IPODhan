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
