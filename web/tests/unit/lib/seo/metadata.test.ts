import { describe, it, expect } from 'vitest';
import {
  generateHomepageMetadata,
  generateIPOListingMetadata,
  generateIPODetailMetadata,
  generateLotCalculatorMetadata,
  generateComparisonToolMetadata,
  generateRegistrarsMetadata,
  generateMarketHolidaysMetadata,
  generateHistoricalIPOsMetadata,
  ipoToMetadataParams,
} from '@/lib/seo/metadata';
import type { IPOMetadataParams } from '@/lib/seo/metadata';
import type { IPO } from '@/lib/db/types';

describe('SEO Metadata Generation', () => {
  describe('generateHomepageMetadata', () => {
    it('should generate valid homepage metadata', () => {
      const metadata = generateHomepageMetadata();

      expect(metadata.title).toBeDefined();
      expect(metadata.description).toBeDefined();
      expect(metadata.openGraph).toBeDefined();
      expect(metadata.twitter).toBeDefined();
      expect(metadata.alternates?.canonical).toBeDefined();
    });

    it('should have title length < 60 characters', () => {
      const metadata = generateHomepageMetadata();
      expect(metadata.title?.toString().length).toBeLessThanOrEqual(60);
    });

    it('should have description length < 160 characters', () => {
      const metadata = generateHomepageMetadata();
      expect(metadata.description?.toString().length).toBeLessThanOrEqual(160);
    });

    it('should include Open Graph tags', () => {
      const metadata = generateHomepageMetadata();
      expect(metadata.openGraph?.title).toBeDefined();
      expect(metadata.openGraph?.description).toBeDefined();
      expect((metadata.openGraph as { type?: string })?.type).toBe('website');
      expect(metadata.openGraph?.images).toBeDefined();
    });

    it('should include Twitter Card tags', () => {
      const metadata = generateHomepageMetadata();
      expect((metadata.twitter as { card?: string })?.card).toBe('summary_large_image');
      expect(metadata.twitter?.title).toBeDefined();
      expect(metadata.twitter?.description).toBeDefined();
    });
  });

  describe('generateIPOListingMetadata', () => {
    it('should generate valid IPO listing metadata', () => {
      const metadata = generateIPOListingMetadata();

      expect(metadata.title).toContain('IPO');
      expect(metadata.description).toBeDefined();
      expect(metadata.alternates?.canonical).toContain('/ipos');
    });

    it('should have proper SEO tags', () => {
      const metadata = generateIPOListingMetadata();
      expect(metadata.title?.toString().length).toBeLessThanOrEqual(60);
      expect(metadata.description?.toString().length).toBeLessThanOrEqual(160);
    });
  });

  describe('generateIPODetailMetadata', () => {
    const mockParams: IPOMetadataParams = {
      companyName: 'Test Company',
      slug: 'test-company-ipo',
      description: 'A leading technology company offering innovative solutions',
      priceMin: 100,
      priceMax: 120,
      openDate: new Date('2025-01-15'),
      closeDate: new Date('2025-01-17'),
      sector: 'Technology',
    };

    it('should generate valid IPO detail metadata', () => {
      const metadata = generateIPODetailMetadata(mockParams);

      expect(metadata.title).toContain('Test Company');
      expect(metadata.description).toBeDefined();
      expect(metadata.alternates?.canonical).toContain('test-company-ipo');
    });

    it('should include company name in title', () => {
      const metadata = generateIPODetailMetadata(mockParams);
      expect(metadata.title).toContain('Test Company');
    });

    it('should include price range in description', () => {
      const metadata = generateIPODetailMetadata(mockParams);
      expect(metadata.description).toContain('₹100');
      expect(metadata.description).toContain('₹120');
    });

    it('should respect description length limit', () => {
      const metadata = generateIPODetailMetadata(mockParams);
      expect(metadata.description?.toString().length).toBeLessThanOrEqual(160);
    });

    it('should handle missing price data gracefully', () => {
      const paramsWithoutPrice: IPOMetadataParams = {
        companyName: 'Test Company',
        slug: 'test-company-ipo',
        priceMin: null,
        priceMax: null,
        openDate: null,
        closeDate: null,
        sector: null,
      };

      const metadata = generateIPODetailMetadata(paramsWithoutPrice);
      expect(metadata.title).toContain('Test Company');
      expect(metadata.description).toBeDefined();
    });

    it('should include Open Graph image', () => {
      const metadata = generateIPODetailMetadata(mockParams);
      expect(metadata.openGraph?.images).toBeDefined();
      expect(Array.isArray(metadata.openGraph?.images)).toBe(true);
    });
  });

  describe('generateLotCalculatorMetadata', () => {
    it('should generate valid lot calculator metadata', () => {
      const metadata = generateLotCalculatorMetadata();

      expect(metadata.title).toContain('Calculator');
      expect(metadata.description).toBeDefined();
      expect(metadata.alternates?.canonical).toContain('lot-calculator');
    });
  });

  describe('generateComparisonToolMetadata', () => {
    it('should generate valid comparison tool metadata', () => {
      const metadata = generateComparisonToolMetadata();

      expect(metadata.title).toContain('Comparison');
      expect(metadata.description).toBeDefined();
      expect(metadata.alternates?.canonical).toContain('compare');
    });
  });

  describe('generateRegistrarsMetadata', () => {
    it('should generate valid registrars metadata', () => {
      const metadata = generateRegistrarsMetadata();

      expect(metadata.title).toContain('Registrar');
      expect(metadata.description).toBeDefined();
      expect(metadata.alternates?.canonical).toContain('registrars');
    });
  });

  describe('generateMarketHolidaysMetadata', () => {
    it('should generate valid market holidays metadata', () => {
      const metadata = generateMarketHolidaysMetadata();

      expect(metadata.title).toContain('Market Holidays');
      expect(metadata.description).toBeDefined();
      expect(metadata.alternates?.canonical).toContain('market-holidays');
    });
  });

  describe('generateHistoricalIPOsMetadata', () => {
    it('should generate valid historical IPOs metadata', () => {
      const metadata = generateHistoricalIPOsMetadata();

      expect(metadata.title).toContain('Historical');
      expect(metadata.description).toBeDefined();
      expect(metadata.alternates?.canonical).toContain('history');
    });
  });

  describe('ipoToMetadataParams', () => {
    const mockIPO: Partial<IPO> = {
      id: '1' as any, // UUID in real schema
      companyName: 'Test Company',
      slug: 'test-company-ipo',
      companyDescription: 'A test company',
      priceRangeMin: 100,
      priceRangeMax: 120,
      openDate: '2025-01-15', // date type from Drizzle
      closeDate: '2025-01-17', // date type from Drizzle
      sector: 'Technology',
    };

    it('should convert IPO to metadata params correctly', () => {
      const params = ipoToMetadataParams(mockIPO as IPO);

      expect(params.companyName).toBe('Test Company');
      expect(params.slug).toBe('test-company-ipo');
      expect(params.description).toBe('A test company');
      expect(params.priceMin).toBe(100);
      expect(params.priceMax).toBe(120);
      expect(params.sector).toBe('Technology');
    });

    it('should handle null values gracefully', () => {
      const ipoWithNulls: Partial<IPO> = {
        id: '1' as any, // UUID in real schema
        companyName: 'Test Company',
        slug: 'test-company-ipo',
        companyDescription: null,
        priceRangeMin: null,
        priceRangeMax: null,
        openDate: null,
        closeDate: null,
        sector: null,
      };

      const params = ipoToMetadataParams(ipoWithNulls as IPO);
      expect(params.companyName).toBe('Test Company');
      expect(params.description).toBeNull();
    });
  });

  describe('Canonical URLs', () => {
    it('should generate absolute canonical URLs', () => {
      const homepageMeta = generateHomepageMetadata();
      expect(homepageMeta.alternates?.canonical).toMatch(/^https?:\/\//);

      const ipoListingMeta = generateIPOListingMetadata();
      expect(ipoListingMeta.alternates?.canonical).toMatch(/^https?:\/\//);
    });

    it('should have consistent base URL across all metadata', () => {
      const baseUrlRegex = /(https?:\/\/[^/]+)/;

      const homepageMeta = generateHomepageMetadata();
      const homeCanonical = String(homepageMeta.alternates?.canonical || '');
      const homeBase = homeCanonical.match(baseUrlRegex)?.[1];

      const ipoListingMeta = generateIPOListingMetadata();
      const listingCanonical = String(ipoListingMeta.alternates?.canonical || '');
      const listingBase = listingCanonical.match(baseUrlRegex)?.[1];

      expect(homeBase).toBe(listingBase);
    });
  });
});
