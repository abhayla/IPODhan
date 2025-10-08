import logger from '../utils/logger.js';
import { config } from '../config.js';

// ==================== CONFIGURATION ====================

const IPO_ALERTS_BASE_URL = process.env.IPO_ALERTS_API_URL || 'https://api.ipoalerts.in';
const IPO_ALERTS_API_KEY = process.env.IPO_ALERTS_API_KEY || '';
const RATE_LIMIT_MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100');
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW || '3600000'); // 1 hour in ms
const REQUEST_TIMEOUT = 30000; // 30 seconds

// ==================== CUSTOM ERRORS ====================

export class RateLimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitExceededError';
  }
}

export class APIAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'APIAuthenticationError';
  }
}

export class APINotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'APINotFoundError';
  }
}

// ==================== RATE LIMITER ====================

class RateLimiter {
  private requestTimestamps: number[] = [];
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  /**
   * Remove timestamps older than the rate limit window
   */
  private cleanOldTimestamps(): void {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    this.requestTimestamps = this.requestTimestamps.filter(ts => ts > cutoff);
  }

  /**
   * Check if a new request can be made without exceeding rate limit
   * @returns true if request can be made, false otherwise
   */
  canMakeRequest(): boolean {
    this.cleanOldTimestamps();
    return this.requestTimestamps.length < this.maxRequests;
  }

  /**
   * Record a new API request timestamp
   */
  recordRequest(): void {
    this.requestTimestamps.push(Date.now());
  }

  /**
   * Get number of requests made in current window
   */
  getRequestCount(): number {
    this.cleanOldTimestamps();
    return this.requestTimestamps.length;
  }

  /**
   * Get number of remaining requests in current window
   */
  getRemainingRequests(): number {
    return Math.max(0, this.maxRequests - this.getRequestCount());
  }

  /**
   * Get time until rate limit resets (in milliseconds)
   */
  getTimeUntilReset(): number {
    this.cleanOldTimestamps();
    if (this.requestTimestamps.length === 0) {
      return 0;
    }
    const oldestTimestamp = this.requestTimestamps[0];
    const resetTime = oldestTimestamp + this.windowMs;
    return Math.max(0, resetTime - Date.now());
  }
}

// ==================== IPO ALERTS API CLIENT ====================

export interface IPOAlertsAPIResponse {
  success: boolean;
  data: any[];
  count: number;
  rate_limit?: {
    remaining: number;
    reset_time: string;
  };
}

