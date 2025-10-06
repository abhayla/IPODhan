import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GMPRepository } from '@/lib/repositories/gmp-repository';
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

describe('GMPRepository', () => {
  let repository: GMPRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new GMPRepository(mockDb, mockRedis);
  });

  describe('findByIPO', () => {
    const mockGMPRecords = [
      {
        id: '1',
        ipoId: 'ipo-123',
        timestamp: new Date('2024-01-15'),
        gmp: 50,
        expectedListingPrice: 150,
        source: 'Market Source',
      },
      {
        id: '2',
        ipoId: 'ipo-123',
        timestamp: new Date('2024-01-14'),
        gmp: 45,
        expectedListingPrice: 145,
        source: 'Market Source',
      },
    ];

    it('should return GMP history for an IPO', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(mockGMPRecords),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findByIPO({
        ipoId: 'ipo-123',
        days: 7,
      });

      expect(result).toHaveLength(2);
      expect(result[0].gmp).toBe(50);
    });

    it('should filter by date range', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockGMPRecords[0]]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findByIPO({
        ipoId: 'ipo-123',
        fromDate: new Date('2024-01-15'),
        toDate: new Date('2024-01-16'),
      });

      expect(result).toHaveLength(1);
    });

    it('should use cached data when available', async () => {
      // Simulate cache behavior: Date objects are serialized as strings
      const cachedGMPRecords = JSON.parse(JSON.stringify(mockGMPRecords));
      mockRedis.get = vi.fn().mockResolvedValue(JSON.stringify(cachedGMPRecords));

      const result = await repository.findByIPO({
        ipoId: 'ipo-123',
        days: 7,
      });

      expect(result).toEqual(cachedGMPRecords);
      expect(mockDb.select).not.toHaveBeenCalled();
    });
  });

  describe('findLatest', () => {
    const mockLatest = {
      id: '1',
      ipoId: 'ipo-123',
      timestamp: new Date('2024-01-15'),
      gmp: 50,
      expectedListingPrice: 150,
      source: 'Market Source',
    };

    it('should return latest GMP record', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockLatest]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findLatest('ipo-123');

      expect(result).toEqual(mockLatest);
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'gmp:latest:ipo-123',
        600,
        JSON.stringify(mockLatest)
      );
    });

    it('should return null when no GMP exists', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findLatest('ipo-123');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    const mockGMPData = {
      ipoId: 'ipo-123',
      timestamp: new Date(),
      gmp: 55,
      expectedListingPrice: 155,
      source: 'Market Source',
    };

    it('should create new GMP record and invalidate cache', async () => {
      const createdGMP = { id: 'new-id', ...mockGMPData };

      const mockInsert = {
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([createdGMP]),
      };
      mockDb.insert = vi.fn().mockReturnValue(mockInsert);
      mockRedis.del = vi.fn().mockResolvedValue(1);
      mockRedis.keys = vi.fn().mockResolvedValue(['gmp:history:ipo-123:7']);

      const result = await repository.create(mockGMPData);

      expect(result).toEqual(createdGMP);
      expect(mockRedis.del).toHaveBeenCalled();
    });
  });

  describe('deleteByIPO', () => {
    it('should delete all GMP records for an IPO and invalidate cache', async () => {
      const mockDelete = {
        where: vi.fn().mockResolvedValue(undefined),
      };
      mockDb.delete = vi.fn().mockReturnValue(mockDelete);
      mockRedis.del = vi.fn().mockResolvedValue(1);
      mockRedis.keys = vi.fn().mockResolvedValue(['gmp:history:ipo-123:all']);

      await repository.deleteByIPO('ipo-123');

      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalled();
    });
  });
});
