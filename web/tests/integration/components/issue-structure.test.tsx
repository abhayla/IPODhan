/**
 * Integration Tests for Issue Structure Feature (Story 4.11)
 * Tests end-to-end data flow from API to component rendering
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { db } from '@/lib/db';
import { ipos, ipoDetails } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IssueStructureSection } from '@/components/ipo/IssueStructureSection';

describe('Issue Structure Integration Tests', () => {
  let testIpoId: string;
  const redis = getRedisClient();

  beforeAll(async () => {
    // Create test IPO
    const [testIPO] = await db.insert(ipos).values({
      companyName: 'Test Issue Structure IPO Ltd',
      slug: 'test-issue-structure-ipo',
      segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
      status: 'OPEN',
      openDate: '2025-01-15',
      closeDate: '2025-01-17',
      priceRangeMin: 100,
      priceRangeMax: 120,
      lotSize: 100,
      issueSize: '500',
      sector: 'Technology',
    }).returning();

    testIpoId = testIPO.id;

    // Create ipo_details record
    await db.insert(ipoDetails).values({
      ipoId: testIpoId,
      issueType: 'BOOK_BUILDING',
      freshIssue: '400',
      ofsIssue: '100',
      minInvestment: '12000',
      cutOffPrice: '115',
      registrarLink: 'https://www.kfintech.com/test',
      isin: 'INE999TEST99',
      faceValue: '10',
      dataSource: 'TEST',
    });
  });

  afterAll(async () => {
    // Clean up test data
    await db.delete(ipoDetails).where(eq(ipoDetails.ipoId, testIpoId));
    await db.delete(ipos).where(eq(ipos.id, testIpoId));
  });

  describe('Repository Integration', () => {
    it('should fetch IPO with ipo_details from repository', async () => {
      const repository = new IPORepository(db, redis);
      const ipo = await repository.findBySlug('test-issue-structure-ipo');

      expect(ipo).not.toBeNull();
      expect(ipo?.ipoDetails).not.toBeNull();
      expect(ipo?.ipoDetails?.issueType).toBe('BOOK_BUILDING');
      expect(ipo?.ipoDetails?.freshIssue).toBe('400');
      expect(ipo?.ipoDetails?.ofsIssue).toBe('100');
    });

    it('should include all issue structure fields', async () => {
      const repository = new IPORepository(db, redis);
      const ipo = await repository.findBySlug('test-issue-structure-ipo');

      expect(ipo?.ipoDetails?.minInvestment).toBe('12000');
      expect(ipo?.ipoDetails?.cutOffPrice).toBe('115');
      expect(ipo?.ipoDetails?.registrarLink).toBe('https://www.kfintech.com/test');
      expect(ipo?.ipoDetails?.isin).toBe('INE999TEST99');
    });
  });

  describe('Component Rendering with Real Data', () => {
    it('should render IssueStructureSection with fetched data', async () => {
      const repository = new IPORepository(db, redis);
      const ipo = await repository.findBySlug('test-issue-structure-ipo');

      render(<IssueStructureSection ipoDetails={ipo?.ipoDetails || null} />);

      await waitFor(() => {
        expect(screen.getByText('Issue Structure')).toBeInTheDocument();
        expect(screen.getByText('Book Building')).toBeInTheDocument();
      });
    });

    it('should display issue breakdown with correct values', async () => {
      const repository = new IPORepository(db, redis);
      const ipo = await repository.findBySlug('test-issue-structure-ipo');

      render(<IssueStructureSection ipoDetails={ipo?.ipoDetails || null} />);

      await waitFor(() => {
        // Fresh Issue: 400 Cr (80%)
        // OFS: 100 Cr (20%)
        expect(screen.getByText(/80\.0%/)).toBeInTheDocument();
        expect(screen.getByText(/20\.0%/)).toBeInTheDocument();
      });
    });

    it('should display minimum investment from database', async () => {
      const repository = new IPORepository(db, redis);
      const ipo = await repository.findBySlug('test-issue-structure-ipo');

      render(<IssueStructureSection ipoDetails={ipo?.ipoDetails || null} />);

      await waitFor(() => {
        expect(screen.getByText('₹12,000')).toBeInTheDocument();
      });
    });

    it('should display cut-off price for BOOK_BUILDING', async () => {
      const repository = new IPORepository(db, redis);
      const ipo = await repository.findBySlug('test-issue-structure-ipo');

      render(<IssueStructureSection ipoDetails={ipo?.ipoDetails || null} />);

      await waitFor(() => {
        expect(screen.getByText('Cut-Off Price')).toBeInTheDocument();
        expect(screen.getByText('₹115')).toBeInTheDocument();
      });
    });

    it('should display registrar link', async () => {
      const repository = new IPORepository(db, redis);
      const ipo = await repository.findBySlug('test-issue-structure-ipo');

      render(<IssueStructureSection ipoDetails={ipo?.ipoDetails || null} />);

      await waitFor(() => {
        const link = screen.getByText('Check Allotment Status');
        expect(link.closest('a')).toHaveAttribute('href', 'https://www.kfintech.com/test');
      });
    });
  });

  describe('Cache Integration', () => {
    it('should cache IPO data with ipo_details', async () => {
      const repository = new IPORepository(db, redis);

      // First fetch (populates cache)
      const firstFetch = await repository.findBySlug('test-issue-structure-ipo');

      // Second fetch (from cache)
      const secondFetch = await repository.findBySlug('test-issue-structure-ipo');

      expect(firstFetch?.ipoDetails).toEqual(secondFetch?.ipoDetails);
    });
  });

  describe('Null Data Handling', () => {
    let nullDataIpoId: string;

    beforeAll(async () => {
      // Create IPO without ipo_details
      const [nullIPO] = await db.insert(ipos).values({
        companyName: 'No Details IPO Ltd',
        slug: 'no-details-ipo',
        segment: 'SME' as const,
  offeringType: 'IPO' as const,
        status: 'UPCOMING',
        openDate: '2025-02-01',
        closeDate: '2025-02-03',
        priceRangeMin: 50,
        priceRangeMax: 60,
        lotSize: 1000,
        issueSize: '50',
        sector: 'Manufacturing',
      }).returning();

      nullDataIpoId = nullIPO.id;
    });

    afterAll(async () => {
      await db.delete(ipos).where(eq(ipos.id, nullDataIpoId));
    });

    it('should handle IPO without ipo_details gracefully', async () => {
      const repository = new IPORepository(db, redis);
      const ipo = await repository.findBySlug('no-details-ipo');

      expect(ipo).not.toBeNull();
      expect(ipo?.ipoDetails).toBeNull();
    });

    it('should render empty state when ipo_details is null', async () => {
      const repository = new IPORepository(db, redis);
      const ipo = await repository.findBySlug('no-details-ipo');

      render(<IssueStructureSection ipoDetails={ipo?.ipoDetails || null} />);

      await waitFor(() => {
        expect(screen.getByText('Issue structure data not available')).toBeInTheDocument();
      });
    });
  });
});
