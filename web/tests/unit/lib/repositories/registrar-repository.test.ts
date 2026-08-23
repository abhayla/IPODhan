/**
 * Unit Tests for RegistrarRepository
 * Story 5.3: Registrar Directory
 *
 * Tests:
 * - findById - retrieve single registrar by ID
 * - findByName - retrieve single registrar by name
 * - findAll - retrieve all registrars (with alphabetical ordering)
 * - search - fuzzy search by registrar name
 * - Cache behavior validation
 * - Active filter validation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RegistrarRepository } from '@/lib/repositories/registrar-repository';
import type Redis from 'ioredis';
import type { Registrar } from '@/lib/db/types';

// Mock database and Redis
interface MockDb {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

const mockDb: MockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  delete: vi.fn(),
};

const mockRedis = {
  get: vi.fn(),
  setex: vi.fn(),
  del: vi.fn(),
  keys: vi.fn(),
} as unknown as Redis;

describe('RegistrarRepository', () => {
  let repository: RegistrarRepository;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockDbAny = mockDb as any;

  // Mock registrar data
  const mockRegistrars: Registrar[] = [
    {
      id: 'reg-1',
      name: 'Link Intime India Pvt Ltd',
      shortName: 'Link Intime',
      email: 'rnt.helpdesk@linkintime.co.in',
      phone: '022-49186000',
      website: 'https://linkintime.co.in',
      allotmentCheckUrl: 'https://linkintime.co.in/MIPO/Ipoallotment.html',
      address: 'C-101, 1st Floor, Mumbai - 400083',
      logoUrl: null,
      active: true,
      allotmentUrlHealthy: true,
      allotmentUrlCheckedAt: null,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    },
    {
      id: 'reg-2',
      name: 'KFin Technologies Limited',
      shortName: 'KFin Technologies',
      email: 'einward.ris@kfintech.com',
      phone: '040-67162222',
      website: 'https://www.kfintech.com',
      allotmentCheckUrl: 'https://kosmic.kfintech.com/ipostatus/',
      address: 'Selenium Building, Hyderabad - 500032',
      logoUrl: null,
      active: true,
      allotmentUrlHealthy: true,
      allotmentUrlCheckedAt: null,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    },
    {
      id: 'reg-3',
      name: 'Bigshare Services Pvt Ltd',
      shortName: 'Bigshare',
      email: 'info@bigshareonline.com',
      phone: '022-62638200',
      website: 'https://www.bigshareonline.com',
      allotmentCheckUrl: 'https://ipo.bigshareonline.com/ipo_status.html',
      address: '1st Floor, Mumbai - 400059',
      logoUrl: null,
      active: true,
      allotmentUrlHealthy: true,
      allotmentUrlCheckedAt: null,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    },
    {
      id: 'reg-4',
      name: 'Inactive Registrar Ltd',
      shortName: 'Inactive',
      email: 'info@inactive.com',
      phone: '011-12345678',
      website: 'https://inactive.com',
      allotmentCheckUrl: null,
      address: 'Delhi',
      logoUrl: null,
      active: false,
      allotmentUrlHealthy: true,
      allotmentUrlCheckedAt: null,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new RegistrarRepository(mockDbAny, mockRedis);
  });

  describe('findById', () => {
    it('should return a registrar by ID', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockRegistrars[0]]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findById('reg-1');

      expect(result).toEqual(mockRegistrars[0]);
      expect(result?.name).toBe('Link Intime India Pvt Ltd');
    });

    it('T-300: hides the allotment-check CTA (returns null URL) when the standing health check marked the URL dead', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const unhealthyRegistrar = { ...mockRegistrars[0], allotmentUrlHealthy: false };
      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([unhealthyRegistrar]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findById('reg-1');

      expect(result?.allotmentCheckUrl).toBeNull();
      // Everything else about the registrar (name, logo, website) still renders.
      expect(result?.name).toBe('Link Intime India Pvt Ltd');
    });

    it('should return null when registrar not found', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findById('non-existent');

      expect(result).toBeNull();
    });

    it('should use cached data when available', async () => {
      const cachedRegistrar = JSON.parse(JSON.stringify(mockRegistrars[0]));
      mockRedis.get = vi.fn().mockResolvedValue(JSON.stringify(cachedRegistrar));

      const result = await repository.findById('reg-1');

      expect(result).toEqual(cachedRegistrar);
      expect(mockDb.select).not.toHaveBeenCalled();
    });
  });

  describe('findByName', () => {
    it('should return a registrar by exact name', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockRegistrars[1]]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findByName('KFin Technologies Limited');

      expect(result).toEqual(mockRegistrars[1]);
      expect(result?.shortName).toBe('KFin Technologies');
    });

    it('should return null when name not found', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findByName('Non Existent Registrar');

      expect(result).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should return all active registrars ordered alphabetically', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const activeRegistrars = mockRegistrars.filter((r) => r.active);

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(activeRegistrars),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findAll();

      expect(result).toHaveLength(3);
      expect(result.every((r) => r.active)).toBe(true);
      expect(result.find((r) => r.shortName === 'Inactive')).toBeUndefined();
    });

    it('should return all registrars including inactive when activeOnly=false', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(mockRegistrars),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findAll(false);

      expect(result).toHaveLength(4);
      expect(result.find((r) => r.shortName === 'Inactive')).toBeDefined();
    });

    it('T-300: strips the allotment-check URL for an inactive registrar even if one is still set on the row', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const rowsWithAStaleUrlOnAnInactiveRow = mockRegistrars.map((r) =>
        r.shortName === 'Inactive' ? { ...r, allotmentCheckUrl: 'https://stale.example.com/status' } : r
      );
      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(rowsWithAStaleUrlOnAnInactiveRow),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findAll(false);

      expect(result.find((r) => r.shortName === 'Inactive')?.allotmentCheckUrl).toBeNull();
    });

    it('should use cached data when available', async () => {
      const cachedRegistrars = JSON.parse(JSON.stringify(mockRegistrars.filter((r) => r.active)));
      mockRedis.get = vi.fn().mockResolvedValue(JSON.stringify(cachedRegistrars));

      const result = await repository.findAll();

      expect(result).toEqual(cachedRegistrars);
      expect(mockDb.select).not.toHaveBeenCalled();
    });
  });

  describe('search', () => {
    it('should return registrars matching search query (name)', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const filteredRegistrars = [mockRegistrars[0]]; // Link Intime

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(filteredRegistrars),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.search('Link');

      expect(result).toHaveLength(1);
      expect(result[0].name).toContain('Link');
    });

    it('should return registrars matching search query (shortName)', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const filteredRegistrars = [mockRegistrars[1]]; // KFin

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(filteredRegistrars),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.search('KFin');

      expect(result).toHaveLength(1);
      expect(result[0].shortName).toBe('KFin Technologies');
    });

    it('should return all registrars when query is empty', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const activeRegistrars = mockRegistrars.filter((r) => r.active);

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(activeRegistrars),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.search('');

      expect(result).toHaveLength(3);
    });

    it('should filter by active status when searching', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const activeFilteredRegistrars = mockRegistrars.filter((r) => r.active && r.shortName === 'Bigshare');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(activeFilteredRegistrars),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.search('Big', true);

      expect(result).toHaveLength(1);
      expect(result.every((r) => r.active)).toBe(true);
    });

    it('should use cached search results when available', async () => {
      const cachedSearchResults = JSON.parse(JSON.stringify([mockRegistrars[0]]));
      mockRedis.get = vi.fn().mockResolvedValue(JSON.stringify(cachedSearchResults));

      const result = await repository.search('Link');

      expect(result).toEqual(cachedSearchResults);
      expect(mockDb.select).not.toHaveBeenCalled();
    });
  });

  describe('invalidateRegistrarCache', () => {
    it('should invalidate all registrar caches', async () => {
      mockRedis.keys = vi.fn().mockResolvedValue(['registrars:all:active', 'registrars:search:link:active']);
      mockRedis.del = vi.fn().mockResolvedValue(2);

      await repository.invalidateRegistrarCache();

      expect(mockRedis.keys).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalled();
    });

    it('should invalidate specific registrar cache by ID', async () => {
      mockRedis.keys = vi.fn().mockResolvedValue(['registrar:name:Link Intime India Pvt Ltd']);
      mockRedis.del = vi.fn().mockResolvedValue(1);

      await repository.invalidateRegistrarCache('reg-1');

      expect(mockRedis.keys).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalled();
    });
  });
});
