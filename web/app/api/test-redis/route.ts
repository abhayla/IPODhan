import { NextResponse } from 'next/server';
import { testRedisConnection, getRedisClient } from '@/lib/redis-client';
import { logger } from '@/lib/logger';

/**
 * Test Redis API Route
 *
 * Tests Redis connection and basic operations
 * GET /api/test-redis
 */
export async function GET() {
  try {
    // Test connection
    const isConnected = await testRedisConnection();

    if (!isConnected) {
      return NextResponse.json(
        {
          success: false,
          error: 'Redis connection failed',
          message: 'Ensure Redis is running (redis-server) or REDIS_URL is set',
        },
        { status: 500 }
      );
    }

    // Test basic operations
    const client = getRedisClient();
    const testKey = 'test:ipodhan:connection';
    const testValue = JSON.stringify({ timestamp: new Date().toISOString(), test: true });

    // SET operation
    await client.set(testKey, testValue, 'EX', 60); // Expires in 60 seconds

    // GET operation
    const retrieved = await client.get(testKey);

    // DELETE operation
    await client.del(testKey);

    logger.info('Redis test successful');

    return NextResponse.json({
      success: true,
      message: 'Redis connection and operations successful',
      operations: {
        ping: 'PONG',
        set: 'OK',
        get: retrieved ? 'OK' : 'FAILED',
        del: 'OK',
      },
      retrievedValue: retrieved,
    });
  } catch (error: any) {
    logger.error({ error }, 'Redis test failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Redis test failed',
        message: error?.message || 'Unknown error',
        hint: 'Make sure Redis is running: redis-server',
      },
      { status: 500 }
    );
  }
}
