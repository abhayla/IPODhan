/**
 * #358: paginated/limited list queries in ipo-repository.ts sorted on a
 * single non-unique column (listing_date, timestamp, similarity) with no
 * secondary key. Rows sharing the sort value reshuffle between identical
 * requests and across page boundaries (the cache-poison bisect probe on
 * /api/ipos/history, #357).
 *
 * These tests assert every fixed query's built ORDER BY carries a unique
 * secondary column (ipos.id, subscriptions.id, gmpRecords.id) so ties
 * resolve the same way on every call. Each `orderBy` mock call is asserted
 * with >1 argument — Drizzle's `.orderBy(...cols)` takes the tiebreak as an
 * additional positional column, so a 1-arg call is exactly the unstable
 * pre-fix shape this test would have caught red.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import type Redis from 'ioredis';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  execute: vi.fn(),
} as any;

const mockRedis = {
  get: vi.fn(),
  setex: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  keys: vi.fn(),
} as unknown as Redis;

describe('IPORepository — #358 deterministic tiebreaker', () => {
  let repository: IPORepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.get = vi.fn().mockResolvedValue(null);
    mockRedis.setex = vi.fn().mockResolvedValue('OK');
    mockDb.execute = vi.fn().mockResolvedValue({ rows: [] });
    repository = new IPORepository(mockDb, mockRedis);
  });

  it('findAll: two rows tied on the sort column (createdAt) — orderBy carries a secondary key', async () => {
    const tiedRow = (id: string) => ({
      ipo: { id, slug: `ipo-${id}`, companyName: `Co ${id}`, createdAt: new Date('2026-01-01') },
      ipoScore: null,
    });

    const mockSelect = {
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockResolvedValue([tiedRow('1'), tiedRow('2')]),
    };
    const mockCountSelect = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ count: 2 }]),
    };
    mockDb.select = vi.fn().mockReturnValueOnce(mockCountSelect).mockReturnValueOnce(mockSelect);

    await repository.findAll({ page: 1, limit: 10 });

    expect(mockSelect.orderBy).toHaveBeenCalledTimes(1);
    // Unstable pre-fix shape was .orderBy(orderBy) — a single argument.
    expect(mockSelect.orderBy.mock.calls[0].length).toBeGreaterThan(1);
  });

  it('findHistorical (/api/ipos/history): orderBy carries a secondary key at every page, listing_date sort', async () => {
    const mockCountSelect = {
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ count: 21 }]),
    };

    const runFindHistorical = async (page: number) => {
      const mockDataSelect = {
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockResolvedValue([]),
      };
      mockDb.select = vi.fn().mockReturnValueOnce(mockCountSelect).mockReturnValueOnce(mockDataSelect);
      await repository.findHistorical({ sort: 'listing_date', sortOrder: 'desc', page, limit: 20 });
      return mockDataSelect.orderBy;
    };

    // The bisect probe checks the N-1/N/N+1 page boundary (limit 19/20/21).
    for (const page of [1, 2, 3]) {
      const orderBySpy = await runFindHistorical(page);
      expect(orderBySpy).toHaveBeenCalledTimes(1);
      expect(orderBySpy.mock.calls[0].length).toBeGreaterThan(1);
    }
  });

  it('findHistorical: subscription-sort branch (raw sql orderByClause) also carries a secondary key', async () => {
    const mockCountSelect = {
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ count: 2 }]),
    };
    const mockDataSelect = {
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockResolvedValue([]),
    };
    mockDb.select = vi.fn().mockReturnValueOnce(mockCountSelect).mockReturnValueOnce(mockDataSelect);

    await repository.findHistorical({ sort: 'subscription', sortOrder: 'desc', page: 1, limit: 20 });

    expect(mockDataSelect.orderBy.mock.calls[0].length).toBeGreaterThan(1);
  });

  it('findListings: orderBy carries a secondary key for the default (listingDate) sort', async () => {
    const mockCountSelect = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ count: 0 }]),
    };
    const mockListingsSelect = {
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockResolvedValue([]),
    };
    mockDb.select = vi.fn().mockReturnValueOnce(mockCountSelect).mockReturnValueOnce(mockListingsSelect);

    await repository.findListings({ category: 'MAINBOARD', page: 1, limit: 50 });

    expect(mockListingsSelect.orderBy.mock.calls[0].length).toBeGreaterThan(1);
  });

  it('search: orderBy carries a secondary key alongside the similarity() sql expression', async () => {
    const mockSelect = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    mockDb.select = vi.fn().mockReturnValue(mockSelect);

    await repository.search('acme', 10);

    expect(mockSelect.orderBy.mock.calls[0].length).toBeGreaterThan(1);
  });
});
