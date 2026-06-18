/**
 * Unit Tests: Field Protection Repository
 * Tests for web/lib/repositories/field-protection-repository.ts
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Redis } from 'ioredis';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

// Mock dependencies
vi.mock('@/lib/db/index.js', () => ({
  getDb: vi.fn(),
}));

vi.mock('@/lib/cache/redis-client.js', () => ({
  getRedisClient: vi.fn(),
}));

// Import after mocks
import { FieldProtectionRepository } from '@/lib/repositories/field-protection-repository';
import type { FieldProtectionRecord } from '@/lib/repositories/field-protection-repository';

describe('FieldProtectionRepository', () => {
  let repository: FieldProtectionRepository;
  let mockDb: any;
  let mockRedis: Partial<Redis>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock Redis
    mockRedis = {
      get: vi.fn(),
      setex: vi.fn(),
      del: vi.fn(),
      keys: vi.fn(),
    };

    // Mock DB with chainable query builder
    // Note: Drizzle queries return Promises when awaited
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockReturnThis(),
      returning: vi.fn(),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      execute: vi.fn(),
      then: vi.fn(),
    };

    repository = new FieldProtectionRepository(
      mockDb as unknown as NodePgDatabase<any>,
      mockRedis as Redis
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('findByIPOId', () => {
    it('should return all field protections for an IPO', async () => {
      // Arrange
      const mockProtections: FieldProtectionRecord[] = [
        {
          id: '1',
          tableName: 'ipos',
          fieldName: 'lotSize',
          ipoId: 'ipo-123',
          isProtected: true,
          autoProtected: true,
          manuallyEditedAt: new Date('2025-01-20'),
          manuallyEditedBy: 'Admin',
          editNote: 'Corrected value',
          createdAt: new Date('2025-01-20'),
          updatedAt: new Date('2025-01-20'),
        },
        {
          id: '2',
          tableName: 'ipos',
          fieldName: 'priceRangeMin',
          ipoId: 'ipo-123',
          isProtected: false,
          autoProtected: false,
          manuallyEditedAt: null,
          manuallyEditedBy: null,
          editNote: null,
          createdAt: new Date('2025-01-20'),
          updatedAt: new Date('2025-01-20'),
        },
      ];

      mockRedis.get = vi.fn().mockResolvedValue(null);
      // findByIPOId doesn't use .limit(), so mock .where() to resolve
      mockDb.where.mockResolvedValue(mockProtections);

      // Act
      const result = await repository.findByIPOId('ipo-123');

      // Assert
      expect(result).toEqual(mockProtections);
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('should use cache on second call', async () => {
      // Arrange
      const mockProtections: FieldProtectionRecord[] = [];
      mockRedis.get = vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(JSON.stringify(mockProtections));
      // findByIPOId doesn't use .limit(), so mock .where() to resolve
      mockDb.where.mockResolvedValue(mockProtections);

      // Act
      await repository.findByIPOId('ipo-123');
      const result = await repository.findByIPOId('ipo-123');

      // Assert
      expect(result).toEqual(mockProtections);
      expect(mockDb.select).toHaveBeenCalledTimes(1);
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'protection:ipo:ipo-123:all',
        3600,
        JSON.stringify(mockProtections)
      );
    });
  });

  describe('findByField', () => {
    it('should return protection status for specific field', async () => {
      // Arrange
      const mockProtection: FieldProtectionRecord = {
        id: '1',
        tableName: 'ipos',
        fieldName: 'lotSize',
        ipoId: 'ipo-123',
        isProtected: true,
        autoProtected: false,
        manuallyEditedAt: new Date('2025-01-20'),
        manuallyEditedBy: 'Admin',
        editNote: null,
        createdAt: new Date('2025-01-20'),
        updatedAt: new Date('2025-01-20'),
      };

      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockDb.limit.mockResolvedValue([mockProtection]);

      // Act
      const result = await repository.findByField('ipo-123', 'ipos', 'lotSize');

      // Assert
      expect(result).toEqual(mockProtection);
    });

    it('should return null when field protection not found', async () => {
      // Arrange
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockDb.limit.mockResolvedValue([]);

      // Act
      const result = await repository.findByField('ipo-123', 'ipos', 'lotSize');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('findByTable', () => {
    it('should return all protections for a table', async () => {
      // Arrange
      const mockProtections: FieldProtectionRecord[] = [
        {
          id: '1',
          tableName: 'ipos',
          fieldName: 'lotSize',
          ipoId: 'ipo-123',
          isProtected: true,
          autoProtected: true,
          manuallyEditedAt: new Date(),
          manuallyEditedBy: 'Admin',
          editNote: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockRedis.get = vi.fn().mockResolvedValue(null);
      // findByTable doesn't use .limit(), so mock .where() to resolve
      mockDb.where.mockResolvedValue(mockProtections);

      // Act
      const result = await repository.findByTable('ipo-123', 'ipos');

      // Assert
      expect(result).toEqual(mockProtections);
    });
  });

  describe('upsert', () => {
    it('should create new field protection record', async () => {
      // Arrange
      const input = {
        ipoId: 'ipo-123',
        tableName: 'ipos',
        fieldName: 'lotSize',
        isProtected: true,
        autoProtected: true,
        manuallyEditedBy: 'Admin',
        editNote: 'Corrected value',
      };

      const mockResult: FieldProtectionRecord = {
        id: '1',
        ...input,
        manuallyEditedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.returning.mockResolvedValue([mockResult]);
      mockRedis.del = vi.fn().mockResolvedValue(1);

      // Act
      const result = await repository.upsert(input);

      // Assert
      expect(result).toEqual(mockResult);
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          ipoId: 'ipo-123',
          tableName: 'ipos',
          fieldName: 'lotSize',
          isProtected: true,
          autoProtected: true,
        })
      );
    });

    it('should update existing field protection record', async () => {
      // Arrange
      const input = {
        ipoId: 'ipo-123',
        tableName: 'ipos',
        fieldName: 'lotSize',
        isProtected: false,
        manuallyEditedBy: 'Admin',
      };

      const mockResult: FieldProtectionRecord = {
        id: '1',
        ...input,
        autoProtected: false,
        manuallyEditedAt: new Date(),
        editNote: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.returning.mockResolvedValue([mockResult]);
      mockRedis.del = vi.fn().mockResolvedValue(1);

      // Act
      const result = await repository.upsert(input);

      // Assert
      expect(result).toEqual(mockResult);
      expect(mockDb.onConflictDoUpdate).toHaveBeenCalled();
    });

    it('should invalidate caches after upsert', async () => {
      // Arrange
      const input = {
        ipoId: 'ipo-123',
        tableName: 'ipos',
        fieldName: 'lotSize',
        isProtected: true,
        manuallyEditedBy: 'Admin',
      };

      mockDb.returning.mockResolvedValue([{ id: '1', ...input }]);
      mockRedis.del = vi.fn().mockResolvedValue(3);

      // Act
      await repository.upsert(input);

      // Assert
      // deleteCache passes keys as spread arguments (...keys)
      expect(mockRedis.del).toHaveBeenCalledWith(
        'protection:ipo:ipo-123:all',
        'protection:table:ipo-123:ipos',
        'protection:field:ipo-123:ipos:lotSize'
      );
    });
  });

  describe('updateProtectionStatus', () => {
    it('should update protection status', async () => {
      // Arrange
      const mockResult: FieldProtectionRecord = {
        id: '1',
        tableName: 'ipos',
        fieldName: 'lotSize',
        ipoId: 'ipo-123',
        isProtected: false,
        autoProtected: false,
        manuallyEditedAt: new Date(),
        manuallyEditedBy: 'Admin',
        editNote: 'Unlocked',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.returning.mockResolvedValue([mockResult]);
      mockRedis.del = vi.fn().mockResolvedValue(1);

      // Act
      const result = await repository.updateProtectionStatus(
        'ipo-123',
        'ipos',
        'lotSize',
        { isProtected: false, editNote: 'Unlocked' }
      );

      // Assert
      expect(result).toEqual(mockResult);
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          isProtected: false,
          editNote: 'Unlocked',
          updatedAt: expect.any(Date),
        })
      );
    });

    it('should return null when field not found', async () => {
      // Arrange
      mockDb.returning.mockResolvedValue([]);

      // Act
      const result = await repository.updateProtectionStatus(
        'ipo-123',
        'ipos',
        'nonexistent',
        { isProtected: false }
      );

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('bulkUpdateProtectionStatus', () => {
    it('should update multiple fields', async () => {
      // Arrange
      const fieldNames = ['lotSize', 'priceRangeMin', 'priceRangeMax'];
      // The repo upserts one row per field; each .returning() yields 1 row → 3 total.
      mockDb.returning.mockResolvedValue([{ id: '1' }]);
      mockRedis.del = vi.fn().mockResolvedValue(1);

      // Act
      const result = await repository.bulkUpdateProtectionStatus(
        'ipo-123',
        'ipos',
        fieldNames,
        true
      );

      // Assert — repo uses insert().onConflictDoUpdate() (upsert), not update().set()
      expect(result).toBe(3);
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.onConflictDoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          set: expect.objectContaining({
            isProtected: true,
            updatedAt: expect.any(Date),
          }),
        })
      );
    });

    it('should invalidate caches for all updated fields', async () => {
      // Arrange
      const fieldNames = ['lotSize', 'priceRangeMin'];
      mockDb.returning.mockResolvedValue([{ id: '1' }, { id: '2' }]);
      mockRedis.del = vi.fn().mockResolvedValue(1);

      // Act
      await repository.bulkUpdateProtectionStatus(
        'ipo-123',
        'ipos',
        fieldNames,
        true
      );

      // Assert
      expect(mockRedis.del).toHaveBeenCalledTimes(2); // Once per field
    });
  });

  describe('delete', () => {
    it('should delete field protection record', async () => {
      // Arrange
      mockDb.returning.mockResolvedValue([{ id: '1' }]);
      mockRedis.del = vi.fn().mockResolvedValue(1);

      // Act
      const result = await repository.delete('ipo-123', 'ipos', 'lotSize');

      // Assert
      expect(result).toBe(true);
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should return false when record not found', async () => {
      // Arrange
      mockDb.returning.mockResolvedValue([]);

      // Act
      const result = await repository.delete('ipo-123', 'ipos', 'nonexistent');

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('deleteAllForIPO', () => {
    it('should delete all protections for an IPO', async () => {
      // Arrange
      mockDb.returning.mockResolvedValue([{ id: '1' }, { id: '2' }, { id: '3' }]);
      mockRedis.keys = vi.fn().mockResolvedValue([
        'protection:ipo:ipo-123:all',
        'protection:field:ipo-123:ipos:lotSize',
      ]);
      mockRedis.del = vi.fn().mockResolvedValue(2);

      // Act
      const result = await repository.deleteAllForIPO('ipo-123');

      // Assert
      expect(result).toBe(3);
      expect(mockDb.delete).toHaveBeenCalled();
    });
  });

  describe('countProtectedFields', () => {
    it('should count only protected fields', async () => {
      // Arrange
      const mockProtections: FieldProtectionRecord[] = [
        {
          id: '1',
          tableName: 'ipos',
          fieldName: 'lotSize',
          ipoId: 'ipo-123',
          isProtected: true,
          autoProtected: false,
          manuallyEditedAt: new Date(),
          manuallyEditedBy: 'Admin',
          editNote: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '2',
          tableName: 'ipos',
          fieldName: 'priceRangeMin',
          ipoId: 'ipo-123',
          isProtected: false,
          autoProtected: false,
          manuallyEditedAt: null,
          manuallyEditedBy: null,
          editNote: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '3',
          tableName: 'ipos',
          fieldName: 'priceRangeMax',
          ipoId: 'ipo-123',
          isProtected: true,
          autoProtected: true,
          manuallyEditedAt: new Date(),
          manuallyEditedBy: 'Admin',
          editNote: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockRedis.get = vi.fn().mockResolvedValue(null);
      // countProtectedFields calls findByIPOId which doesn't use .limit()
      mockDb.where.mockResolvedValue(mockProtections);

      // Act
      const result = await repository.countProtectedFields('ipo-123');

      // Assert
      expect(result).toBe(2); // Only 2 protected fields
    });
  });
});
