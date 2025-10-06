import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import type Redis from 'ioredis';

// Mock Drizzle DB
const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

// Mock Redis
const mockRedis = {
  get: vi.fn(),
  setex: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  keys: vi.fn(),
} as unknown as Redis;

describe('IPORepository', () => {
  let repository: IPORepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new IPORepository(mockDb, mockRedis);
  });

  describe('findById', () => {
    const mockIPO = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      slug: 'test-ipo',
      companyName: 'Test Company',
      category: 'MAINBOARD',
      status: 'OPEN',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should return IPO from cache if available', async () => {
      // Simulate cache behavior: Date objects are serialized as strings
      const cachedIPO = JSON.parse(JSON.stringify(mockIPO));
      mockRedis.get = vi.fn().mockResolvedValue(JSON.stringify(cachedIPO));

      const result = await repository.findById(mockIPO.id);

      expect(mockRedis.get).toHaveBeenCalledWith(`ipo:id:${mockIPO.id}`);
      expect(result).toEqual(cachedIPO);
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('should query database on cache miss and populate cache', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockIPO]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findById(mockIPO.id);

      expect(mockRedis.get).toHaveBeenCalledWith(`ipo:id:${mockIPO.id}`);
      expect(mockDb.select).toHaveBeenCalled();
      expect(result).toEqual(mockIPO);
      expect(mockRedis.setex).toHaveBeenCalledWith(
        `ipo:id:${mockIPO.id}`,
        1800,
        JSON.stringify(mockIPO)
      );
    });

    it('should return null when IPO not found', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findById('non-existent-id');

      expect(result).toBeNull();
    });

    it('should handle cache errors and fallback to database', async () => {
      mockRedis.get = vi.fn().mockRejectedValue(new Error('Redis error'));

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockIPO]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findById(mockIPO.id);

      expect(result).toEqual(mockIPO);
      expect(mockDb.select).toHaveBeenCalled();
    });
  });

  describe('findBySlug', () => {
    const mockIPO = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      slug: 'test-ipo',
      companyName: 'Test Company',
      category: 'MAINBOARD',
      status: 'OPEN',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should return IPO with relations from database', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockIPO]),
        orderBy: vi.fn().mockReturnThis(),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findBySlug('test-ipo');

      expect(result).toBeDefined();
      expect(result?.slug).toBe('test-ipo');
    });

    it('should return null when IPO not found by slug', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findBySlug('non-existent-slug');

      expect(result).toBeNull();
    });
  });

  describe('findAll', () => {
    const mockIPOs = [
      {
        id: '1',
        slug: 'ipo-1',
        companyName: 'Company 1',
        category: 'MAINBOARD',
        status: 'OPEN',
      },
      {
        id: '2',
        slug: 'ipo-2',
        companyName: 'Company 2',
        category: 'SME',
        status: 'UPCOMING',
      },
    ];

    it('should return paginated IPO list with filters', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockResolvedValue(mockIPOs),
      };

      const mockCountSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ count: 2 }]),
      };

      mockDb.select = vi
        .fn()
        .mockReturnValueOnce(mockCountSelect)
        .mockReturnValueOnce(mockSelect);

      const result = await repository.findAll({
        status: 'OPEN',
        page: 1,
        limit: 10,
      });

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(10);
    });
  });

  describe('search', () => {
    const mockResults = [
      {
        id: '1',
        slug: 'reliance-ipo',
        companyName: 'Reliance Industries',
        category: 'MAINBOARD',
        status: 'LISTED',
      },
    ];

    it('should search IPOs using trigram similarity', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(mockResults),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.search('Reliance', 10);

      expect(result).toHaveLength(1);
      expect(result[0].companyName).toBe('Reliance Industries');
    });

    it('should fallback to ILIKE search if trigram fails', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn()
          .mockRejectedValueOnce(new Error('Trigram error'))
          .mockResolvedValueOnce(mockResults),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.search('Reliance', 10);

      expect(result).toBeDefined();
    });
  });

  describe('create', () => {
    const mockIPOData = {
      slug: 'new-ipo',
      companyName: 'New Company',
      category: 'MAINBOARD' as const,
      status: 'UPCOMING' as const,
    };

    it('should create new IPO and invalidate cache', async () => {
      const createdIPO = { id: 'new-id', ...mockIPOData };

      const mockInsert = {
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([createdIPO]),
      };
      mockDb.insert = vi.fn().mockReturnValue(mockInsert);
      mockRedis.keys = vi.fn().mockResolvedValue(['ipo:list:hash1', 'ipo:search:hash2']);
      mockRedis.del = vi.fn().mockResolvedValue(2);

      const result = await repository.create(mockIPOData);

      expect(result).toEqual(createdIPO);
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockRedis.keys).toHaveBeenCalledWith('ipo:list:*');
    });
  });

  describe('update', () => {
    const mockIPO = {
      id: '123',
      slug: 'test-ipo',
      companyName: 'Test Company',
      category: 'MAINBOARD',
      status: 'OPEN',
    };

    it('should update IPO and invalidate cache', async () => {
      const updateData = { status: 'CLOSED' as const };
      const updatedIPO = { ...mockIPO, ...updateData };

      const mockUpdate = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([updatedIPO]),
      };
      mockDb.update = vi.fn().mockReturnValue(mockUpdate);
      mockRedis.del = vi.fn().mockResolvedValue(2);
      mockRedis.keys = vi.fn().mockResolvedValue(['ipo:list:hash1']);

      const result = await repository.update(mockIPO.id, updateData);

      expect(result.status).toBe('CLOSED');
      expect(mockRedis.del).toHaveBeenCalled();
    });

    it('should throw EntityNotFoundError when IPO not found', async () => {
      const mockUpdate = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([]),
      };
      mockDb.update = vi.fn().mockReturnValue(mockUpdate);

      await expect(
        repository.update('non-existent-id', { status: 'CLOSED' as const })
      ).rejects.toThrow('IPO not found');
    });
  });

  describe('delete', () => {
    it('should delete IPO and invalidate cache', async () => {
      const mockIPO = {
        id: '123',
        slug: 'test-ipo',
        companyName: 'Test Company',
      };

      const mockDelete = {
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([mockIPO]),
      };
      mockDb.delete = vi.fn().mockReturnValue(mockDelete);
      mockRedis.del = vi.fn().mockResolvedValue(2);
      mockRedis.keys = vi.fn().mockResolvedValue(['ipo:list:hash1']);

      await repository.delete(mockIPO.id);

      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalled();
    });

    it('should throw EntityNotFoundError when IPO not found', async () => {
      const mockDelete = {
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([]),
      };
      mockDb.delete = vi.fn().mockReturnValue(mockDelete);

      await expect(repository.delete('non-existent-id')).rejects.toThrow(
        'IPO not found'
      );
    });
  });
});
