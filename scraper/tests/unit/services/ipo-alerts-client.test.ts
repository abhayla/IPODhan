import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  IPOAlertsClient,
  RateLimitExceededError,
  APIAuthenticationError,
  APINotFoundError
} from '../../../src/services/ipo-alerts-client';

// Mock the config module
vi.mock('../../../src/config.js', () => ({
  config: {
    scraper: {
      retryAttempts: 3,
      retryDelays: [1000, 2000, 4000]
    }
  }
}));

// Mock the logger module
vi.mock('../../../src/utils/logger.js', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

describe('IPOAlertsClient', () => {
  let client: IPOAlertsClient;
  let mockFetch: any;

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    // Mock global fetch BEFORE creating client
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Create a new client instance with test configuration
    // Use small rate limit for faster testing
    client = new IPOAlertsClient(
      'https://api.test.com',
      'test-api-key',
      5, // maxRequests (reduced for testing)
      10000 // windowMs (10 seconds for testing)
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchOpenIPOs', () => {
    it('should successfully fetch open IPOs', async () => {
      const mockResponse = {
        data: [
          { id: '1', company_name: 'Test IPO 1', status: 'OPEN' },
          { id: '2', company_name: 'Test IPO 2', status: 'OPEN' }
        ],
        count: 2
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse
      });

      const result = await client.fetchOpenIPOs();

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse.data);
      expect(result.count).toBe(2);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/ipos?status=open',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'User-Agent': 'IPODhan/1.0 (+https://ipodhan.com)',
            'Accept': 'application/json',
            'Authorization': 'Bearer test-api-key'
          })
        })
      );
    });

    it('should handle API response with data array directly', async () => {
      const mockResponse = [
        { id: '1', company_name: 'Test IPO 1' }
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse
      });

      const result = await client.fetchOpenIPOs();

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse);
      expect(result.count).toBe(1);
    });
  });

  describe('fetchUpcomingIPOs', () => {
    it('should successfully fetch upcoming IPOs', async () => {
      const mockResponse = {
        data: [
          { id: '3', company_name: 'Upcoming IPO 1', status: 'UPCOMING' }
        ],
        count: 1
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse
      });

      const result = await client.fetchUpcomingIPOs();

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse.data);
      expect(result.count).toBe(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/ipos?status=upcoming',
        expect.anything()
      );
    });
  });

  describe('fetchIPOById', () => {
    it('should successfully fetch IPO by ID', async () => {
      const mockResponse = {
        data: { id: '123', company_name: 'Test IPO', status: 'OPEN' }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse
      });

      const result = await client.fetchIPOById('123');

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/ipos/123',
        expect.anything()
      );
    });
  });

  describe('fetchAllActiveIPOs', () => {
    it('should fetch and combine open and upcoming IPOs', async () => {
      const openResponse = {
        data: [
          { id: '1', company_name: 'Open IPO 1' },
          { id: '2', company_name: 'Open IPO 2' }
        ]
      };

      const upcomingResponse = {
        data: [
          { id: '3', company_name: 'Upcoming IPO 1' }
        ]
      };

      // First call for open IPOs
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => openResponse
      });

      // Second call for upcoming IPOs
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => upcomingResponse
      });

      const result = await client.fetchAllActiveIPOs();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(3);
      expect(result.count).toBe(3);
      expect(result.data).toEqual([
        ...openResponse.data,
        ...upcomingResponse.data
      ]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('Rate Limiting', () => {
    it('should track request count correctly', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [] })
      });

      // Make 3 requests
      await client.fetchOpenIPOs();
      await client.fetchUpcomingIPOs();
      await client.fetchIPOById('123');

      const status = client.getRateLimitStatus();
      expect(status.used).toBe(3);
      expect(status.remaining).toBe(2); // 5 max - 3 used = 2 remaining
      expect(status.limit).toBe(5);
    });

    it('should enforce rate limit at max requests', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [] })
      });

      // Make 5 requests (max limit)
      for (let i = 0; i < 5; i++) {
        await client.fetchOpenIPOs();
      }

      // 6th request should throw RateLimitExceededError
      await expect(client.fetchOpenIPOs()).rejects.toThrow(RateLimitExceededError);
      await expect(client.fetchOpenIPOs()).rejects.toThrow(
        /Rate limit exceeded/
      );
    });

    it('should reset rate limit after window expires', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [] })
      });

      // Make 5 requests (hit limit)
      for (let i = 0; i < 5; i++) {
        await client.fetchOpenIPOs();
      }

      // Fast-forward time by 11 seconds (window is 10 seconds)
      vi.useFakeTimers();
      vi.advanceTimersByTime(11000);

      // Should be able to make requests again after window reset
      await client.fetchOpenIPOs();

      vi.useRealTimers();
    });

    it('should include rate limit info in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [] })
      });

      const result = await client.fetchOpenIPOs();

      expect(result.rate_limit).toBeDefined();
      expect(result.rate_limit?.remaining).toBeDefined();
      expect(result.rate_limit?.reset_time).toBeDefined();
      expect(typeof result.rate_limit?.remaining).toBe('number');
      expect(typeof result.rate_limit?.reset_time).toBe('string');
    });
  });

  describe('Retry Logic', () => {
    it('should retry on 500 server error with exponential backoff', async () => {
      vi.useFakeTimers();

      // First 2 attempts fail with 500 error
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
        // Third attempt succeeds
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: [] })
        });

      const promise = client.fetchOpenIPOs();

      // Fast-forward through retry delays
      await vi.advanceTimersByTimeAsync(1000); // First retry delay
      await vi.advanceTimersByTimeAsync(2000); // Second retry delay

      const result = await promise;

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(3); // 1 initial + 2 retries

      vi.useRealTimers();
    });

    it('should retry on network error', async () => {
      vi.useFakeTimers();

      // First attempt fails with network error
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        // Second attempt succeeds
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: [] })
        });

      const promise = client.fetchOpenIPOs();

      // Fast-forward through retry delay
      await vi.advanceTimersByTimeAsync(1000);

      const result = await promise;

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('should NOT retry on 404 error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });

      await expect(client.fetchOpenIPOs()).rejects.toThrow(APINotFoundError);
      expect(mockFetch).toHaveBeenCalledTimes(1); // No retries
    });

    it('should NOT retry on 401 authentication error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      });

      await expect(client.fetchOpenIPOs()).rejects.toThrow(APIAuthenticationError);
      expect(mockFetch).toHaveBeenCalledTimes(1); // No retries
    });

    it('should NOT retry on 429 rate limit error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests'
      });

      await expect(client.fetchOpenIPOs()).rejects.toThrow(RateLimitExceededError);
      expect(mockFetch).toHaveBeenCalledTimes(1); // No retries
    });

    it('should fail after max retries exceeded', async () => {
      vi.useFakeTimers();

      // All 3 attempts fail
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      });

      const promise = client.fetchOpenIPOs();

      // Fast-forward through all retry delays
      await vi.advanceTimersByTimeAsync(1000); // First retry
      await vi.advanceTimersByTimeAsync(2000); // Second retry

      await expect(promise).rejects.toThrow(/API server error: 500/);
      expect(mockFetch).toHaveBeenCalledTimes(3); // 1 initial + 2 retries

      vi.useRealTimers();
    });
  });

  describe('Error Handling', () => {
    it('should throw APIAuthenticationError on 401', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      });

      await expect(client.fetchOpenIPOs()).rejects.toThrow(APIAuthenticationError);
      await expect(client.fetchOpenIPOs()).rejects.toThrow(
        /API authentication failed/
      );
    });

    it('should throw APINotFoundError on 404', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });

      await expect(client.fetchOpenIPOs()).rejects.toThrow(APINotFoundError);
      await expect(client.fetchOpenIPOs()).rejects.toThrow(
        /API endpoint not found/
      );
    });

    it('should throw RateLimitExceededError on 429', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests'
      });

      await expect(client.fetchOpenIPOs()).rejects.toThrow(RateLimitExceededError);
      await expect(client.fetchOpenIPOs()).rejects.toThrow(
        /rate limit exceeded/i
      );
    });

    it('should throw Error on 500 server error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      });

      await expect(client.fetchOpenIPOs()).rejects.toThrow(/API server error: 500/);
    });

    it.skip('should handle timeout errors', async () => {
      // Skipped: Timeout testing with AbortController is complex in unit tests
      // Timeout functionality is tested in integration tests
    });
  });

  describe('HTTP Headers', () => {
    it('should set correct User-Agent header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [] })
      });

      await client.fetchOpenIPOs();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': 'IPODhan/1.0 (+https://ipodhan.com)'
          })
        })
      );
    });

    it('should set Accept: application/json header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [] })
      });

      await client.fetchOpenIPOs();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Accept': 'application/json'
          })
        })
      );
    });

    it('should include Authorization header when API key is provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [] })
      });

      await client.fetchOpenIPOs();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key'
          })
        })
      );
    });

    it('should NOT include Authorization header when API key is empty', async () => {
      const clientWithoutKey = new IPOAlertsClient(
        'https://api.test.com',
        '', // Empty API key
        5,
        10000
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [] })
      });

      await clientWithoutKey.fetchOpenIPOs();

      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.headers).not.toHaveProperty('Authorization');
    });
  });

  describe('getRateLimitStatus', () => {
    it('should return current rate limit status', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [] })
      });

      // Make 2 requests
      await client.fetchOpenIPOs();
      await client.fetchUpcomingIPOs();

      const status = client.getRateLimitStatus();

      expect(status.used).toBe(2);
      expect(status.remaining).toBe(3);
      expect(status.limit).toBe(5);
      expect(status.resetInMs).toBeGreaterThanOrEqual(0);
    });

    it('should show zero remaining when limit is reached', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [] })
      });

      // Make 5 requests (hit limit)
      for (let i = 0; i < 5; i++) {
        await client.fetchOpenIPOs();
      }

      const status = client.getRateLimitStatus();

      expect(status.used).toBe(5);
      expect(status.remaining).toBe(0);
    });
  });
});
