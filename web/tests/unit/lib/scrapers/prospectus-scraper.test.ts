/**
 * Unit Tests for Prospectus Scraper
 *
 * Tests fuzzy matching, document validation, and URL validation
 * Story 7.9: Prospectus Documents Scraper Implementation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProspectusScraper } from '@/lib/scrapers/sources/prospectus-scraper';

describe('ProspectusScraper - Fuzzy Matching', () => {
  let scraper: ProspectusScraper;

  beforeEach(() => {
    scraper = new ProspectusScraper();
  });

  it('should match company names with similar variations', () => {
    const scraper = new ProspectusScraper();
    // @ts-ignore - accessing private method for testing
    const similarity1 = scraper.calculateSimilarity('Tech Corp Limited', 'Tech Corp Ltd');
    expect(similarity1).toBeGreaterThanOrEqual(85);
  });

  it('should match company names with different suffixes', () => {
    const scraper = new ProspectusScraper();
    // @ts-ignore
    const similarity = scraper.calculateSimilarity('ABC Industries Limited', 'ABC Industries Pvt Ltd');
    expect(similarity).toBeGreaterThanOrEqual(85);
  });

  it('should NOT match completely different company names', () => {
    const scraper = new ProspectusScraper();
    // @ts-ignore
    const similarity = scraper.calculateSimilarity('ABC Industries', 'XYZ Corporation');
    expect(similarity).toBeLessThan(85);
  });

  it('should normalize company names correctly', () => {
    const scraper = new ProspectusScraper();
    // @ts-ignore
    const normalized1 = scraper.normalizeCompanyName('Tech Corporation Limited');
    // @ts-ignore
    const normalized2 = scraper.normalizeCompanyName('Tech Corp Ltd');

    expect(normalized1).toBe('tech');
    expect(normalized2).toBe('tech');
  });

  it('should handle empty strings gracefully', () => {
    const scraper = new ProspectusScraper();
    // @ts-ignore
    const similarity = scraper.calculateSimilarity('', '');
    expect(similarity).toBe(0);
  });
});

describe('ProspectusScraper - Document Validation', () => {
  let scraper: ProspectusScraper;

  beforeEach(() => {
    scraper = new ProspectusScraper();
  });

  it('should validate correct document structure', () => {
    const scraper = new ProspectusScraper();
    // @ts-ignore
    const doc = scraper.validateDocument({
      ipoName: 'Test Company',
      documentType: 'DRHP',
      title: 'Test Company - DRHP',
      url: 'https://example.com/doc.pdf',
      fileSize: null,
      uploadedAt: null,
      exchange: 'NSE',
    });

    expect(doc).not.toBeNull();
    expect(doc?.ipoName).toBe('Test Company');
  });

  it('should reject document with invalid URL', () => {
    const scraper = new ProspectusScraper();
    // @ts-ignore
    const doc = scraper.validateDocument({
      ipoName: 'Test Company',
      documentType: 'DRHP',
      title: 'Test Company - DRHP',
      url: 'not-a-valid-url',
      fileSize: null,
      uploadedAt: null,
      exchange: 'NSE',
    });

    expect(doc).toBeNull();
  });

  it('should reject document with invalid document type', () => {
    const scraper = new ProspectusScraper();
    // @ts-ignore
    const doc = scraper.validateDocument({
      ipoName: 'Test Company',
      documentType: 'INVALID',
      title: 'Test Company - INVALID',
      url: 'https://example.com/doc.pdf',
      fileSize: null,
      uploadedAt: null,
      exchange: 'NSE',
    });

    expect(doc).toBeNull();
  });

  it('should reject document with empty IPO name', () => {
    const scraper = new ProspectusScraper();
    // @ts-ignore
    const doc = scraper.validateDocument({
      ipoName: '',
      documentType: 'DRHP',
      title: 'Test Company - DRHP',
      url: 'https://example.com/doc.pdf',
      fileSize: null,
      uploadedAt: null,
      exchange: 'NSE',
    });

    expect(doc).toBeNull();
  });
});

describe('ProspectusScraper - Document Merging', () => {
  let scraper: ProspectusScraper;

  beforeEach(() => {
    scraper = new ProspectusScraper();
  });

  it('should merge documents from both exchanges without duplicates', () => {
    const scraper = new ProspectusScraper();

    const nseDoc = {
      ipoName: 'Test Company',
      documentType: 'DRHP' as const,
      title: 'Test Company - DRHP',
      url: 'https://example.com/doc.pdf',
      fileSize: 1000,
      uploadedAt: new Date(),
      exchange: 'NSE' as const,
    };

    const bseDoc = {
      ipoName: 'Test Company',
      documentType: 'DRHP' as const,
      title: 'Test Company - DRHP',
      url: 'https://example.com/doc.pdf', // Same URL
      fileSize: 1000,
      uploadedAt: new Date(),
      exchange: 'BSE' as const,
    };

    // @ts-ignore
    const merged = scraper.mergeDocuments([nseDoc], [bseDoc]);

    expect(merged).toHaveLength(1);
    expect(merged[0].exchange).toBe('NSE'); // Should prefer NSE
  });

  it('should keep both documents if URLs are different', () => {
    const scraper = new ProspectusScraper();

    const nseDoc = {
      ipoName: 'Test Company',
      documentType: 'DRHP' as const,
      title: 'Test Company - DRHP',
      url: 'https://nse.com/doc.pdf',
      fileSize: 1000,
      uploadedAt: new Date(),
      exchange: 'NSE' as const,
    };

    const bseDoc = {
      ipoName: 'Test Company',
      documentType: 'DRHP' as const,
      title: 'Test Company - DRHP',
      url: 'https://bse.com/doc.pdf', // Different URL
      fileSize: 1000,
      uploadedAt: new Date(),
      exchange: 'BSE' as const,
    };

    // @ts-ignore
    const merged = scraper.mergeDocuments([nseDoc], [bseDoc]);

    expect(merged).toHaveLength(2);
  });

  it('should handle empty document arrays', () => {
    const scraper = new ProspectusScraper();
    // @ts-ignore
    const merged = scraper.mergeDocuments([], []);
    expect(merged).toHaveLength(0);
  });
});

describe('ProspectusScraper - URL Validation Edge Cases', () => {
  it('should handle URL validation timeout', async () => {
    const scraper = new ProspectusScraper();

    // Mock a slow URL that will timeout
    vi.spyOn(global, 'fetch').mockImplementation(() =>
      new Promise((resolve) => setTimeout(resolve, 15000))
    );

    // @ts-ignore
    const result = await scraper.validateDocumentUrl('https://slow-server.com/doc.pdf');

    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();

    vi.restoreAllMocks();
  }, 15000);

  it('should handle 404 errors', async () => {
    const scraper = new ProspectusScraper();

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers(),
    } as Response);

    // @ts-ignore
    const result = await scraper.validateDocumentUrl('https://example.com/not-found.pdf');

    expect(result.valid).toBe(false);
    expect(result.error).toContain('404');

    vi.restoreAllMocks();
  });

  it('should reject non-PDF content type', async () => {
    const scraper = new ProspectusScraper();

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
    } as Response);

    // @ts-ignore
    const result = await scraper.validateDocumentUrl('https://example.com/doc.html');

    expect(result.valid).toBe(false);
    expect(result.error).toContain('Not a PDF');

    vi.restoreAllMocks();
  });

  it('should extract file size from content-length header', async () => {
    const scraper = new ProspectusScraper();

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'application/pdf',
        'content-length': '1024000',
      }),
    } as Response);

    // @ts-ignore
    const result = await scraper.validateDocumentUrl('https://example.com/doc.pdf');

    expect(result.valid).toBe(true);
    expect(result.fileSize).toBe(1024000);

    vi.restoreAllMocks();
  });
});

describe('ProspectusScraper - Retry Logic', () => {
  it('should retry failed validation attempts', async () => {
    const scraper = new ProspectusScraper();

    let attempts = 0;
    vi.spyOn(global, 'fetch').mockImplementation(() => {
      attempts++;
      if (attempts < 3) {
        return Promise.reject(new Error('Network error'));
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/pdf' }),
      } as Response);
    });

    // @ts-ignore
    const result = await scraper.validateWithRetry('https://example.com/doc.pdf', 2);

    expect(attempts).toBe(3); // Initial attempt + 2 retries
    expect(result.valid).toBe(true);

    vi.restoreAllMocks();
  }, 20000);

  it('should fail after max retries', async () => {
    const scraper = new ProspectusScraper();

    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

    // @ts-ignore
    const result = await scraper.validateWithRetry('https://example.com/doc.pdf', 2);

    expect(result.valid).toBe(false);
    expect(result.error).toContain('Max retries exceeded');

    vi.restoreAllMocks();
  }, 20000);
});

describe('ProspectusScraper - Fuzzy Matching Threshold', () => {
  it('should not match when similarity is below 85% threshold', async () => {
    const scraper = new ProspectusScraper();

    // Mock database query to return no results
    const doc = {
      ipoName: 'Completely Different Company Name',
      documentType: 'DRHP' as const,
      title: 'Test',
      url: 'https://example.com/doc.pdf',
      fileSize: null,
      uploadedAt: null,
      exchange: 'NSE' as const,
    };

    // Note: This test would require mocking the database
    // For now, we test the similarity calculation directly
    // @ts-ignore
    const similarity = scraper.calculateSimilarity('Tech Corp', 'Completely Different Company');
    expect(similarity).toBeLessThan(85);
  });
});
