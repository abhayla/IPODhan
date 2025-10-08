import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ListingPerformanceRepository } from '@/lib/repositories/listing-performance-repository';
import type Redis from 'ioredis';

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  delete: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const mockRedis = {
  get: vi.fn(),
  setex: vi.fn(),
  del: vi.fn(),
  keys: vi.fn(),
} as unknown as Redis;

describe('ListingPerformanceRepository', () => {
  let repository: ListingPerformanceRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new ListingPerformanceRepository(mockDb, mockRedis);
  });

  describe('findByIPO', () => {
    const mockIPOId = 'ipo-123';
    const mockPerformance = {
      id: 'perf-1',
      ipoId: mockIPOId,
      listingPrice: 150,
      issuePrice: 100,
      listingGainPercent: '50.00',
      currentPrice: 160,
      currentGainPercent: '60.00',
      lastUpdated: new Date('2024-01-20'),
    };

    it('should return listing performance from cache if available', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(JSON.stringify(mockPerformance));

      const result = await repository.findByIPO(mockIPOId);

      expect(result).toBeDefined();
      expect(result?.listingGainPercent).toBe('50.00');
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('should query database on cache miss and populate cache', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockPerformance]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findByIPO(mockIPOId);

      expect(result).toBeDefined();
      expect(result?.listingGainPercent).toBe('50.00');
      expect(mockDb.select).toHaveBeenCalled();
      expect(mockRedis.setex).toHaveBeenCalled();
    });

    it('should return null when performance not found', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findByIPO(mockIPOId);

      expect(result).toBeNull();
    });

    it('should handle cache errors and fallback to database', async () => {
      mockRedis.get = vi.fn().mockRejectedValue(new Error('Redis error'));
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockPerformance]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findByIPO(mockIPOId);

      expect(result).toBeDefined();
      expect(mockDb.select).toHaveBeenCalled();
    });
  });

  describe('upsert', () => {
    const performanceData = {
      ipoId: 'ipo-123',
      listingPrice: 150,
      issuePrice: 100,
      listingGainPercent: '50.00',
      currentPrice: 160,
      currentGainPercent: '60.00',
    };

    it('should create new performance record and invalidate cache', async () => {
      const createdPerformance = {
        id: 'perf-new',
        ...performanceData,
        lastUpdated: new Date(),
      };

      mockRedis.del = vi.fn().mockResolvedValue(1);

      const mockInsert = {
        values: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([createdPerformance]),
      };
      mockDb.insert = vi.fn().mockReturnValue(mockInsert);

      const result = await repository.upsert(performanceData);

      expect(result).toEqual(createdPerformance);
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalled();
    });

    it('should update existing performance record and invalidate cache', async () => {
      const updatedPerformance = {
        id: 'perf-existing',
        ...performanceData,
        currentPrice: 170,
        currentGainPercent: '70.00',
        lastUpdated: new Date(),
      };

      mockRedis.del = vi.fn().mockResolvedValue(1);

      const mockInsert = {
        values: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([updatedPerformance]),
      };
      mockDb.insert = vi.fn().mockReturnValue(mockInsert);

      const result = await repository.upsert(performanceData);

      expect(result).toEqual(updatedPerformance);
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalled();
    });

    it('should throw DatabaseError on upsert failure', async () => {
      mockRedis.del = vi.fn().mockResolvedValue(1);

      const mockInsert = {
        values: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockReturnThis(),
        returning: vi.fn().mockRejectedValue(new Error('Upsert failed')),
      };
      mockDb.insert = vi.fn().mockReturnValue(mockInsert);

      await expect(repository.upsert(performanceData)).rejects.toThrow();
    });
  });

  describe('delete', () => {
    const ipoId = 'ipo-123';

    it('should delete listing performance and invalidate cache', async () => {
      mockRedis.del = vi.fn().mockResolvedValue(1);

      const mockDelete = {
        where: vi.fn().mockResolvedValue(undefined),
      };
      mockDb.delete = vi.fn().mockReturnValue(mockDelete);

      await repository.delete(ipoId);

      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalled();
    });

    it('should throw DatabaseError on delete failure', async () => {
      const mockDelete = {
        where: vi.fn().mockRejectedValue(new Error('Delete failed')),
      };
      mockDb.delete = vi.fn().mockReturnValue(mockDelete);

      await expect(repository.delete(ipoId)).rejects.toThrow();
    });
  });

  describe('Cache Behavior', () => {
    it('should use correct TTL for listing performance cache', async () => {
      const mockIPOId = 'ipo-123';
      const mockPerformance = {
        id: 'perf-1',
        ipoId: mockIPOId,
        listingPrice: 150,
        issuePrice: 100,
        listingGainPercent: '50.00',
        currentPrice: null,
        currentGainPercent: null,
        lastUpdated: new Date('2024-01-20'),
      };

      const mockSetex = vi.fn().mockResolvedValue('OK');
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = mockSetex;

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockPerformance]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      await repository.findByIPO(mockIPOId);

      expect(mockSetex).toHaveBeenCalled();
      // Verify TTL is passed correctly (600 seconds / 10 minutes for listing performance)
      const setexCall = mockSetex.mock.calls[0];
      expect(setexCall[1]).toBe(600);
    });
  });
});
