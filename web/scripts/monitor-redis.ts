/**
 * Redis Health Monitoring Script
 *
 * Monitors Redis performance including hit rate, memory usage,
 * eviction rate, and connection health.
 */

import { getRedisClient } from '@/lib/cache/redis-client';
import { logger } from '@/lib/logging/logger';
import { sendAlert, AlertLevel } from '@/lib/monitoring/alerts';

export interface RedisHealthMetrics {
  connection: {
    status: 'healthy' | 'degraded' | 'down';
    responseTime: number;
  };
  memory: {
    usedMemory: string;
    usedMemoryPeak: string;
    usedMemoryRss: string;
    memFragmentationRatio: number;
  };
  stats: {
    totalKeys: number;
    hitRate: number;
    evictedKeys: number;
    expiredKeys: number;
    opsPerSec: number;
  };
  persistence: {
    lastSaveTime: number;
    changesSinceLastSave: number;
  };
}

/**
 * Parse Redis INFO output into object
 */
function parseRedisInfo(info: string): Record<string, any> {
  const lines = info.split('\r\n');
  const stats: Record<string, any> = {};

  for (const line of lines) {
    if (line && !line.startsWith('#')) {
      const [key, value] = line.split(':');
      if (key && value !== undefined) {
        // Try to parse as number
        const numValue = parseFloat(value);
        stats[key] = isNaN(numValue) ? value : numValue;
      }
    }
  }

  return stats;
}

/**
 * Get total number of keys in Redis
 */
async function getTotalKeys(redis: any): Promise<number> {
  try {
    const dbInfo = await redis.info('keyspace');
    const match = dbInfo.match(/keys=(\d+)/);
    return match ? parseInt(match[1]) : 0;
  } catch (error) {
    logger.error('Failed to get Redis key count', { error });
    return 0;
  }
}

/**
 * Monitor Redis health
 */
export async function monitorRedisHealth(): Promise<RedisHealthMetrics> {
  const redis = getRedisClient();
  const startTime = Date.now();

  try {
    // Test connection
    await redis.ping();
    const responseTime = Date.now() - startTime;

    const connectionStatus =
      responseTime < 100
        ? 'healthy'
        : responseTime < 500
          ? 'degraded'
          : 'down';

    // Get Redis INFO stats
    const [statsInfo, memoryInfo, persistenceInfo] = await Promise.all([
      redis.info('stats'),
      redis.info('memory'),
      redis.info('persistence'),
    ]);

    const stats = parseRedisInfo(statsInfo);
    const memStats = parseRedisInfo(memoryInfo);
    const persistStats = parseRedisInfo(persistenceInfo);

    // Get total keys
    const totalKeys = await getTotalKeys(redis);

    // Calculate hit rate
    const keyspaceHits = stats.keyspace_hits || 0;
    const keyspaceMisses = stats.keyspace_misses || 0;
    const hitRate =
      keyspaceHits + keyspaceMisses > 0
        ? (keyspaceHits / (keyspaceHits + keyspaceMisses)) * 100
        : 0;

    const metrics: RedisHealthMetrics = {
      connection: {
        status: connectionStatus as 'healthy' | 'degraded' | 'down',
        responseTime,
      },
      memory: {
        usedMemory: memStats.used_memory_human || 'N/A',
        usedMemoryPeak: memStats.used_memory_peak_human || 'N/A',
        usedMemoryRss: memStats.used_memory_rss_human || 'N/A',
        memFragmentationRatio: memStats.mem_fragmentation_ratio || 0,
      },
      stats: {
        totalKeys,
        hitRate,
        evictedKeys: stats.evicted_keys || 0,
        expiredKeys: stats.expired_keys || 0,
        opsPerSec: stats.instantaneous_ops_per_sec || 0,
      },
      persistence: {
        lastSaveTime: persistStats.rdb_last_save_time || 0,
        changesSinceLastSave: persistStats.rdb_changes_since_last_save || 0,
      },
    };

    logger.info('Redis health metrics collected', {
      hitRate: hitRate.toFixed(2),
      totalKeys,
      memoryUsed: memStats.used_memory_human,
      evictedKeys: stats.evicted_keys,
      opsPerSec: stats.instantaneous_ops_per_sec,
    });

    // Send alerts for issues
    if (hitRate < 80) {
      await sendAlert({
        level: AlertLevel.WARNING,
        title: 'Redis cache hit rate below target',
        message: `Cache hit rate: ${hitRate.toFixed(2)}% (target: >80%)`,
        metadata: {
          hitRate: hitRate.toFixed(2),
          threshold: 80,
        },
      });
    }

    if (stats.evicted_keys > 100) {
      await sendAlert({
        level: AlertLevel.WARNING,
        title: 'High Redis eviction rate',
        message: `${stats.evicted_keys} keys evicted (possible memory pressure)`,
        metadata: {
          evictedKeys: stats.evicted_keys,
          threshold: 100,
        },
      });
    }

    if (memStats.mem_fragmentation_ratio > 1.5) {
      await sendAlert({
        level: AlertLevel.WARNING,
        title: 'High Redis memory fragmentation',
        message: `Fragmentation ratio: ${memStats.mem_fragmentation_ratio.toFixed(2)}`,
        metadata: {
          fragmentationRatio: memStats.mem_fragmentation_ratio.toFixed(2),
          threshold: 1.5,
        },
      });
    }

    if (connectionStatus === 'degraded') {
      await sendAlert({
        level: AlertLevel.WARNING,
        title: 'Redis connection degraded',
        message: `Response time: ${responseTime}ms (threshold: 100ms)`,
        metadata: {
          responseTime,
          threshold: 100,
        },
      });
    }

    return metrics;
  } catch (error) {
    logger.error('Redis monitoring failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    await sendAlert({
      level: AlertLevel.CRITICAL,
      title: 'Redis monitoring failed',
      message:
        error instanceof Error ? error.message : 'Unknown error occurred',
    });

    throw error;
  }
}

/**
 * Start periodic Redis monitoring
 */
export function startRedisMonitoring(intervalMinutes: number = 2) {
  logger.info('Starting Redis monitoring', {
    interval: `${intervalMinutes} minutes`,
  });

  // Run immediately
  monitorRedisHealth().catch((error) => {
    logger.error('Initial Redis health check failed', { error });
  });

  // Then run periodically
  setInterval(() => {
    monitorRedisHealth().catch((error) => {
      logger.error('Periodic Redis health check failed', { error });
    });
  }, intervalMinutes * 60 * 1000);
}

// Run if executed directly
if (require.main === module) {
  monitorRedisHealth()
    .then((metrics) => {
      console.log('\n=== Redis Health Check Results ===\n');
      console.log(JSON.stringify(metrics, null, 2));
      process.exit(0);
    })
    .catch((error) => {
      console.error('Health check failed:', error);
      process.exit(1);
    });
}
