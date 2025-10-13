/**
 * Integration Tests for Prospectus Scraper
 *
 * Tests full workflow with mocked HTML responses and database operations
 * Story 7.9: Prospectus Documents Scraper Implementation
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ProspectusScraper } from '../../sources/prospectus-scraper';
import { db } from '@/lib/db';
import { ipos, documents } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

describe('ProspectusScraper - Integration Tests', () => {
  let testIpoId: string;

  beforeAll(async () => {
    // Create a test IPO for matching
    const [testIPO] = await db
      .insert(ipos)
      .values({
        companyName: 'Test IPO Company Limited',
        slug: 'test-ipo-company-integration',
        category: 'MAINBOARD',
        status: 'UPCOMING',
      })
      .returning();

    testIpoId = testIPO.id;
  });

  afterAll(async () => {
    // Clean up test data
    if (testIpoId) {
      await db.delete(documents).where(eq(documents.ipoId, testIpoId));
      await db.delete(ipos).where(eq(ipos.id, testIpoId));
    }
  });

  it('should match document to existing IPO', async () => {
    const scraper = new ProspectusScraper();

    const doc = {
      ipoName: 'Test IPO Company Ltd', // Similar to 'Test IPO Company Limited'
      documentType: 'DRHP' as const,
      title: 'Test IPO Company - DRHP',
      url: 'https://example.com/test-doc.pdf',
      fileSize: 1000,
      uploadedAt: new Date(),
      exchange: 'NSE' as const,
    };

    // @ts-ignore - accessing private method
    const match = await scraper.matchDocumentToIPO(doc);

    expect(match.ipoId).toBe(testIpoId);
    expect(match.score).toBeGreaterThanOrEqual(85);
  });

  it('should NOT match document with completely different name', async () => {
    const scraper = new ProspectusScraper();

    const doc = {
      ipoName: 'Completely Different Company XYZ',
      documentType: 'DRHP' as const,
      title: 'Different Company - DRHP',
      url: 'https://example.com/diff-doc.pdf',
      fileSize: 1000,
      uploadedAt: new Date(),
      exchange: 'NSE' as const,
    };

    // @ts-ignore - accessing private method
    const match = await scraper.matchDocumentToIPO(doc);

    expect(match.ipoId).toBeNull();
    expect(match.score).toBeLessThan(85);
  });

  it('should store document in database with matched IPO', async () => {
    const scraper = new ProspectusScraper();

    const matchedDoc = {
      ipoName: 'Test IPO Company',
      documentType: 'PROSPECTUS' as const,
      title: 'Test IPO Company - Prospectus',
      url: 'https://example.com/test-prospectus-integration.pdf',
      fileSize: 5000,
      uploadedAt: new Date(),
      exchange: 'NSE' as const,
      ipoId: testIpoId,
      matchScore: 95,
    };

    // @ts-ignore - accessing private method
    await scraper.storeDocuments([matchedDoc]);

    // Verify document was stored
    const storedDocs = await db
      .select()
      .from(documents)
      .where(eq(documents.url, 'https://example.com/test-prospectus-integration.pdf'));

    expect(storedDocs).toHaveLength(1);
    expect(storedDocs[0].ipoId).toBe(testIpoId);
    expect(storedDocs[0].type).toBe('PROSPECTUS');
    expect(storedDocs[0].exchange).toBe('NSE');

    // Clean up
    await db
      .delete(documents)
      .where(eq(documents.url, 'https://example.com/test-prospectus-integration.pdf'));
  });

  it('should handle duplicate URLs with upsert logic', async () => {
    const scraper = new ProspectusScraper();

    const doc1 = {
      ipoName: 'Test IPO Company',
      documentType: 'RHP' as const,
      title: 'Test IPO Company - RHP v1',
      url: 'https://example.com/test-rhp-duplicate.pdf',
      fileSize: 3000,
      uploadedAt: new Date(),
      exchange: 'NSE' as const,
      ipoId: testIpoId,
      matchScore: 95,
    };

    // Store first document
    // @ts-ignore
    await scraper.storeDocuments([doc1]);

    // Store same URL with updated title
    const doc2 = {
      ...doc1,
      title: 'Test IPO Company - RHP v2 Updated',
    };

    // @ts-ignore
    await scraper.storeDocuments([doc2]);

    // Verify only one document exists with updated title
    const storedDocs = await db
      .select()
      .from(documents)
      .where(eq(documents.url, 'https://example.com/test-rhp-duplicate.pdf'));

    expect(storedDocs).toHaveLength(1);
    expect(storedDocs[0].title).toBe('Test IPO Company - RHP v2 Updated');

    // Clean up
    await db
      .delete(documents)
      .where(eq(documents.url, 'https://example.com/test-rhp-duplicate.pdf'));
  });

  it('should skip documents without matched IPO', async () => {
    const scraper = new ProspectusScraper();

    const unmatchedDoc = {
      ipoName: 'Unmatched Company',
      documentType: 'DRHP' as const,
      title: 'Unmatched - DRHP',
      url: 'https://example.com/unmatched.pdf',
      fileSize: 2000,
      uploadedAt: new Date(),
      exchange: 'BSE' as const,
      ipoId: null,
      matchScore: 0,
    };

    // @ts-ignore
    await scraper.storeDocuments([unmatchedDoc]);

    // Verify document was NOT stored
    const storedDocs = await db
      .select()
      .from(documents)
      .where(eq(documents.url, 'https://example.com/unmatched.pdf'));

    expect(storedDocs).toHaveLength(0);
  });
});

describe('ProspectusScraper - Full Workflow Mock', () => {
  it('should handle zero documents gracefully', async () => {
    const scraper = new ProspectusScraper();

    // Mock fetchHTML to return empty HTML
    vi.spyOn(scraper as any, 'fetchHTML').mockResolvedValue({
      html: () => '<html><body><table></table></body></html>',
      text: () => '',
      $: () => ({
        each: () => {},
        find: () => ({ length: 0 }),
      }),
    });

    // @ts-ignore
    const nseResults = await scraper.scrapeNSE();
    expect(nseResults).toHaveLength(0);

    vi.restoreAllMocks();
  });
});
