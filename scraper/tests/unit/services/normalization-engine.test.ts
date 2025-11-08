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
