import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MarketHolidayRepository } from '@/lib/repositories/market-holiday-repository';
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

describe('MarketHolidayRepository', () => {
  let repository: MarketHolidayRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new MarketHolidayRepository(mockDb, mockRedis);
  });

  const mockHolidays = [
    {
      id: 'holiday-1',
      date: '2025-01-26',
      description: 'Republic Day',
      year: 2025,
      exchange: 'BOTH' as const,
      type: 'BOTH' as const,
      createdAt: new Date('2025-01-01'),
      updatedAt: new Date('2025-01-01'),
    },
    {
      id: 'holiday-2',
      date: '2025-03-14',
      description: 'Holi',
      year: 2025,
      exchange: 'BOTH' as const,
      type: 'BOTH' as const,
      createdAt: new Date('2025-01-01'),
      updatedAt: new Date('2025-01-01'),
    },
    {
      id: 'holiday-3',
      date: '2025-08-15',
      description: 'Independence Day',
      year: 2025,
      exchange: 'BOTH' as const,
      type: 'BOTH' as const,
      createdAt: new Date('2025-01-01'),
      updatedAt: new Date('2025-01-01'),
    },
  ];

  describe('findAll', () => {
    it('should return all holidays from cache if available', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(JSON.stringify(mockHolidays));

      const result = await repository.findAll();

      expect(result).toHaveLength(3);
      expect(result[0].description).toBe('Republic Day');
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('should query database on cache miss and populate cache', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(mockHolidays),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findAll();

      expect(result).toHaveLength(3);
      expect(mockDb.select).toHaveBeenCalled();
      expect(mockRedis.setex).toHaveBeenCalled();
    });

    it('should filter by year', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(mockHolidays),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findAll({ year: 2025 });

      expect(result).toHaveLength(3);
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('should filter by exchange', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue([mockHolidays[0]]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findAll({ exchange: 'NSE' });

      expect(result).toHaveLength(1);
      expect(mockDb.select).toHaveBeenCalled();
    });

    // T-264 P2-2: calling .where() more than once on the same Drizzle query
    // builder does NOT AND the conditions - each call REPLACES the previous
    // one. With year+exchange both set, only the LAST .where() call took
    // effect, so ?year=2026&exchange=NSE silently returned every year's
    // NSE/BOTH rows instead of just 2026's. A mock that merely returns
    // `this` from `.where()` can't catch this (it's shape, not substance) -
    // assert the query builder is invoked with a SINGLE combined `.where()`
    // call, which is the only way both conditions can actually apply.
    it('combines year + exchange into a single .where() call (regression: T-264 P2-2)', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const whereSpy = vi.fn().mockReturnThis();
      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: whereSpy,
        orderBy: vi.fn().mockResolvedValue([mockHolidays[0]]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      await repository.findAll({ year: 2026, exchange: 'NSE' });

      // Exactly one .where() call - if the old sequential-.where() bug
      // regressed, this would be 2 (one per filter) and the second call
      // would silently discard the first condition.
      expect(whereSpy).toHaveBeenCalledTimes(1);
      // The single call must carry a real condition, not undefined (which
      // would mean no filtering happened at all).
      expect(whereSpy.mock.calls[0][0]).toBeDefined();
    });

    it('applies only one .where() call even with all three filters set', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const whereSpy = vi.fn().mockReturnThis();
      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: whereSpy,
        orderBy: vi.fn().mockResolvedValue(mockHolidays),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      await repository.findAll({ year: 2026, exchange: 'BSE', upcoming: true });

      expect(whereSpy).toHaveBeenCalledTimes(1);
    });

    it('should filter upcoming holidays', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(mockHolidays),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findAll({ upcoming: true });

      expect(result).toHaveLength(3);
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('should handle cache errors and fallback to database', async () => {
      mockRedis.get = vi.fn().mockRejectedValue(new Error('Redis error'));
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(mockHolidays),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findAll();

      expect(result).toHaveLength(3);
      expect(mockDb.select).toHaveBeenCalled();
    });
  });

  describe('findUpcoming', () => {
    it('should return upcoming holidays with default limit', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(mockHolidays.slice(0, 5)),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findUpcoming();

      expect(result).toHaveLength(3);
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('should return upcoming holidays with custom limit', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockHolidays[0]]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findUpcoming(1);

      expect(result).toHaveLength(1);
      expect(result[0].description).toBe('Republic Day');
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('should use cached data when available', async () => {
      mockRedis.get = vi
        .fn()
        .mockResolvedValue(JSON.stringify(mockHolidays));

      const result = await repository.findUpcoming(5);

      expect(result).toHaveLength(3);
      expect(mockDb.select).not.toHaveBeenCalled();
    });
  });

  describe('findByYear', () => {
    it('should return holidays for specified year', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(mockHolidays),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findByYear(2025);

      expect(result).toHaveLength(3);
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('should use cached data when available', async () => {
      mockRedis.get = vi
        .fn()
        .mockResolvedValue(JSON.stringify(mockHolidays));

      const result = await repository.findByYear(2025);

      expect(result).toHaveLength(3);
      expect(mockDb.select).not.toHaveBeenCalled();
    });
  });

  describe('findByExchange', () => {
    it('should return holidays for NSE exchange', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(mockHolidays),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findByExchange('NSE');

      expect(result).toHaveLength(3);
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('should return holidays for BSE exchange', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(mockHolidays),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findByExchange('BSE');

      expect(result).toHaveLength(3);
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('should return holidays for BOTH exchanges', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(mockHolidays),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findByExchange('BOTH');

      expect(result).toHaveLength(3);
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('should use cached data when available', async () => {
      mockRedis.get = vi
        .fn()
        .mockResolvedValue(JSON.stringify(mockHolidays));

      const result = await repository.findByExchange('NSE');

      expect(result).toHaveLength(3);
      expect(mockDb.select).not.toHaveBeenCalled();
    });
  });

  describe('findByDateRange', () => {
    it('should return holidays within date range', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue([mockHolidays[0], mockHolidays[1]]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findByDateRange(
        '2025-01-01',
        '2025-06-30'
      );

      expect(result).toHaveLength(2);
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('should use cached data when available', async () => {
      mockRedis.get = vi
        .fn()
        .mockResolvedValue(JSON.stringify(mockHolidays.slice(0, 2)));

      const result = await repository.findByDateRange(
        '2025-01-01',
        '2025-06-30'
      );

      expect(result).toHaveLength(2);
      expect(mockDb.select).not.toHaveBeenCalled();
    });
  });

  describe('invalidateHolidayCache', () => {
    it('should invalidate all market holiday caches', async () => {
      mockRedis.keys = vi.fn().mockResolvedValue(['market_holidays:*']);
      mockRedis.del = vi.fn().mockResolvedValue(1);

      await repository.invalidateHolidayCache();

      expect(mockRedis.keys).toHaveBeenCalled();
    });
  });

  describe('Cache Key Generation', () => {
    it('should generate correct cache key without filters', async () => {
      const mockGet = vi.fn().mockResolvedValue(null);
      const mockSetex = vi.fn().mockResolvedValue('OK');
      mockRedis.get = mockGet;
      mockRedis.setex = mockSetex;

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(mockHolidays),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      await repository.findAll();

      const getCall = mockGet.mock.calls[0];
      expect(getCall[0]).toBe('market_holidays:all');
    });

    it('should generate correct cache key with year filter', async () => {
      const mockGet = vi.fn().mockResolvedValue(null);
      const mockSetex = vi.fn().mockResolvedValue('OK');
      mockRedis.get = mockGet;
      mockRedis.setex = mockSetex;

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(mockHolidays),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      await repository.findAll({ year: 2025 });

      const getCall = mockGet.mock.calls[0];
      expect(getCall[0]).toBe('market_holidays:year:2025');
    });

    it('should generate correct cache key with exchange filter', async () => {
      const mockGet = vi.fn().mockResolvedValue(null);
      const mockSetex = vi.fn().mockResolvedValue('OK');
      mockRedis.get = mockGet;
      mockRedis.setex = mockSetex;

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(mockHolidays),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      await repository.findAll({ exchange: 'NSE' });

      const getCall = mockGet.mock.calls[0];
      expect(getCall[0]).toBe('market_holidays:exchange:NSE');
    });

    it('should generate correct cache key with upcoming filter', async () => {
      const mockGet = vi.fn().mockResolvedValue(null);
      const mockSetex = vi.fn().mockResolvedValue('OK');
      mockRedis.get = mockGet;
      mockRedis.setex = mockSetex;

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(mockHolidays),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      await repository.findAll({ upcoming: true });

      const getCall = mockGet.mock.calls[0];
      expect(getCall[0]).toBe('market_holidays:upcoming');
    });
  });

  describe('Cache TTL', () => {
    it('should use 30-day TTL for market holidays', async () => {
      const mockGet = vi.fn().mockResolvedValue(null);
      const mockSetex = vi.fn().mockResolvedValue('OK');
      mockRedis.get = mockGet;
      mockRedis.setex = mockSetex;

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(mockHolidays),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      await repository.findAll();

      expect(mockSetex).toHaveBeenCalled();
      const setexCall = mockSetex.mock.calls[0];
      // 2592000 seconds = 30 days
      expect(setexCall[1]).toBe(2592000);
    });
  });
});
