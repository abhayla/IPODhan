/**
 * HTTP Client for Web Scraping
 *
 * Provides a robust HTTP client with:
 * - Rate limiting
 * - Retry logic
 * - User agent rotation
 * - Error handling
 * - Timeout management
 */

import { logger } from '@/lib/logger';

export interface HttpClientOptions {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  headers?: Record<string, string>;
  rateLimit?: number; // requests per second
}

export interface ScraperResponse {
  data: string;
  status: number;
  headers: Record<string, string>;
  url: string;
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

class HttpClient {
  private lastRequestTime: number = 0;
  private requestQueue: Promise<any> = Promise.resolve();

  /**
   * Get a random user agent
   */
  private getRandomUserAgent(): string {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Rate limit requests
   */
  private async rateLimit(rateLimit?: number): Promise<void> {
    if (!rateLimit) return;

    const minDelay = 1000 / rateLimit;
    const timeSinceLastRequest = Date.now() - this.lastRequestTime;

    if (timeSinceLastRequest < minDelay) {
      await this.sleep(minDelay - timeSinceLastRequest);
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Fetch with retries
   */
  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    retries: number,
    retryDelay: number
  ): Promise<Response> {
    try {
      const response = await fetch(url, options);

      if (!response.ok && retries > 0) {
        logger.warn(`HTTP ${response.status} for ${url}, retrying... (${retries} attempts left)`);
        await this.sleep(retryDelay);
        return this.fetchWithRetry(url, options, retries - 1, retryDelay * 2);
      }

      return response;
    } catch (error) {
      if (retries > 0) {
        logger.warn(`Request failed for ${url}, retrying... (${retries} attempts left)`);
        await this.sleep(retryDelay);
        return this.fetchWithRetry(url, options, retries - 1, retryDelay * 2);
      }
      throw error;
    }
  }

  /**
   * Main fetch method
   */
  async fetch(url: string, options: HttpClientOptions = {}): Promise<ScraperResponse> {
    const {
      timeout = 30000,
      retries = 3,
      retryDelay = 1000,
      headers = {},
      rateLimit,
    } = options;

    // Queue the request to ensure rate limiting
    return this.requestQueue = this.requestQueue.then(async () => {
      await this.rateLimit(rateLimit);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const fetchOptions: RequestInit = {
          headers: {
            'User-Agent': this.getRandomUserAgent(),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            ...headers,
          },
          signal: controller.signal,
        };

        logger.info(`Fetching: ${url}`);
        const response = await this.fetchWithRetry(url, fetchOptions, retries, retryDelay);

        const data = await response.text();
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        logger.info(`Successfully fetched: ${url} (${response.status})`);

        return {
          data,
          status: response.status,
          headers: responseHeaders,
          url: response.url,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Failed to fetch ${url}: ${errorMessage}`);
        throw new Error(`HTTP request failed: ${errorMessage}`);
      } finally {
        clearTimeout(timeoutId);
      }
    });
  }

  /**
   * Fetch JSON data
   */
  async fetchJSON<T = any>(url: string, options: HttpClientOptions = {}): Promise<T> {
    const response = await this.fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'Accept': 'application/json',
      },
    });

    try {
      return JSON.parse(response.data);
    } catch (error) {
      throw new Error(`Failed to parse JSON response from ${url}`);
    }
  }
}

// Export singleton instance
export const httpClient = new HttpClient();
