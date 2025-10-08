/**
 * Integration Tests for GET /api/health
 * Story 8.4a: Production Deployment - Dev Machine Preparation
 *
 * Tests the health check endpoint with real database and Redis connections.
 * Ensures proper monitoring of application dependencies for production deployment.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { GET } from '@/app/api/health/route';

// ==================== SETUP & TEARDOWN ====================

let redisClient: ReturnType<typeof getRedisClient>;

beforeAll(async () => {
  // Initialize Redis client
  redisClient = getRedisClient();
});

afterAll(async () => {
  // No cleanup needed - health check doesn't modify data
});

// ==================== TESTS ====================

describe('GET /api/health', () => {
  describe('Health Check Response', () => {
    it('should return health status (healthy or unhealthy)', async () => {
      const response = await GET();
      const data = await response.json();

      // Status should be 200 if healthy, 503 if unhealthy
      expect([200, 503]).toContain(response.status);
      expect(['healthy', 'unhealthy']).toContain(data.status);

      // If healthy, should be 200; if unhealthy, should be 503
      if (data.status === 'healthy') {
        expect(response.status).toBe(200);
      } else {
        expect(response.status).toBe(503);
      }

      expect(data).toHaveProperty('timestamp');
      expect(data.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // ISO format
    });

    it('should include database details with connection status', async () => {
      const response = await GET();
      const data = await response.json();

      expect(data.details.database).toHaveProperty('connected');
      expect(typeof data.details.database.connected).toBe('boolean');

      // If database is healthy, should have additional details
      if (data.services.database === 'healthy') {
        expect(data.details.database.connected).toBe(true);
        expect(data.details.database).toHaveProperty('serverTime');
        expect(data.details.database).toHaveProperty('version');
        expect(data.details.database).toHaveProperty('tables');
        expect(typeof data.details.database.tables).toBe('number');
        expect(data.details.database.tables).toBeGreaterThan(0);
      } else {
        expect(data.details.database.connected).toBe(false);
        expect(data.details.database).toHaveProperty('error');
      }
    });

    it('should include Redis details with connection status', async () => {
      const response = await GET();
      const data = await response.json();

      expect(data.details.redis).toHaveProperty('connected');
      expect(typeof data.details.redis.connected).toBe('boolean');

      // If Redis is healthy, should have additional details
      if (data.services.redis === 'healthy') {
        expect(data.details.redis.connected).toBe(true);
        expect(data.details.redis).toHaveProperty('memoryUsed');
        expect(typeof data.details.redis.memoryUsed).toBe('string');
      } else {
        expect(data.details.redis.connected).toBe(false);
        expect(data.details.redis).toHaveProperty('error');
      }
    });

    it('should include application metadata', async () => {
      const response = await GET();
      const data = await response.json();

      expect(data).toHaveProperty('application');
      expect(data.application).toMatchObject({
        name: expect.any(String),
        environment: expect.any(String),
      });
    });

    it('should return different timestamps on subsequent calls', async () => {
      const response1 = await GET();
      const data1 = await response1.json();

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      const response2 = await GET();
      const data2 = await response2.json();

      expect(data1.timestamp).not.toBe(data2.timestamp);
    });
  });

  describe('Response Format Validation', () => {
    it('should always include required top-level fields', async () => {
      const response = await GET();
      const data = await response.json();

      expect(data).toHaveProperty('status');
      expect(data).toHaveProperty('timestamp');
      expect(data).toHaveProperty('services');
      expect(data).toHaveProperty('details');
      expect(data).toHaveProperty('application');
    });

    it('should include both database and Redis in services object', async () => {
      const response = await GET();
      const data = await response.json();

      expect(data.services).toHaveProperty('database');
      expect(data.services).toHaveProperty('redis');
      expect(['healthy', 'unhealthy']).toContain(data.services.database);
      expect(['healthy', 'unhealthy']).toContain(data.services.redis);
    });

    it('should include details for both services', async () => {
      const response = await GET();
      const data = await response.json();

      expect(data.details).toHaveProperty('database');
      expect(data.details).toHaveProperty('redis');
      expect(data.details.database).toHaveProperty('connected');
      expect(data.details.redis).toHaveProperty('connected');
    });
  });

  describe('Service-Specific Checks', () => {
    it('should verify PostgreSQL version is reported', async () => {
      const response = await GET();
      const data = await response.json();

      if (data.services.database === 'healthy') {
        expect(data.details.database.version).toMatch(/PostgreSQL/);
        expect(data.details.database.version).toBeTruthy();
      }
    });

    it('should verify Redis memory usage is reported', async () => {
      const response = await GET();
      const data = await response.json();

      if (data.services.redis === 'healthy') {
        expect(data.details.redis.memoryUsed).toBeTruthy();
        // Memory should be in human-readable format (e.g., "1.5M", "200K")
        expect(data.details.redis.memoryUsed).toMatch(/^\d+(\.\d+)?[KMG]?$/);
      }
    });

    it('should report correct table count from database', async () => {
      const response = await GET();
      const data = await response.json();

      if (data.services.database === 'healthy') {
        // IPODhan should have multiple tables (ipos, subscriptions, gmp_records, etc.)
        expect(data.details.database.tables).toBeGreaterThanOrEqual(5);
      }
    });
  });

  describe('Performance', () => {
    it('should respond within 2 seconds', async () => {
      const startTime = Date.now();
      await GET();
      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(2000);
    });

    it('should handle multiple concurrent requests', async () => {
      const requests = Array(10)
        .fill(null)
        .map(() => GET());

      const responses = await Promise.all(requests);

      // All responses should have valid status codes (200 or 503)
      responses.forEach((response) => {
        expect([200, 503]).toContain(response.status);
      });
    });
  });

  describe('Monitoring Integration', () => {
    it('should return format compatible with UptimeRobot', async () => {
      const response = await GET();
      const data = await response.json();

      // UptimeRobot expects 200 status for healthy, non-200 for unhealthy
      if (data.status === 'healthy') {
        expect(response.status).toBe(200);
      } else {
        expect(response.status).not.toBe(200);
      }
    });

    it('should provide machine-readable status field', async () => {
      const response = await GET();
      const data = await response.json();

      expect(['healthy', 'unhealthy']).toContain(data.status);
    });

    it('should include ISO 8601 timestamp', async () => {
      const response = await GET();
      const data = await response.json();

      // Verify timestamp is valid ISO 8601
      const timestamp = new Date(data.timestamp);
      expect(timestamp.toISOString()).toBe(data.timestamp);
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid successive calls', async () => {
      const response1 = await GET();
      const response2 = await GET();
      const response3 = await GET();

      // All should return valid status codes
      expect([200, 503]).toContain(response1.status);
      expect([200, 503]).toContain(response2.status);
      expect([200, 503]).toContain(response3.status);
    });

    it('should return consistent structure on every call', async () => {
      const response1 = await GET();
      const data1 = await response1.json();

      const response2 = await GET();
      const data2 = await response2.json();

      // Same keys should be present
      expect(Object.keys(data1).sort()).toEqual(Object.keys(data2).sort());
      expect(Object.keys(data1.services).sort()).toEqual(
        Object.keys(data2.services).sort()
      );
      expect(Object.keys(data1.details).sort()).toEqual(
        Object.keys(data2.details).sort()
      );
    });
  });

  describe('Production Readiness', () => {
    it('should not expose database connection strings', async () => {
      const response = await GET();
      const data = await response.json();
      const dataString = JSON.stringify(data);

      // Should not contain connection strings, tokens, or API keys
      expect(dataString.toLowerCase()).not.toContain('postgresql://');
      expect(dataString.toLowerCase()).not.toContain('redis://');
      expect(dataString.toLowerCase()).not.toContain('token');
      expect(dataString.toLowerCase()).not.toContain('secret');
      expect(dataString.toLowerCase()).not.toContain('api_key');
      expect(dataString.toLowerCase()).not.toContain('apikey');
    });

    it('should provide actionable error information when unhealthy', async () => {
      const response = await GET();
      const data = await response.json();

      // If any service is unhealthy, details should include error info
      if (data.services.database === 'unhealthy') {
        expect(data.details.database).toHaveProperty('error');
        expect(data.details.database.error).toBeTruthy();
      }

      if (data.services.redis === 'unhealthy') {
        expect(data.details.redis).toHaveProperty('error');
        expect(data.details.redis.error).toBeTruthy();
      }
    });

    it('should return 503 when any service is unhealthy', async () => {
      const response = await GET();
      const data = await response.json();

      if (data.status === 'unhealthy') {
        expect(response.status).toBe(503);
      }
    });
  });
});