export class IPOAlertsClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly rateLimiter: RateLimiter;
  private readonly timeout: number;

  constructor(
    baseUrl: string = IPO_ALERTS_BASE_URL,
    apiKey: string = IPO_ALERTS_API_KEY,
    maxRequests: number = RATE_LIMIT_MAX_REQUESTS,
    windowMs: number = RATE_LIMIT_WINDOW
  ) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.rateLimiter = new RateLimiter(maxRequests, windowMs);
    this.timeout = REQUEST_TIMEOUT;
  }

  /**
   * Make HTTP request with retry logic and exponential backoff
   */
  private async makeRequest(
    url: string,
    retryAttempt: number = 0
  ): Promise<IPOAlertsAPIResponse> {
    const maxRetries = config.scraper.retryAttempts;
    const retryDelays = config.scraper.retryDelays;

    // Check rate limit before making request
    if (!this.rateLimiter.canMakeRequest()) {
      const resetTime = this.rateLimiter.getTimeUntilReset();
      const resetMinutes = Math.ceil(resetTime / 60000);
      throw new RateLimitExceededError(
        `Rate limit exceeded. Reset in ${resetMinutes} minutes. ` +
        `(${this.rateLimiter.getRequestCount()}/${RATE_LIMIT_MAX_REQUESTS} requests used)`
      );
    }

    // Log warning at 80% threshold
    const requestCount = this.rateLimiter.getRequestCount();
    if (requestCount >= RATE_LIMIT_MAX_REQUESTS * 0.8) {
      logger.warn(
        {
          requestCount,
          maxRequests: RATE_LIMIT_MAX_REQUESTS,
          remaining: this.rateLimiter.getRemainingRequests()
        },
        'Rate limit warning: 80% threshold reached'
      );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const startTime = Date.now();

      // Build headers
      const headers: HeadersInit = {
        'User-Agent': 'IPODhan/1.0 (+https://ipodhan.com)',
        'Accept': 'application/json'
      };

      // Add authorization header if API key is provided
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      logger.debug({ url, attempt: retryAttempt + 1 }, 'Making API request');

      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const duration = Date.now() - startTime;

      // Record successful request for rate limiting
      this.rateLimiter.recordRequest();

      logger.debug(
        {
          url,
          status: response.status,
          duration,
          rateLimitUsed: this.rateLimiter.getRequestCount(),
          rateLimitRemaining: this.rateLimiter.getRemainingRequests()
        },
        'API request completed'
      );

      // Handle error responses
      if (!response.ok) {
        // 401 Unauthorized - authentication error (do not retry)
        if (response.status === 401) {
          throw new APIAuthenticationError(
            'API authentication failed. Check API key configuration.'
          );
        }

        // 404 Not Found - endpoint not found or no data (do not retry)
        if (response.status === 404) {
          throw new APINotFoundError('API endpoint not found or no data available');
        }

        // 429 Rate Limit - should not happen as we track it ourselves (do not retry)
        if (response.status === 429) {
          throw new RateLimitExceededError('API rate limit exceeded (server-side)');
        }

        // 500/502/503 Server Error - retry with exponential backoff
        if (response.status >= 500) {
          throw new Error(`API server error: ${response.status} ${response.statusText}`);
        }

        // Other errors
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      // Parse JSON response
      const data = await response.json();

      // Return standardized response format
      return {
        success: true,
        data: Array.isArray(data) ? data : data.data || [],
        count: Array.isArray(data) ? data.length : data.count || 0,
        rate_limit: {
          remaining: this.rateLimiter.getRemainingRequests(),
          reset_time: new Date(Date.now() + this.rateLimiter.getTimeUntilReset()).toISOString()
        }
      };

    } catch (error) {
      clearTimeout(timeoutId);

      // Do not retry on authentication or not found errors
      if (error instanceof APIAuthenticationError || error instanceof APINotFoundError || error instanceof RateLimitExceededError) {
        throw error;
      }

      // Retry on network errors, server errors, and timeouts
      if (retryAttempt < maxRetries - 1) {
        const delay = retryDelays[retryAttempt] || retryDelays[retryDelays.length - 1];
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.warn(
          {
            url,
            attempt: retryAttempt + 1,
            maxRetries,
            delay,
            error: errorMessage
          },
          'API request failed, retrying with exponential backoff'
        );

        await new Promise(resolve => setTimeout(resolve, delay));
        return this.makeRequest(url, retryAttempt + 1);
      }

      // Max retries exceeded
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ url, error: errorMessage, attempts: retryAttempt + 1 }, 'API request failed after max retries');
      throw error;
    }
  }

  /**
   * Fetch currently open IPOs from API
   * @returns API response with open IPOs
   */
  async fetchOpenIPOs(): Promise<IPOAlertsAPIResponse> {
    const url = `${this.baseUrl}/ipos?status=open`;
    logger.info({ url }, 'Fetching open IPOs from API');
    return this.makeRequest(url);
  }

  /**
   * Fetch upcoming IPOs from API
   * @returns API response with upcoming IPOs
   */
  async fetchUpcomingIPOs(): Promise<IPOAlertsAPIResponse> {
    const url = `${this.baseUrl}/ipos?status=upcoming`;
    logger.info({ url }, 'Fetching upcoming IPOs from API');
    return this.makeRequest(url);
  }

  /**
   * Fetch detailed IPO data by ID
   * @param id - IPO ID
   * @returns API response with IPO details
   */
  async fetchIPOById(id: string): Promise<IPOAlertsAPIResponse> {
    const url = `${this.baseUrl}/ipos/${id}`;
    logger.info({ url, ipoId: id }, 'Fetching IPO by ID from API');
    return this.makeRequest(url);
  }

  /**
   * Fetch all active IPOs (open + upcoming)
   * Makes 2 API requests: one for open IPOs, one for upcoming IPOs
   * @returns Combined API response with all active IPOs
   */
  async fetchAllActiveIPOs(): Promise<IPOAlertsAPIResponse> {
    logger.info('Fetching all active IPOs (open + upcoming)');

    const [openResponse, upcomingResponse] = await Promise.all([
      this.fetchOpenIPOs(),
      this.fetchUpcomingIPOs()
    ]);

    const combinedData = [...openResponse.data, ...upcomingResponse.data];

    logger.info(
      {
        openCount: openResponse.count,
        upcomingCount: upcomingResponse.count,
        totalCount: combinedData.length
      },
      'Fetched all active IPOs'
    );

    return {
      success: true,
      data: combinedData,
      count: combinedData.length,
      rate_limit: {
        remaining: this.rateLimiter.getRemainingRequests(),
        reset_time: new Date(Date.now() + this.rateLimiter.getTimeUntilReset()).toISOString()
      }
    };
  }

  /**
   * Get current rate limit status
   * @returns Rate limit information
   */
  getRateLimitStatus(): {
    used: number;
    remaining: number;
    limit: number;
    resetInMs: number;
  } {
    return {
      used: this.rateLimiter.getRequestCount(),
      remaining: this.rateLimiter.getRemainingRequests(),
      limit: RATE_LIMIT_MAX_REQUESTS,
      resetInMs: this.rateLimiter.getTimeUntilReset()
    };
  }
}

// Export singleton instance
export const ipoAlertsClient = new IPOAlertsClient();
