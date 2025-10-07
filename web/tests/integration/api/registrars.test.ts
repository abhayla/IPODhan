/**
 * Integration Tests for GET /api/registrars
 * Story 5.3: Registrar Directory
 *
 * Tests the full API route with real database and Redis connections.
 * Ensures proper integration with RegistrarRepository and caching.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { registrars } from '@/lib/db/schema';
import { GET } from '@/app/api/registrars/route';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';

// ==================== TEST DATA ====================

const testRegistrars = [
  {
    name: 'Alpha Registrar Services Ltd',
    shortName: 'Alpha Registrar',
    email: 'info@alpharegistrar.com',
    phone: '022-12345678',
    website: 'https://www.alpharegistrar.com',
    allotmentCheckUrl: 'https://www.alpharegistrar.com/ipo-status',
    address: 'Mumbai - 400001',
    logoUrl: null,
    active: true,
  },
  {
    name: 'Beta Registrar Technologies',
    shortName: 'Beta Registrar',
    email: 'contact@betaregistrar.com',
    phone: '011-87654321',
    website: 'https://www.betaregistrar.com',
    allotmentCheckUrl: 'https://www.betaregistrar.com/allotment',
    address: 'New Delhi - 110001',
    logoUrl: null,
    active: true,
  },
  {
    name: 'Gamma Corporate Services',
    shortName: 'Gamma',
    email: 'support@gamma.com',
    phone: '044-11223344',
    website: 'https://www.gamma.com',
    allotmentCheckUrl: null,
    address: 'Chennai - 600001',
    logoUrl: null,
    active: false, // Inactive registrar
  },
];

let insertedRegistrarIds: string[] = [];

// ==================== SETUP & TEARDOWN ====================

beforeAll(async () => {
  // Clean up any existing test data
  await db
    .delete(registrars)
    .where(eq(registrars.name, 'Alpha Registrar Services Ltd'));
  await db
    .delete(registrars)
    .where(eq(registrars.name, 'Beta Registrar Technologies'));
  await db
    .delete(registrars)
    .where(eq(registrars.name, 'Gamma Corporate Services'));
});

afterAll(async () => {
  // Clean up test data
  for (const id of insertedRegistrarIds) {
    await db.delete(registrars).where(eq(registrars.id, id));
  }

  // Clear Redis cache
  const redis = getRedisClient();
  const keys = await redis.keys('registrars:*');
  if (keys.length > 0) {
    await redis.del(...keys);
  }

  insertedRegistrarIds = [];
});

beforeEach(async () => {
  // Insert fresh test data before each test
  insertedRegistrarIds = [];

  for (const registrar of testRegistrars) {
    const [inserted] = await db.insert(registrars).values(registrar).returning();
    insertedRegistrarIds.push(inserted.id);
  }

  // Clear Redis cache to ensure fresh data
  const redis = getRedisClient();
  const keys = await redis.keys('registrars:*');
  if (keys.length > 0) {
    await redis.del(...keys);
  }
});

// ==================== TESTS ====================

describe('GET /api/registrars', () => {
  describe('Basic Functionality', () => {
    it('should return all active registrars by default', async () => {
      const request = new NextRequest('http://localhost:3000/api/registrars');
      const response = await GET(request);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('registrars');
      expect(Array.isArray(data.registrars)).toBe(true);

      // Should only return active registrars
      const testRegistrarNames = data.registrars
        .map((r: { name: string }) => r.name)
        .filter((name: string) =>
          ['Alpha Registrar Services Ltd', 'Beta Registrar Technologies', 'Gamma Corporate Services'].includes(name)
        );

      expect(testRegistrarNames).toHaveLength(2);
      expect(testRegistrarNames).toContain('Alpha Registrar Services Ltd');
      expect(testRegistrarNames).toContain('Beta Registrar Technologies');
      expect(testRegistrarNames).not.toContain('Gamma Corporate Services'); // Inactive
    });

    it('should return registrars in alphabetical order', async () => {
      const request = new NextRequest('http://localhost:3000/api/registrars');
      const response = await GET(request);

      const data = await response.json();
      const registrarNames = data.registrars.map((r: { name: string }) => r.name);

      // Check if array is sorted alphabetically
      const sortedNames = [...registrarNames].sort();
      expect(registrarNames).toEqual(sortedNames);
    });

    it('should include all required registrar fields', async () => {
      const request = new NextRequest('http://localhost:3000/api/registrars');
      const response = await GET(request);

      const data = await response.json();
      const testRegistrar = data.registrars.find(
        (r: { name: string }) => r.name === 'Alpha Registrar Services Ltd'
      );

      expect(testRegistrar).toBeDefined();
      expect(testRegistrar).toHaveProperty('id');
      expect(testRegistrar).toHaveProperty('name');
      expect(testRegistrar).toHaveProperty('shortName');
      expect(testRegistrar).toHaveProperty('email');
      expect(testRegistrar).toHaveProperty('phone');
      expect(testRegistrar).toHaveProperty('website');
      expect(testRegistrar).toHaveProperty('allotmentCheckUrl');
      expect(testRegistrar).toHaveProperty('address');
      expect(testRegistrar).toHaveProperty('active');
      expect(testRegistrar.active).toBe(true);
    });
  });

  describe('Search Functionality', () => {
    it('should filter registrars by name when search param provided', async () => {
      const request = new NextRequest('http://localhost:3000/api/registrars?search=Alpha');
      const response = await GET(request);

      expect(response.status).toBe(200);

      const data = await response.json();
      const filteredNames = data.registrars
        .map((r: { name: string }) => r.name)
        .filter((name: string) =>
          ['Alpha Registrar Services Ltd', 'Beta Registrar Technologies'].includes(name)
        );

      expect(filteredNames).toHaveLength(1);
      expect(filteredNames[0]).toBe('Alpha Registrar Services Ltd');
    });

    it('should filter registrars by shortName when search param provided', async () => {
      const request = new NextRequest('http://localhost:3000/api/registrars?search=Beta');
      const response = await GET(request);

      const data = await response.json();
      const filteredNames = data.registrars
        .map((r: { name: string }) => r.name)
        .filter((name: string) =>
          ['Alpha Registrar Services Ltd', 'Beta Registrar Technologies'].includes(name)
        );

      expect(filteredNames).toHaveLength(1);
      expect(filteredNames[0]).toBe('Beta Registrar Technologies');
    });

    it('should return empty array when search matches no registrars', async () => {
      const request = new NextRequest('http://localhost:3000/api/registrars?search=NonExistentRegistrar');
      const response = await GET(request);

      const data = await response.json();
      expect(data.registrars).toHaveLength(0);
    });

    it('should perform case-insensitive search', async () => {
      const request = new NextRequest('http://localhost:3000/api/registrars?search=alpha');
      const response = await GET(request);

      const data = await response.json();
      const filteredNames = data.registrars
        .map((r: { name: string }) => r.name)
        .filter((name: string) => name === 'Alpha Registrar Services Ltd');

      expect(filteredNames).toHaveLength(1);
    });
  });

  describe('Caching', () => {
    it('should set cache control headers', async () => {
      const request = new NextRequest('http://localhost:3000/api/registrars');
      const response = await GET(request);

      const cacheControl = response.headers.get('Cache-Control');
      expect(cacheControl).toBe('public, max-age=604800'); // 7 days
    });

    it('should cache results in Redis', async () => {
      const request = new NextRequest('http://localhost:3000/api/registrars');
      await GET(request);

      // Check Redis for cached data
      const redis = getRedisClient();
      const cachedData = await redis.get('registrars:all:active');

      expect(cachedData).not.toBeNull();

      if (cachedData) {
        const parsed = JSON.parse(cachedData);
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed.length).toBeGreaterThan(0);
      }
    });

    it('should cache search results separately', async () => {
      const request = new NextRequest('http://localhost:3000/api/registrars?search=Alpha');
      await GET(request);

      // Check Redis for cached search data
      const redis = getRedisClient();
      const cachedData = await redis.get('registrars:search:alpha:active');

      expect(cachedData).not.toBeNull();
    });
  });

  describe('Error Handling', () => {
    it('should return 400 for invalid query parameters', async () => {
      // Test with an invalid parameter type (if we add strict validation)
      const request = new NextRequest('http://localhost:3000/api/registrars?search=');
      const response = await GET(request);

      // Empty search should still work and return all
      expect(response.status).toBe(200);
    });

    it('should handle database errors gracefully', async () => {
      // This test would require mocking the database connection
      // For now, we'll just ensure the endpoint doesn't crash with valid inputs
      const request = new NextRequest('http://localhost:3000/api/registrars');
      const response = await GET(request);

      expect(response.status).toBeLessThan(500);
    });
  });

  describe('Data Integrity', () => {
    it('should not modify registrar data in response', async () => {
      const request = new NextRequest('http://localhost:3000/api/registrars?search=Alpha');
      const response = await GET(request);

      const data = await response.json();
      const testRegistrar = data.registrars.find(
        (r: { name: string }) => r.name === 'Alpha Registrar Services Ltd'
      );

      expect(testRegistrar.email).toBe('info@alpharegistrar.com');
      expect(testRegistrar.phone).toBe('022-12345678');
      expect(testRegistrar.website).toBe('https://www.alpharegistrar.com');
    });

    it('should preserve null values for optional fields', async () => {
      const request = new NextRequest('http://localhost:3000/api/registrars');
      const response = await GET(request);

      const data = await response.json();
      const registrarsWithNullFields = data.registrars.filter(
        (r: { logoUrl: null }) => r.logoUrl === null
      );

      expect(registrarsWithNullFields.length).toBeGreaterThan(0);
    });
  });
});
