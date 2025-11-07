/**
 * Unit Tests: dynamic-validation-rules
 * Tests custom validation rules for Dynamic Admin (Phase 4)
 *
 * Coverage:
 * - IPOs table validations (6 fields)
 * - Financial data validations (10 fields)
 * - Subscriptions validations (5 fields)
 * - GMP records validations (3 fields)
 * - Cross-field validation logic
 * - Helper functions
 * - Main validateCustomField() and validateRecord() functions
 */

import { describe, it, expect } from 'vitest';
import {
  validateCustomField,
  validateRecord,
  customValidationRules,
  type ValidationContext,
} from '@/lib/admin/dynamic-validation-rules';

describe('dynamic-validation-rules', () => {
  // ========================================
  // IPOs Table Validations
  // ========================================
  describe('ipos.lotSize', () => {
    const validator = customValidationRules.ipos.lotSize;

    it('should accept valid lot sizes', () => {
      expect(validator(10).valid).toBe(true);
      expect(validator(100).valid).toBe(true);
      expect(validator(1000).valid).toBe(true);
    });

    it('should accept null (nullable field)', () => {
      expect(validator(null).valid).toBe(true);
      expect(validator(undefined).valid).toBe(true);
    });

    it('should reject zero and negative values', () => {
      const result1 = validator(0);
      expect(result1.valid).toBe(false);
      expect(result1.error).toContain('at least 1');

      const result2 = validator(-5);
      expect(result2.valid).toBe(false);
      expect(result2.error).toContain('at least 1');
    });

    it('should reject decimal values', () => {
      const result = validator(10.5);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('whole number');
    });

    it('should warn for unusual value of 1', () => {
      const result = validator(1);
      expect(result.valid).toBe(true);
      expect(result.warning).toContain('unusual');
    });

    it('should warn for very large values', () => {
      const result = validator(15000);
      expect(result.valid).toBe(true);
      expect(result.warning).toContain('10,000');
    });
  });

  describe('ipos.priceRangeMin', () => {
    const validator = customValidationRules.ipos.priceRangeMin;

    it('should accept valid prices', () => {
      expect(validator(100).valid).toBe(true);
      expect(validator(500).valid).toBe(true);
      expect(validator(1000).valid).toBe(true);
    });

    it('should reject zero and negative values', () => {
      const result1 = validator(0);
      expect(result1.valid).toBe(false);
      expect(result1.error).toContain('greater than ₹0');

      const result2 = validator(-100);
      expect(result2.valid).toBe(false);
    });

    it('should validate against priceRangeMax (cross-field)', () => {
      const result = validator(500, { priceRangeMax: 400 });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cannot exceed maximum');
    });

    it('should accept when min <= max', () => {
      const result = validator(400, { priceRangeMax: 500 });
      expect(result.valid).toBe(true);
    });

    it('should warn for very high prices', () => {
      const result = validator(150000);
      expect(result.valid).toBe(true);
      expect(result.warning).toContain('lakh');
    });
  });

  describe('ipos.priceRangeMax', () => {
    const validator = customValidationRules.ipos.priceRangeMax;

    it('should accept valid prices', () => {
      expect(validator(100).valid).toBe(true);
      expect(validator(500).valid).toBe(true);
    });

    it('should reject zero and negative values', () => {
      const result = validator(0);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('greater than ₹0');
    });

    it('should validate against priceRangeMin (cross-field)', () => {
      const result = validator(300, { priceRangeMin: 400 });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cannot be less than minimum');
    });

    it('should accept when max >= min', () => {
      const result = validator(500, { priceRangeMin: 400 });
      expect(result.valid).toBe(true);
    });
  });

  describe('ipos.issueSize', () => {
    const validator = customValidationRules.ipos.issueSize;

    it('should accept valid issue sizes', () => {
      expect(validator(100).valid).toBe(true);
      expect(validator(1000).valid).toBe(true);
      expect(validator(5000).valid).toBe(true);
    });

    it('should reject zero and negative values', () => {
      const result = validator(0);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('greater than ₹0 crores');
    });

    it('should warn for very small issue sizes', () => {
      const result = validator(5);
      expect(result.valid).toBe(true);
      expect(result.warning).toContain('below ₹10 crores');
    });

    it('should warn for very large issue sizes', () => {
      const result = validator(150000);
      expect(result.valid).toBe(true);
      expect(result.warning).toContain('lakh crores');
    });
  });

  describe('ipos.openDate and closeDate', () => {
    const openValidator = customValidationRules.ipos.openDate;
    const closeValidator = customValidationRules.ipos.closeDate;

    it('should accept valid dates', () => {
      expect(openValidator('2025-01-01').valid).toBe(true);
      expect(closeValidator('2025-01-10').valid).toBe(true);
    });

    it('should reject invalid date formats', () => {
      const result = openValidator('invalid-date');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid date');
    });

    it('should validate open < close (cross-field)', () => {
      const result1 = openValidator('2025-01-10', { closeDate: '2025-01-05' });
      expect(result1.valid).toBe(false);
      expect(result1.error).toContain('before close date');

      const result2 = closeValidator('2025-01-05', { openDate: '2025-01-10' });
      expect(result2.valid).toBe(false);
      expect(result2.error).toContain('after open date');
    });

    it('should accept when open < close', () => {
      const result1 = openValidator('2025-01-01', { closeDate: '2025-01-10' });
      expect(result1.valid).toBe(true);

      const result2 = closeValidator('2025-01-10', { openDate: '2025-01-01' });
      expect(result2.valid).toBe(true);
    });
  });

  // ========================================
  // Financial Data Table Validations
  // ========================================
  describe('financialData.peRatio', () => {
    const validator = customValidationRules.financialData.peRatio;

    it('should accept valid P/E ratios', () => {
      expect(validator(0).valid).toBe(true);
      expect(validator(15).valid).toBe(true);
      expect(validator(50).valid).toBe(true);
      expect(validator(100).valid).toBe(true);
    });

    it('should reject negative values', () => {
      const result = validator(-5);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cannot be negative');
    });

    it('should reject values > 1000', () => {
      const result = validator(1500);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('exceeds 1000');
    });

    it('should warn for very high values', () => {
      const result = validator(600);
      expect(result.valid).toBe(true);
      expect(result.warning).toContain('exceeds 500');
    });
  });

  describe('financialData.roe', () => {
    const validator = customValidationRules.financialData.roe;

    it('should accept valid ROE values', () => {
      expect(validator(0).valid).toBe(true);
      expect(validator(15).valid).toBe(true);
      expect(validator(50).valid).toBe(true);
      expect(validator(-10).valid).toBe(true);
    });

    it('should reject values < -100', () => {
      const result = validator(-150);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cannot be less than -100%');
    });

    it('should reject values > 100', () => {
      const result = validator(150);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cannot exceed 100%');
    });

    it('should warn for very negative values', () => {
      const result = validator(-60);
      expect(result.valid).toBe(true);
      expect(result.warning).toContain('below -50%');
    });
  });

  describe('financialData.debtToEquity', () => {
    const validator = customValidationRules.financialData.debtToEquity;

    it('should accept valid debt-to-equity ratios', () => {
      expect(validator(0).valid).toBe(true);
      expect(validator(1).valid).toBe(true);
      expect(validator(5).valid).toBe(true);
    });

    it('should reject negative values', () => {
      const result = validator(-1);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cannot be negative');
    });

    it('should warn for very high leverage', () => {
      const result = validator(15);
      expect(result.valid).toBe(true);
      expect(result.warning).toContain('exceeds 10');
    });
  });

  describe('financialData.revenue (all fiscal years)', () => {
    const validator2024 = customValidationRules.financialData.revenueFy2024;
    const validator2023 = customValidationRules.financialData.revenueFy2023;
    const validator2022 = customValidationRules.financialData.revenueFy2022;

    it('should accept valid revenue values', () => {
      expect(validator2024(1000).valid).toBe(true);
      expect(validator2023(5000).valid).toBe(true);
      expect(validator2022(10000).valid).toBe(true);
    });

    it('should reject negative revenue', () => {
      const result = validator2024(-1000);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cannot be negative');
    });

    it('should accept null values', () => {
      expect(validator2024(null).valid).toBe(true);
      expect(validator2023(null).valid).toBe(true);
      expect(validator2022(null).valid).toBe(true);
    });
  });

  describe('financialData.profit (all fiscal years)', () => {
    const validator2024 = customValidationRules.financialData.profitFy2024;
    const validator2023 = customValidationRules.financialData.profitFy2023;
    const validator2022 = customValidationRules.financialData.profitFy2022;

    it('should accept positive profit values', () => {
      expect(validator2024(1000).valid).toBe(true);
      expect(validator2023(5000).valid).toBe(true);
    });

    it('should accept negative profit (net loss)', () => {
      expect(validator2024(-1000).valid).toBe(true);
      expect(validator2023(-500).valid).toBe(true);
    });

    it('should warn for extreme values', () => {
      const result = validator2024(150000);
      expect(result.valid).toBe(true);
      expect(result.warning).toContain('outside typical range');
    });
  });

  describe('financialData.eps', () => {
    const validator = customValidationRules.financialData.eps;

    it('should accept valid EPS values', () => {
      expect(validator(10).valid).toBe(true);
      expect(validator(100).valid).toBe(true);
      expect(validator(-5).valid).toBe(true);
    });

    it('should warn for extreme values', () => {
      const result1 = validator(15000);
      expect(result1.valid).toBe(true);
      expect(result1.warning).toContain('outside typical range');

      const result2 = validator(-1500);
      expect(result2.valid).toBe(true);
      expect(result2.warning).toContain('outside typical range');
    });
  });

  describe('financialData.netWorth', () => {
    const validator = customValidationRules.financialData.netWorth;

    it('should accept positive net worth', () => {
      expect(validator(1000).valid).toBe(true);
      expect(validator(10000).valid).toBe(true);
    });

    it('should reject zero and negative net worth', () => {
      const result1 = validator(0);
      expect(result1.valid).toBe(false);
      expect(result1.error).toContain('must be positive');

      const result2 = validator(-1000);
      expect(result2.valid).toBe(false);
      expect(result2.error).toContain('must be positive');
    });
  });

  // ========================================
  // Subscriptions Table Validations
  // ========================================
  describe('subscriptions validations', () => {
    it('should validate totalSubscription', () => {
      const validator = customValidationRules.subscriptions.totalSubscription;

      expect(validator(0).valid).toBe(true);
      expect(validator(1.5).valid).toBe(true);
      expect(validator(10).valid).toBe(true);

      const result = validator(-1);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cannot be negative');
    });

    it('should validate qibSubscription', () => {
      const validator = customValidationRules.subscriptions.qibSubscription;

      expect(validator(0).valid).toBe(true);
      expect(validator(5.5).valid).toBe(true);

      const result = validator(-2);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('QIB');
    });

    it('should validate niiSubscription', () => {
      const validator = customValidationRules.subscriptions.niiSubscription;

      expect(validator(0).valid).toBe(true);
      expect(validator(3.2).valid).toBe(true);

      const result = validator(-1);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('NII');
    });

    it('should validate retailSubscription', () => {
      const validator = customValidationRules.subscriptions.retailSubscription;

      expect(validator(0).valid).toBe(true);
      expect(validator(1.8).valid).toBe(true);

      const result = validator(-0.5);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Retail');
    });

    it('should validate employeeSubscription', () => {
      const validator = customValidationRules.subscriptions.employeeSubscription;

      expect(validator(0).valid).toBe(true);
      expect(validator(2.5).valid).toBe(true);

      const result = validator(-1);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Employee');
    });
  });

  // ========================================
  // GMP Records Table Validations
  // ========================================
  describe('gmpRecords.gmpPrice', () => {
    const validator = customValidationRules.gmpRecords.gmpPrice;

    it('should accept valid GMP prices', () => {
      expect(validator(0).valid).toBe(true);
      expect(validator(50).valid).toBe(true);
      expect(validator(500).valid).toBe(true);
    });

    it('should reject negative values', () => {
      const result = validator(-50);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cannot be negative');
    });

    it('should warn for very high prices', () => {
      const result = validator(15000);
      expect(result.valid).toBe(true);
      expect(result.warning).toContain('₹10,000');
    });
  });

  describe('gmpRecords.gmpPercentage', () => {
    const validator = customValidationRules.gmpRecords.gmpPercentage;

    it('should accept valid GMP percentages', () => {
      expect(validator(0).valid).toBe(true);
      expect(validator(50).valid).toBe(true);
      expect(validator(200).valid).toBe(true);
      expect(validator(-50).valid).toBe(true);
    });

    it('should reject values < -100% (complete loss)', () => {
      const result = validator(-150);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cannot be less than -100%');
    });

    it('should warn for extremely high percentages', () => {
      const result = validator(1500);
      expect(result.valid).toBe(true);
      expect(result.warning).toContain('exceeds 1000%');
    });
  });

  describe('gmpRecords.estimatedListingPrice', () => {
    const validator = customValidationRules.gmpRecords.estimatedListingPrice;

    it('should accept valid listing prices', () => {
      expect(validator(100).valid).toBe(true);
      expect(validator(500).valid).toBe(true);
      expect(validator(1000).valid).toBe(true);
    });

    it('should reject zero and negative values', () => {
      const result1 = validator(0);
      expect(result1.valid).toBe(false);
      expect(result1.error).toContain('greater than ₹0');

      const result2 = validator(-100);
      expect(result2.valid).toBe(false);
    });
  });

  // ========================================
  // Main Function Tests
  // ========================================
  describe('validateCustomField()', () => {
    it('should validate using custom rules', () => {
      const context: ValidationContext = {
        tableName: 'ipos',
        fieldName: 'lotSize',
        value: 100,
      };

      const result = validateCustomField(context);
      expect(result.valid).toBe(true);
    });

    it('should return validation error for invalid value', () => {
      const context: ValidationContext = {
        tableName: 'ipos',
        fieldName: 'lotSize',
        value: -5,
      };

      const result = validateCustomField(context);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle cross-field validation', () => {
      const context: ValidationContext = {
        tableName: 'ipos',
        fieldName: 'priceRangeMin',
        value: 500,
        record: { priceRangeMax: 400 },
      };

      const result = validateCustomField(context);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cannot exceed maximum');
    });

    it('should return valid for tables without custom rules', () => {
      const context: ValidationContext = {
        tableName: 'unknownTable',
        fieldName: 'someField',
        value: 123,
      };

      const result = validateCustomField(context);
      expect(result.valid).toBe(true);
    });

    it('should return valid for fields without custom rules', () => {
      const context: ValidationContext = {
        tableName: 'ipos',
        fieldName: 'someUnvalidatedField',
        value: 'test',
      };

      const result = validateCustomField(context);
      expect(result.valid).toBe(true);
    });
  });

  describe('validateRecord()', () => {
    it('should validate all fields in an IPO record', () => {
      const record = {
        lotSize: 100,
        priceRangeMin: 300,
        priceRangeMax: 400,
        issueSize: 1000,
        openDate: '2025-01-01',
        closeDate: '2025-01-10',
      };

      const result = validateRecord('ipos', record);
      expect(result.valid).toBe(true);
      expect(Object.keys(result.errors)).toHaveLength(0);
    });

    it('should collect multiple errors', () => {
      const record = {
        lotSize: -5, // Error: negative
        priceRangeMin: 500, // Error: > max
        priceRangeMax: 400,
        issueSize: -100, // Error: negative
      };

      const result = validateRecord('ipos', record);
      expect(result.valid).toBe(false);
      expect(Object.keys(result.errors).length).toBeGreaterThan(0);
      expect(result.errors.lotSize).toBeDefined();
      expect(result.errors.priceRangeMin).toBeDefined();
      expect(result.errors.issueSize).toBeDefined();
    });

    it('should collect warnings separately', () => {
      const record = {
        lotSize: 1, // Warning: unusual
        issueSize: 5, // Warning: very small
      };

      const result = validateRecord('ipos', record);
      expect(result.valid).toBe(true);
      expect(result.warnings.lotSize).toBeDefined();
      expect(result.warnings.issueSize).toBeDefined();
    });

    it('should handle empty record', () => {
      const result = validateRecord('ipos', {});
      expect(result.valid).toBe(true);
    });

    it('should handle unknown table', () => {
      const result = validateRecord('unknownTable', { field: 'value' });
      expect(result.valid).toBe(true);
    });

    it('should validate financial data record', () => {
      const record = {
        peRatio: 25,
        roe: 15,
        debtToEquity: 2,
        revenueFy2024: 10000,
        profitFy2024: 2000,
        eps: 50,
        netWorth: 5000,
      };

      const result = validateRecord('financialData', record);
      expect(result.valid).toBe(true);
    });

    it('should validate subscriptions record', () => {
      const record = {
        totalSubscription: 5.5,
        qibSubscription: 8.2,
        niiSubscription: 3.1,
        retailSubscription: 1.8,
        employeeSubscription: 0.5,
      };

      const result = validateRecord('subscriptions', record);
      expect(result.valid).toBe(true);
    });

    it('should validate GMP record', () => {
      const record = {
        gmpPrice: 150,
        gmpPercentage: 50,
        estimatedListingPrice: 450,
      };

      const result = validateRecord('gmpRecords', record);
      expect(result.valid).toBe(true);
    });
  });
});
