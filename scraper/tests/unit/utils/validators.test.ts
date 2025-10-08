import { describe, it, expect } from 'vitest';
import {
  validateIPOData,
  validateSubscriptionData,
  sanitizeCompanyName,
  sanitizeSubscriptionNumber,
  generateSlug,
  ScrapedIPOSchema,
  ScrapedSubscriptionSchema
} from '../../../src/utils/validators';

describe('validators', () => {
  describe('ScrapedIPOSchema', () => {
    it('should validate valid IPO data', () => {
      const validIPO = {
        companyName: 'Test Company Limited',
        issueSize: 500,
        priceRangeMin: 100,
        priceRangeMax: 120,
        openDate: '2025-10-15',
        closeDate: '2025-10-18',
        listingExchange: 'NSE',
        category: 'MAINBOARD',
        sector: 'Technology',
        status: 'UPCOMING',
        lotSize: 100,
        faceValue: 10
      };

      const result = ScrapedIPOSchema.safeParse(validIPO);
      expect(result.success).toBe(true);
    });

    it('should reject IPO with missing required fields', () => {
      const invalidIPO = {
        companyName: 'Test Company',
        issueSize: 500
        // Missing required fields
      };

      const result = ScrapedIPOSchema.safeParse(invalidIPO);
      expect(result.success).toBe(false);
    });

    it('should reject IPO with invalid price range (max < min)', () => {
      const invalidIPO = {
        companyName: 'Test Company Limited',
        issueSize: 500,
        priceRangeMin: 120,
        priceRangeMax: 100, // Invalid: max < min
        openDate: '2025-10-15',
        closeDate: '2025-10-18',
        listingExchange: 'NSE',
        category: 'MAINBOARD',
        status: 'UPCOMING'
      };

      const result = ScrapedIPOSchema.safeParse(invalidIPO);
      expect(result.success).toBe(false);
    });

    it('should reject IPO with invalid date range (close < open)', () => {
      const invalidIPO = {
        companyName: 'Test Company Limited',
        issueSize: 500,
        priceRangeMin: 100,
        priceRangeMax: 120,
        openDate: '2025-10-18',
        closeDate: '2025-10-15', // Invalid: close < open
        listingExchange: 'NSE',
        category: 'MAINBOARD',
        status: 'UPCOMING'
      };

      const result = ScrapedIPOSchema.safeParse(invalidIPO);
      expect(result.success).toBe(false);
    });

    it('should reject IPO with invalid enum values', () => {
      const invalidIPO = {
        companyName: 'Test Company Limited',
        issueSize: 500,
        priceRangeMin: 100,
        priceRangeMax: 120,
        openDate: '2025-10-15',
        closeDate: '2025-10-18',
        listingExchange: 'INVALID_EXCHANGE', // Invalid enum
        category: 'MAINBOARD',
        status: 'UPCOMING'
      };

      const result = ScrapedIPOSchema.safeParse(invalidIPO);
      expect(result.success).toBe(false);
    });
  });

  describe('ScrapedSubscriptionSchema', () => {
    it('should validate valid subscription data', () => {
      const validSubscription = {
        ipoCompanyName: 'Test Company Limited',
        qibSubscription: 2.5,
        niiSubscription: 1.8,
        retailSubscription: 3.2,
        totalSubscription: 2.1,
        timestamp: '2025-10-15T10:30:00Z'
      };

      const result = ScrapedSubscriptionSchema.safeParse(validSubscription);
      expect(result.success).toBe(true);
    });

    it('should reject subscription with negative values', () => {
      const invalidSubscription = {
        ipoCompanyName: 'Test Company Limited',
        qibSubscription: -1.5, // Invalid: negative
        niiSubscription: 1.8,
        retailSubscription: 3.2,
        totalSubscription: 2.1,
        timestamp: '2025-10-15T10:30:00Z'
      };

      const result = ScrapedSubscriptionSchema.safeParse(invalidSubscription);
      expect(result.success).toBe(false);
    });

    it('should accept optional granular subscription fields', () => {
      const subscriptionWithGranular = {
        ipoCompanyName: 'Test Company Limited',
        qibSubscription: 2.5,
        niiSubscription: 1.8,
        retailSubscription: 3.2,
        totalSubscription: 2.1,
        anchorInvestorSubscription: 1.5,
        bNIISubscription: 2.0,
        sNIISubscription: 1.6,
        timestamp: '2025-10-15T10:30:00Z'
      };

      const result = ScrapedSubscriptionSchema.safeParse(subscriptionWithGranular);
      expect(result.success).toBe(true);
    });
  });

  describe('validateIPOData', () => {
    it('should return success for valid data', () => {
      const validIPO = {
        companyName: 'Test Company Limited',
        issueSize: 500,
        priceRangeMin: 100,
        priceRangeMax: 120,
        openDate: '2025-10-15',
        closeDate: '2025-10-18',
        listingExchange: 'NSE',
        category: 'MAINBOARD',
        status: 'UPCOMING'
      };

      const result = validateIPOData(validIPO);
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    it('should return error for invalid data', () => {
      const invalidIPO = {
        companyName: 'Test Company',
        issueSize: -500 // Invalid: negative
      };

      const result = validateIPOData(invalidIPO);
      expect(result.success).toBe(false);
      expect(result.data).toBeUndefined();
      expect(result.error).toBeDefined();
    });
  });

  describe('sanitizeCompanyName', () => {
    it('should remove HTML tags', () => {
      const result = sanitizeCompanyName('<script>alert("xss")</script>Test Company');
      expect(result).toBe('alert("xss")Test Company');
    });

    it('should remove angle brackets', () => {
      const result = sanitizeCompanyName('Test <Company> Limited');
      expect(result).toBe('Test Company Limited');
    });

    it('should trim whitespace', () => {
      const result = sanitizeCompanyName('  Test Company  ');
      expect(result).toBe('Test Company');
    });

    it('should limit length to 200 characters', () => {
      const longName = 'A'.repeat(250);
      const result = sanitizeCompanyName(longName);
      expect(result.length).toBe(200);
    });
  });

  describe('sanitizeSubscriptionNumber', () => {
    it('should parse valid numbers', () => {
      expect(sanitizeSubscriptionNumber(2.5)).toBe(2.5);
      expect(sanitizeSubscriptionNumber('3.7')).toBe(3.7);
    });

    it('should throw error for negative numbers', () => {
      expect(() => sanitizeSubscriptionNumber(-1.5)).toThrow('Invalid subscription number');
    });

    it('should throw error for NaN', () => {
      expect(() => sanitizeSubscriptionNumber('invalid')).toThrow('Invalid subscription number');
    });

    it('should cap at reasonable maximum (10000x)', () => {
      const result = sanitizeSubscriptionNumber(15000);
      expect(result).toBe(10000);
    });
  });

  describe('generateSlug', () => {
    it('should convert to lowercase', () => {
      const result = generateSlug('TEST COMPANY LIMITED');
      expect(result).toBe('test-company-limited');
    });

    it('should replace spaces with hyphens', () => {
      const result = generateSlug('Test Company Limited');
      expect(result).toBe('test-company-limited');
    });

    it('should remove non-alphanumeric characters', () => {
      const result = generateSlug('Test & Company! Ltd.');
      expect(result).toBe('test-company-ltd');
    });

    it('should remove leading and trailing hyphens', () => {
      const result = generateSlug('---Test Company---');
      expect(result).toBe('test-company');
    });

    it('should limit length to 255 characters', () => {
      const longName = 'A '.repeat(150);
      const result = generateSlug(longName);
      expect(result.length).toBeLessThanOrEqual(255);
    });
  });
});
