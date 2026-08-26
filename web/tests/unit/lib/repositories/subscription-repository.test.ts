import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubscriptionRepository } from '@/lib/repositories/subscription-repository';
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

describe('SubscriptionRepository', () => {
  let repository: SubscriptionRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new SubscriptionRepository(mockDb, mockRedis);
  });

  describe('findByIPO', () => {
    const mockSubscriptions = [
      {
        id: '1',
        ipoId: 'ipo-123',
        timestamp: new Date('2024-01-15'),
        totalSubscription: '5.5',
        qibSubscription: '3.2',
        niiSubscription: '2.1',
        retailSubscription: '1.8',
      },
      {
        id: '2',
        ipoId: 'ipo-123',
        timestamp: new Date('2024-01-14'),
        totalSubscription: '3.2',
        qibSubscription: '2.0',
        niiSubscription: '1.5',
        retailSubscription: '1.2',
      },
    ];

    it('should return subscription history for an IPO', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(mockSubscriptions),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findByIPO({
        ipoId: 'ipo-123',
        limit: 100,
      });

      expect(result).toHaveLength(2);
      expect(result[0].totalSubscription).toBe('5.5');
    });

    it('should filter by date range', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockSubscriptions[0]]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findByIPO({
        ipoId: 'ipo-123',
        fromDate: new Date('2024-01-15'),
        toDate: new Date('2024-01-16'),
      });

      expect(result).toHaveLength(1);
    });

    it('should rehydrate Date fields when reading from cache (not leave them as strings)', async () => {
      // Redis only ever stores the JSON.stringify'd form, so timestamp comes
      // back as an ISO string on the wire — the repository must revive it.
      mockRedis.get = vi
        .fn()
        .mockResolvedValue(JSON.stringify(mockSubscriptions));

      const result = await repository.findByIPO({ ipoId: 'ipo-123' });

      expect(mockDb.select).not.toHaveBeenCalled();
      expect(result).toHaveLength(2);
      expect(result[0].timestamp).toBeInstanceOf(Date);
      expect(result[0].timestamp.toISOString()).toBe(
        mockSubscriptions[0].timestamp.toISOString()
      );
    });
  });

  describe('findLatest', () => {
    const mockLatest = {
      id: '1',
      ipoId: 'ipo-123',
      timestamp: new Date('2024-01-15'),
      totalSubscription: '5.5',
    };

    it('should return latest subscription snapshot', async () => {
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
        'subscription:latest:ipo-123',
        300,
        JSON.stringify(mockLatest)
      );
    });

    it('should return null when no subscription exists', async () => {
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

    it('should return a real Date (not a string) for timestamp on a cache hit, so callers can call .toISOString() safely', async () => {
      // Regression test for the P2-2 500: the route calls
      // latestSubscription.timestamp.toISOString() and previously threw
      // "timestamp.toISOString is not a function" on any cache hit because
      // JSON.parse left timestamp as a string.
      mockRedis.get = vi.fn().mockResolvedValue(JSON.stringify(mockLatest));

      const result = await repository.findLatest('ipo-123');

      expect(mockDb.select).not.toHaveBeenCalled();
      expect(result).not.toBeNull();
      expect(result!.timestamp).toBeInstanceOf(Date);
      expect(() => result!.timestamp.toISOString()).not.toThrow();
      expect(result!.timestamp.toISOString()).toBe(mockLatest.timestamp.toISOString());
    });
  });

  describe('createSnapshot', () => {
    const mockSnapshot = {
      ipoId: 'ipo-123',
      timestamp: new Date(),
      totalSubscription: '6.5',
      qibSubscription: '4.0',
      niiSubscription: '2.5',
      retailSubscription: '2.0',
    };

    it('should create new subscription snapshot and invalidate cache', async () => {
      const createdSnapshot = { id: 'new-id', ...mockSnapshot };

      const mockInsert = {
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([createdSnapshot]),
      };
      mockDb.insert = vi.fn().mockReturnValue(mockInsert);
      mockRedis.del = vi.fn().mockResolvedValue(1);
      mockRedis.keys = vi
        .fn()
        .mockResolvedValue(['subscription:history:ipo-123:all']);

      const result = await repository.createSnapshot(mockSnapshot);

      expect(result).toEqual(createdSnapshot);
      expect(mockRedis.del).toHaveBeenCalled();
    });
  });

  describe('deleteByIPO', () => {
    it('should delete all subscriptions for an IPO and invalidate cache', async () => {
      const mockDelete = {
        where: vi.fn().mockResolvedValue(undefined),
      };
      mockDb.delete = vi.fn().mockReturnValue(mockDelete);
      mockRedis.del = vi.fn().mockResolvedValue(1);
      mockRedis.keys = vi.fn().mockResolvedValue(['subscription:history:ipo-123:all']);

      await repository.deleteByIPO('ipo-123');

      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalled();
    });
  });
});
