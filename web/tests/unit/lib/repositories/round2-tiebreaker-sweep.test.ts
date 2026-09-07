/**
 * #358 round 2: the same non-unique-sort + limit/paginate class extends
 * beyond ipo-repository.ts. These tests cover the five sites the round-1
 * review flagged as under-covered:
 *   - scraper-log-repository.ts findAll (paginated createdAt)
 *   - gmp-repository.ts findByIPO (timestamp + limit)
 *   - subscription-repository.ts findByIPO (timestamp + limit)
 *   - review-repository.ts findByIpoId (publishedDate + limit)
 *   - data-conflicts-repository.ts findUnresolved (detectedAt + optional limit)
 *
 * Each asserts the built orderBy() call carries a secondary, unique column
 * (id) alongside the primary sort — the pre-fix shape was always a single
 * argument.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScraperLogRepository } from '@/lib/repositories/scraper-log-repository';
import { GMPRepository } from '@/lib/repositories/gmp-repository';
import { SubscriptionRepository } from '@/lib/repositories/subscription-repository';
import { ReviewRepository } from '@/lib/repositories/review-repository';
import { DataConflictsRepository } from '@/lib/repositories/data-conflicts-repository';
import type Redis from 'ioredis';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = { select: vi.fn(), execute: vi.fn() } as any;

const mockRedis = {
  get: vi.fn(),
  setex: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  keys: vi.fn(),
} as unknown as Redis;

beforeEach(() => {
  vi.clearAllMocks();
  mockRedis.get = vi.fn().mockResolvedValue(null);
  mockRedis.setex = vi.fn().mockResolvedValue('OK');
});

describe('ScraperLogRepository.findAll — #358 tiebreaker', () => {
  it('paginated createdAt sort carries a secondary key', async () => {
    const repository = new ScraperLogRepository(mockDb, mockRedis);

    const mockCountSelect = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ total: 0 }]),
    };
    const mockDataSelect = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockResolvedValue([]),
    };
    mockDb.select = vi.fn().mockReturnValueOnce(mockCountSelect).mockReturnValueOnce(mockDataSelect);

    await repository.findAll({}, { page: 1, limit: 20 });

    expect(mockDataSelect.orderBy.mock.calls[0].length).toBeGreaterThan(1);
  });
});

describe('GMPRepository.findByIPO — #358 tiebreaker', () => {
  it('timestamp sort + limit carries a secondary key', async () => {
    const repository = new GMPRepository(mockDb, mockRedis);
    const mockSelect = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    mockDb.select = vi.fn().mockReturnValue(mockSelect);

    await repository.findByIPO({ ipoId: 'ipo-1', limit: 10 });

    expect(mockSelect.orderBy.mock.calls[0].length).toBeGreaterThan(1);
  });
});

describe('SubscriptionRepository.findByIPO — #358 tiebreaker', () => {
  it('timestamp sort + limit carries a secondary key', async () => {
    const repository = new SubscriptionRepository(mockDb, mockRedis);
    const mockSelect = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    mockDb.select = vi.fn().mockReturnValue(mockSelect);

    await repository.findByIPO({ ipoId: 'ipo-1', limit: 10 });

    expect(mockSelect.orderBy.mock.calls[0].length).toBeGreaterThan(1);
  });
});

describe('ReviewRepository.findByIpoId — #358 tiebreaker', () => {
  it('publishedDate sort + limit carries a secondary key', async () => {
    const repository = new ReviewRepository(mockDb, mockRedis);
    const mockSelect = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    mockDb.select = vi.fn().mockReturnValue(mockSelect);

    await repository.findByIpoId('ipo-1', 10);

    expect(mockSelect.orderBy.mock.calls[0].length).toBeGreaterThan(1);
  });
});

describe('DataConflictsRepository.findUnresolved — #358 tiebreaker', () => {
  it('detectedAt sort + optional limit carries a secondary key', async () => {
    const repository = new DataConflictsRepository(mockDb, mockRedis);
    const mockSelect = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    mockDb.select = vi.fn().mockReturnValue(mockSelect);

    await repository.findUnresolved(10);

    expect(mockSelect.orderBy.mock.calls[0].length).toBeGreaterThan(1);
  });
});
