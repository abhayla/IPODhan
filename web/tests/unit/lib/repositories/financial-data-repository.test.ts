import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FinancialDataRepository } from '@/lib/repositories/financial-data-repository';
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
} as unknown as Redis;

describe('FinancialDataRepository', () => {
  let repository: FinancialDataRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new FinancialDataRepository(mockDb, mockRedis);
  });

  describe('findByIPO', () => {
    const mockFinancialData = {
      id: '1',
      ipoId: 'ipo-123',
      revenueFy2023: '1000.50',
      profitFy2023: '150.25',
      peRatio: '25.5',
      eps: '12.5',
    };

    it('should return financial data from cache', async () => {
      mockRedis.get = vi
        .fn()
        .mockResolvedValue(JSON.stringify(mockFinancialData));

      const result = await repository.findByIPO('ipo-123');

      expect(result).toEqual(mockFinancialData);
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('should return financial data from database on cache miss', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockFinancialData]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findByIPO('ipo-123');

      expect(result).toEqual(mockFinancialData);
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'financial:ipo-123',
        1800,
        JSON.stringify(mockFinancialData)
      );
    });

    it('should return null when financial data not found', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findByIPO('ipo-123');

      expect(result).toBeNull();
    });
  });

  describe('upsert', () => {
    const mockData = {
      ipoId: 'ipo-123',
      revenueFy2023: '1000.50',
      profitFy2023: '150.25',
      peRatio: '25.5',
    };

    it('should upsert financial data and invalidate cache', async () => {
      const upsertedData = { id: 'new-id', ...mockData };

      const mockInsert = {
        values: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([upsertedData]),
      };
      mockDb.insert = vi.fn().mockReturnValue(mockInsert);
      mockRedis.del = vi.fn().mockResolvedValue(1);

      const result = await repository.upsert(mockData);

      expect(result).toEqual(upsertedData);
      expect(mockRedis.del).toHaveBeenCalledWith('financial:ipo-123');
    });
  });

  describe('delete', () => {
    it('should delete financial data and invalidate cache', async () => {
      const mockDelete = {
        where: vi.fn().mockResolvedValue(undefined),
      };
      mockDb.delete = vi.fn().mockReturnValue(mockDelete);
      mockRedis.del = vi.fn().mockResolvedValue(1);

      await repository.delete('ipo-123');

      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalledWith('financial:ipo-123');
    });
  });
});
