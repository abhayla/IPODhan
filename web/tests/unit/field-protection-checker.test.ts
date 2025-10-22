/**
 * Unit Tests: Field Protection Checker
 * Tests for web/lib/admin/field-protection-checker.ts
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Redis } from 'ioredis';

// Mock dependencies
vi.mock('@/lib/db/index.js', () => ({
  getDb: vi.fn(),
}));

vi.mock('@/lib/cache/redis-client.js', () => ({
  getRedisClient: vi.fn(),
}));

// Import after mocks
import {
  isIPOLocked,
  isFieldProtected,
  filterProtectedFields,
  invalidateProtectionCache,
  getBlockedUpdateNotifications,
  markFieldAsManuallyEdited,
  type FieldProtectionStatus,
  type FilterProtectedFieldsResult,
  type BlockedUpdateNotification,
} from '@/lib/admin/field-protection-checker';
import { getDb } from '@/lib/db/index.js';
import { getRedisClient } from '@/lib/cache/redis-client.js';

describe('Field Protection Checker', () => {
  let mockDb: any;
  let mockRedis: Partial<Redis>;

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();

    // Mock Redis client - all methods return resolved promises
    mockRedis = {
      get: vi.fn().mockResolvedValue(null),
      setex: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
      keys: vi.fn().mockResolvedValue([]),
      zadd: vi.fn().mockResolvedValue(1),
      zremrangebyrank: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1),
      zrevrange: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as Redis);

    // Mock DB client - create chainable mock
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]), // Default: empty, tests override
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    };

    vi.mocked(getDb).mockResolvedValue(mockDb);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isIPOLocked', () => {
    it('should return true when IPO is locked', async () => {
      // Arrange
      mockDb.limit.mockResolvedValue([{ scraperLocked: true }]);

      // Act
      const result = await isIPOLocked('ipo-123');

      // Assert
      expect(result).toBe(true);
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('should return false when IPO is not locked', async () => {
      // Arrange
      mockDb.limit.mockResolvedValue([{ scraperLocked: false }]);

      // Act
      const result = await isIPOLocked('ipo-123');

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when IPO does not exist', async () => {
      // Arrange
      mockDb.limit.mockResolvedValue([]);

      // Act
      const result = await isIPOLocked('non-existent-ipo');

      // Assert
      expect(result).toBe(false);
    });

    it('should use cache on second call', async () => {
      // Arrange
      vi.mocked(mockRedis.get)
        .mockResolvedValueOnce(null) // First call - cache miss
        .mockResolvedValueOnce('1'); // Second call - cache hit
      mockDb.limit.mockResolvedValue([{ scraperLocked: true }]);

      // Act
      const result1 = await isIPOLocked('ipo-123');
      const result2 = await isIPOLocked('ipo-123');

      // Assert
      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(mockDb.select).toHaveBeenCalledTimes(1); // DB called only once
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'protection:ipo_locked:ipo-123',
        3600,
        '1'
      );
    });

    it('should handle Redis errors gracefully', async () => {
      // Arrange
      vi.mocked(mockRedis.get).mockRejectedValue(new Error('Redis error'));
      mockDb.limit.mockResolvedValue([{ scraperLocked: true }]);

      // Act
      const result = await isIPOLocked('ipo-123');

      // Assert
      expect(result).toBe(true);
      // Should not throw, should query DB
    });
  });

  describe('isFieldProtected', () => {
    it('should return protected=true when IPO is locked', async () => {
      // Arrange
      mockDb.limit
        .mockResolvedValueOnce([{ scraperLocked: true }]) // IPO lock check
        .mockResolvedValueOnce([]); // Field protection check (not reached)

      // Act
      const result = await isFieldProtected('ipo-123', 'ipos', 'lotSize');

      // Assert
      expect(result.isProtected).toBe(true);
      expect(result.reason).toBe('ipo_locked');
      expect(result.ipoLocked).toBe(true);
    });

    it('should return protected=true when field is protected', async () => {
      // Arrange
      mockDb.limit
        .mockResolvedValueOnce([{ scraperLocked: false }]) // IPO not locked
        .mockResolvedValueOnce([
          {
            isProtected: true,
            autoProtected: false,
            manuallyEditedAt: new Date('2025-01-20'),
            manuallyEditedBy: 'Admin',
          },
        ]); // Field is protected

      // Act
      const result = await isFieldProtected('ipo-123', 'ipos', 'lotSize');

      // Assert
      expect(result.isProtected).toBe(true);
      expect(result.reason).toBe('field_protected');
      expect(result.fieldProtected).toBe(true);
      expect(result.ipoLocked).toBe(false);
      expect(result.lastEditedBy).toBe('Admin');
    });

    it('should return protected=false when field is not protected', async () => {
      // Arrange
      mockDb.limit
        .mockResolvedValueOnce([{ scraperLocked: false }])
        .mockResolvedValueOnce([]); // No protection record

      // Act
      const result = await isFieldProtected('ipo-123', 'ipos', 'lotSize');

      // Assert
      expect(result.isProtected).toBe(false);
      expect(result.reason).toBeUndefined();
      expect(result.fieldProtected).toBe(false);
      expect(result.ipoLocked).toBe(false);
    });

    it('should indicate auto-protected fields', async () => {
      // Arrange
      mockDb.limit
        .mockResolvedValueOnce([{ scraperLocked: false }])
        .mockResolvedValueOnce([
          {
            isProtected: true,
            autoProtected: true,
            manuallyEditedAt: new Date(),
            manuallyEditedBy: 'Admin',
          },
        ]);

      // Act
      const result = await isFieldProtected('ipo-123', 'ipos', 'lotSize');

      // Assert
      expect(result.isProtected).toBe(true);
      expect(result.reason).toBe('auto_protected');
      expect(result.autoProtected).toBe(true);
    });

    it('should use cache for field protection status', async () => {
      // Arrange
      const cachedStatus: FieldProtectionStatus = {
        isProtected: true,
        reason: 'field_protected',
        ipoLocked: false,
        fieldProtected: true,
        autoProtected: false,
      };
      vi.mocked(mockRedis.get)
        .mockResolvedValueOnce(null) // IPO lock cache miss
        .mockResolvedValueOnce(JSON.stringify(cachedStatus)); // Field cache hit
      mockDb.limit.mockResolvedValueOnce([{ scraperLocked: false }]);

      // Act
      const result = await isFieldProtected('ipo-123', 'ipos', 'lotSize');

      // Assert
      expect(result).toEqual(cachedStatus);
      expect(mockDb.select).toHaveBeenCalledTimes(1); // Only IPO lock checked
    });
  });

  describe('filterProtectedFields', () => {
    it('should return empty object when IPO is locked', async () => {
      // Arrange
      mockDb.limit.mockResolvedValue([{ scraperLocked: true }]);
      const data = { lotSize: 3000, priceRangeMin: 100, priceRangeMax: 200 };

      // Act
      const result = await filterProtectedFields('ipo-123', 'ipos', data, 'NSE-Scraper');

      // Assert
      expect(result.filtered).toEqual({});
      expect(result.skipped).toEqual(data);
      expect(result.allFieldsProtected).toBe(true);
      expect(result.ipoLocked).toBe(true);
    });

    it('should filter out protected fields only', async () => {
      // Arrange
      // filterProtectedFields checks IPO lock once, then for each field:
      // - calls isFieldProtected, which first calls isIPOLocked again, then queries field protection
      // So sequence: IPO lock (1x) -> lotSize: IPO lock + field query -> priceRangeMin: IPO lock + field query -> priceRangeMax: IPO lock + field query
      mockDb.limit
        .mockResolvedValueOnce([{ scraperLocked: false }]) // Initial IPO lock check
        .mockResolvedValueOnce([{ scraperLocked: false }]) // lotSize: IPO lock check
        .mockResolvedValueOnce([
          { isProtected: true, autoProtected: false }, // lotSize: field is protected
        ])
        .mockResolvedValueOnce([{ scraperLocked: false }]) // priceRangeMin: IPO lock check
        .mockResolvedValueOnce([]) // priceRangeMin: no protection record
        .mockResolvedValueOnce([{ scraperLocked: false }]) // priceRangeMax: IPO lock check
        .mockResolvedValueOnce([]); // priceRangeMax: no protection record

      const data = { lotSize: 3000, priceRangeMin: 100, priceRangeMax: 200 };

      // Act
      const result = await filterProtectedFields('ipo-123', 'ipos', data, 'NSE-Scraper');

      // Assert
      expect(result.filtered).toEqual({ priceRangeMin: 100, priceRangeMax: 200 });
      expect(result.skipped).toEqual({ lotSize: 3000 });
      expect(result.allFieldsProtected).toBe(false);
      expect(result.ipoLocked).toBe(false);
    });

    it('should allow all fields when none are protected', async () => {
      // Arrange
      mockDb.limit
        .mockResolvedValueOnce([{ scraperLocked: false }])
        .mockResolvedValueOnce([{ isProtected: false }])
        .mockResolvedValueOnce([{ isProtected: false }]);

      const data = { lotSize: 3000, priceRangeMin: 100 };

      // Act
      const result = await filterProtectedFields('ipo-123', 'ipos', data, 'NSE-Scraper');

      // Assert
      expect(result.filtered).toEqual(data);
      expect(result.skipped).toEqual({});
      expect(result.allFieldsProtected).toBe(false);
    });

    it('should store blocked update notifications', async () => {
      // Arrange
      mockDb.limit.mockResolvedValue([{ scraperLocked: true }]);
      const data = { lotSize: 3000 };

      // Act
      await filterProtectedFields('ipo-123', 'ipos', data, 'NSE-Scraper');

      // Assert
      expect(mockRedis.zadd).toHaveBeenCalledWith(
        'protection:blocked_updates',
        expect.any(Number),
        expect.stringContaining('NSE-Scraper')
      );
      expect(mockRedis.zremrangebyrank).toHaveBeenCalledWith(
        'protection:blocked_updates',
        0,
        -1001
      );
      expect(mockRedis.expire).toHaveBeenCalledWith(
        'protection:blocked_updates',
        7 * 24 * 3600
      );
    });
  });

  describe('invalidateProtectionCache', () => {
    it('should invalidate IPO-level cache only', async () => {
      // Arrange
      vi.mocked(mockRedis.del).mockResolvedValue(1);

      // Act
      await invalidateProtectionCache('ipo-123');

      // Assert
      expect(mockRedis.del).toHaveBeenCalledWith('protection:ipo_locked:ipo-123');
    });

    it('should invalidate specific field cache', async () => {
      // Arrange
      vi.mocked(mockRedis.keys).mockResolvedValue([]);
      vi.mocked(mockRedis.del).mockResolvedValue(2);

      // Act
      await invalidateProtectionCache('ipo-123', 'ipos', 'lotSize');

      // Assert
      expect(mockRedis.del).toHaveBeenCalledWith(
        'protection:ipo_locked:ipo-123',
        'protection:field:ipo-123:ipos:lotSize'
      );
    });

    it('should invalidate all fields in table', async () => {
      // Arrange
      vi.mocked(mockRedis.keys).mockResolvedValue([
        'protection:field:ipo-123:ipos:lotSize',
        'protection:field:ipo-123:ipos:priceRangeMin',
      ]);
      vi.mocked(mockRedis.del).mockResolvedValue(3);

      // Act
      await invalidateProtectionCache('ipo-123', 'ipos');

      // Assert
      expect(mockRedis.keys).toHaveBeenCalledWith('protection:field:ipo-123:ipos:*');
      expect(mockRedis.del).toHaveBeenCalledWith(
        'protection:ipo_locked:ipo-123',
        'protection:field:ipo-123:ipos:lotSize',
        'protection:field:ipo-123:ipos:priceRangeMin'
      );
    });

    it('should handle Redis errors gracefully', async () => {
      // Arrange
      vi.mocked(mockRedis.del).mockRejectedValue(new Error('Redis error'));

      // Act & Assert
      await expect(invalidateProtectionCache('ipo-123')).resolves.not.toThrow();
    });
  });

  describe('getBlockedUpdateNotifications', () => {
    it('should return parsed notifications', async () => {
      // Arrange
      // Note: When JSON.stringify is used, Date objects become ISO strings
      const notification1 = {
        ipoId: 'ipo-123',
        tableName: 'ipos',
        fieldName: 'lotSize',
        scraperName: 'NSE-Scraper',
        reason: 'field_protected',
        timestamp: '2025-01-20T10:00:00.000Z', // ISO string, not Date
        attemptedValue: 3000,
      };
      const notification2 = {
        ipoId: 'ipo-456',
        tableName: 'ipos',
        scraperName: 'BSE-Scraper',
        reason: 'ipo_locked',
        timestamp: '2025-01-20T11:00:00.000Z', // ISO string, not Date
      };

      vi.mocked(mockRedis.zrevrange).mockResolvedValue([
        JSON.stringify(notification1),
        JSON.stringify(notification2),
      ]);

      // Act
      const result = await getBlockedUpdateNotifications(10);

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(notification1);
      expect(result[1]).toEqual(notification2);
      expect(mockRedis.zrevrange).toHaveBeenCalledWith('protection:blocked_updates', 0, 9);
    });

    it('should return empty array on Redis error', async () => {
      // Arrange
      vi.mocked(mockRedis.zrevrange).mockRejectedValue(new Error('Redis error'));

      // Act
      const result = await getBlockedUpdateNotifications(10);

      // Assert
      expect(result).toEqual([]);
    });

    it('should respect limit parameter', async () => {
      // Arrange
      vi.mocked(mockRedis.zrevrange).mockResolvedValue([]);

      // Act
      await getBlockedUpdateNotifications(25);

      // Assert
      expect(mockRedis.zrevrange).toHaveBeenCalledWith('protection:blocked_updates', 0, 24);
    });
  });

  describe('markFieldAsManuallyEdited', () => {
    it('should create protection record with auto-protect enabled', async () => {
      // Arrange
      mockDb.onConflictDoUpdate.mockResolvedValue({});

      // Act
      await markFieldAsManuallyEdited(
        'ipo-123',
        'ipos',
        'lotSize',
        'Admin',
        'Corrected lot size',
        true
      );

      // Assert
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          ipoId: 'ipo-123',
          tableName: 'ipos',
          fieldName: 'lotSize',
          isProtected: true,
          autoProtected: true,
          manuallyEditedBy: 'Admin',
          editNote: 'Corrected lot size',
        })
      );
    });

    it('should create protection record without auto-protect', async () => {
      // Arrange
      mockDb.onConflictDoUpdate.mockResolvedValue({});

      // Act
      await markFieldAsManuallyEdited(
        'ipo-123',
        'ipos',
        'lotSize',
        'Admin',
        undefined,
        false
      );

      // Assert
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          isProtected: false,
          autoProtected: false,
        })
      );
    });

    it('should update IPO last_manual_edit_at timestamp', async () => {
      // Arrange
      mockDb.onConflictDoUpdate.mockResolvedValue({});

      // Act
      await markFieldAsManuallyEdited('ipo-123', 'ipos', 'lotSize', 'Admin');

      // Assert
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          lastManualEditAt: expect.any(Date),
        })
      );
    });

    it('should invalidate protection cache', async () => {
      // Arrange
      mockDb.onConflictDoUpdate.mockResolvedValue({});
      vi.mocked(mockRedis.del).mockResolvedValue(1);

      // Act
      await markFieldAsManuallyEdited('ipo-123', 'ipos', 'lotSize', 'Admin');

      // Assert
      expect(mockRedis.del).toHaveBeenCalled();
    });
  });
});
