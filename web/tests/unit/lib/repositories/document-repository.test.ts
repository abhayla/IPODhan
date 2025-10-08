import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentRepository } from '@/lib/repositories/document-repository';
import type Redis from 'ioredis';
import { EntityNotFoundError } from '@/lib/errors/repository-errors';

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

describe('DocumentRepository', () => {
  let repository: DocumentRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new DocumentRepository(mockDb, mockRedis);
  });

  describe('findByIPO', () => {
    const mockIPOId = 'ipo-123';
    const mockDocuments = [
      {
        id: 'doc-1',
        ipoId: mockIPOId,
        type: 'DRHP',
        url: 'https://example.com/drhp.pdf',
        title: 'drhp.pdf',
        fileSize: 1024000,
        uploadedAt: new Date('2024-01-15'),
      },
      {
        id: 'doc-2',
        ipoId: mockIPOId,
        type: 'RHP',
        url: 'https://example.com/rhp.pdf',
        title: 'rhp.pdf',
        fileSize: 2048000,
        uploadedAt: new Date('2024-01-16'),
      },
    ];

    it('should return documents from cache if available', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(JSON.stringify(mockDocuments));

      const result = await repository.findByIPO(mockIPOId);

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('DRHP');
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('should query database on cache miss and populate cache', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(mockDocuments),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findByIPO(mockIPOId);

      expect(result).toHaveLength(2);
      expect(mockDb.select).toHaveBeenCalled();
      expect(mockRedis.setex).toHaveBeenCalled();
    });

    it('should return empty array when no documents found', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findByIPO(mockIPOId);

      expect(result).toHaveLength(0);
    });

    it('should handle cache errors and fallback to database', async () => {
      mockRedis.get = vi.fn().mockRejectedValue(new Error('Redis error'));
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(mockDocuments),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findByIPO(mockIPOId);

      expect(result).toHaveLength(2);
      expect(mockDb.select).toHaveBeenCalled();
    });
  });

  describe('create', () => {
    const newDocument = {
      ipoId: 'ipo-123',
      type: 'DRHP' as const,
      url: 'https://example.com/new-doc.pdf',
      title: 'new-doc.pdf',
      fileSize: 512000,
    };

    it('should create new document and invalidate cache', async () => {
      const createdDocument = {
        id: 'doc-new',
        ...newDocument,
        uploadedAt: new Date(),
      };

      mockRedis.del = vi.fn().mockResolvedValue(1);

      const mockInsert = {
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([createdDocument]),
      };
      mockDb.insert = vi.fn().mockReturnValue(mockInsert);

      const result = await repository.create(newDocument);

      expect(result).toEqual(createdDocument);
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalled();
    });

    it('should throw DatabaseError on insert failure', async () => {
      mockRedis.del = vi.fn().mockResolvedValue(1);

      const mockInsert = {
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockRejectedValue(new Error('Insert failed')),
      };
      mockDb.insert = vi.fn().mockReturnValue(mockInsert);

      await expect(repository.create(newDocument)).rejects.toThrow();
    });
  });

  describe('delete', () => {
    const documentId = 'doc-123';
    const mockDeletedDoc = {
      id: documentId,
      ipoId: 'ipo-123',
      type: 'DRHP',
      url: 'https://example.com/doc.pdf',
      title: 'doc.pdf',
      fileSize: 1024000,
    };

    it('should delete document and invalidate cache', async () => {
      mockRedis.del = vi.fn().mockResolvedValue(1);

      const mockDelete = {
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([mockDeletedDoc]),
      };
      mockDb.delete = vi.fn().mockReturnValue(mockDelete);

      await repository.delete(documentId);

      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalled();
    });

    it('should throw EntityNotFoundError when document not found', async () => {
      const mockDelete = {
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([]),
      };
      mockDb.delete = vi.fn().mockReturnValue(mockDelete);

      await expect(repository.delete(documentId)).rejects.toThrow(
        EntityNotFoundError
      );
    });

    it('should throw DatabaseError on delete failure', async () => {
      const mockDelete = {
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockRejectedValue(new Error('Delete failed')),
      };
      mockDb.delete = vi.fn().mockReturnValue(mockDelete);

      await expect(repository.delete(documentId)).rejects.toThrow();
    });
  });

  describe('deleteByIPO', () => {
    const ipoId = 'ipo-123';

    it('should delete all documents for an IPO and invalidate cache', async () => {
      mockRedis.del = vi.fn().mockResolvedValue(1);

      const mockDelete = {
        where: vi.fn().mockResolvedValue(undefined),
      };
      mockDb.delete = vi.fn().mockReturnValue(mockDelete);

      await repository.deleteByIPO(ipoId);

      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalled();
    });

    it('should throw DatabaseError on bulk delete failure', async () => {
      const mockDelete = {
        where: vi.fn().mockRejectedValue(new Error('Bulk delete failed')),
      };
      mockDb.delete = vi.fn().mockReturnValue(mockDelete);

      await expect(repository.deleteByIPO(ipoId)).rejects.toThrow();
    });
  });
});
