/**
 * Scraper Metrics Tracker
 *
 * Tracks success/failure metrics in Redis for monitoring and alerting.
 * Story 7.5: Error Handling & Monitoring
 */

import type Redis from 'ioredis';
import { logger } from '../utils/logger';
import type { ScraperSource } from './types';
import { notifyOwner } from './owner-notify';

/**
 * Metrics for a scraper source
 */
export interface ScraperMetrics {
  success: number;
  failure: number;
  rate: number; // Success rate as percentage (0-100)
}

/**
 * Alert check result
 */
export interface AlertCheck {
  sendAlert: boolean;
  reason: string | null;
}

/**
 * Tracks scraper metrics in Redis with rolling 24-hour window
 */
export class ScraperMetricsTracker {
  private readonly METRICS_TTL = 86400; // 24 hours in seconds
  private readonly ALERT_COOLDOWN = 3600; // 1 hour in seconds
  private readonly CONSECUTIVE_FAILURE_THRESHOLD = 3;
  private readonly SUCCESS_RATE_THRESHOLD = 80; // percentage
  // T-309 (T-305 round-6 P3): a run that returns 0 rows but throws nothing is
  // logged 'SUCCESS' by BaseScraperOrchestrator.logSuccess() — indistinguishable
  // from a genuinely healthy cycle to the freshness/health monitors (the
  // API_FALLBACK source did this every cycle). Same 3-strikes shape as
  // CONSECUTIVE_FAILURE_THRESHOLD, extending this tracker rather than adding a
  // parallel mechanism.
  private readonly CONSECUTIVE_ZERO_YIELD_THRESHOLD = 3;

  constructor(private redis: Redis) {}

  /**
   * Record a successful scraper run
   */
  async recordSuccess(source: ScraperSource): Promise<void> {
    const key = this.getSuccessKey(source);

    try {
      await this.redis.incr(key);
      await this.redis.expire(key, this.METRICS_TTL);

      // Reset consecutive failures on success
      await this.resetConsecutiveFailures(source);

      logger.info({
        metric: 'scraper_success',
        source,
      }, `Scraper ${source} success recorded`);
    } catch (error) {
      logger.error({
        error,
        source,
      }, `Failed to record success metric for ${source}`);
    }
  }

  /**
   * Record a failed scraper run
   */
  async recordFailure(source: ScraperSource): Promise<void> {
    const failureKey = this.getFailureKey(source);
    const consecutiveKey = this.getConsecutiveFailureKey(source);

    try {
      await this.redis.incr(failureKey);
      await this.redis.expire(failureKey, this.METRICS_TTL);
      await this.redis.incr(consecutiveKey);

      logger.warn({
        metric: 'scraper_failure',
        source,
      }, `Scraper ${source} failure recorded`);
    } catch (error) {
      logger.error({
        error,
        source,
      }, `Failed to record failure metric for ${source}`);
    }
  }

  /**
   * T-309: record one cycle's yield (rows processed) and return the new
   * consecutive-zero-yield streak. A non-zero yield resets the streak to 0.
   * Best-effort — mirrors recordFailure()'s error handling (never throws).
   */
  async recordZeroYieldCycle(source: ScraperSource, iposProcessed: number): Promise<number> {
    const key = this.getConsecutiveZeroYieldKey(source);
    try {
      if (iposProcessed > 0) {
        await this.redis.del(key);
        return 0;
      }
      const streak = await this.redis.incr(key);
      await this.redis.expire(key, this.METRICS_TTL);
      return streak;
    } catch (error) {
      logger.error({
        error,
        source,
      }, `Failed to record zero-yield cycle for ${source}`);
      return 0;
    }
  }

  /**
   * Get the current consecutive-zero-yield streak for a source.
   */
  async getConsecutiveZeroYield(source: ScraperSource): Promise<number> {
    try {
      const value = await this.redis.get(this.getConsecutiveZeroYieldKey(source));
      return parseInt(value || '0', 10);
    } catch (error) {
      logger.error({
        error,
        source,
      }, `Failed to get consecutive zero-yield count for ${source}`);
      return 0;
    }
  }

  /** Is the zero-yield streak at/above the DEGRADED threshold? */
  isZeroYieldDegraded(streak: number): boolean {
    return streak >= this.CONSECUTIVE_ZERO_YIELD_THRESHOLD;
  }

  /**
   * Get current metrics for a scraper source
   */
  async getMetrics(source: ScraperSource): Promise<ScraperMetrics> {
    try {
      const [successStr, failureStr] = await Promise.all([
        this.redis.get(this.getSuccessKey(source)),
        this.redis.get(this.getFailureKey(source)),
      ]);

      const success = parseInt(successStr || '0', 10);
      const failure = parseInt(failureStr || '0', 10);
      const total = success + failure;
      const rate = total > 0 ? (success / total) * 100 : 100;

      return { success, failure, rate };
    } catch (error) {
      logger.error({
        error,
        source,
      }, `Failed to get metrics for ${source}`);

      // Return default metrics on error
      return { success: 0, failure: 0, rate: 100 };
    }
  }

