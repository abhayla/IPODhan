/**
 * Data Freshness Service
 *
 * Checks if IPO data is stale and if scrapers are healthy.
 * Story 7.5: Error Handling & Monitoring
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { ScraperLogRepository } from '../repositories/scraper-log-repository';
import { IPORepository } from '../repositories/ipo-repository';
import * as schema from '@ipodhan/shared/db/schema';
import type { ScraperSource } from '../db/types';

/**
 * Service for checking data freshness and scraper health
 */
export class DataFreshnessService {
  private scraperLogRepository: ScraperLogRepository;
  private ipoRepository: IPORepository;
  private redis: Redis;

  // Data is considered stale if older than 2 hours
  private readonly STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000;

  constructor(db: NodePgDatabase<typeof schema>, redis: Redis) {
    this.scraperLogRepository = new ScraperLogRepository(db, redis);
    this.ipoRepository = new IPORepository(db, redis);
    this.redis = redis;
  }

  /**
   * Check if IPO data is stale (last_scraped_at > 2 hours ago)
   */
  async isIPODataStale(slug: string): Promise<boolean> {
    try {
      const ipo = await this.ipoRepository.findBySlug(slug);

      if (!ipo || !ipo.lastScrapedAt) {
        return true; // No data or no scrape timestamp = stale
      }

      const staleThreshold = new Date(Date.now() - this.STALE_THRESHOLD_MS);
      return ipo.lastScrapedAt < staleThreshold;
    } catch (error) {
      console.error(`Failed to check staleness for IPO ${slug}:`, error);
      return true; // Assume stale on error
    }
  }

  /**
   * Get last successful scrape time across all sources
   */
  async getLastSuccessfulScrape(): Promise<Date | null> {
    try {
      const sources: ScraperSource[] = ['NSE', 'BSE', 'API_FALLBACK'];

      const lastSuccesses = await Promise.all(
        sources.map(source => this.scraperLogRepository.getLastSuccess(source))
      );

      // Find most recent successful scrape
      const successDates = lastSuccesses
        .filter(log => log !== null)
        .map(log => log!.createdAt);

      if (successDates.length === 0) {
        return null;
      }

      return new Date(Math.max(...successDates.map(d => d.getTime())));
    } catch (error) {
      console.error('Failed to get last successful scrape:', error);
      return null;
    }
  }

  /**
   * Check if all scrapers are failing
   */
  async areAllScrapersFailing(): Promise<boolean> {
    try {
      const sources: ScraperSource[] = ['NSE', 'BSE', 'API_FALLBACK'];

      // Get metrics from Redis for each source
      const metricsPromises = sources.map(async (source) => {
        try {
          const [successStr, failureStr] = await Promise.all([
            this.redis.get(`scraper:${source}:success_count`),
            this.redis.get(`scraper:${source}:failure_count`),
          ]);

          const success = parseInt(successStr || '0', 10);
          const failure = parseInt(failureStr || '0', 10);
          const total = success + failure;
          const rate = total > 0 ? (success / total) * 100 : 100;

          return rate;
        } catch (error) {
          console.error(`Failed to get metrics for ${source}:`, error);
          return 100; // Assume healthy on error
        }
      });

      const rates = await Promise.all(metricsPromises);

      // All failing if all have very low success rates (< 20%)
      return rates.every(rate => rate < 20);
    } catch (error) {
      console.error('Failed to check if all scrapers are failing:', error);
      return false;
    }
  }

  /**
   * Get data freshness status
   */
  async getDataFreshnessStatus(): Promise<{
    isStale: boolean;
    lastSuccessfulScrape: Date | null;
    allScrapersFailing: boolean;
  }> {
    const [lastSuccessfulScrape, allScrapersFailing] = await Promise.all([
      this.getLastSuccessfulScrape(),
      this.areAllScrapersFailing(),
    ]);

    // Data is stale if last scrape was > 2 hours ago or no recent scrape
    const isStale =
      !lastSuccessfulScrape ||
      lastSuccessfulScrape.getTime() < Date.now() - this.STALE_THRESHOLD_MS;

    return {
      isStale,
      lastSuccessfulScrape,
      allScrapersFailing,
    };
  }
}
