/**
 * Clear stale IPO listings cache from Redis
 *
 * This script clears cached IPO listing data that may be showing
 * outdated or empty results for 2025 listings.
 *
 * Usage: npx tsx scripts/clear-listings-cache.ts
 */

import { getRedisClient } from '../lib/cache/redis-client';

async function clearListingsCache() {
  const redis = getRedisClient();

  try {
    console.log('[Cache Clear] Starting cache cleanup for IPO listings...');

    // Pattern to match all IPO listing cache keys
    const pattern = 'ipo:listings:*';

    // Find all matching keys
    const keys = await redis.keys(pattern);

    if (keys.length === 0) {
      console.log('[Cache Clear] No cache keys found matching pattern:', pattern);
      return;
    }

    console.log(`[Cache Clear] Found ${keys.length} cache keys to delete:`);
    keys.forEach(key => console.log(`  - ${key}`));

    // Delete all matching keys
    const deleted = await redis.del(...keys);

    console.log(`[Cache Clear] Successfully deleted ${deleted} cache entries`);
    console.log('[Cache Clear] Cache cleanup complete!');

    // Close Redis connection
    redis.disconnect();

    process.exit(0);
  } catch (error) {
    console.error('[Cache Clear] Error clearing cache:', error);
    redis.disconnect();
    process.exit(1);
  }
}

// Run the script
clearListingsCache();
