import logger from '../utils/logger.js';
import type { ScraperType } from './types.js';

// ==================== TYPES ====================

interface FailureRecord {
  count: number;
  timestamps: number[];
  lastError: string | null;
  lastFailureTime: number | null;
}

// ==================== FAILURE TRACKER ====================

/**
 * Tracks consecutive scraper failures for automatic fallback triggering
 * In-memory tracking (Story 7.5 will add database persistence)
 */
export class ScraperFailureTracker {
  private failures: Map<ScraperType, FailureRecord> = new Map();
  private readonly fallbackThreshold: number;

  constructor(fallbackThreshold: number = 3) {
    this.fallbackThreshold = fallbackThreshold;

    // Initialize failure records for each scraper type
    const scraperTypes: ScraperType[] = ['NSE', 'BSE', 'MONEYCONTROL', 'CHITTORGARH', 'API_FALLBACK'];
    scraperTypes.forEach(type => {
      this.failures.set(type, {
        count: 0,
        timestamps: [],
        lastError: null,
        lastFailureTime: null
      });
    });
  }

  /**
   * Record a scraper failure
   * @param scraperType - Type of scraper that failed
   * @param error - Error that caused the failure
   */
  recordFailure(scraperType: ScraperType, error: Error): void {
    const record = this.failures.get(scraperType);
    if (!record) {
      logger.error({ scraperType }, 'Invalid scraper type');
      return;
    }

    const now = Date.now();
    record.count++;
    record.timestamps.push(now);
    record.lastError = error.message;
    record.lastFailureTime = now;

    logger.warn(
      {
        scraperType,
        failureCount: record.count,
        error: error.message,
        fallbackThreshold: this.fallbackThreshold
      },
      `${scraperType} scraper failure recorded (${record.count}/${this.fallbackThreshold})`
    );

    // Check if fallback should be triggered
    if (record.count >= this.fallbackThreshold) {
      logger.error(
        {
          scraperType,
          failureCount: record.count,
          fallbackThreshold: this.fallbackThreshold
        },
        `${scraperType} scraper has failed ${record.count} consecutive times - fallback threshold reached`
      );
    }
  }

  /**
   * Record a successful scraper run
   * Resets failure count for the scraper type
   * @param scraperType - Type of scraper that succeeded
   */
  recordSuccess(scraperType: ScraperType): void {
    const record = this.failures.get(scraperType);
    if (!record) {
      logger.error({ scraperType }, 'Invalid scraper type');
      return;
    }

    const previousCount = record.count;

    // Reset failure count
    record.count = 0;
    record.timestamps = [];
    record.lastError = null;
    record.lastFailureTime = null;

    if (previousCount > 0) {
      logger.info(
        {
          scraperType,
          previousFailureCount: previousCount
        },
        `${scraperType} scraper success - failure count reset to 0`
      );
    }
  }

  /**
   * Check if fallback should be triggered for a scraper type
   * @param scraperType - Type of scraper to check
   * @returns true if fallback should be triggered (failures >= threshold)
   */
  shouldTriggerFallback(scraperType: ScraperType): boolean {
    const record = this.failures.get(scraperType);
    if (!record) {
      logger.error({ scraperType }, 'Invalid scraper type');
      return false;
    }

    return record.count >= this.fallbackThreshold;
  }

  /**
   * Get current failure count for a scraper type
   * @param scraperType - Type of scraper to check
   * @returns Current consecutive failure count
   */
  getFailureCount(scraperType: ScraperType): number {
    const record = this.failures.get(scraperType);
    return record?.count || 0;
  }

  /**
   * Get last failure information for a scraper type
   * @param scraperType - Type of scraper to check
   * @returns Last failure timestamp and error message
   */
  getLastFailure(scraperType: ScraperType): {
    timestamp: number | null;
    error: string | null;
  } {
    const record = this.failures.get(scraperType);
    if (!record) {
      return { timestamp: null, error: null };
    }

    return {
      timestamp: record.lastFailureTime,
      error: record.lastError
    };
  }

  /**
   * Get failure statistics for all scrapers
   * @returns Failure statistics object
   */
  getAllFailures(): Record<ScraperType, FailureRecord> {
    const result = {} as Record<ScraperType, FailureRecord>;
    this.failures.forEach((record, type) => {
      result[type] = record;
    });
    return result;
  }

  /**
   * Reset all failure counts (for testing or manual reset)
   */
  resetAll(): void {
    this.failures.forEach((record, scraperType) => {
      record.count = 0;
      record.timestamps = [];
      record.lastError = null;
      record.lastFailureTime = null;
    });

    logger.info('All scraper failure counts reset');
  }

  /**
   * Reset failure count for a specific scraper type (for testing or manual reset)
   * @param scraperType - Type of scraper to reset
   */
  reset(scraperType: ScraperType): void {
    this.recordSuccess(scraperType);
  }
}

// Export singleton instance
export const scraperFailureTracker = new ScraperFailureTracker();
