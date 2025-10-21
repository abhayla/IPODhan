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
      lastScraperRun: freshnessResult.rows[0]?.last_update || null,
      staleIPOs: Number(freshnessResult.rows[0]?.stale || 0),
      oldestUpdate: freshnessResult.rows[0]?.oldest_update || null,
    };

    // Scraper health
    const scraperHealthResult = await db.execute(sql`
      SELECT
        COUNT(*) as total_runs,
        COUNT(*) FILTER (WHERE status = 'SUCCESS') as successful_runs,
        COUNT(*) FILTER (WHERE status = 'FAILED' AND started_at > NOW() - INTERVAL '24 hours') as failed_24h,
        AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_duration
      FROM scraper_logs
      WHERE started_at > NOW() - INTERVAL '7 days'
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
    const result = await db.execute(sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE lot_size IS NULL OR lot_size = 0) as missing_lot_size,
        COUNT(*) FILTER (WHERE price_range_lower IS NULL OR price_range_upper IS NULL) as missing_price,
        COUNT(*) FILTER (WHERE open_date IS NULL) as missing_open_date,
        COUNT(*) FILTER (WHERE close_date IS NULL) as missing_close_date,
        COUNT(*) FILTER (WHERE total_shares IS NULL OR total_shares = 0) as missing_shares
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
        totalShares:
          total > 0
            ? ((total - Number(result.rows[0]?.missing_shares || 0)) / total) *
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
