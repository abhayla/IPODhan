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
        category: 'MAINBOARD' as const,
        sector: 'Technology',
        status: 'UPCOMING' as const,
        lotSize: 100,
        faceValue: 10,
        symbol: 'TESTCO',
        leadManagers: ['Test Lead Manager']
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
        category: 'MAINBOARD' as const,
        status: 'UPCOMING' as const,
        symbol: 'TESTCO',
        leadManagers: ['Test Lead Manager']
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

  // ==================== IPO ALERTS API TESTS ====================

  describe('IPOAlertsAPIIPOSchema', () => {
    it('should validate valid IPO Alerts API data', () => {
      const validAPIData = {
        id: 'api-123',
        company_name: 'Tech Innovations Ltd',
        issue_size: 750,
        price_range: {
          min: 200,
          max: 250
        },
        open_date: '2025-10-20',
        close_date: '2025-10-23',
        status: 'UPCOMING',
        category: 'MAINBOARD',
        exchange: 'NSE',
        sector: 'Technology',
        lot_size: 50,
        face_value: 10
      };

      const result = validateIPOAlertsIPOData(validAPIData);
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    it('should reject API data with missing required fields', () => {
      const invalidAPIData = {
        id: 'api-123',
        company_name: 'Tech Innovations Ltd',
        // Missing required fields
        status: 'UPCOMING'
      };

      const result = validateIPOAlertsIPOData(invalidAPIData);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject API data with invalid price range (max < min)', () => {
      const invalidAPIData = {
        id: 'api-123',
        company_name: 'Tech Innovations Ltd',
        issue_size: 750,
        price_range: {
          min: 250,
          max: 200 // Invalid: max < min
        },
        open_date: '2025-10-20',
        close_date: '2025-10-23',
        status: 'UPCOMING',
        category: 'MAINBOARD',
        exchange: 'NSE'
      };

      const result = validateIPOAlertsIPOData(invalidAPIData);
      expect(result.success).toBe(false);
    });

    it('should reject API data with invalid date range (close < open)', () => {
      const invalidAPIData = {
        id: 'api-123',
        company_name: 'Tech Innovations Ltd',
        issue_size: 750,
        price_range: {
          min: 200,
          max: 250
        },
        open_date: '2025-10-23',
        close_date: '2025-10-20', // Invalid: close < open
        status: 'UPCOMING',
        category: 'MAINBOARD',
        exchange: 'NSE'
      };

      const result = validateIPOAlertsIPOData(invalidAPIData);
      expect(result.success).toBe(false);
    });

    it('should accept optional fields', () => {
      const apiDataWithOptionals = {
        id: 'api-123',
        company_name: 'Tech Innovations Ltd',
        issue_size: 750,
        price_range: {
          min: 200,
          max: 250
        },
        open_date: '2025-10-20',
        close_date: '2025-10-23',
        status: 'UPCOMING',
        category: 'MAINBOARD',
        exchange: 'NSE',
        sector: 'Technology',
        lot_size: 50,
        face_value: 10,
        allotment_date: '2025-10-28',
        listing_date: '2025-10-30',
        company_description: 'Leading tech company',
        registrar: 'Link Intime',
        lead_managers: ['ICICI Securities', 'Kotak Investment']
      };

      const result = validateIPOAlertsIPOData(apiDataWithOptionals);
      expect(result.success).toBe(true);
    });

    it('should validate underscore_case field names', () => {
      const apiData = {
        id: 'api-123',
        company_name: 'Test Company', // underscore_case
        issue_size: 500, // underscore_case
        price_range: { min: 100, max: 120 },
        open_date: '2025-10-20', // underscore_case
        close_date: '2025-10-23', // underscore_case
        status: 'OPEN',
        category: 'SME',
        exchange: 'BSE'
      };

      const result = validateIPOAlertsIPOData(apiData);
      expect(result.success).toBe(true);
    });
  });

  describe('validateIPOAlertsIPOData', () => {
    it('should return success for valid API data', () => {
      const validAPIData = {
        id: 'api-456',
        company_name: 'Digital Solutions Pvt Ltd',
        issue_size: 1000,
        price_range: { min: 300, max: 350 },
        open_date: '2025-11-01',
        close_date: '2025-11-04',
        status: 'OPEN',
        category: 'MAINBOARD',
        exchange: 'BOTH'
      };

      const result = validateIPOAlertsIPOData(validAPIData);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(validAPIData);
    });

    it('should return error for invalid API data', () => {
      const invalidAPIData = {
        id: 'api-456',
        company_name: '',
        issue_size: -100, // Invalid: negative
        price_range: { min: 100, max: 120 },
        open_date: '2025-11-01',
        close_date: '2025-11-04',
        status: 'OPEN',
        category: 'MAINBOARD',
        exchange: 'NSE'
      };

      const result = validateIPOAlertsIPOData(invalidAPIData);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('transformIPOAlertsData', () => {
    it('should transform API underscore_case to camelCase', () => {
      const apiData = {
        id: 'api-789',
        company_name: 'Future Tech Ltd',
        issue_size: 800,
        price_range: { min: 150, max: 180 },
        open_date: '2025-10-25',
        close_date: '2025-10-28',
        status: 'UPCOMING' as const,
        category: 'MAINBOARD' as const,
        exchange: 'NSE' as const,
        sector: 'IT Services'
      };

      const transformed = transformIPOAlertsData(apiData);

      expect(transformed.companyName).toBe('Future Tech Ltd');
      expect(transformed.issueSize).toBe(800);
      expect(transformed.priceRangeMin).toBe(150);
      expect(transformed.priceRangeMax).toBe(180);
      expect(transformed.openDate).toBe('2025-10-25');
      expect(transformed.closeDate).toBe('2025-10-28');
      expect(transformed.listingExchange).toBe('NSE');
      expect(transformed.category).toBe('MAINBOARD');
      expect(transformed.status).toBe('UPCOMING');
      expect(transformed.sector).toBe('IT Services');
    });

    it('should map price_range object to separate fields', () => {
      const apiData = {
        id: 'api-123',
        company_name: 'Test Company',
        issue_size: 500,
        price_range: {
          min: 100,
          max: 120
        },
        open_date: '2025-10-20',
        close_date: '2025-10-23',
        status: 'OPEN' as const,
        category: 'SME' as const,
        exchange: 'BSE' as const
      };

      const transformed = transformIPOAlertsData(apiData);

      expect(transformed.priceRangeMin).toBe(100);
      expect(transformed.priceRangeMax).toBe(120);
      expect(transformed).not.toHaveProperty('price_range');
    });

    it('should sanitize company name during transformation', () => {
      const apiData = {
        id: 'api-123',
        company_name: '<script>alert("xss")</script>Test Company',
        issue_size: 500,
        price_range: { min: 100, max: 120 },
        open_date: '2025-10-20',
        close_date: '2025-10-23',
        status: 'OPEN' as const,
        category: 'MAINBOARD' as const,
        exchange: 'NSE' as const
      };

      const transformed = transformIPOAlertsData(apiData);

      // Should remove HTML tags
      expect(transformed.companyName).not.toContain('<script>');
      expect(transformed.companyName).toBe('alert("xss")Test Company');
    });

    it('should transform optional fields when present', () => {
      const apiData = {
        id: 'api-123',
        company_name: 'Complete IPO Data Ltd',
        issue_size: 1200,
        price_range: { min: 400, max: 450 },
        open_date: '2025-11-10',
        close_date: '2025-11-13',
        status: 'UPCOMING' as const,
        category: 'MAINBOARD' as const,
        exchange: 'BOTH' as const,
        sector: 'Finance',
        lot_size: 30,
        face_value: 5,
        allotment_date: '2025-11-18',
        listing_date: '2025-11-20',
        company_description: 'Leading financial services provider',
        registrar: 'KFin Technologies',
        lead_managers: ['Axis Capital', 'IIFL Securities']
      };

      const transformed = transformIPOAlertsData(apiData);

      expect(transformed.sector).toBe('Finance');
      expect(transformed.lotSize).toBe(30);
      expect(transformed.faceValue).toBe(5);
      expect(transformed.allotmentDate).toBe('2025-11-18');
      expect(transformed.listingDate).toBe('2025-11-20');
      expect(transformed.companyDescription).toBe('Leading financial services provider');
      expect(transformed.registrar).toBe('KFin Technologies');
      expect(transformed.leadManagers).toEqual(['Axis Capital', 'IIFL Securities']);
    });

    it('should handle missing optional fields gracefully', () => {
      const apiData = {
        id: 'api-123',
        company_name: 'Minimal Data IPO',
        issue_size: 500,
        price_range: { min: 100, max: 120 },
        open_date: '2025-10-20',
        close_date: '2025-10-23',
        status: 'OPEN' as const,
        category: 'SME' as const,
        exchange: 'BSE' as const
      };

      const transformed = transformIPOAlertsData(apiData);

      expect(transformed.sector).toBeUndefined();
      expect(transformed.lotSize).toBeUndefined();
      expect(transformed.faceValue).toBeUndefined();
      expect(transformed.allotmentDate).toBeUndefined();
      expect(transformed.listingDate).toBeUndefined();
      expect(transformed.companyDescription).toBeUndefined();
      expect(transformed.registrar).toBeUndefined();
      expect(transformed.leadManagers).toBeUndefined();
    });

    it('should preserve enum values correctly', () => {
      const apiData = {
        id: 'api-123',
        company_name: 'Enum Test IPO',
        issue_size: 500,
        price_range: { min: 100, max: 120 },
        open_date: '2025-10-20',
        close_date: '2025-10-23',
        status: 'CLOSED' as const,
        category: 'RIGHTS' as const,
        exchange: 'BOTH' as const
      };

      const transformed = transformIPOAlertsData(apiData);

      expect(transformed.status).toBe('CLOSED');
      expect(transformed.category).toBe('RIGHTS');
      expect(transformed.listingExchange).toBe('BOTH');
    });

    it('should create valid ScrapedIPO format', () => {
      const apiData = {
        id: 'api-123',
        company_name: 'Valid Transform IPO',
        issue_size: 600,
        price_range: { min: 120, max: 150 },
        open_date: '2025-10-20',
        close_date: '2025-10-23',
        status: 'UPCOMING' as const,
        category: 'RIGHTS' as const, // Changed to RIGHTS (doesn't require symbol/leadManagers)
        exchange: 'NSE' as const
      };

      const transformed = transformIPOAlertsData(apiData);

      // Verify it matches ScrapedIPO schema structure
      const validationResult = validateIPOData(transformed);
      expect(validationResult.success).toBe(true);
    });
  });
});

// Re-import for IPO Alerts tests
import {
  validateIPOAlertsIPOData,
  transformIPOAlertsData
} from '../../../src/utils/validators';

// ==================== BSE DETAIL CONDITIONAL VALIDATION TESTS ====================

describe('ScrapedIPOSchema - Conditional Validation for BSE Detail Data', () => {
  describe('MAINBOARD/SME Category Validation', () => {
    it('should fail when MAINBOARD IPO missing symbol', () => {
      const mainboardIPO = {
        companyName: 'MIDWEST GOLD LIMITED',
        issueSize: 33200000,
        priceRangeMin: 1014,
        priceRangeMax: 1065,
        openDate: '2025-10-15',
        closeDate: '2025-10-17',
        listingExchange: 'BSE',
        category: 'MAINBOARD' as const,
        status: 'UPCOMING' as const,
        lotSize: 14,
        faceValue: 10,
        symbol: null, // Missing for MAINBOARD
        leadManagers: ['Beeline Capital Advisors Pvt. Ltd.']
      };

      const result = ScrapedIPOSchema.safeParse(mainboardIPO);
      expect(result.success).toBe(false);

      if (!result.success) {
        const errorMessage = result.error.issues[0].message;
        expect(errorMessage).toContain('Symbol and leadManagers are required for MAINBOARD/SME IPOs');
      }
    });

    it('should fail when MAINBOARD IPO missing lead managers', () => {
      const mainboardIPO = {
        companyName: 'MIDWEST GOLD LIMITED',
        issueSize: 33200000,
        priceRangeMin: 1014,
        priceRangeMax: 1065,
        openDate: '2025-10-15',
        closeDate: '2025-10-17',
        listingExchange: 'BSE',
        category: 'MAINBOARD' as const,
        status: 'UPCOMING' as const,
        lotSize: 14,
        faceValue: 10,
        symbol: 'MIDWESTLTD',
        leadManagers: null // Missing for MAINBOARD
      };

      const result = ScrapedIPOSchema.safeParse(mainboardIPO);
      expect(result.success).toBe(false);

      if (!result.success) {
        const errorMessage = result.error.issues[0].message;
        expect(errorMessage).toContain('Symbol and leadManagers are required for MAINBOARD/SME IPOs');
      }
    });

    it('should fail when SME IPO missing symbol', () => {
      const smeIPO = {
        companyName: 'KRN HEAT EXCHANGER AND REFRIGERATION LIMITED',
        issueSize: 50000000,
        priceRangeMin: 200,
        priceRangeMax: 220,
        openDate: '2024-03-25',
        closeDate: '2024-03-27',
        listingExchange: 'BSE',
        category: 'SME' as const,
        status: 'UPCOMING' as const,
        lotSize: 500,
        faceValue: 10,
        symbol: null, // Missing for SME
        leadManagers: ['Test Lead Manager']
      };

      const result = ScrapedIPOSchema.safeParse(smeIPO);
      expect(result.success).toBe(false);

      if (!result.success) {
        const errorMessage = result.error.issues[0].message;
        expect(errorMessage).toContain('Symbol and leadManagers are required for MAINBOARD/SME IPOs');
      }
    });

    it('should pass when MAINBOARD IPO has symbol and lead managers', () => {
      const mainboardIPO = {
        companyName: 'MIDWEST GOLD LIMITED',
        issueSize: 33200000,
        priceRangeMin: 1014,
        priceRangeMax: 1065,
        openDate: '2025-10-15',
        closeDate: '2025-10-17',
        listingExchange: 'BSE',
        category: 'MAINBOARD' as const,
        status: 'UPCOMING' as const,
        lotSize: 14,
        faceValue: 10,
        symbol: 'MIDWESTLTD',
        leadManagers: ['Beeline Capital Advisors Pvt. Ltd.', 'Narnolia Financial Advisors Ltd.']
      };

      const result = ScrapedIPOSchema.safeParse(mainboardIPO);
      expect(result.success).toBe(true);
    });
  });

  describe('RIGHTS/NCD Category Validation', () => {
    it('should pass when RIGHTS IPO missing symbol', () => {
      const rightsIPO = {
        companyName: 'SUNSHIELD CHEMICALS LTD',
        issueSize: 45000000,
        priceRangeMin: 100,
        priceRangeMax: 100,
        openDate: '2024-01-15',
        closeDate: '2024-01-22',
        listingExchange: 'BSE',
        category: 'RIGHTS' as const,
        status: 'UPCOMING' as const,
        lotSize: 150,
        faceValue: 10,
        symbol: null, // Allowed for RIGHTS
        leadManagers: null
      };

      const result = ScrapedIPOSchema.safeParse(rightsIPO);
      expect(result.success).toBe(true);
    });

    it('should pass when RIGHTS IPO missing lead managers', () => {
      const rightsIPO = {
        companyName: 'WARDWIZARD INNOVATIONS MOBILITY LTD',
        issueSize: 50000000,
        priceRangeMin: 75,
        priceRangeMax: 75,
        openDate: '2024-02-01',
        closeDate: '2024-02-08',
        listingExchange: 'BSE',
        category: 'RIGHTS' as const,
        status: 'UPCOMING' as const,
        lotSize: 200,
        faceValue: 10,
        symbol: 'WARDWIZ', // Can have symbol
        leadManagers: null // Allowed for RIGHTS
      };

      const result = ScrapedIPOSchema.safeParse(rightsIPO);
      expect(result.success).toBe(true);
    });

    it('should pass when NCD missing both symbol and lead managers', () => {
      const ncdIPO = {
        companyName: 'SMC Global Securities Limited',
        issueSize: 50000000,
        priceRangeMin: 1000,
        priceRangeMax: 1000,
        openDate: '2024-01-10',
        closeDate: '2024-01-17',
        listingExchange: 'BSE',
        category: 'NCD' as const,
        status: 'UPCOMING' as const,
        lotSize: 10,
        faceValue: 1000,
        symbol: null, // Allowed for NCD
        leadManagers: null // Allowed for NCD
      };

      const result = ScrapedIPOSchema.safeParse(ncdIPO);
      expect(result.success).toBe(true);
    });

    it('should pass when NCD has symbol and lead managers (optional)', () => {
      const ncdIPO = {
        companyName: 'Indel Money Limited',
        issueSize: 75000000,
        priceRangeMin: 1000,
        priceRangeMax: 1000,
        openDate: '2024-01-20',
        closeDate: '2024-01-27',
        listingExchange: 'BSE',
        category: 'NCD' as const,
        status: 'UPCOMING' as const,
        lotSize: 10,
        faceValue: 1000,
        symbol: 'INDELMONEY',
        leadManagers: ['XYZ Capital']
      };

      const result = ScrapedIPOSchema.safeParse(ncdIPO);
      expect(result.success).toBe(true);
    });

    it('should pass when RIGHTS has empty lead managers array', () => {
      const rightsIPO = {
        companyName: '3I INFOTECH LTD',
        issueSize: 30000000,
        priceRangeMin: 50,
        priceRangeMax: 50,
        openDate: '2024-02-10',
        closeDate: '2024-02-17',
        listingExchange: 'BSE',
        category: 'RIGHTS' as const,
        status: 'UPCOMING' as const,
        lotSize: 100,
        faceValue: 10,
        symbol: null,
        leadManagers: [] // Empty array should fail for MAINBOARD but pass for RIGHTS
      };

      const result = ScrapedIPOSchema.safeParse(rightsIPO);
      expect(result.success).toBe(true);
    });

    it('should fail when MAINBOARD has empty lead managers array', () => {
      const mainboardIPO = {
        companyName: 'TEST MAINBOARD LIMITED',
        issueSize: 100000000,
        priceRangeMin: 500,
        priceRangeMax: 550,
        openDate: '2024-05-01',
        closeDate: '2024-05-03',
        listingExchange: 'NSE',
        category: 'MAINBOARD' as const,
        status: 'UPCOMING' as const,
        lotSize: 25,
        faceValue: 10,
        symbol: 'TESTMB',
        leadManagers: [] // Empty array should fail for MAINBOARD
      };

      const result = ScrapedIPOSchema.safeParse(mainboardIPO);
      expect(result.success).toBe(false);

      if (!result.success) {
        const errorMessage = result.error.issues[0].message;
        expect(errorMessage).toContain('Symbol and leadManagers are required for MAINBOARD/SME IPOs');
      }
    });
  });

  describe('Edge Cases - Conditional Validation', () => {
    it('should handle MAINBOARD with symbol but empty string leadManagers', () => {
      const mainboardIPO = {
        companyName: 'EDGE CASE LIMITED',
        issueSize: 80000000,
        priceRangeMin: 300,
        priceRangeMax: 350,
        openDate: '2024-06-01',
        closeDate: '2024-06-03',
        listingExchange: 'NSE',
        category: 'MAINBOARD' as const,
        status: 'UPCOMING' as const,
        lotSize: 30,
        faceValue: 10,
        symbol: 'EDGECASE',
        leadManagers: [''] // Array with empty string
      };

      const result = ScrapedIPOSchema.safeParse(mainboardIPO);
      // Should pass schema validation (array exists, has length)
      expect(result.success).toBe(true);
    });

    it('should handle price range where min equals max (valid for RIGHTS/NCD)', () => {
      const rightsIPO = {
        companyName: 'PRICE EQUALITY RIGHTS',
        issueSize: 20000000,
        priceRangeMin: 100,
        priceRangeMax: 100, // Equal prices (valid for RIGHTS/NCD)
        openDate: '2024-03-01',
        closeDate: '2024-03-08',
        listingExchange: 'BSE',
        category: 'RIGHTS' as const,
        status: 'UPCOMING' as const,
        lotSize: 50,
        faceValue: 10,
        symbol: null,
        leadManagers: null
      };

      const result = ScrapedIPOSchema.safeParse(rightsIPO);
      expect(result.success).toBe(true);
    });
  });
});
