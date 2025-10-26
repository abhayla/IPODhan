/**
 * Integration Tests for AnchorInvestorRepository (Story 11.10)
 *
 * Tests database operations, schema constraints, and cache behavior
 * Requires:
 * - PostgreSQL test database (ipodhan_test)
 * - Redis instance running
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { AnchorInvestorRepository } from '@/lib/repositories/anchor-investor-repository';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { db } from '@/lib/db/index';
import { getRedisClient, closeRedisClient } from '@/lib/cache/redis-client';
import { anchorInvestors, ipos } from '@/lib/db';
import { eq } from 'drizzle-orm';
import type { IndividualInvestor } from '@ipodhan/shared/db/schema';

// ==================== TEST FIXTURES ====================

const mockInvestorList: IndividualInvestor[] = [
  {
    name: 'HDFC Mutual Fund',
    type: 'Mutual Fund',
    shares: 500000,
    amount: 125.5,
    percentOfIssue: 2.5,
  },
  {
    name: 'SBI Life Insurance',
    type: 'Insurance',
    shares: 350000,
    amount: 87.75,
    percentOfIssue: 1.75,
  },
];

// ==================== TEST SUITE ====================

describe('AnchorInvestorRepository Integration Tests', () => {
  let repository: AnchorInvestorRepository;
  let ipoRepository: IPORepository;
  let redis: ReturnType<typeof getRedisClient>;
  let testIPOId: string;

  beforeAll(async () => {
    redis = getRedisClient();
    repository = new AnchorInvestorRepository(db, redis);
    ipoRepository = new IPORepository(db, redis);

    // Create test IPO for foreign key relationship
    const testIPO = await ipoRepository.create({
      slug: 'test-anchor-ipo',
      companyName: 'Test Anchor Company Ltd',
      segment: 'MAINBOARD' as const,
      offeringType: 'IPO' as const,
      status: 'UPCOMING' as const,
      sector: 'Technology',
    });
    testIPOId = testIPO.id;
  });

  afterAll(async () => {
    // Clean up test data
    await db.delete(anchorInvestors).where(eq(anchorInvestors.ipoId, testIPOId));
    await db.delete(ipos).where(eq(ipos.id, testIPOId));
    await closeRedisClient();
  });

  beforeEach(async () => {
    // Clear anchor investor data for this test IPO
    await db.delete(anchorInvestors).where(eq(anchorInvestors.ipoId, testIPOId));

    // Clear cache before each test
    const keys = await redis.keys('anchor:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  // ==================== TABLE CREATION & SCHEMA ====================

  describe('Table Creation and Schema', () => {
    it('should verify anchor_investors table exists with all columns', async () => {
      const result = await db.execute(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'anchor_investors'
        ORDER BY ordinal_position;
      `);

      const columns = result.rows.map((row: any) => row.column_name);

      // Verify all required columns exist
      expect(columns).toContain('id');
      expect(columns).toContain('ipo_id');
      expect(columns).toContain('bid_date');
      expect(columns).toContain('total_shares_offered');
      expect(columns).toContain('total_amount_raised');
      expect(columns).toContain('anchor_investors_count');
      expect(columns).toContain('lock_in_50_percent_date');
      expect(columns).toContain('lock_in_remaining_date');
      expect(columns).toContain('investor_list');
      expect(columns).toContain('created_at');
      expect(columns).toContain('updated_at');
    });

    it('should verify indexes exist on ipo_id and bid_date', async () => {
      const result = await db.execute(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'anchor_investors'
        AND schemaname = 'public';
      `);

      const indexes = result.rows.map((row: any) => row.indexname);

      expect(indexes).toContain('idx_anchor_investors_ipo_id');
      expect(indexes).toContain('idx_anchor_investors_bid_date');
    });
  });

  // ==================== FOREIGN KEY CONSTRAINT ====================

  describe('Foreign Key Constraint', () => {
    it('should insert successfully with valid ipo_id', async () => {
      const anchorData = {
        ipoId: testIPOId,
        bidDate: '2025-01-15',
        totalSharesOffered: 1000000,
        totalAmountRaised: '250.00',
        anchorInvestorsCount: 25,
        lockIn50PercentDate: '2025-02-14',
        lockInRemainingDate: '2025-04-15',
        investorList: mockInvestorList,
      };

      const result = await repository.create(anchorData);

      expect(result.id).toBeDefined();
      expect(result.ipoId).toBe(testIPOId);
    });

    it('should fail to insert with invalid ipo_id (foreign key violation)', async () => {
      const invalidIPOId = '00000000-0000-0000-0000-000000000000';

      const anchorData = {
        ipoId: invalidIPOId,
        bidDate: '2025-01-15',
        totalSharesOffered: 1000000,
        totalAmountRaised: '250.00',
        anchorInvestorsCount: 25,
        lockIn50PercentDate: '2025-02-14',
        lockInRemainingDate: '2025-04-15',
      };

      await expect(repository.create(anchorData)).rejects.toThrow();
    });
  });

  // ==================== JSONB INVESTOR_LIST FIELD ====================

  describe('JSONB investor_list Field', () => {
    it('should insert with valid JSON structure in investor_list', async () => {
      const anchorData = {
        ipoId: testIPOId,
        bidDate: '2025-01-15',
        totalSharesOffered: 1000000,
        totalAmountRaised: '250.00',
        anchorInvestorsCount: 25,
        lockIn50PercentDate: '2025-02-14',
        lockInRemainingDate: '2025-04-15',
        investorList: mockInvestorList,
      };

      const result = await repository.create(anchorData);

      expect(result.investorList).toBeDefined();
      expect(Array.isArray(result.investorList)).toBe(true);
      expect(result.investorList?.length).toBe(2);
      expect(result.investorList?.[0].name).toBe('HDFC Mutual Fund');
    });

    it('should query and retrieve JSONB investor_list data correctly', async () => {
      const anchorData = {
        ipoId: testIPOId,
        bidDate: '2025-01-15',
        totalSharesOffered: 1000000,
        totalAmountRaised: '250.00',
        anchorInvestorsCount: 25,
        lockIn50PercentDate: '2025-02-14',
        lockInRemainingDate: '2025-04-15',
        investorList: mockInvestorList,
      };

      await repository.create(anchorData);

      const retrieved = await repository.findByIPOId(testIPOId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.investorList).toBeDefined();
      expect(retrieved?.investorList?.[0]).toMatchObject({
        name: 'HDFC Mutual Fund',
        type: 'Mutual Fund',
        shares: 500000,
      });
    });

    it('should handle null investor_list (optional field)', async () => {
      const anchorData = {
        ipoId: testIPOId,
        bidDate: '2025-01-15',
        totalSharesOffered: 1000000,
        totalAmountRaised: '250.00',
        anchorInvestorsCount: 25,
        lockIn50PercentDate: '2025-02-14',
        lockInRemainingDate: '2025-04-15',
        investorList: null,
      };

      const result = await repository.create(anchorData);

      expect(result.investorList).toBeNull();
    });
  });

  // ==================== REPOSITORY METHODS ====================

  describe('Repository Methods', () => {
    it('should findByIPOId() return correct record', async () => {
      const anchorData = {
        ipoId: testIPOId,
        bidDate: '2025-01-15',
        totalSharesOffered: 1000000,
        totalAmountRaised: '250.00',
        anchorInvestorsCount: 25,
        lockIn50PercentDate: '2025-02-14',
        lockInRemainingDate: '2025-04-15',
        investorList: mockInvestorList,
      };

      await repository.create(anchorData);

      const result = await repository.findByIPOId(testIPOId);

      expect(result).toBeDefined();
      expect(result?.ipoId).toBe(testIPOId);
      expect(result?.anchorInvestorsCount).toBe(25);
    });

    it('should findByIPOId() return null when no data exists', async () => {
      const nonExistentIPOId = '99999999-9999-9999-9999-999999999999';

      const result = await repository.findByIPOId(nonExistentIPOId);

      expect(result).toBeNull();
    });

    it('should create() insert new record and return it', async () => {
      const anchorData = {
        ipoId: testIPOId,
        bidDate: '2025-01-20',
        totalSharesOffered: 2000000,
        totalAmountRaised: '500.00',
        anchorInvestorsCount: 30,
        lockIn50PercentDate: '2025-02-19',
        lockInRemainingDate: '2025-04-20',
      };

      const result = await repository.create(anchorData);

      expect(result.id).toBeDefined();
      expect(result.ipoId).toBe(testIPOId);
      expect(result.totalSharesOffered).toBe(2000000);
      expect(result.totalAmountRaised).toBe('500.00');
    });

    it('should upsert() update existing record when ipo_id matches', async () => {
      // Create initial record
      const initialData = {
        ipoId: testIPOId,
        bidDate: '2025-01-15',
        totalSharesOffered: 1000000,
        totalAmountRaised: '250.00',
        anchorInvestorsCount: 25,
        lockIn50PercentDate: '2025-02-14',
        lockInRemainingDate: '2025-04-15',
      };

      await repository.create(initialData);

      // Upsert with new data
      const updatedData = {
        ipoId: testIPOId,
        bidDate: '2025-01-16',
        totalSharesOffered: 1500000,
        totalAmountRaised: '375.00',
        anchorInvestorsCount: 30,
        lockIn50PercentDate: '2025-02-15',
        lockInRemainingDate: '2025-04-16',
        investorList: mockInvestorList,
      };

      const result = await repository.upsert(updatedData);

      expect(result.totalSharesOffered).toBe(1500000);
      expect(result.anchorInvestorsCount).toBe(30);
      expect(result.investorList).toBeDefined();

      // Verify only one record exists
      const allRecords = await db
        .select()
        .from(anchorInvestors)
        .where(eq(anchorInvestors.ipoId, testIPOId));

      expect(allRecords.length).toBe(1);
    });

    it('should delete() remove record and invalidate cache', async () => {
      // Create record
      const anchorData = {
        ipoId: testIPOId,
        bidDate: '2025-01-15',
        totalSharesOffered: 1000000,
        totalAmountRaised: '250.00',
        anchorInvestorsCount: 25,
        lockIn50PercentDate: '2025-02-14',
        lockInRemainingDate: '2025-04-15',
      };

      await repository.create(anchorData);

      // Populate cache
      await repository.findByIPOId(testIPOId);

      // Verify cache exists
      const cacheKey = `anchor:${testIPOId}`;
      const cachedBefore = await redis.get(cacheKey);
      expect(cachedBefore).toBeDefined();

      // Delete record
      await repository.delete(testIPOId);

      // Verify record deleted
      const result = await db
        .select()
        .from(anchorInvestors)
        .where(eq(anchorInvestors.ipoId, testIPOId));

      expect(result.length).toBe(0);

      // Verify cache invalidated
      const cachedAfter = await redis.get(cacheKey);
      expect(cachedAfter).toBeNull();
    });
  });

  // ==================== CACHE BEHAVIOR ====================

  describe('Cache Behavior', () => {
    it('should cache anchor data on first request and serve from cache on second request', async () => {
      const anchorData = {
        ipoId: testIPOId,
        bidDate: '2025-01-15',
        totalSharesOffered: 1000000,
        totalAmountRaised: '250.00',
        anchorInvestorsCount: 25,
        lockIn50PercentDate: '2025-02-14',
        lockInRemainingDate: '2025-04-15',
        investorList: mockInvestorList,
      };

      await repository.create(anchorData);

      // First request - cache miss
      const firstRequest = await repository.findByIPOId(testIPOId);

      // Verify cache was populated
      const cacheKey = `anchor:${testIPOId}`;
      const cached = await redis.get(cacheKey);
      expect(cached).toBeDefined();

      // Second request - cache hit
      const secondRequest = await repository.findByIPOId(testIPOId);

      // Compare key fields (timestamps may be serialized differently)
      expect(firstRequest?.id).toBe(secondRequest?.id);
      expect(firstRequest?.ipoId).toBe(secondRequest?.ipoId);
      expect(firstRequest?.bidDate).toBe(secondRequest?.bidDate);
      expect(firstRequest?.totalSharesOffered).toBe(secondRequest?.totalSharesOffered);
      expect(firstRequest?.totalAmountRaised).toBe(secondRequest?.totalAmountRaised);
      expect(firstRequest?.anchorInvestorsCount).toBe(secondRequest?.anchorInvestorsCount);
      expect(firstRequest?.investorList).toEqual(secondRequest?.investorList);
    });

    it('should invalidate cache on upsert operation', async () => {
      const anchorData = {
        ipoId: testIPOId,
        bidDate: '2025-01-15',
        totalSharesOffered: 1000000,
        totalAmountRaised: '250.00',
        anchorInvestorsCount: 25,
        lockIn50PercentDate: '2025-02-14',
        lockInRemainingDate: '2025-04-15',
      };

      await repository.create(anchorData);

      // Populate cache
      await repository.findByIPOId(testIPOId);

      // Verify cache exists
      const cacheKey = `anchor:${testIPOId}`;
      const cachedBefore = await redis.get(cacheKey);
      expect(cachedBefore).toBeDefined();

      // Upsert with new data
      await repository.upsert({
        ...anchorData,
        anchorInvestorsCount: 30,
      });

      // Verify cache was invalidated
      const cachedAfter = await redis.get(cacheKey);
      expect(cachedAfter).toBeNull();
    });

    it('should use correct TTL for anchor investor data (24 hours)', async () => {
      const anchorData = {
        ipoId: testIPOId,
        bidDate: '2025-01-15',
        totalSharesOffered: 1000000,
        totalAmountRaised: '250.00',
        anchorInvestorsCount: 25,
        lockIn50PercentDate: '2025-02-14',
        lockInRemainingDate: '2025-04-15',
      };

      await repository.create(anchorData);

      // Fetch to populate cache
      await repository.findByIPOId(testIPOId);

      // Check TTL (should be 86400 seconds = 24 hours)
      const cacheKey = `anchor:${testIPOId}`;
      const ttl = await redis.ttl(cacheKey);

      expect(ttl).toBeGreaterThan(86000); // Allow some seconds for processing
      expect(ttl).toBeLessThanOrEqual(86400);
    });
  });

  // ==================== DATA VALIDATION ====================

  describe('Data Validation and Edge Cases', () => {
    it('should handle very large numbers in totalSharesOffered', async () => {
      const anchorData = {
        ipoId: testIPOId,
        bidDate: '2025-01-15',
        totalSharesOffered: 999999999,
        totalAmountRaised: '9999.99',
        anchorInvestorsCount: 100,
        lockIn50PercentDate: '2025-02-14',
        lockInRemainingDate: '2025-04-15',
      };

      const result = await repository.create(anchorData);

      expect(result.totalSharesOffered).toBe(999999999);
      expect(result.totalAmountRaised).toBe('9999.99');
    });

    it('should handle zero investor count', async () => {
      const anchorData = {
        ipoId: testIPOId,
        bidDate: '2025-01-15',
        totalSharesOffered: 1000000,
        totalAmountRaised: '250.00',
        anchorInvestorsCount: 0,
        lockIn50PercentDate: '2025-02-14',
        lockInRemainingDate: '2025-04-15',
      };

      const result = await repository.create(anchorData);

      expect(result.anchorInvestorsCount).toBe(0);
    });

    it('should preserve decimal precision in totalAmountRaised', async () => {
      const anchorData = {
        ipoId: testIPOId,
        bidDate: '2025-01-15',
        totalSharesOffered: 1000000,
        totalAmountRaised: '123.45',
        anchorInvestorsCount: 25,
        lockIn50PercentDate: '2025-02-14',
        lockInRemainingDate: '2025-04-15',
      };

      const result = await repository.create(anchorData);
      const retrieved = await repository.findByIPOId(testIPOId);

      expect(retrieved?.totalAmountRaised).toBe('123.45');
    });

    it('should handle empty investor_list array', async () => {
      const anchorData = {
        ipoId: testIPOId,
        bidDate: '2025-01-15',
        totalSharesOffered: 1000000,
        totalAmountRaised: '250.00',
        anchorInvestorsCount: 0,
        lockIn50PercentDate: '2025-02-14',
        lockInRemainingDate: '2025-04-15',
        investorList: [],
      };

      const result = await repository.create(anchorData);

      expect(result.investorList).toEqual([]);
    });
  });
});
