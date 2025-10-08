/**
 * Scraper Metrics Tracker
 *
 * Tracks success/failure metrics in Redis for monitoring and alerting.
 * Story 7.5: Error Handling & Monitoring
 */

import type Redis from 'ioredis';
import { logger } from '../utils/logger';
import type { ScraperSource } from './types';

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
    const sources: ScraperSource[] = ['NSE', 'BSE', 'API_FALLBACK'];
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

  private getAlertSentKey(source: ScraperSource): string {
    return `scraper:${source}:alert_sent`;
  }
}
