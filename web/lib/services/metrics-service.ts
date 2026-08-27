/**
 * Business Metrics Service
 *
 * Collects and exposes business-level metrics for monitoring
 * IPO data quality, scraper health, and application performance.
 */

import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { logger, logBusinessMetric } from '../logging/logger';

export interface BusinessMetrics {
  ipoStats: {
    total: number;
    upcoming: number;
    open: number;
    closed: number;
    listed: number;
    mainboard: number;
    sme: number;
  };
  dataFreshness: {
    lastScraperRun: Date | null;
    staleIPOs: number; // Updated > 24h ago
    oldestUpdate: Date | null;
  };
  scraperHealth: {
    successRate: number;
    failedLast24h: number;
    avgDuration: number;
    totalRuns: number;
  };
  apiHealth: {
    avgResponseTime: number;
    errorRate: number;
    cacheHitRate: number;
  };
  systemHealth: {
    memoryUsageMB: number;
    uptimeSeconds: number;
  };
}

/**
 * Collect all business metrics
 */
export async function collectBusinessMetrics(): Promise<BusinessMetrics> {
  try {
    // IPO statistics
    const ipoStatsResult = await db.execute(sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'UPCOMING') as upcoming,
        COUNT(*) FILTER (WHERE status = 'OPEN') as open,
        COUNT(*) FILTER (WHERE status = 'CLOSED') as closed,
        COUNT(*) FILTER (WHERE status = 'LISTED') as listed,
        COUNT(*) FILTER (WHERE segment = 'MAINBOARD') as mainboard,
        COUNT(*) FILTER (WHERE segment = 'SME') as sme
      FROM ipos
    `);

    const ipoStats = {
      total: Number(ipoStatsResult.rows[0]?.total || 0),
      upcoming: Number(ipoStatsResult.rows[0]?.upcoming || 0),
      open: Number(ipoStatsResult.rows[0]?.open || 0),
      closed: Number(ipoStatsResult.rows[0]?.closed || 0),
      listed: Number(ipoStatsResult.rows[0]?.listed || 0),
      mainboard: Number(ipoStatsResult.rows[0]?.mainboard || 0),
      sme: Number(ipoStatsResult.rows[0]?.sme || 0),
    };

    // Data freshness
    const freshnessResult = await db.execute(sql`
      SELECT
        MAX(updated_at) as last_update,
        MIN(updated_at) as oldest_update,
        COUNT(*) FILTER (WHERE updated_at < NOW() - INTERVAL '24 hours') as stale
      FROM ipos
    `);

    const dataFreshness = {
      lastScraperRun: freshnessResult.rows[0]?.last_update ? new Date(String(freshnessResult.rows[0].last_update)) : null,
      staleIPOs: Number(freshnessResult.rows[0]?.stale || 0),
      oldestUpdate: freshnessResult.rows[0]?.oldest_update ? new Date(String(freshnessResult.rows[0].oldest_update)) : null,
    };

    // Scraper health
    // scraper_logs has no started_at/completed_at columns (it records one row
    // per completed run, not a start/end pair) - use created_at + duration_ms,
    // and the real status enum value is 'FAILURE', not 'FAILED'.
    const scraperHealthResult = await db.execute(sql`
      SELECT
        COUNT(*) as total_runs,
        COUNT(*) FILTER (WHERE status = 'SUCCESS') as successful_runs,
        COUNT(*) FILTER (WHERE status = 'FAILURE' AND created_at > NOW() - INTERVAL '24 hours') as failed_24h,
        AVG(duration_ms) as avg_duration
      FROM scraper_logs
      WHERE created_at > NOW() - INTERVAL '7 days'
    `);

    const totalRuns = Number(scraperHealthResult.rows[0]?.total_runs || 0);
    const successfulRuns = Number(
      scraperHealthResult.rows[0]?.successful_runs || 0
    );

    const scraperHealth = {
      successRate: totalRuns > 0 ? (successfulRuns / totalRuns) * 100 : 0,
      failedLast24h: Number(scraperHealthResult.rows[0]?.failed_24h || 0),
      avgDuration: Number(scraperHealthResult.rows[0]?.avg_duration || 0),
      totalRuns,
    };

    // System health
    const memUsage = process.memoryUsage();
    const systemHealth = {
      memoryUsageMB: Math.round(memUsage.heapUsed / 1024 / 1024),
      uptimeSeconds: Math.round(process.uptime()),
    };

    // API health (will be populated from logs)
    const apiHealth = {
      avgResponseTime: 0, // TODO: Calculate from logs
      errorRate: 0, // TODO: Calculate from logs
      cacheHitRate: 0, // TODO: Calculate from Redis stats
    };

    const metrics: BusinessMetrics = {
      ipoStats,
      dataFreshness,
      scraperHealth,
      apiHealth,
      systemHealth,
    };

    // Log key metrics
    logBusinessMetric('ipo.total', ipoStats.total);
    logBusinessMetric('ipo.open', ipoStats.open);
    logBusinessMetric('ipo.stale', dataFreshness.staleIPOs);
    logBusinessMetric('scraper.success_rate', scraperHealth.successRate);
    logBusinessMetric('system.memory_mb', systemHealth.memoryUsageMB);

    logger.info('Business metrics collected', metrics);

    return metrics;
  } catch (error) {
    logger.error('Failed to collect business metrics', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get IPO data quality metrics
 */
export async function getDataQualityMetrics() {
  try {
    // ipos has price_range_min/price_range_max (not price_range_lower/upper)
    // and no total_shares column at all - share counts live on subscriptions
    // (total_shares_bid) and ipo_details (total_shares_offered), not on ipos
    // itself, so there is no single ipos-level "missing shares" dimension.
    const result = await db.execute(sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE lot_size IS NULL OR lot_size = 0) as missing_lot_size,
        COUNT(*) FILTER (WHERE price_range_min IS NULL OR price_range_max IS NULL) as missing_price,
        COUNT(*) FILTER (WHERE open_date IS NULL) as missing_open_date,
        COUNT(*) FILTER (WHERE close_date IS NULL) as missing_close_date
      FROM ipos
      WHERE status IN ('UPCOMING', 'OPEN')
    `);

    const total = Number(result.rows[0]?.total || 0);

    return {
      total,
      completeness: {
        lotSize:
          total > 0
            ? ((total - Number(result.rows[0]?.missing_lot_size || 0)) /
                total) *
              100
            : 0,
        priceRange:
          total > 0
            ? ((total - Number(result.rows[0]?.missing_price || 0)) / total) *
              100
            : 0,
        openDate:
          total > 0
            ? ((total - Number(result.rows[0]?.missing_open_date || 0)) /
                total) *
              100
            : 0,
        closeDate:
          total > 0
            ? ((total - Number(result.rows[0]?.missing_close_date || 0)) /
                total) *
              100
            : 0,
      },
    };
  } catch (error) {
    logger.error('Failed to get data quality metrics', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
