/**
 * Integration Tests: Admin Cache Management API
 * Tests for /api/admin/cache/clear endpoint
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getRedisClient, closeRedisClient } from '@/lib/cache/redis-client';

const ADMIN_TOKEN = process.env.ADMIN_AUTH_TOKEN || 'test-admin-token';
const API_BASE = 'http://localhost:3000';

describe('Admin Cache Management API', () => {
  let redis: ReturnType<typeof getRedisClient>;

  beforeAll(() => {
    redis = getRedisClient();
  });

  afterAll(async () => {
    await closeRedisClient();
  });

  describe('GET /api/admin/cache/clear - Cache Statistics', () => {
    it('should return cache statistics when authenticated', async () => {
      // Seed some cache data
      await redis.set('protection:test:1', 'value1');
      await redis.set('ipo:test:1', 'value2');
      await redis.set('subscription:test:1', 'value3');
      await redis.set('gmp:test:1', 'value4');

      const response = await fetch(`${API_BASE}/api/admin/cache/clear`, {
        headers: {
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
      });

      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('totalKeys');
      expect(data.data).toHaveProperty('memoryUsage');
      expect(data.data.breakdown).toHaveProperty('protection');
      expect(data.data.breakdown).toHaveProperty('ipo');
      expect(data.data.breakdown).toHaveProperty('subscription');
      expect(data.data.breakdown).toHaveProperty('gmp');
      expect(data.data.breakdown).toHaveProperty('other');

      // Verify counts include our test data
      expect(data.data.breakdown.protection).toBeGreaterThanOrEqual(1);
      expect(data.data.breakdown.ipo).toBeGreaterThanOrEqual(1);
      expect(data.data.breakdown.subscription).toBeGreaterThanOrEqual(1);
      expect(data.data.breakdown.gmp).toBeGreaterThanOrEqual(1);
    });

    it('should reject unauthenticated requests', async () => {
      const response = await fetch(`${API_BASE}/api/admin/cache/clear`);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Unauthorized');
    });
  });

  describe('POST /api/admin/cache/clear - Clear Cache', () => {
    it('should clear cache by pattern', async () => {
      // Seed test data
      await redis.set('protection:test:clear:1', 'value1');
      await redis.set('protection:test:clear:2', 'value2');
      await redis.set('ipo:keep:1', 'keep');

      const response = await fetch(`${API_BASE}/api/admin/cache/clear`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
        body: JSON.stringify({
          pattern: 'protection:test:clear:*',
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.keysCleared).toBeGreaterThanOrEqual(2);
      expect(data.data.pattern).toBe('protection:test:clear:*');

      // Verify keys are deleted
      const key1 = await redis.get('protection:test:clear:1');
      const key2 = await redis.get('protection:test:clear:2');
      const keepKey = await redis.get('ipo:keep:1');

      expect(key1).toBeNull();
      expect(key2).toBeNull();
      expect(keepKey).toBe('keep'); // Should not be deleted
    });

    it('should clear all caches when clearAll=true', async () => {
      // Seed test data
      await redis.set('test:clearall:1', 'value1');
      await redis.set('test:clearall:2', 'value2');

      const response = await fetch(`${API_BASE}/api/admin/cache/clear`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
        body: JSON.stringify({
          clearAll: true,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.pattern).toBe('*');
      expect(data.message).toContain('Successfully cleared all');

      // Verify all keys are cleared
      const dbSize = await redis.dbsize();
      expect(dbSize).toBe(0);
    });

    it('should validate request body', async () => {
      const response = await fetch(`${API_BASE}/api/admin/cache/clear`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Either pattern or clearAll=true is required');
    });

    it('should handle empty pattern results gracefully', async () => {
      const response = await fetch(`${API_BASE}/api/admin/cache/clear`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
        body: JSON.stringify({
          pattern: 'nonexistent:pattern:*',
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.keysCleared).toBe(0);
    });

    it('should reject unauthenticated requests', async () => {
      const response = await fetch(`${API_BASE}/api/admin/cache/clear`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pattern: 'test:*',
        }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Unauthorized');
    });
  });

  describe('Cache Management Integration', () => {
    it('should reflect changes in statistics after clearing', async () => {
      // Seed data
      await redis.set('integration:test:1', 'value1');
      await redis.set('integration:test:2', 'value2');
      await redis.set('integration:test:3', 'value3');

      // Get initial stats
      const statsResponse1 = await fetch(`${API_BASE}/api/admin/cache/clear`, {
        headers: {
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
      });
      const stats1 = await statsResponse1.json();
      const initialKeys = stats1.data.totalKeys;

      // Clear pattern
      await fetch(`${API_BASE}/api/admin/cache/clear`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
        body: JSON.stringify({
          pattern: 'integration:test:*',
        }),
      });

      // Get updated stats
      const statsResponse2 = await fetch(`${API_BASE}/api/admin/cache/clear`, {
        headers: {
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
      });
      const stats2 = await statsResponse2.json();

      expect(stats2.data.totalKeys).toBe(initialKeys - 3);
    });
  });
});
