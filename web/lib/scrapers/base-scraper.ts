/**
 * Base Scraper Class
 *
 * Abstract base class for all web scrapers
 * Provides common functionality:
 * - HTTP client access
 * - Error handling
 * - Logging
 * - Data validation
 */

import { logger } from '@/lib/logger';
import { httpClient, type HttpClientOptions } from './utils/http-client';
import { parseHTML, type CheerioAPI } from './utils/parser';

export interface ScraperConfig {
  name: string;
  baseUrl: string;
  rateLimit?: number; // requests per second
  timeout?: number;
  retries?: number;
}

export interface ScraperResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: Date;
  source: string;
}

export abstract class BaseScraper<T> {
  protected config: ScraperConfig;

  constructor(config: ScraperConfig) {
    this.config = config;
  }

  /**
   * Main scrape method - to be implemented by subclasses
   */
  abstract scrape(...args: any[]): Promise<ScraperResult<T>>;

  /**
   * Fetch HTML and parse with Cheerio
   */
  protected async fetchHTML(url: string, options?: HttpClientOptions): Promise<CheerioAPI> {
    const response = await httpClient.fetch(url, {
      rateLimit: this.config.rateLimit,
      timeout: this.config.timeout,
      retries: this.config.retries,
      ...options,
    });

    return parseHTML(response.data);
  }

  /**
   * Fetch JSON data
   */
  protected async fetchJSON<K = any>(url: string, options?: HttpClientOptions): Promise<K> {
    return httpClient.fetchJSON<K>(url, {
      rateLimit: this.config.rateLimit,
      timeout: this.config.timeout,
      retries: this.config.retries,
      ...options,
    });
  }

  /**
   * Create success result
   */
  protected createSuccessResult(data: T): ScraperResult<T> {
    return {
      success: true,
      data,
      timestamp: new Date(),
      source: this.config.name,
    };
  }

  /**
   * Create error result
   */
  protected createErrorResult(error: string | Error): ScraperResult<T> {
    const errorMessage = error instanceof Error ? error.message : error;
    logger.error(`[${this.config.name}] Scraping failed:`, errorMessage);

    return {
      success: false,
      error: errorMessage,
      timestamp: new Date(),
      source: this.config.name,
    };
  }

  /**
   * Validate scraped data
   */
  protected validateData(data: any, requiredFields: string[]): boolean {
    if (!data || typeof data !== 'object') {
      return false;
    }

    return requiredFields.every(field => {
      const value = data[field];
      return value !== undefined && value !== null && value !== '';
    });
  }

  /**
   * Log scraping start
   */
  protected logStart(message: string): void {
    logger.info(`[${this.config.name}] ${message}`);
  }

  /**
   * Log scraping completion
   */
  protected logComplete(count: number): void {
    logger.info(`[${this.config.name}] Successfully scraped ${count} items`);
  }

  /**
   * Log scraping error
   */
  protected logError(error: string | Error): void {
    const errorMessage = error instanceof Error ? error.message : error;
    logger.error(`[${this.config.name}] Error:`, errorMessage);
  }
}