  /**
   * Get consecutive failure count
   */
  async getConsecutiveFailures(source: ScraperSource): Promise<number> {
    try {
      const value = await this.redis.get(this.getConsecutiveFailureKey(source));
      return parseInt(value || '0', 10);
    } catch (error) {
      logger.error({
        error,
        source,
      }, `Failed to get consecutive failures for ${source}`);
      return 0;
    }
  }

  /**
   * Reset consecutive failure counter
   */
  async resetConsecutiveFailures(source: ScraperSource): Promise<void> {
    try {
      await this.redis.del(this.getConsecutiveFailureKey(source));
    } catch (error) {
      logger.error({
        error,
        source,
      }, `Failed to reset consecutive failures for ${source}`);
    }
  }

  /**
   * Check if an alert should be sent
   */
  async shouldSendAlert(source: ScraperSource): Promise<AlertCheck> {
    try {
      // Check if alert was recently sent (cooldown period)
      const alertSent = await this.redis.get(this.getAlertSentKey(source));
      if (alertSent) {
        return { sendAlert: false, reason: null };
      }

      // Check consecutive failures
      const consecutiveFailures = await this.getConsecutiveFailures(source);
      if (consecutiveFailures >= this.CONSECUTIVE_FAILURE_THRESHOLD) {
        return {
          sendAlert: true,
          reason: `${consecutiveFailures} consecutive failures`,
        };
      }

      // Check success rate in last 24 hours
      const metrics = await this.getMetrics(source);
      if (metrics.rate < this.SUCCESS_RATE_THRESHOLD && (metrics.success + metrics.failure) >= 5) {
        return {
          sendAlert: true,
          reason: `Success rate ${metrics.rate.toFixed(1)}% below threshold`,
        };
      }

      return { sendAlert: false, reason: null };
    } catch (error) {
      logger.error({
        error,
        source,
      }, `Failed to check alert status for ${source}`);

      // T-194: a Redis error here means the alert-detection path itself is
      // blind -- silently returning {sendAlert:false} would hide a REAL
      // scraper failure behind a monitoring failure. Redis stays best-effort
      // (redis-best-effort-fail-open.md -- this never throws or blocks the
      // scrape), but the owner MUST be told monitoring is degraded rather
      // than the failure going dark. Best-effort + fire-and-forget: never
      // awaited, never throws.
      notifyOwner(
        'P0',
        `Scraper alerting degraded for ${source}`,
        {
          body: `shouldSendAlert() failed to read Redis: ${error instanceof Error ? error.message : String(error)}`,
          type: 'alerting-degraded',
          dedupeKey: `alerting-degraded:${source}`,
        }
      );

      return { sendAlert: false, reason: null };
    }
  }

  /**
   * Mark that an alert was sent (sets cooldown)
   */
  async markAlertSent(source: ScraperSource): Promise<void> {
    try {
      await this.redis.setex(
        this.getAlertSentKey(source),
        this.ALERT_COOLDOWN,
        '1'
      );

      logger.info({
        source,
        cooldown: this.ALERT_COOLDOWN,
      }, `Alert cooldown set for ${source}`);
    } catch (error) {
      logger.error({
        error,
        source,
      }, `Failed to mark alert sent for ${source}`);
    }
  }

  /**
   * Get all metrics for all sources
   */
  async getAllMetrics(): Promise<Record<ScraperSource, ScraperMetrics>> {
    const sources: ScraperSource[] = ['NSE', 'BSE', 'MONEYCONTROL', 'CHITTORGARH', 'API_FALLBACK'];
    const metrics: Record<string, ScraperMetrics> = {};

    for (const source of sources) {
      metrics[source] = await this.getMetrics(source);
    }

    return metrics as Record<ScraperSource, ScraperMetrics>;
  }

  // Redis key generators
  private getSuccessKey(source: ScraperSource): string {
    return `scraper:${source}:success_count`;
  }

  private getFailureKey(source: ScraperSource): string {
    return `scraper:${source}:failure_count`;
  }

  private getConsecutiveFailureKey(source: ScraperSource): string {
    return `scraper:${source}:consecutive_failures`;
  }

  private getConsecutiveZeroYieldKey(source: ScraperSource): string {
    return `scraper:${source}:consecutive_zero_yield`;
  }

  private getAlertSentKey(source: ScraperSource): string {
    return `scraper:${source}:alert_sent`;
  }
}
