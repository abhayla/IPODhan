/**
 * Integration Tests for GET /api/health
 * Story 8.4a: Production Deployment - Dev Machine Preparation
 * Updated T-226 (2026-08-20): endpoint now exercises the real dependency
 * path (short-timeout DB query, Redis best-effort) instead of a heavier,
 * potentially-cached check. See web/app/api/health/route.ts doc comment.
 *
 * Tests the health check endpoint with real database and Redis connections.
 * Ensures proper monitoring of application dependencies for production deployment.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getRedisClient } from '@/lib/cache/redis-client';
import { GET } from '@/app/api/health/route';

function makeRequest(url = 'http://localhost:3000/api/health'): Request {
  return new Request(url);
}

// ==================== SETUP & TEARDOWN ====================

let redisClient: ReturnType<typeof getRedisClient>;

beforeAll(async () => {
  // Initialize Redis client
  redisClient = getRedisClient();
});

// ==================== TESTS ====================

describe('GET /api/health', () => {
  describe('Health Check Response', () => {
    it('should return health status (healthy or unhealthy)', async () => {
      const response = await GET(makeRequest());
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
      expect(data.probe).toBe('ready');
    });

    it('should include database details with connection status', async () => {
      const response = await GET(makeRequest());
      const data = await response.json();

      expect(data.details.database).toHaveProperty('connected');
      expect(typeof data.details.database.connected).toBe('boolean');
      expect(typeof data.details.database.responseTimeMs).toBe('number');

      if (data.services.database === 'healthy') {
        expect(data.details.database.connected).toBe(true);
      } else {
        expect(data.details.database.connected).toBe(false);
        expect(data.details.database).toHaveProperty('error');
      }
    });

    it('should include Redis details with connection status', async () => {
      const response = await GET(makeRequest());
      const data = await response.json();

      expect(data.details.redis).toHaveProperty('connected');
      expect(typeof data.details.redis.connected).toBe('boolean');
      expect(typeof data.details.redis.responseTimeMs).toBe('number');

      if (data.services.redis === 'healthy') {
        expect(data.details.redis.connected).toBe(true);
      } else {
        expect(data.details.redis.connected).toBe(false);
        expect(data.details.redis).toHaveProperty('error');
      }
    });

    it('should include application metadata', async () => {
      const response = await GET(makeRequest());
      const data = await response.json();

      expect(data).toHaveProperty('application');
      expect(data.application).toMatchObject({
        name: expect.any(String),
        environment: expect.any(String),
      });
    });

    it('should return different timestamps on subsequent calls', async () => {
      const response1 = await GET(makeRequest());
      const data1 = await response1.json();

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      const response2 = await GET(makeRequest());
      const data2 = await response2.json();

      expect(data1.timestamp).not.toBe(data2.timestamp);
    });
  });

  describe('Liveness probe', () => {
    it('should return alive immediately without checking dependencies', async () => {
      const response = await GET(makeRequest('http://localhost:3000/api/health?probe=live'));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('alive');
      expect(data.probe).toBe('live');
      expect(data).not.toHaveProperty('services');
    });
  });

  describe('Response Format Validation', () => {
    it('should always include required top-level fields', async () => {
      const response = await GET(makeRequest());
      const data = await response.json();

      expect(data).toHaveProperty('status');
      expect(data).toHaveProperty('timestamp');
      expect(data).toHaveProperty('services');
      expect(data).toHaveProperty('details');
      expect(data).toHaveProperty('application');
    });

    it('should include both database and Redis in services object', async () => {
      const response = await GET(makeRequest());
      const data = await response.json();

      expect(data.services).toHaveProperty('database');
      expect(data.services).toHaveProperty('redis');
      expect(['healthy', 'unhealthy']).toContain(data.services.database);
      expect(['healthy', 'unhealthy']).toContain(data.services.redis);
    });

    it('should include details for both services', async () => {
      const response = await GET(makeRequest());
      const data = await response.json();

      expect(data.details).toHaveProperty('database');
      expect(data.details).toHaveProperty('redis');
      expect(data.details.database).toHaveProperty('connected');
      expect(data.details.redis).toHaveProperty('connected');
    });
  });

  describe('Performance', () => {
    it('should respond within 2.5 seconds even under the DB/Redis timeout budget', async () => {
      const startTime = Date.now();
      await GET(makeRequest());
      const endTime = Date.now();
      const duration = endTime - startTime;

      // 2s DB timeout + 2s Redis timeout run concurrently, not stacked -
      // budget generously above the 2s per-check ceiling for CI jitter.
      expect(duration).toBeLessThan(2500);
    });

    it('should handle multiple concurrent requests', async () => {
      const requests = Array(10)
        .fill(null)
        .map(() => GET(makeRequest()));

      const responses = await Promise.all(requests);

      // All responses should have valid status codes (200 or 503)
      responses.forEach((response) => {
        expect([200, 503]).toContain(response.status);
      });
    });
  });

  describe('Monitoring Integration', () => {
    it('should return format compatible with UptimeRobot', async () => {
      const response = await GET(makeRequest());
      const data = await response.json();

      // UptimeRobot expects 200 status for healthy, non-200 for unhealthy
      if (data.status === 'healthy') {
        expect(response.status).toBe(200);
      } else {
        expect(response.status).not.toBe(200);
      }
    });

    it('should provide machine-readable status field', async () => {
      const response = await GET(makeRequest());
      const data = await response.json();

      expect(['healthy', 'unhealthy']).toContain(data.status);
    });

    it('should include ISO 8601 timestamp', async () => {
      const response = await GET(makeRequest());
      const data = await response.json();

      // Verify timestamp is valid ISO 8601
      const timestamp = new Date(data.timestamp);
      expect(timestamp.toISOString()).toBe(data.timestamp);
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid successive calls', async () => {
      const response1 = await GET(makeRequest());
      const response2 = await GET(makeRequest());
      const response3 = await GET(makeRequest());

      // All should return valid status codes
      expect([200, 503]).toContain(response1.status);
      expect([200, 503]).toContain(response2.status);
      expect([200, 503]).toContain(response3.status);
    });

    it('should return consistent structure on every call', async () => {
      const response1 = await GET(makeRequest());
      const data1 = await response1.json();

      const response2 = await GET(makeRequest());
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
      const response = await GET(makeRequest());
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
      const response = await GET(makeRequest());
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

    it('should return 503 only when the database (hard dependency) is unhealthy', async () => {
      const response = await GET(makeRequest());
      const data = await response.json();

      if (data.services.database === 'unhealthy') {
        expect(response.status).toBe(503);
        expect(data.status).toBe('unhealthy');
      } else {
        expect(response.status).toBe(200);
        expect(data.status).toBe('healthy');
      }
    });
  });
});
