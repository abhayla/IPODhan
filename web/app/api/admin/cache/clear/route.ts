/**
 * API Route: Cache Management
 * POST /api/admin/cache/clear - Clear Redis cache by pattern or all caches
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/middleware/admin-auth';
import { getRedisClient } from '@/lib/cache/redis-client';

/**
 * GET /api/admin/cache/clear
 * Get cache statistics
 */
export const GET = withAdminAuth(async (request: NextRequest, adminContext) => {
  try {
    const redis = getRedisClient();

    // Get cache statistics
    const dbSize = await redis.dbsize();
    const info = await redis.info('memory');

    // Parse memory info
    const memoryMatch = info.match(/used_memory_human:([^\r\n]+)/);
    const memoryUsage = memoryMatch ? memoryMatch[1] : 'Unknown';

    // Get pattern counts
    const protectionKeys = await redis.keys('protection:*');
    const ipoKeys = await redis.keys('ipo:*');
    const subscriptionKeys = await redis.keys('subscription:*');
    const gmpKeys = await redis.keys('gmp:*');
    const otherKeys = dbSize - protectionKeys.length - ipoKeys.length - subscriptionKeys.length - gmpKeys.length;

    console.log(`[Admin API] Cache stats requested by ${adminContext.adminName}`);

    return NextResponse.json({
      success: true,
      data: {
        totalKeys: dbSize,
        memoryUsage,
        breakdown: {
          protection: protectionKeys.length,
          ipo: ipoKeys.length,
          subscription: subscriptionKeys.length,
          gmp: gmpKeys.length,
          other: Math.max(0, otherKeys),
        },
      },
    });
  } catch (error) {
    console.error('[Admin API] Failed to get cache statistics:', error);
    return NextResponse.json(
      { error: 'Failed to get cache statistics', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
});

/**
 * POST /api/admin/cache/clear
 * Clear cache by pattern or all caches
 */
export const POST = withAdminAuth(async (request: NextRequest, adminContext) => {
  try {
    const body = await request.json();
    const { pattern, clearAll } = body;

    // Validation
    if (clearAll !== true && !pattern) {
      return NextResponse.json(
        { error: 'Either pattern or clearAll=true is required' },
        { status: 400 }
      );
    }

    const redis = getRedisClient();
    let keysCleared = 0;
    let deletedKeys: string[] = [];

    if (clearAll) {
      // Clear all caches
      const allKeys = await redis.keys('*');
      keysCleared = allKeys.length;

      if (keysCleared > 0) {
        await redis.del(...allKeys);
        deletedKeys = allKeys.slice(0, 10); // Store first 10 for logging
      }

      console.log(
        `[Admin API] Cleared ALL caches (${keysCleared} keys) by ${adminContext.adminName}`
      );
    } else {
      // Clear by pattern
      const keys = await redis.keys(pattern);
      keysCleared = keys.length;

      if (keysCleared > 0) {
        await redis.del(...keys);
        deletedKeys = keys.slice(0, 10); // Store first 10 for logging
      }

      console.log(
        `[Admin API] Cleared ${keysCleared} cache keys matching pattern "${pattern}" by ${adminContext.adminName}`
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        keysCleared,
        pattern: clearAll ? '*' : pattern,
        sampleKeys: deletedKeys,
      },
      message: clearAll
        ? `Successfully cleared all ${keysCleared} cache keys`
        : `Successfully cleared ${keysCleared} cache keys matching "${pattern}"`,
    });
  } catch (error) {
    console.error('[Admin API] Failed to clear cache:', error);
    return NextResponse.json(
      { error: 'Failed to clear cache', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
});
