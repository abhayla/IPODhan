import { describe, it, expect } from 'vitest';
import {
  generateOrganizationSchema,
  generateFinancialProductSchema,
  generateBreadcrumbSchema,
  toJsonLdScript,
  generateIPODetailBreadcrumbs,
  generateToolsBreadcrumbs,
  generateHistoricalIPOsBreadcrumbs,
  generateRegistrarsBreadcrumbs,
  generateMarketHolidaysBreadcrumbs,
} from '@/lib/seo/structured-data';
import type { BreadcrumbItem } from '@/lib/seo/structured-data';
import type { IPO } from '@/lib/db/types';

describe('Structured Data (JSON-LD) Generation', () => {
  describe('generateOrganizationSchema', () => {
    it('should generate valid Organization schema', () => {
      const schema = generateOrganizationSchema();

      expect(schema['@context']).toBe('https://schema.org');
      expect(schema['@type']).toBe('Organization');
      expect(schema.name).toBe('IPODhan');
      expect(schema.url).toBeDefined();
      expect(schema.logo).toBeDefined();
      expect(schema.description).toBeDefined();
    });

    it('should include social media links', () => {
      const schema = generateOrganizationSchema();
      expect(Array.isArray(schema.sameAs)).toBe(true);
      expect(schema.sameAs.length).toBeGreaterThan(0);
    });

    it('should include contact point', () => {
      const schema = generateOrganizationSchema();
      expect(schema.contactPoint).toBeDefined();
      expect(schema.contactPoint?.['@type']).toBe('ContactPoint');
    });
  });

  describe('generateFinancialProductSchema', () => {
    const mockIPO: Partial<IPO> = {
      id: '1' as any, // UUID in real schema
      companyName: 'Test Company',
      slug: 'test-company-ipo',
      companyDescription: 'A leading technology company',
      priceRangeMin: 100,
      priceRangeMax: 120,
      status: 'OPEN',
      openDate: '2025-01-15', // date type from Drizzle
      closeDate: '2025-01-17', // date type from Drizzle
    };

    it('should generate valid FinancialProduct schema', () => {
      const schema = generateFinancialProductSchema(mockIPO as IPO);

      expect(schema['@context']).toBe('https://schema.org');
      expect(schema['@type']).toBe('FinancialProduct');
      expect(schema.name).toContain('Test Company');
      expect(schema.category).toBe('Initial Public Offering');
    });

    it('should include provider information', () => {
      const schema = generateFinancialProductSchema(mockIPO as IPO);

      expect(schema.provider).toBeDefined();
      expect(schema.provider['@type']).toBe('Corporation');
      expect(schema.provider.name).toBe('Test Company');
    });

    it('should include offer details when price range is available', () => {
      const schema = generateFinancialProductSchema(mockIPO as IPO);

      expect(schema.offers).toBeDefined();
      expect(schema.offers?.['@type']).toBe('Offer');
      expect(schema.offers?.priceCurrency).toBe('INR');
      expect(schema.offers?.price).toContain('₹100');
      expect(schema.offers?.price).toContain('₹120');
    });

    it('should set correct availability based on status', () => {
      const openIPO = { ...mockIPO, status: 'OPEN' as const };
      const schema = generateFinancialProductSchema(openIPO as IPO);
      expect(schema.offers?.availability).toBe('https://schema.org/InStock');

      const closedIPO = { ...mockIPO, status: 'CLOSED' as const };
      const closedSchema = generateFinancialProductSchema(closedIPO as IPO);
      expect(closedSchema.offers?.availability).toBe('https://schema.org/SoldOut');

      const upcomingIPO = { ...mockIPO, status: 'UPCOMING' as const };
      const upcomingSchema = generateFinancialProductSchema(upcomingIPO as IPO);
      expect(upcomingSchema.offers?.availability).toBe('https://schema.org/PreOrder');
    });

    it('should include valid dates when available', () => {
      const schema = generateFinancialProductSchema(mockIPO as IPO);

      expect(schema.offers?.validFrom).toBeDefined();
      expect(schema.offers?.validThrough).toBeDefined();
      expect(new Date(schema.offers!.validFrom!).toISOString()).toBe(
        new Date('2025-01-15').toISOString()
      );
    });

    it('should handle IPO without price range', () => {
      const ipoWithoutPrice: Partial<IPO> = {
        ...mockIPO,
        priceRangeMin: null,
        priceRangeMax: null,
      };

      const schema = generateFinancialProductSchema(ipoWithoutPrice as IPO);
      expect(schema.offers).toBeUndefined();
    });
  });

  describe('generateBreadcrumbSchema', () => {
    const mockBreadcrumbs: BreadcrumbItem[] = [
      { name: 'Home', url: 'https://ipodhan.com' },
      { name: 'IPOs', url: 'https://ipodhan.com/ipos' },
      { name: 'Test Company IPO', url: 'https://ipodhan.com/ipos/test-company' },
    ];

    it('should generate valid BreadcrumbList schema', () => {
      const schema = generateBreadcrumbSchema(mockBreadcrumbs);

      expect(schema['@context']).toBe('https://schema.org');
      expect(schema['@type']).toBe('BreadcrumbList');
      expect(schema.itemListElement).toBeDefined();
      expect(Array.isArray(schema.itemListElement)).toBe(true);
    });

    it('should have correct number of breadcrumb items', () => {
      const schema = generateBreadcrumbSchema(mockBreadcrumbs);
      expect(schema.itemListElement.length).toBe(3);
    });

    it('should have sequential positions starting from 1', () => {
      const schema = generateBreadcrumbSchema(mockBreadcrumbs);

      schema.itemListElement.forEach((item, index) => {
        expect(item.position).toBe(index + 1);
      });
    });

    it('should include URL for all items except the last one', () => {
      const schema = generateBreadcrumbSchema(mockBreadcrumbs);

      // First and second should have URLs
      expect(schema.itemListElement[0].item).toBeDefined();
      expect(schema.itemListElement[1].item).toBeDefined();

      // Last item should not have URL (current page)
      expect(schema.itemListElement[2].item).toBeUndefined();
    });

    it('should handle single breadcrumb item', () => {
      const singleBreadcrumb: BreadcrumbItem[] = [
        { name: 'Home', url: 'https://ipodhan.com' },
      ];

      const schema = generateBreadcrumbSchema(singleBreadcrumb);
      expect(schema.itemListElement.length).toBe(1);
      expect(schema.itemListElement[0].position).toBe(1);
      expect(schema.itemListElement[0].item).toBeUndefined();
    });
  });

  describe('toJsonLdScript', () => {
    it('should convert schema to valid JSON string', () => {
      const schema = generateOrganizationSchema();
      const jsonString = toJsonLdScript(schema);

      expect(typeof jsonString).toBe('string');
      expect(() => JSON.parse(jsonString)).not.toThrow();
    });

    it('should preserve schema structure', () => {
      const schema = generateOrganizationSchema();
      const jsonString = toJsonLdScript(schema);
      const parsed = JSON.parse(jsonString);

      expect(parsed['@context']).toBe(schema['@context']);
      expect(parsed['@type']).toBe(schema['@type']);
      expect(parsed.name).toBe(schema.name);
    });
  });

  describe('Breadcrumb Helper Functions', () => {
    describe('generateIPODetailBreadcrumbs', () => {
      it('should generate correct breadcrumb structure for IPO detail', () => {
        const breadcrumbs = generateIPODetailBreadcrumbs('Test Company', 'test-company-ipo');

        expect(breadcrumbs.length).toBe(3);
        expect(breadcrumbs[0].name).toBe('Home');
        expect(breadcrumbs[1].name).toBe('IPOs');
        expect(breadcrumbs[2].name).toContain('Test Company');
      });

      it('should have correct URLs', () => {
        const breadcrumbs = generateIPODetailBreadcrumbs('Test Company', 'test-company-ipo');

        expect(breadcrumbs[0].url).toMatch(/\/$/); // Home
        expect(breadcrumbs[1].url).toContain('/ipos');
        expect(breadcrumbs[2].url).toContain('test-company-ipo');
      });
    });

    describe('generateToolsBreadcrumbs', () => {
      it('should generate correct breadcrumb structure for tools', () => {
        const breadcrumbs = generateToolsBreadcrumbs('Lot Calculator', 'lot-calculator');

        expect(breadcrumbs.length).toBe(3);
        expect(breadcrumbs[0].name).toBe('Home');
        expect(breadcrumbs[1].name).toBe('Tools');
        expect(breadcrumbs[2].name).toBe('Lot Calculator');
      });
    });

    describe('generateHistoricalIPOsBreadcrumbs', () => {
      it('should generate correct breadcrumb structure for historical IPOs', () => {
        const breadcrumbs = generateHistoricalIPOsBreadcrumbs();

        expect(breadcrumbs.length).toBe(2);
        expect(breadcrumbs[0].name).toBe('Home');
        expect(breadcrumbs[1].name).toBe('Historical IPOs');
      });
    });

    describe('generateRegistrarsBreadcrumbs', () => {
      it('should generate correct breadcrumb structure for registrars', () => {
        const breadcrumbs = generateRegistrarsBreadcrumbs();

        expect(breadcrumbs.length).toBe(2);
        expect(breadcrumbs[0].name).toBe('Home');
        expect(breadcrumbs[1].name).toBe('Registrars');
      });
    });

    describe('generateMarketHolidaysBreadcrumbs', () => {
      it('should generate correct breadcrumb structure for market holidays', () => {
        const breadcrumbs = generateMarketHolidaysBreadcrumbs();

        expect(breadcrumbs.length).toBe(2);
        expect(breadcrumbs[0].name).toBe('Home');
        expect(breadcrumbs[1].name).toBe('Market Holidays');
      });
    });
  });

  describe('Schema Validation', () => {
    it('should have all required @context fields', () => {
      const orgSchema = generateOrganizationSchema();
      expect(orgSchema['@context']).toBe('https://schema.org');

      const mockIPO: Partial<IPO> = {
        id: '1' as any, // UUID in real schema
        companyName: 'Test',
        slug: 'test',
        status: 'OPEN',
      };
      const productSchema = generateFinancialProductSchema(mockIPO as IPO);
      expect(productSchema['@context']).toBe('https://schema.org');

      const breadcrumbSchema = generateBreadcrumbSchema([
        { name: 'Home', url: 'https://ipodhan.com' },
      ]);
      expect(breadcrumbSchema['@context']).toBe('https://schema.org');
    });

    it('should have all required @type fields', () => {
      const orgSchema = generateOrganizationSchema();
      expect(orgSchema['@type']).toBe('Organization');

      const mockIPO: Partial<IPO> = {
        id: '1' as any, // UUID in real schema
        companyName: 'Test',
        slug: 'test',
        status: 'OPEN',
      };
      const productSchema = generateFinancialProductSchema(mockIPO as IPO);
      expect(productSchema['@type']).toBe('FinancialProduct');

      const breadcrumbSchema = generateBreadcrumbSchema([
        { name: 'Home', url: 'https://ipodhan.com' },
      ]);
      expect(breadcrumbSchema['@type']).toBe('BreadcrumbList');
    });
  });
});
