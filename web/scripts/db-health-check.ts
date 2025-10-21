/**
 * Database Health Check Script
 *
 * Monitors database performance metrics including slow queries,
 * connection pool usage, cache hit ratio, and index utilization.
 */

import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { logger } from '@/lib/logging/logger';
import { sendAlert, AlertLevel } from '@/lib/monitoring/alerts';

export interface DatabaseHealthMetrics {
  slowQueries: Array<{
    query: string;
    meanExecTime: number;
    calls: number;
    maxExecTime: number;
  }>;
  connectionStats: {
    activeConnections: number;
    totalConnections: number;
    cacheHitRatio: number;
  };
  tableSizes: Array<{
    tableName: string;
    size: string;
    rowCount: number;
  }>;
  unusedIndexes: Array<{
    tableName: string;
    indexName: string;
    indexSize: string;
  }>;
}

/**
 * Check database health and return metrics
 */
export async function checkDatabaseHealth(): Promise<DatabaseHealthMetrics> {
  try {
    logger.info('Starting database health check');

    // Check slow queries (> 100ms)
    const slowQueriesResult = await db.execute(sql`
      SELECT
        SUBSTRING(query, 1, 100) as query,
        calls,
        mean_exec_time,
        max_exec_time,
        stddev_exec_time
      FROM pg_stat_statements
      WHERE mean_exec_time > 100
      ORDER BY mean_exec_time DESC
      LIMIT 20
    `);

    const slowQueries = slowQueriesResult.rows.map((row: any) => ({
      query: row.query,
      meanExecTime: parseFloat(row.mean_exec_time),
      calls: parseInt(row.calls),
      maxExecTime: parseFloat(row.max_exec_time),
    }));

    if (slowQueries.length > 0) {
      logger.warn('Slow queries detected', {
        count: slowQueries.length,
        slowest: slowQueries[0]?.meanExecTime,
      });

      if (slowQueries[0]?.meanExecTime > 500) {
        await sendAlert({
          level: AlertLevel.CRITICAL,
          title: 'Critical slow query detected',
          message: `Query averaging ${slowQueries[0].meanExecTime.toFixed(2)}ms`,
          metadata: {
            query: slowQueries[0].query,
            avgTime: slowQueries[0].meanExecTime,
          },
        });
      }
    }

    // Check connection pool stats
    const poolStatsResult = await db.execute(sql`
      SELECT
        numbackends as active_connections,
        xact_commit,
        xact_rollback,
        blks_read,
        blks_hit
      FROM pg_stat_database
      WHERE datname = current_database()
    `);

    const poolStats = poolStatsResult.rows[0] as any;
    const activeConnections = parseInt(poolStats?.active_connections || '0');

    // Calculate cache hit ratio
    const blksRead = parseInt(poolStats?.blks_read || '0');
    const blksHit = parseInt(poolStats?.blks_hit || '0');
    const cacheHitRatio =
      blksRead + blksHit > 0
        ? (blksHit / (blksRead + blksHit)) * 100
        : 0;

    if (activeConnections > 18) {
      await sendAlert({
        level: AlertLevel.WARNING,
        title: 'Connection pool near capacity',
        message: `${activeConnections}/20 connections in use`,
        metadata: {
          connections: activeConnections,
          maxConnections: 20,
        },
      });
    }

    if (cacheHitRatio < 95) {
      await sendAlert({
        level: AlertLevel.WARNING,
        title: 'Low database cache hit ratio',
        message: `Cache hit ratio: ${cacheHitRatio.toFixed(2)}%`,
        metadata: {
          cacheHitRatio,
          threshold: 95,
        },
      });
    }

    const connectionStats = {
      activeConnections,
      totalConnections: 20,
      cacheHitRatio,
    };

    // Check table sizes
    const tableSizesResult = await db.execute(sql`
      SELECT
        schemaname || '.' || tablename as table_name,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
        n_live_tup as row_count
      FROM pg_tables
      JOIN pg_stat_user_tables USING (schemaname, tablename)
      WHERE schemaname = 'public'
      ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
      LIMIT 10
    `);

    const tableSizes = tableSizesResult.rows.map((row: any) => ({
      tableName: row.table_name,
      size: row.size,
      rowCount: parseInt(row.row_count || '0'),
    }));

    // Check for unused indexes
    const unusedIndexesResult = await db.execute(sql`
      SELECT
        schemaname || '.' || tablename as table_name,
        indexname as index_name,
        pg_size_pretty(pg_relation_size(schemaname||'.'||indexname)) as index_size
      FROM pg_stat_user_indexes
      WHERE idx_scan = 0
        AND schemaname = 'public'
        AND indexname NOT LIKE '%_pkey'
      ORDER BY pg_relation_size(schemaname||'.'||indexname) DESC
      LIMIT 10
    `);

    const unusedIndexes = unusedIndexesResult.rows.map((row: any) => ({
      tableName: row.table_name,
      indexName: row.index_name,
      indexSize: row.index_size,
    }));

    if (unusedIndexes.length > 0) {
      logger.warn('Unused indexes detected', {
        count: unusedIndexes.length,
      });
    }

    const metrics: DatabaseHealthMetrics = {
      slowQueries,
      connectionStats,
      tableSizes,
      unusedIndexes,
    };

    logger.info('Database health check complete', {
      slowQueries: slowQueries.length,
      connections: activeConnections,
      cacheHitRatio: cacheHitRatio.toFixed(2),
      unusedIndexes: unusedIndexes.length,
    });

    return metrics;
  } catch (error) {
    logger.error('Database health check failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Run health check periodically
 */
export function startDatabaseMonitoring(intervalMinutes: number = 5) {
  logger.info('Starting database monitoring', {
    interval: `${intervalMinutes} minutes`,
  });

  // Run immediately
  checkDatabaseHealth().catch((error) => {
    logger.error('Initial database health check failed', { error });
  });

  // Then run periodically
  setInterval(() => {
    checkDatabaseHealth().catch((error) => {
      logger.error('Periodic database health check failed', { error });
    });
  }, intervalMinutes * 60 * 1000);
}

// Run if executed directly
if (require.main === module) {
  checkDatabaseHealth()
    .then((metrics) => {
      console.log('\n=== Database Health Check Results ===\n');
      console.log(JSON.stringify(metrics, null, 2));
      process.exit(0);
    })
    .catch((error) => {
      console.error('Health check failed:', error);
      process.exit(1);
    });
}
