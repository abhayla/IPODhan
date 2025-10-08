import type Redis from 'ioredis';
import logger from '../../utils/logger.js';

/**
 * Scraper health status for individual scraper
 */
export interface ScraperHealth {
  lastScrapedAt: Date | null;
  timeSinceLastScrape: number;   // milliseconds
  consecutiveFailures: number;
  status: 'OK' | 'WARNING' | 'ALERT';
}

/**
 * Complete health check result
 */
export interface HealthCheckResult {
  success: boolean;
  status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL' | 'UNKNOWN';
  timestamp: Date;
  scrapers: {
    nse: ScraperHealth;
    bse: ScraperHealth;
    apiFallback: ScraperHealth;
  };
}

/**
 * Health check thresholds (in milliseconds)
 */
const HEALTH_THRESHOLDS = {
  WARNING: 60 * 60 * 1000,    // 1 hour
  ALERT: 2 * 60 * 60 * 1000,  // 2 hours
  CONSECUTIVE_FAILURES_WARNING: 3,
  CONSECUTIVE_FAILURES_ALERT: 5
} as const;

/**
 * Run health check job
 * Checks last successful scrape times and consecutive failures for all scrapers
 *
 * @param redis - Redis client for failure tracking
 * @returns Health check result
 */
export async function runHealthCheck(redis: Redis): Promise<HealthCheckResult> {
  const startTime = Date.now();

  try {
    logger.info('Starting health check');

    // Get health status for each scraper
    // Note: Once last_scraped_at is added to database, this will query the database
    // For now, we use Redis failure tracking as a proxy
    const nseHealth = await getScraperHealth(redis, 'NSE');
    const bseHealth = await getScraperHealth(redis, 'BSE');
    const apiHealth = await getScraperHealth(redis, 'API_FALLBACK');

    // Determine overall health status
    const overallStatus = determineOverallStatus([nseHealth, bseHealth, apiHealth]);

    // Log warnings and alerts
    logHealthIssues(nseHealth, 'NSE');
    logHealthIssues(bseHealth, 'BSE');
    logHealthIssues(apiHealth, 'API_FALLBACK');

    const duration = Date.now() - startTime;
    logger.info({
      status: overallStatus,
      duration,
      nse: nseHealth.status,
      bse: bseHealth.status,
      api: apiHealth.status
    }, 'Health check completed');

    return {
      success: true,
      status: overallStatus,
      timestamp: new Date(),
      scrapers: {
        nse: nseHealth,
        bse: bseHealth,
        apiFallback: apiHealth
      }
    };
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime
    }, 'Health check failed');

    // Return UNKNOWN status on error (don't crash scheduler)
    return {
      success: false,
      status: 'UNKNOWN',
      timestamp: new Date(),
      scrapers: {
        nse: createUnknownHealth(),
        bse: createUnknownHealth(),
        apiFallback: createUnknownHealth()
      }
    };
  }
}

/**
 * Get health status for a specific scraper
 * @param redis - Redis client for failure tracking
 * @param source - Scraper source (NSE, BSE, API_FALLBACK)
 * @returns Scraper health status
 */
async function getScraperHealth(
  redis: Redis,
  source: 'NSE' | 'BSE' | 'API_FALLBACK'
): Promise<ScraperHealth> {
  try {
    // TODO: Once last_scraped_at is added to database, query it here
    // For now, use Redis failure tracking as a proxy
    // Query: SELECT MAX(last_scraped_at) FROM ipos WHERE 'NSE' = ANY(listing_exchanges)

    // Get consecutive failures from Redis (from Story 7.3)
    const failureKey = `scraper:${source}:failures`;
    const failures = await redis.get(failureKey);
    const consecutiveFailures = failures ? parseInt(failures, 10) : 0;

    // For MVP, we don't have last_scraped_at yet, so we use failure count
    // as a proxy for health status
    let status: 'OK' | 'WARNING' | 'ALERT' = 'OK';
    if (consecutiveFailures >= HEALTH_THRESHOLDS.CONSECUTIVE_FAILURES_ALERT) {
      status = 'ALERT';
    } else if (consecutiveFailures >= HEALTH_THRESHOLDS.CONSECUTIVE_FAILURES_WARNING) {
      status = 'WARNING';
    }

    return {
      lastScrapedAt: null,  // TODO: Get from database once field is added
      timeSinceLastScrape: 0,  // TODO: Calculate from database timestamp
      consecutiveFailures,
      status
    };
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      source
    }, 'Failed to get scraper health');
    return createUnknownHealth();
  }
}

/**
 * Determine overall health status based on all scrapers
 * @param scraperHealths - Array of scraper health statuses
 * @returns Overall health status
 */
function determineOverallStatus(
  scraperHealths: ScraperHealth[]
): 'HEALTHY' | 'DEGRADED' | 'CRITICAL' {
  const hasAlert = scraperHealths.some(h => h.status === 'ALERT');
  const hasWarning = scraperHealths.some(h => h.status === 'WARNING');

  if (hasAlert) {
    return 'CRITICAL';
  } else if (hasWarning) {
    return 'DEGRADED';
  } else {
    return 'HEALTHY';
  }
}

/**
 * Log health issues (warnings and alerts)
 * @param health - Scraper health status
 * @param source - Scraper source name
 */
function logHealthIssues(health: ScraperHealth, source: string): void {
  if (health.status === 'ALERT') {
    logger.error({
      source,
      consecutiveFailures: health.consecutiveFailures,
      lastScrapedAt: health.lastScrapedAt,
      timeSinceLastScrape: health.timeSinceLastScrape
    }, `ALERT: ${source} scraper has ${health.consecutiveFailures} consecutive failures`);
  } else if (health.status === 'WARNING') {
    logger.warn({
      source,
      consecutiveFailures: health.consecutiveFailures,
      lastScrapedAt: health.lastScrapedAt,
      timeSinceLastScrape: health.timeSinceLastScrape
    }, `WARNING: ${source} scraper has ${health.consecutiveFailures} consecutive failures`);
  }
}

/**
 * Create unknown health status (for error cases)
 * @returns Unknown scraper health
 */
function createUnknownHealth(): ScraperHealth {
  return {
    lastScrapedAt: null,
    timeSinceLastScrape: 0,
    consecutiveFailures: 0,
    status: 'OK'  // Default to OK if we can't determine status
  };
}
