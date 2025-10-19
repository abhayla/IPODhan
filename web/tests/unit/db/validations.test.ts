import { describe, it, expect } from 'vitest';
import {
  insertIPOSchema,
  insertSubscriptionSchema,
  insertGMPRecordSchema,
  insertFinancialDataSchema,
  insertDocumentSchema,
  insertListingPerformanceSchema,
  insertMarketHolidaySchema,
  insertRegistrarSchema,
  insertPeerCompanySchema,
  insertBrokerAffiliateSchema,
  validatePriceRange,
  validateIPODates,
} from '../../../lib/db/validations';

describe('Database Validation Schemas', () => {
  describe('IPO Validation', () => {
    it('should validate a valid IPO insert', () => {
      const validIPO = {
        companyName: 'Test Company',
        slug: 'test-company',
        segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
        status: 'UPCOMING',
      };

      const result = insertIPOSchema.safeParse(validIPO);
      expect(result.success).toBe(true);
    });

    it('should reject IPO with invalid slug format', () => {
      const invalidIPO = {
        companyName: 'Test Company',
        slug: 'Test Company!', // Invalid characters
        segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
        status: 'UPCOMING',
      };

      const result = insertIPOSchema.safeParse(invalidIPO);
      expect(result.success).toBe(false);
    });

    it('should reject IPO with invalid rating', () => {
      const invalidIPO = {
        companyName: 'Test Company',
        slug: 'test-company',
        segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
        status: 'UPCOMING',
        rating: 6, // Rating must be 1-5
      };

      const result = insertIPOSchema.safeParse(invalidIPO);
      expect(result.success).toBe(false);
    });

    it('should accept IPO with optional fields', () => {
      const validIPO = {
        companyName: 'Test Company',
        slug: 'test-company',
        segment: 'SME' as const,
  offeringType: 'IPO' as const,
        status: 'OPEN',
        sector: 'Technology',
        issueSize: '100.50',
        priceRangeMin: 100,
        priceRangeMax: 120,
        lotSize: 100,
        rating: 4,
      };

      const result = insertIPOSchema.safeParse(validIPO);
      expect(result.success).toBe(true);
    });
  });

  describe('Subscription Validation', () => {
    it('should validate a valid subscription insert', () => {
      const validSubscription = {
        ipoId: '123e4567-e89b-12d3-a456-426614174000',
        timestamp: new Date(),
        totalSubscription: '5.50',
        qibSubscription: '2.50',
      };

      const result = insertSubscriptionSchema.safeParse(validSubscription);
      expect(result.success).toBe(true);
    });

    it('should reject subscription with invalid UUID', () => {
      const invalidSubscription = {
        ipoId: 'invalid-uuid',
        timestamp: new Date(),
        totalSubscription: '5.50',
      };

      const result = insertSubscriptionSchema.safeParse(invalidSubscription);
      expect(result.success).toBe(false);
    });

    it('should reject subscription with negative applications', () => {
      const invalidSubscription = {
        ipoId: '123e4567-e89b-12d3-a456-426614174000',
        timestamp: new Date(),
        totalApplications: -100, // Must be non-negative
      };

      const result = insertSubscriptionSchema.safeParse(invalidSubscription);
      expect(result.success).toBe(false);
    });
  });

  describe('GMP Record Validation', () => {
    it('should validate a valid GMP record insert', () => {
      const validGMPRecord = {
        ipoId: '123e4567-e89b-12d3-a456-426614174000',
        timestamp: new Date(),
        gmp: 50,
        expectedListingPrice: 150,
        source: 'Grey Market Source',
      };

      const result = insertGMPRecordSchema.safeParse(validGMPRecord);
      expect(result.success).toBe(true);
    });

    it('should validate GMP record with enhanced fields', () => {
      const validGMPRecord = {
        ipoId: '123e4567-e89b-12d3-a456-426614174000',
        timestamp: new Date(),
        gmp: 50,
        expectedListingPrice: 150,
        subjectRate: 20,
        kostakRate: 15,
        saudaDetails: 'Active trading in grey market',
        source: 'Grey Market Source',
      };

      const result = insertGMPRecordSchema.safeParse(validGMPRecord);
      expect(result.success).toBe(true);
    });

    it('should reject GMP record without source', () => {
      const invalidGMPRecord = {
        ipoId: '123e4567-e89b-12d3-a456-426614174000',
        timestamp: new Date(),
        gmp: 50,
      };

      const result = insertGMPRecordSchema.safeParse(invalidGMPRecord);
      expect(result.success).toBe(false);
    });
  });

  describe('Financial Data Validation', () => {
    it('should validate a valid financial data insert', () => {
      const validFinancialData = {
        ipoId: '123e4567-e89b-12d3-a456-426614174000',
        revenueFy2024: '100.00',
        profitFy2024: '15.00',
        netWorth: '500.00',
      };

      const result = insertFinancialDataSchema.safeParse(validFinancialData);
      expect(result.success).toBe(true);
    });
  });

  describe('Document Validation', () => {
    it('should validate a valid document insert', () => {
      const validDocument = {
        ipoId: '123e4567-e89b-12d3-a456-426614174000',
        type: 'DRHP',
        title: 'Draft Prospectus',
        url: 'https://example.com/drhp.pdf',
        fileSize: 1024000,
      };

      const result = insertDocumentSchema.safeParse(validDocument);
      expect(result.success).toBe(true);
    });

    it('should reject document with invalid URL', () => {
      const invalidDocument = {
        ipoId: '123e4567-e89b-12d3-a456-426614174000',
        type: 'DRHP',
        title: 'Draft Prospectus',
        url: 'not-a-valid-url',
      };

      const result = insertDocumentSchema.safeParse(invalidDocument);
      expect(result.success).toBe(false);
    });

    it('should reject document with negative file size', () => {
      const invalidDocument = {
        ipoId: '123e4567-e89b-12d3-a456-426614174000',
        type: 'DRHP',
        title: 'Draft Prospectus',
        url: 'https://example.com/drhp.pdf',
        fileSize: -1000,
      };

      const result = insertDocumentSchema.safeParse(invalidDocument);
      expect(result.success).toBe(false);
    });
  });

  describe('Listing Performance Validation', () => {
    it('should validate a valid listing performance insert', () => {
      const validListingPerformance = {
        ipoId: '123e4567-e89b-12d3-a456-426614174000',
        listingPrice: 150,
        issuePrice: 100,
        listingGainPercent: '50.00',
      };

      const result = insertListingPerformanceSchema.safeParse(validListingPerformance);
      expect(result.success).toBe(true);
    });

    it('should reject listing performance with negative prices', () => {
      const invalidListingPerformance = {
        ipoId: '123e4567-e89b-12d3-a456-426614174000',
        listingPrice: -150,
        issuePrice: 100,
        listingGainPercent: '50.00',
      };

      const result = insertListingPerformanceSchema.safeParse(invalidListingPerformance);
      expect(result.success).toBe(false);
    });
  });

  describe('Market Holiday Validation', () => {
    it('should validate a valid market holiday insert', () => {
      const validHoliday = {
        date: new Date('2025-01-26'),
        description: 'Republic Day',
        exchange: 'BOTH',
        type: 'TRADING',
        year: 2025,
      };

      const result = insertMarketHolidaySchema.safeParse(validHoliday);
      expect(result.success).toBe(true);
    });

    it('should reject holiday with invalid year', () => {
      const invalidHoliday = {
        date: new Date('2025-01-26'),
        description: 'Republic Day',
        exchange: 'BOTH',
        type: 'TRADING',
        year: 1999, // Year must be >= 2000
      };

      const result = insertMarketHolidaySchema.safeParse(invalidHoliday);
      expect(result.success).toBe(false);
    });
  });

  describe('Registrar Validation', () => {
    it('should validate a valid registrar insert', () => {
      const validRegistrar = {
        name: 'Link Intime India Pvt Ltd',
        shortName: 'Link Intime',
        email: 'ipo@linkintime.co.in',
        website: 'https://www.linkintime.co.in',
        active: true,
      };

      const result = insertRegistrarSchema.safeParse(validRegistrar);
      expect(result.success).toBe(true);
    });

    it('should reject registrar with invalid email', () => {
      const invalidRegistrar = {
        name: 'Link Intime India Pvt Ltd',
        email: 'not-an-email',
      };

      const result = insertRegistrarSchema.safeParse(invalidRegistrar);
      expect(result.success).toBe(false);
    });

    it('should reject registrar with invalid website URL', () => {
      const invalidRegistrar = {
        name: 'Link Intime India Pvt Ltd',
        website: 'not-a-url',
      };

      const result = insertRegistrarSchema.safeParse(invalidRegistrar);
      expect(result.success).toBe(false);
    });
  });

  describe('Peer Company Validation', () => {
    it('should validate a valid peer company insert', () => {
      const validPeerCompany = {
        ipoId: '123e4567-e89b-12d3-a456-426614174000',
        companyName: 'Peer Company Ltd',
        sector: 'Technology',
        isListed: true,
        peRatio: '18.50',
      };

      const result = insertPeerCompanySchema.safeParse(validPeerCompany);
      expect(result.success).toBe(true);
    });
  });

  describe('Broker Affiliate Validation', () => {
    it('should validate a valid broker affiliate insert', () => {
      const validBrokerAffiliate = {
        brokerName: 'Zerodha',
        affiliateUrl: 'https://zerodha.com/open-account',
        displayText: 'Open Demat Account',
        active: true,
        displayOrder: 1,
      };

      const result = insertBrokerAffiliateSchema.safeParse(validBrokerAffiliate);
      expect(result.success).toBe(true);
    });

    it('should reject broker affiliate with invalid URL', () => {
      const invalidBrokerAffiliate = {
        brokerName: 'Zerodha',
        affiliateUrl: 'not-a-valid-url',
      };

      const result = insertBrokerAffiliateSchema.safeParse(invalidBrokerAffiliate);
      expect(result.success).toBe(false);
    });

    it('should reject broker affiliate with negative display order', () => {
      const invalidBrokerAffiliate = {
        brokerName: 'Zerodha',
        affiliateUrl: 'https://zerodha.com/open-account',
        displayOrder: -1,
      };

      const result = insertBrokerAffiliateSchema.safeParse(invalidBrokerAffiliate);
      expect(result.success).toBe(false);
    });
  });

  describe('Custom Validation Schemas', () => {
    describe('Price Range Validation', () => {
      it('should validate when min <= max', () => {
        const validPriceRange = {
          priceRangeMin: 100,
          priceRangeMax: 120,
        };

        const result = validatePriceRange.safeParse(validPriceRange);
        expect(result.success).toBe(true);
      });

      it('should reject when min > max', () => {
        const invalidPriceRange = {
          priceRangeMin: 120,
          priceRangeMax: 100,
        };

        const result = validatePriceRange.safeParse(invalidPriceRange);
        expect(result.success).toBe(false);
      });

      it('should accept when only one value is provided', () => {
        const partialPriceRange = {
          priceRangeMin: 100,
        };

        const result = validatePriceRange.safeParse(partialPriceRange);
        expect(result.success).toBe(true);
      });
    });

    describe('IPO Dates Validation', () => {
      it('should validate when openDate <= closeDate', () => {
        const validDates = {
          openDate: new Date('2025-01-01'),
          closeDate: new Date('2025-01-03'),
        };

        const result = validateIPODates.safeParse(validDates);
        expect(result.success).toBe(true);
      });

      it('should reject when openDate > closeDate', () => {
        const invalidDates = {
          openDate: new Date('2025-01-03'),
          closeDate: new Date('2025-01-01'),
        };

        const result = validateIPODates.safeParse(invalidDates);
        expect(result.success).toBe(false);
      });

      it('should accept when only one date is provided', () => {
        const partialDates = {
          openDate: new Date('2025-01-01'),
        };

        const result = validateIPODates.safeParse(partialDates);
        expect(result.success).toBe(true);
      });
    });
  });
});
