/**
 * Redis Connection Test Script
 *
 * Tests Redis connectivity and provides diagnostics for fault tolerance testing
 */

import { getRedisClient, testRedisConnection } from '../lib/cache/redis-client';

async function testRedis() {
  console.log('=== Redis Connection Test ===\n');

  try {
    console.log('1. Testing connection...');
    const isHealthy = await testRedisConnection();

    if (isHealthy) {
      console.log('✓ Redis connection successful\n');

      const redis = getRedisClient();

      // Test basic operations
      console.log('2. Testing SET operation...');
      await redis.set('test:key', 'test-value', 'EX', 10);
      console.log('✓ SET operation successful\n');

      console.log('3. Testing GET operation...');
      const value = await redis.get('test:key');
      console.log(`✓ GET operation successful: ${value}\n`);

      console.log('4. Testing DEL operation...');
      await redis.del('test:key');
      console.log('✓ DEL operation successful\n');

      console.log('5. Getting Redis info...');
      const info = await redis.info('server');
      const lines = info.split('\r\n');
      const version = lines.find(l => l.startsWith('redis_version:'));
      console.log(`✓ ${version}\n`);

      console.log('=== All tests passed ===');
      process.exit(0);
    } else {
      console.log('✗ Redis connection failed\n');
      console.log('=== Test failed ===');
      process.exit(1);
    }
  } catch (error) {
    console.error('✗ Error during testing:', error);
    console.log('\n=== Test failed ===');
    process.exit(1);
  }
}

testRedis();
