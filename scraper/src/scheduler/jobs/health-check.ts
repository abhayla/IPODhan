import type Redis from 'ioredis';
import type { ScraperLogRepository } from '@ipodhan/shared';
import type { ScraperSource } from '../../services/types.js';
import { FRESHNESS_SLOS } from '../../config/freshness-slo.js';
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
 * Complete health check result. Keyed by the sources covered in
 * `freshness-slo.ts` (T-195) — the full set of six live scraper sources
 * T-176 measured actually running in production (nse/bse/moneycontrol/
 * chittorgarh/investorgainGmp/apiFallback), not just the original three.
 */
export interface HealthCheckResult {
  success: boolean;
  status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL' | 'UNKNOWN';
  timestamp: Date;
  scrapers: Record<string, ScraperHealth>;
}

/**
 * Health check thresholds (T-195): derived from each source's freshness SLO
 * in `freshness-slo.ts` (itself seeded from the T-176 MEASURED 30-min flat
 * cadence), NOT a hardcoded flat 1h/2h. WARNING fires at half the source's
 * max staleness (an early, non-paging signal); ALERT fires at the full SLO
 * (the same bar `freshness-monitor.ts` uses to page the owner), so this
 * job's status and the freshness monitor's alerts never disagree.
 */
const CONSECUTIVE_FAILURES_WARNING = 3;
const CONSECUTIVE_FAILURES_ALERT = 5;

/**
 * Run health check job
 * Checks last successful scrape times (from `scraper_logs`, via
 * `ScraperLogRepository.getLastSuccess` — the SAME source
 * `/api/admin/scraper/status` already reads, see
 * `web/app/api/admin/scraper/status/route.ts`) and consecutive failures
 * (Redis) for every source in `freshness-slo.ts`.
 *
 * @param redis - Redis client for failure tracking
 * @param scraperLogRepository - Reused source of truth for last-successful-scrape timestamps
 * @returns Health check result
 */
export async function runHealthCheck(
  redis: Redis,
  scraperLogRepository: Pick<ScraperLogRepository, 'getLastSuccess'>
): Promise<HealthCheckResult> {
  const startTime = Date.now();

  try {
    logger.info('Starting health check');

    const scrapers: Record<string, ScraperHealth> = {};
    for (const slo of FRESHNESS_SLOS) {
      scrapers[healthKey(slo.source)] = await getScraperHealth(
        redis,
        scraperLogRepository,
        slo.source,
        slo.maxStalenessMs
      );
    }

    const overallStatus = determineOverallStatus(Object.values(scrapers));

    for (const [key, health] of Object.entries(scrapers)) {
      logHealthIssues(health, key);
    }

    const duration = Date.now() - startTime;
    logger.info(
      {
        status: overallStatus,
        duration,
        scraperStatuses: Object.fromEntries(
          Object.entries(scrapers).map(([key, h]) => [key, h.status])
        ),
      },
      'Health check completed'
    );

    return {
      success: true,
      status: overallStatus,
      timestamp: new Date(),
      scrapers,
    };
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      },
      'Health check failed'
    );

    // Return UNKNOWN status on error (don't crash scheduler)
    return {
      success: false,
      status: 'UNKNOWN',
      timestamp: new Date(),
      scrapers: Object.fromEntries(FRESHNESS_SLOS.map((slo) => [healthKey(slo.source), createUnknownHealth()])),
    };
  }
}

/** camelCase key for the ScraperHealth map, matching the pre-T-195 nse/bse/apiFallback naming convention. */
function healthKey(source: ScraperSource): string {
  const map: Partial<Record<ScraperSource, string>> = {
    API_FALLBACK: 'apiFallback',
    INVESTORGAIN_GMP: 'investorgainGmp',
  };
  return map[source] ?? source.toLowerCase();
}

/**
 * Get health status for a specific scraper source. `lastScrapedAt` /
 * `timeSinceLastScrape` now come from `scraperLogRepository.getLastSuccess`
 * (T-195 — this was previously a hardcoded null/0 stub with a TODO).
 *
 * @param redis - Redis client for failure tracking
 * @param scraperLogRepository - Source of truth for last-successful-scrape timestamps
 * @param source - Scraper source
 * @param maxStalenessMs - This source's freshness SLO (from freshness-slo.ts)
 * @returns Scraper health status
 */
async function getScraperHealth(
  redis: Redis,
  scraperLogRepository: Pick<ScraperLogRepository, 'getLastSuccess'>,
  source: ScraperSource,
  maxStalenessMs: number
): Promise<ScraperHealth> {
  try {
    const failureKey = `scraper:${source}:failures`;
    const failures = await redis.get(failureKey);
    const consecutiveFailures = failures ? parseInt(failures, 10) : 0;

    const lastSuccess = await scraperLogRepository.getLastSuccess(source);
    const lastScrapedAt = lastSuccess ? new Date(lastSuccess.createdAt) : null;
    // A source that has NEVER succeeded (fresh deploy / new source) is
    // "unknown freshness", not "infinitely stale" — timeSinceLastScrape
    // stays 0 and staleness plays no part in this source's status, matching
    // the null-lastRun handling already relied on by
    // /api/admin/scraper/status (GitHub #3: null means "never ran", not "stale").
    const timeSinceLastScrape = lastScrapedAt ? Date.now() - lastScrapedAt.getTime() : 0;

    const staleWarning = lastScrapedAt !== null && timeSinceLastScrape >= maxStalenessMs / 2;
    const staleAlert = lastScrapedAt !== null && timeSinceLastScrape >= maxStalenessMs;

    let status: 'OK' | 'WARNING' | 'ALERT' = 'OK';
    if (consecutiveFailures >= CONSECUTIVE_FAILURES_ALERT || staleAlert) {
      status = 'ALERT';
    } else if (consecutiveFailures >= CONSECUTIVE_FAILURES_WARNING || staleWarning) {
      status = 'WARNING';
    }

    return {
      lastScrapedAt,
      timeSinceLastScrape,
      consecutiveFailures,
      status,
    };
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        source,
      },
      'Failed to get scraper health'
    );
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
