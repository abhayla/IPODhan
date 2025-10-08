/**
 * Unit Tests for getSectorAverage Utility
 *
 * Tests:
 * - Returns null when sector is null
 * - Returns cached value when available
 * - Queries database and caches result
 * - Returns null and caches when no data found
 * - Handles cache failures gracefully
 * - Rounds result to 2 decimal places
 * - Invalidates cache correctly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

// Mock the database - must use factory function to avoid hoisting issues
vi.mock('@/lib/db/index', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([])),
          })),
        })),
      })),
    })),
  },
}));

// Mock the database schema
vi.mock('@/lib/db/schema', () => ({
  ipos: {},
  listingPerformance: {},
}));

// Mock Redis client - must use factory function to avoid hoisting issues
vi.mock('@/lib/cache/redis-client', () => ({
  safeGet: vi.fn(),
  safeSet: vi.fn(),
  safeDel: vi.fn(),
}));

// Import the functions under test after mocks are set up
import { getSectorAverage, invalidateSectorAverageCache } from '@/lib/utils/sector-averages';

// Get references to the mocked functions after modules are loaded
const { db } = await import('@/lib/db/index');
const redisModule = await import('@/lib/cache/redis-client');
const mockSafeGet = redisModule.safeGet as Mock;
const mockSafeSet = redisModule.safeSet as Mock;
const mockSafeDel = redisModule.safeDel as Mock;
const mockSelect = db.select as Mock;

describe('getSectorAverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when sector is null', async () => {
    const result = await getSectorAverage(null);
    expect(result).toBeNull();
    expect(mockSafeGet).not.toHaveBeenCalled();
  });

  it('returns cached value when available', async () => {
    mockSafeGet.mockResolvedValue('25.5');

    const result = await getSectorAverage('Technology');

    expect(result).toBe(25.5);
    expect(mockSafeGet).toHaveBeenCalledWith('sector:average:listing-gain:technology');
  });

  it('generates correct cache key with normalized sector name', async () => {
    mockSafeGet.mockResolvedValue('30.0');

    await getSectorAverage('IT Services & Consulting');

    expect(mockSafeGet).toHaveBeenCalledWith(
      'sector:average:listing-gain:it-services-&-consulting'
    );
  });

  it('handles cache miss and queries database', async () => {
    mockSafeGet.mockResolvedValue(null);

    const mockLimit = vi.fn().mockResolvedValue([{ avgListingGain: 28.75 }]);
    const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockInnerJoin = vi.fn().mockReturnValue({ where: mockWhere });
    const mockFrom = vi.fn().mockReturnValue({ innerJoin: mockInnerJoin });
    (mockSelect as Mock).mockReturnValue({ from: mockFrom });

    const result = await getSectorAverage('Finance');

    expect(result).toBe(28.75);
    expect(mockSafeSet).toHaveBeenCalledWith(
      'sector:average:listing-gain:finance',
      '28.75',
      604800 // 7 days
    );
  });

  it('rounds database result to 2 decimal places', async () => {
    mockSafeGet.mockResolvedValue(null);

    const mockLimit = vi.fn().mockResolvedValue([{ avgListingGain: 25.6789 }]);
    const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockInnerJoin = vi.fn().mockReturnValue({ where: mockWhere });
    const mockFrom = vi.fn().mockReturnValue({ innerJoin: mockInnerJoin });
    (mockSelect as Mock).mockReturnValue({ from: mockFrom });

    const result = await getSectorAverage('Technology');

    expect(result).toBe(25.68);
  });

  it('returns null and caches when no data found in database', async () => {
    mockSafeGet.mockResolvedValue(null);

    const mockLimit = vi.fn().mockResolvedValue([]);
    const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockInnerJoin = vi.fn().mockReturnValue({ where: mockWhere });
    const mockFrom = vi.fn().mockReturnValue({ innerJoin: mockInnerJoin });
    (mockSelect as Mock).mockReturnValue({ from: mockFrom });

    const result = await getSectorAverage('Unknown Sector');

    expect(result).toBeNull();
    expect(mockSafeSet).toHaveBeenCalledWith(
      'sector:average:listing-gain:unknown-sector',
      'null',
      3600 // 1 hour for null results
    );
  });

  it('returns null when database result has null avgListingGain', async () => {
    mockSafeGet.mockResolvedValue(null);

    const mockLimit = vi.fn().mockResolvedValue([{ avgListingGain: null }]);
    const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockInnerJoin = vi.fn().mockReturnValue({ where: mockWhere });
    const mockFrom = vi.fn().mockReturnValue({ innerJoin: mockInnerJoin });
    (mockSelect as Mock).mockReturnValue({ from: mockFrom });

    const result = await getSectorAverage('Technology');

    expect(result).toBeNull();
  });

  it('handles cache read failure and falls back to database', async () => {
    mockSafeGet.mockRejectedValue(new Error('Redis connection failed'));

    const mockLimit = vi.fn().mockResolvedValue([{ avgListingGain: 30.0 }]);
    const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockInnerJoin = vi.fn().mockReturnValue({ where: mockWhere });
    const mockFrom = vi.fn().mockReturnValue({ innerJoin: mockInnerJoin });
    (mockSelect as Mock).mockReturnValue({ from: mockFrom });

    const result = await getSectorAverage('Technology');

    expect(result).toBe(30.0);
  });

  it('returns null when both cache and database fail', async () => {
    mockSafeGet.mockRejectedValue(new Error('Redis failed'));

    const mockLimit = vi.fn().mockRejectedValue(new Error('DB failed'));
    const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockInnerJoin = vi.fn().mockReturnValue({ where: mockWhere });
    const mockFrom = vi.fn().mockReturnValue({ innerJoin: mockInnerJoin });
    (mockSelect as Mock).mockReturnValue({ from: mockFrom });

    const result = await getSectorAverage('Technology');

    expect(result).toBeNull();
  });

  it('handles invalid cached value (NaN)', async () => {
    mockSafeGet.mockResolvedValue('invalid-number');

    const mockLimit = vi.fn().mockResolvedValue([{ avgListingGain: 25.0 }]);
    const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockInnerJoin = vi.fn().mockReturnValue({ where: mockWhere });
    const mockFrom = vi.fn().mockReturnValue({ innerJoin: mockInnerJoin });
    (mockSelect as Mock).mockReturnValue({ from: mockFrom });

    const result = await getSectorAverage('Technology');

    // Should fall back to database when cached value is invalid
    expect(result).toBe(25.0);
  });
});

describe('invalidateSectorAverageCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes cache key for given sector', async () => {
    await invalidateSectorAverageCache('Technology');

    expect(mockSafeDel).toHaveBeenCalledWith('sector:average:listing-gain:technology');
  });

  it('normalizes sector name in cache key', async () => {
    await invalidateSectorAverageCache('IT Services & Consulting');

    expect(mockSafeDel).toHaveBeenCalledWith(
      'sector:average:listing-gain:it-services-&-consulting'
    );
  });

  it('handles cache deletion errors gracefully', async () => {
    mockSafeDel.mockRejectedValue(new Error('Redis connection failed'));

    // Should not throw
    await expect(invalidateSectorAverageCache('Technology')).resolves.toBeUndefined();
  });
});
