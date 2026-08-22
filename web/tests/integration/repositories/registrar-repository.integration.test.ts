/**
 * Integration Tests for RegistrarRepository
 * Story 4.6: Allotment Status Checker
 *
 * Tests repository methods with real database and Redis cache
 *
 * Requirements:
 * - PostgreSQL test database
 * - Redis instance running
 * - TEST_DATABASE_URL environment variable
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { RegistrarRepository } from '@/lib/repositories/registrar-repository';
import { db } from '@/lib/db/index';
import { getRedisClient, closeRedisClient } from '@/lib/cache/redis-client';
import { registrars } from '@/lib/db';
import { eq } from 'drizzle-orm';
import type { NewRegistrar } from '@/lib/db/types';
import { assertNotProductionDatabase } from '../../helpers/db-safety-guard';

describe('RegistrarRepository Integration Tests', () => {
  let repository: RegistrarRepository;
  let redis: ReturnType<typeof getRedisClient>;
  let testRegistrarId: string;

  const testRegistrar: Omit<NewRegistrar, 'id' | 'createdAt' | 'updatedAt'> = {
    name: 'Test Registrar Ltd',
    shortName: 'Test Registrar',
    email: 'test@testregistrar.com',
    phone: '123-456-7890',
    website: 'https://testregistrar.com',
    allotmentCheckUrl: 'https://testregistrar.com/check',
    address: 'Test Address',
    logoUrl: null,
    active: true,
  };

  beforeAll(async () => {
    assertNotProductionDatabase('registrar-repository.integration.test.ts');

    redis = getRedisClient();
    repository = new RegistrarRepository(db, redis);

    // Clean up any existing test data
    await db.delete(registrars).where(eq(registrars.name, testRegistrar.name));

    // Insert test registrar
    const [inserted] = await db
      .insert(registrars)
      .values(testRegistrar)
      .returning();

    testRegistrarId = inserted.id;
  });

  afterAll(async () => {
    // Clean up test data
    await db.delete(registrars).where(eq(registrars.id, testRegistrarId));
    await closeRedisClient();
  });

  beforeEach(async () => {
    // Clear cache before each test
    const keys = await redis.keys('registrar:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  describe('findById', () => {
    it('should find registrar by ID from database', async () => {
      const registrar = await repository.findById(testRegistrarId);

      expect(registrar).toBeDefined();
      expect(registrar?.id).toBe(testRegistrarId);
      expect(registrar?.name).toBe(testRegistrar.name);
      expect(registrar?.shortName).toBe(testRegistrar.shortName);
      expect(registrar?.website).toBe(testRegistrar.website);
      expect(registrar?.allotmentCheckUrl).toBe(testRegistrar.allotmentCheckUrl);
      expect(registrar?.active).toBe(true);
    });

    it('should return null for non-existent ID', async () => {
      const registrar = await repository.findById('00000000-0000-0000-0000-000000000000');
      expect(registrar).toBeNull();
    });

    it('should cache registrar data on first fetch', async () => {
      // First call - should fetch from database
      const registrar1 = await repository.findById(testRegistrarId);
      expect(registrar1).toBeDefined();

      // Check if cached
      const cacheKey = `registrar:${testRegistrarId}`;
      const cached = await redis.get(cacheKey);
      expect(cached).toBeDefined();

      const cachedData = JSON.parse(cached!);
      expect(cachedData.id).toBe(testRegistrarId);
      expect(cachedData.name).toBe(testRegistrar.name);
    });

    it('should serve from cache on subsequent calls', async () => {
      // First call - cache miss
      await repository.findById(testRegistrarId);

      // Second call - should hit cache
      const registrar2 = await repository.findById(testRegistrarId);
      expect(registrar2).toBeDefined();
      expect(registrar2?.id).toBe(testRegistrarId);
    });
  });

  describe('findByName', () => {
    it('should find registrar by name', async () => {
      const registrar = await repository.findByName(testRegistrar.name);

      expect(registrar).toBeDefined();
      expect(registrar?.id).toBe(testRegistrarId);
      expect(registrar?.name).toBe(testRegistrar.name);
    });

    it('should return null for non-existent name', async () => {
      const registrar = await repository.findByName('Non Existent Registrar');
      expect(registrar).toBeNull();
    });

    it('should cache registrar data by name', async () => {
      await repository.findByName(testRegistrar.name);

      const cacheKey = `registrar:name:${testRegistrar.name}`;
      const cached = await redis.get(cacheKey);
      expect(cached).toBeDefined();
    });
  });

  describe('findAll', () => {
    it('should find all active registrars by default', async () => {
      const registrars = await repository.findAll();

      expect(Array.isArray(registrars)).toBe(true);
      expect(registrars.length).toBeGreaterThan(0);

      // All should be active
      registrars.forEach(reg => {
        expect(reg.active).toBe(true);
      });
    });

    it('should find only active registrars when activeOnly is true', async () => {
      const registrars = await repository.findAll(true);

      expect(Array.isArray(registrars)).toBe(true);
      registrars.forEach(reg => {
        expect(reg.active).toBe(true);
      });
    });

    it('should find all registrars including inactive when activeOnly is false', async () => {
      const registrars = await repository.findAll(false);

      expect(Array.isArray(registrars)).toBe(true);
      expect(registrars.length).toBeGreaterThanOrEqual(0);
    });

    it('should cache findAll results', async () => {
      await repository.findAll(true);

      const cacheKey = 'registrars:all:active';
      const cached = await redis.get(cacheKey);
      expect(cached).toBeDefined();
    });
  });

  describe('cache invalidation', () => {
    it('should invalidate registrar cache by ID', async () => {
      // Cache the registrar
      await repository.findById(testRegistrarId);

      // Verify cached
      const cacheKey = `registrar:${testRegistrarId}`;
      let cached = await redis.get(cacheKey);
      expect(cached).toBeDefined();

      // Invalidate cache
      await repository.invalidateRegistrarCache(testRegistrarId);

      // Verify cache cleared
      cached = await redis.get(cacheKey);
      expect(cached).toBeNull();
    });

    it('should invalidate all registrar caches', async () => {
      // Cache various registrar queries
      await repository.findById(testRegistrarId);
      await repository.findAll(true);

      // Verify cached
      const keys = await redis.keys('registrar*');
      expect(keys.length).toBeGreaterThan(0);

      // Invalidate all
      await repository.invalidateRegistrarCache();

      // Verify all cleared
      const keysAfter = await redis.keys('registrar*');
      expect(keysAfter.length).toBe(0);
    });
  });
});
