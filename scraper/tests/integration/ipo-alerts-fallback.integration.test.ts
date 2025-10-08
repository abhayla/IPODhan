import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

// Mock the config module
vi.mock('../../src/config.js', () => ({
  config: {
    scraper: {
      retryAttempts: 3,
      retryDelays: [100, 200, 400] // Reduced delays for testing
    }
  }
}));

// Mock the logger module
vi.mock('../../src/utils/logger.js', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

// Mock database and Redis - we'll test the workflow logic without real DB/Redis
vi.mock('../../src/services/data-persister.js', () => ({
  upsertIPO: vi.fn().mockResolvedValue({ id: 'test-id', slug: 'test-slug' }),
  createSubscriptionSnapshot: vi.fn().mockResolvedValue({ id: 'sub-id' })
}));

vi.mock('../../src/services/cache-invalidator.js', () => ({
  invalidateIPOCaches: vi.fn().mockResolvedValue(undefined),
  invalidateSubscriptionCache: vi.fn().mockResolvedValue(undefined)
}));

// Load fixtures
const fixturesPath = path.resolve(__dirname, '../fixtures/ipo-alerts-api-response.json');
const fixtures = JSON.parse(readFileSync(fixturesPath, 'utf-8'));

describe('IPO Alerts Fallback Integration', () => {
  let mockFetch: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Full Fallback Workflow', () => {
    it('should complete full workflow: API fetch -> validate -> transform -> persist -> cache invalidate', async () => {
      const { IPOAlertsClient } = await import('../../src/services/ipo-alerts-client.js');
      const { validateIPOAlertsIPOData, transformIPOAlertsData } = await import('../../src/utils/validators.js');
      const { upsertIPO } = await import('../../src/services/data-persister.js');
      const { invalidateIPOCaches } = await import('../../src/services/cache-invalidator.js');

      // Mock API response with fixture data
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => fixtures.openIPOs
      });

      const client = new IPOAlertsClient(
        'https://api.test.com',
        'test-key',
        10,
        60000
      );

      // Step 1: Fetch from API
      const apiResponse = await client.fetchOpenIPOs();
      expect(apiResponse.success).toBe(true);
      expect(apiResponse.data).toHaveLength(2);

      // Step 2 & 3: Validate and transform each IPO
      const validatedIPOs = [];
      for (const ipoData of apiResponse.data) {
        const validation = validateIPOAlertsIPOData(ipoData);
        expect(validation.success).toBe(true);

        if (validation.success && validation.data) {
          const transformed = transformIPOAlertsData(validation.data);
          validatedIPOs.push(transformed);
        }
      }

      expect(validatedIPOs).toHaveLength(2);

      // Step 4: Persist to database (mocked)
      for (const ipo of validatedIPOs) {
        await upsertIPO(ipo);
      }

      expect(upsertIPO).toHaveBeenCalledTimes(2);

      // Step 5: Invalidate cache (mocked)
      await invalidateIPOCaches();
      expect(invalidateIPOCaches).toHaveBeenCalled();
    });

    it('should handle empty API response gracefully', async () => {
      const { IPOAlertsClient } = await import('../../src/services/ipo-alerts-client.js');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => fixtures.emptyResponse
      });

      const client = new IPOAlertsClient(
        'https://api.test.com',
        'test-key',
        10,
        60000
      );

      const apiResponse = await client.fetchOpenIPOs();
      expect(apiResponse.success).toBe(true);
      expect(apiResponse.data).toHaveLength(0);
      expect(apiResponse.count).toBe(0);
    });
  });

  describe('Data Validation and Transformation', () => {
    it('should validate and transform all fixture IPOs correctly', async () => {
      const { validateIPOAlertsIPOData, transformIPOAlertsData } = await import('../../src/utils/validators.js');

      // Test with all open IPOs from fixtures
      for (const ipoData of fixtures.openIPOs.data) {
        const validation = validateIPOAlertsIPOData(ipoData);
        expect(validation.success).toBe(true);

        if (validation.success && validation.data) {
          const transformed = transformIPOAlertsData(validation.data);

          // Verify field transformation
          expect(transformed.companyName).toBe(ipoData.company_name);
          expect(transformed.issueSize).toBe(ipoData.issue_size);
          expect(transformed.priceRangeMin).toBe(ipoData.price_range.min);
          expect(transformed.priceRangeMax).toBe(ipoData.price_range.max);
          expect(transformed.openDate).toBe(ipoData.open_date);
          expect(transformed.closeDate).toBe(ipoData.close_date);
          expect(transformed.listingExchange).toBe(ipoData.exchange);
          expect(transformed.category).toBe(ipoData.category);
          expect(transformed.status).toBe(ipoData.status);
        }
      }
    });

    it('should validate and transform upcoming IPOs correctly', async () => {
      const { validateIPOAlertsIPOData, transformIPOAlertsData } = await import('../../src/utils/validators.js');

      // Test with all upcoming IPOs from fixtures
      for (const ipoData of fixtures.upcomingIPOs.data) {
        const validation = validateIPOAlertsIPOData(ipoData);
        expect(validation.success).toBe(true);

        if (validation.success && validation.data) {
          const transformed = transformIPOAlertsData(validation.data);
          expect(transformed.status).toBe('UPCOMING');
        }
      }
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limit across multiple requests', async () => {
      const { IPOAlertsClient, RateLimitExceededError } = await import('../../src/services/ipo-alerts-client.js');

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => fixtures.openIPOs
      });

      const client = new IPOAlertsClient(
        'https://api.test.com',
        'test-key',
        3, // Low limit for testing
        60000
      );

      // Make 3 requests (at limit)
      await client.fetchOpenIPOs();
      await client.fetchUpcomingIPOs();
      await client.fetchIPOById('test-id');

      // 4th request should throw
      await expect(client.fetchOpenIPOs()).rejects.toThrow(RateLimitExceededError);
    });

    it('should track rate limit status correctly', async () => {
      const { IPOAlertsClient } = await import('../../src/services/ipo-alerts-client.js');

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => fixtures.openIPOs
      });

      const client = new IPOAlertsClient(
        'https://api.test.com',
        'test-key',
        5,
        60000
      );

      await client.fetchOpenIPOs();
      await client.fetchUpcomingIPOs();

      const status = client.getRateLimitStatus();
      expect(status.used).toBe(2);
      expect(status.remaining).toBe(3);
      expect(status.limit).toBe(5);
    });
  });

  describe('Error Handling', () => {
    it('should handle API 404 error', async () => {
      const { IPOAlertsClient, APINotFoundError } = await import('../../src/services/ipo-alerts-client.js');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });

      const client = new IPOAlertsClient(
        'https://api.test.com',
        'test-key',
        10,
        60000
      );

      await expect(client.fetchOpenIPOs()).rejects.toThrow(APINotFoundError);
    });

    it('should handle API 429 rate limit error', async () => {
      const { IPOAlertsClient, RateLimitExceededError } = await import('../../src/services/ipo-alerts-client.js');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests'
      });

      const client = new IPOAlertsClient(
        'https://api.test.com',
        'test-key',
        10,
        60000
      );

      await expect(client.fetchOpenIPOs()).rejects.toThrow(RateLimitExceededError);
    });

    it('should retry on 500 server error', async () => {
      vi.useFakeTimers();

      const { IPOAlertsClient } = await import('../../src/services/ipo-alerts-client.js');

      // First 2 attempts fail, 3rd succeeds
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error'
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error'
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => fixtures.openIPOs
        });

      const client = new IPOAlertsClient(
        'https://api.test.com',
        'test-key',
        10,
        60000
      );

      const promise = client.fetchOpenIPOs();

      // Fast-forward through retry delays
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(200);

      const result = await promise;

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    });
  });

  describe('Failure Tracker Integration', () => {
    it('should track consecutive failures correctly', async () => {
      const { ScraperFailureTracker } = await import('../../src/services/scraper-failure-tracker.js');

      const tracker = new ScraperFailureTracker(3);
      const error = new Error('Test scraper failure');

      // Record 2 failures - should not trigger fallback yet
      tracker.recordFailure('NSE', error);
      tracker.recordFailure('NSE', error);
      expect(tracker.shouldTriggerFallback('NSE')).toBe(false);

      // 3rd failure - should trigger fallback
      tracker.recordFailure('NSE', error);
      expect(tracker.shouldTriggerFallback('NSE')).toBe(true);
      expect(tracker.getFailureCount('NSE')).toBe(3);
    });

    it('should reset failure count on success', async () => {
      const { ScraperFailureTracker } = await import('../../src/services/scraper-failure-tracker.js');

      const tracker = new ScraperFailureTracker(3);
      const error = new Error('Test scraper failure');

      // Record 3 failures (trigger threshold)
      tracker.recordFailure('NSE', error);
      tracker.recordFailure('NSE', error);
      tracker.recordFailure('NSE', error);
      expect(tracker.shouldTriggerFallback('NSE')).toBe(true);

      // Record success - should reset
      tracker.recordSuccess('NSE');
      expect(tracker.shouldTriggerFallback('NSE')).toBe(false);
      expect(tracker.getFailureCount('NSE')).toBe(0);
    });

    it('should track failures independently for NSE and BSE', async () => {
      const { ScraperFailureTracker } = await import('../../src/services/scraper-failure-tracker.js');

      const tracker = new ScraperFailureTracker(3);
      const error = new Error('Test scraper failure');

      // NSE: 3 failures (trigger)
      tracker.recordFailure('NSE', error);
      tracker.recordFailure('NSE', error);
      tracker.recordFailure('NSE', error);

      // BSE: 1 failure (no trigger)
      tracker.recordFailure('BSE', error);

      expect(tracker.shouldTriggerFallback('NSE')).toBe(true);
      expect(tracker.shouldTriggerFallback('BSE')).toBe(false);
      expect(tracker.getFailureCount('NSE')).toBe(3);
      expect(tracker.getFailureCount('BSE')).toBe(1);
    });
  });

  describe('Combined API Fetch (Open + Upcoming)', () => {
    it('should combine open and upcoming IPOs correctly', async () => {
      const { IPOAlertsClient } = await import('../../src/services/ipo-alerts-client.js');

      // First call: open IPOs
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => fixtures.openIPOs
      });

      // Second call: upcoming IPOs
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => fixtures.upcomingIPOs
      });

      const client = new IPOAlertsClient(
        'https://api.test.com',
        'test-key',
        10,
        60000
      );

      const allIPOs = await client.fetchAllActiveIPOs();

      expect(allIPOs.success).toBe(true);
      expect(allIPOs.count).toBe(5); // 2 open + 3 upcoming
      expect(allIPOs.data).toHaveLength(5);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('Performance', () => {
    it('should complete workflow within reasonable time', async () => {
      const { IPOAlertsClient } = await import('../../src/services/ipo-alerts-client.js');
      const { validateIPOAlertsIPOData, transformIPOAlertsData } = await import('../../src/utils/validators.js');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => fixtures.openIPOs
      });

      const startTime = Date.now();

      const client = new IPOAlertsClient(
        'https://api.test.com',
        'test-key',
        10,
        60000
      );

      // Full workflow
      const apiResponse = await client.fetchOpenIPOs();

      for (const ipoData of apiResponse.data) {
        const validation = validateIPOAlertsIPOData(ipoData);
        if (validation.success && validation.data) {
          transformIPOAlertsData(validation.data);
        }
      }

      const duration = Date.now() - startTime;

      // Workflow should complete quickly (< 1 second for 2 IPOs)
      expect(duration).toBeLessThan(1000);
    });
  });
});
